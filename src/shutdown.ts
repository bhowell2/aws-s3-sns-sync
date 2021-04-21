import { log, LogLevel } from "./logger";

export type StopService = () => Promise<void> | void

/**
 * Promise should be returned when the function is asynchronous,
 * otherwise the function MUST BE synchronous or it will not
 * work correctly.
 */
type ShutdownHook = () => Promise<any> | void;

const shutdownHandlers: Array<ShutdownHook> = [];

/**
 * The shutdown hook should be synchronous, ensuring that the system does
 * not exit before intended.
 * @param hook
 */
export function registerShutdownHook(hook: ShutdownHook) {
  shutdownHandlers.push(hook);
}

/**
 * Removes all instances of the hook from the registered shutdown
 * hooks. This removes all instances because it is possible the
 * same hook was registered multiple times
 * @param hook
 * @param removeAllMatches whether or not to attempt to match more than once
 */
export function removeShutdownHook(hook: ShutdownHook, removeAllMatches: boolean = true) {
  const indexes = [];
  for (let i = 0; i < shutdownHandlers.length; i++) {
    if (hook === shutdownHandlers[i]) {
      indexes.push(i)
      if (!removeAllMatches) {
        break;
      }
    }
  }
  for (let i = 0; i < indexes.length; i++) {
    shutdownHandlers.splice(indexes[i] - i, 1);
  }
}

// 15 seconds
let SHUTDOWN_TIMEOUT = 15_000;

export function setShutownTimeout(milliseconds: number) {
  SHUTDOWN_TIMEOUT = milliseconds;
}

/**
 * Handles running the hooks in an asynchronous manner and calling
 * process.exit(exitCode) when the hooks finish. This is used in
 * various failure/interrupt events rather than only on the 'exit',
 * because it will run async handlers and THEN call exit, while exit
 * expects all operations to be synchronous and thus will exit before
 * async events have completed.
 */
function runHooks(exitCode: number, timeoutMillis: number, args?: any) {
  if (shutdownHandlers.length > 0) {
    log(`Running ${shutdownHandlers.length} shutdown hooks.`, LogLevel.DEBUG);
    setTimeout(() => {
      process.exit(exitCode);
    }, timeoutMillis || 0);
    let promises = [];
    for (let i = 0; i < shutdownHandlers.length; i++) {
      const potentialPromise = shutdownHandlers[i]();
      if (potentialPromise instanceof Promise) {
        potentialPromise.catch(err => { // catch error so as not to hang shutdown process
          console.error(err);
        });
        promises.push(potentialPromise);
      }
    }
    // remove all shutdown handlers that were run.
    shutdownHandlers.splice(0, shutdownHandlers.length);
    Promise.all(promises).then(() => process.exit(exitCode));
  }
}

process.on('exit', () => {
  /*
  * If the hooks are async this will possibly complete before they
  * actually run and there is no way to really combat this.
  * */
  runHooks(0, 60 * 1000);
});

[
  'beforeExit', 'uncaughtException', 'unhandledRejection',
  'SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP',
  'SIGABRT', 'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV',
  'SIGUSR2', 'SIGTERM',
].forEach(processOnKey => {
  process.on(processOnKey as any, function (args) {
    console.log("Received shutdown from:");
    console.log(args);
    runHooks(1, SHUTDOWN_TIMEOUT, args)
  })
});
