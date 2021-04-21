export interface AsyncOpQueueOptions {

  /**
   * The maximum number of operations that can be performed at a time.
   *
   * In the context of the sync program this will limit the number of
   * concurrent file writes.
   *
   * Defaults to 300.
   */
  maxConcurrency?: number

  /**
   * Will remove the task from the list of currently running tasks if
   * the specified amount of time has passed. The expiration does not actually
   * stop the task if it is already running, but allows other tasks with
   * the same key to be run.
   *
   * Values:
   * undefined  - never expiration
   * <= 0       - expiration immediately
   * > 0        - expiration in the future by that number of millis
   */
  defaultTaskRunTimeoutMillis: number | undefined

  /**
   * Sets the interval for the reaper to run on to check for expired task keys.
   * This ensures that the set that tracks running tasks does not grow unbounded
   * if the same key is never reused (expiration is checked when a key is used
   * as well). A value of 0 (or less) will result in no reaper being run, undefined
   * will result in the default of 100 being used, otherwise the value supplied
   * will be used.
   *
   * Care should be taken when using this, because if the concurrency is very large,
   * it will block the event loop while the expiration of every key is checked.
   *
   * Defaults to 10.
   */
  taskReaperIntervalMillis?: number

  /**
   * By default this will not catch errors. Meaning that the application/queue will
   * shutdown if the error is not caught INSIDE the submitted task. Note this may
   * be ignored when using the promise based tasks, because unhandled-rejections
   * may only trigger a warning rather than a failure. See: https://nodejs.org/docs/latest-v12.x/api/cli.html#cli_unhandled_rejections_mode
   * for more information. Use the command line option --unhandled-rejections=strict
   * so that regular tasks and promise tasks are handled the same way.
   */
  catchErrors?: boolean

}

type Task = (onComplete: () => void) => void

export type PromiseTask<T> = () => Promise<T>

interface QueueItem {
  next: QueueItem | undefined
  key: string
  task: Task
  runTimeout: number | undefined
}

interface RunningTask {
  expiration: number | undefined
  id: number
}

/**
 * A linked list type queue. This ensures that the task is only run once.
 */
export default class AsyncOpQueue {

  maxConcurrency: number;
  defaultTaskRunTimeoutMillis: number | undefined;  // undefined represents no expiration
  reaperIntervalMillis: number;
  /*
   * Used to track the expiration(s) for a task(s) key.
   */
  runningTasks: {[key: string]: RunningTask} = {};
  runCount = 0;

  catchErrors: boolean

  queueHead: QueueItem | undefined;
  queueTail: QueueItem | undefined;
  /*
  * Number of items in the queue.
  * */
  size = 0;
  /*
  * A run ID is provided to each task's onComplete function to ensure
  * that the correct task is removed when it is called. This ensures
  * that if the expiration has expired for the task and it has been removed
  * by the reaper rather than the onComplete function call that a
  * currently running task with the same key will not be removed by the
  * onComplete function of the older task.
  * */
  runId = 0;

  shutdown = false;
  shutdownImmediately = false;

  constructor(options: AsyncOpQueueOptions) {
    this.maxConcurrency = options?.maxConcurrency || 300;
    this.defaultTaskRunTimeoutMillis = options?.defaultTaskRunTimeoutMillis;
    this.reaperIntervalMillis = options?.taskReaperIntervalMillis || 10;
    this.catchErrors = options.catchErrors || false;
    // start the queue
    this.run();
    // start the check for expiration
    this.reap();
  }

  public queueSize() {
    return this.size;
  }

  public runningCount() {
    return this.runCount;
  }

  public submit(key: string, task: Task, runTimeout = this.defaultTaskRunTimeoutMillis) {
    // if queue not shutdown then can submit item to be run
    if (!this.shutdown) {
      const queueItem = {next: undefined, key, task, runTimeout};
      this.size++;
      if (this.queueHead === undefined) {
        this.queueHead = queueItem;
        this.queueTail = this.queueHead;
      }
        // else if (this.queueHead === this.queueTail) {
        //   this.queueTail = queueItem;
        //   this.queueHead.next = this.queueTail;
      // }
      else {
        if (!this.queueTail) {
          throw new Error("The tail queue should never be undefined at this point.")
        }
        /*
        * In the case that queueTail = queueHead this is like setting
        * queueHead.next = queueItem
        * queueTail = queueItem
        * In the case that queueTail != queueHead this is like setting
        * */
        this.queueTail.next = queueItem;
        this.queueTail = queueItem;
      }
    }
  }

  public submitPromiseTask<T>(key: string,
                              promiseTask: PromiseTask<T>,
                              runTimeout = this.defaultTaskRunTimeoutMillis) {
    if (this.catchErrors) {
      this.submit(key, onComplete => {
        promiseTask().then(res => {
          onComplete();
          return res;
        }).catch(err => {
          onComplete()
          return Promise.reject(err)
        })
      }, runTimeout)
    } else {
      this.submit(key, onComplete => {
        promiseTask().then(res => {
          onComplete();
          return res;
        })
      }, runTimeout)
    }
  }

  /**
   * Tasks must be removed by both the key and their id. This ensures that
   * if a task has timed out and been removed by the reaper a future task
   * with the same key is not removed by timed out task's onComplete function.
   * @param key
   * @param id
   */
  private removeRunningTask(key: string, id: number) {
    const runningTask = this.runningTasks[key];
    // only remove if the key and id are correct, otherwise ignore
    if (runningTask && runningTask.id === id) {
      delete this.runningTasks[key];
      this.runCount--;
    }
  }

  /**
   * Removes the key from running tasks if the task for a key has timed out.
   */
  private reap() {
    if (this.reaperIntervalMillis && this.reaperIntervalMillis > 0 && !this.shutdown) {
      setTimeout(() => {
        /*
        * Using currentTime this way is conservative as it will not update for
        * every iteration of the loop but will set some lower bound for the
        * */
        const currentTime = Date.now();
        for (const key in this.runningTasks) {
          const runningTask = this.runningTasks[key];
          if (runningTask.expiration !== undefined && runningTask.expiration - currentTime <= 0) {
            this.removeRunningTask(key, runningTask.id)
          }
        }
        // repeat on interval
        this.reap();
      }, this.reaperIntervalMillis);
    }
  }

  /**
   * Called by the constructor, goes through the linked list and runs the
   * task if the maxConcurrency has not been exceeded and a task for the
   * given key is not already running (or has timed out).
   */
  private run() {
    setImmediate(() => {
      /*
      * Tasks will be skipped if there is currently a running task for the
      * given key. When a task is skipped, it will be put at the head of the
      * queue so that it may be run (first) when the queue checks for tasks
      * to be run again.
      *
      * Because javascript is single-threaded and the tasks are async, it is
      * not a concern that tasks will be run out of order as the queue will
      * not be updated until the
      *
      * */
      let taskToRun = this.queueHead;
      let previousUnrunTask: QueueItem | undefined;
      while (taskToRun && this.runCount < this.maxConcurrency && !this.shutdownImmediately) {
        const {key} = taskToRun;
        const runningTaskForKey = this.runningTasks[key];
        /*
        * If there is no currently running task for the given key OR the
        * expiration has expired may run the task. Otherwise, need to skip
        * the current task and check the next one.
        *
        * The current design could result in starvation of the skipped tasks,
        * because once a task is skipped it isn't check again until the next
        * run() call (i.e., the loop continues with the next tasks). In the
        * current app starvation is unlikely, though, since pretty much all
        * tasks are
        * */
        if (
          runningTaskForKey === undefined ||
          (
            runningTaskForKey.expiration !== undefined &&
            runningTaskForKey.expiration - Date.now() <= 0
          )
        ) {
          const id = this.runId++;
          this.runningTasks[key] = {
            expiration: taskToRun.runTimeout !== undefined ? taskToRun.runTimeout + Date.now() : undefined,
            id
          };
          // run the task
          if (this.catchErrors) {
            try {
              taskToRun.task(() => {
                this.removeRunningTask(key, id);
              })
            } catch (err) {
              // remove when fails
              this.removeRunningTask(key, id);
            }
          } else {
            taskToRun.task(() => {
              this.removeRunningTask(key, id);
            })
          }
          this.size--;
          /*
          * Only increment runCount if there was NOT already a task running for
          * the given key. The other case here would be that a task was already
          * running for the given key, but it has expired.
          * */
          if (runningTaskForKey === undefined) {
            this.runCount++;
          }
        } else {  // cannot run task right now add to previousUnrunTask
          if (previousUnrunTask !== undefined) {
            previousUnrunTask.next = taskToRun;
            previousUnrunTask = taskToRun;
          } else {
            previousUnrunTask = taskToRun;
            this.queueHead = previousUnrunTask;
          }
        }
        taskToRun = taskToRun.next;
        if (previousUnrunTask === undefined) {
          this.queueHead = taskToRun;
        }
      }
      /*
      * If taskToRun is undefined, means reached the end of the queue, otherwise
      * stopped somewhere before due to maxConcurrency being reached (or
      * shutdownImmediately, but this is not of interest here).
      * */
      if (taskToRun === undefined) {
        /*
        * In the case that previousUnrunTask is NOT undefined, then the queueTail
        * needs to be set to the last task that was not run. Note, this is
        * because all other tasks were run (taskToRun === undefined).
        * */
        if (previousUnrunTask !== undefined) {
          this.queueTail = previousUnrunTask;
          this.queueTail.next = undefined;
        }
      } else {
        /*
        * In this case we need to link the non-run tasks with the tasks that
        * have not even been attempted to run. The non-run tasks were not run,
        * because their keys were already in use.
        * */
        if (previousUnrunTask !== undefined) {
          previousUnrunTask.next = taskToRun;
        }
      }
      /*
      * There are two cases for shutdown:
      * 1. Shutdown immediately - i.e., do not run any remaining tasks in the queue.
      * 2. Shutdown after all remaining tasks in the queue have completed.
      * */
      if (!this.shutdown) {
        this.run();
      } else {
        if (!this.shutdownImmediately && this.size > 0) {
          this.run();
        }
      }
    })
  }

  /**
   * Stops the queue from accepting any new tasks to run and either completes
   * the current tasks in the queue or, if immediately = true, does not run
   * any tasks that are still in the queue and not already running.
   *
   * Note: this does not stop a task that is already executing.
   *
   * @param immediately if true then completes the
   * @param timeout amount of time to keep queue open to attempt to finish processing tasks already in queue -
   *        this sets immediately = true when the expiration expires
   */
  public stop(immediately: boolean = false, timeout?: number) {
    if (!this.shutdown) {
      this.shutdown = true;
      this.shutdownImmediately = immediately;
      if (timeout !== undefined && !immediately) {
        setTimeout(() => {
          this.shutdownImmediately = true;
        }, timeout)
      }
    }
  }

}
