import AsyncOpQueue from "../src/AsyncOpQueue";

describe("No expiration queue tests.", () => {

  let noTimeoutQueue: AsyncOpQueue;

  beforeEach(() => {
    noTimeoutQueue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: undefined});
  });

  afterEach(() => {
    noTimeoutQueue.stop(true);
    noTimeoutQueue = undefined as any;
  });

  /*
  * Ensures that only one task is run per key concurrently.
  * This will submit multiple
  * */
  test("Should only run one task per key concurrently.", async () => {
    const key1 = "key1";
    let taskTracker: string[] = [];
    noTimeoutQueue.submit(key1, onComplete => {
      setTimeout(() => {
        taskTracker.push("key1-1");
        onComplete();
      }, 20)
    })
    noTimeoutQueue.submit(key1, onComplete => {
      setTimeout(() => {
        taskTracker.push("key1-2");
        onComplete();
      }, 20)
    })
    noTimeoutQueue.submit("key2", onComplete => {
      taskTracker.push("key2-1");
      onComplete();
    })
    // submitting with expiration of 12. this means should run AFTER key1-1, but before key1-2
    noTimeoutQueue.submit("key3", onComplete => {
      setTimeout(() => {
        taskTracker.push("key3-1");
        onComplete();
      }, 20)
    })
    noTimeoutQueue.submit("key3", onComplete => {
      taskTracker.push("key3-2")
      onComplete();
    });

    /*
    * Even though key2 runs immediately, the tracker length should be 0 here, because
    * setImmediate() of AsyncOpQueue#run() will not run until the next event loo tick.
    * */
    expect(taskTracker.length).toEqual(0);

    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(taskTracker).toEqual(["key2-1", "key1-1", "key3-1", "key3-2"])
        resolve();
      }, 30)
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(taskTracker).toEqual(["key2-1", "key1-1", "key3-1", "key3-2", "key1-2"])
          resolve();
        }, 30)
      });
    })
  })

  test("Should adjust queue size.", async () => {
    let counter = 0;
    noTimeoutQueue.submit("1", onComplete => {
      counter++;
      onComplete()
    })
    noTimeoutQueue.submit("2", onComplete => {
      counter++;
      onComplete();
    });
    expect(noTimeoutQueue.queueSize()).toEqual(2);
    expect(counter).toEqual(0)
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(noTimeoutQueue.queueSize()).toEqual(0)
        expect(counter).toEqual(2)
        resolve()
      }, 5)
    })
  })


  test("Should run in submission order when not async.", async () => {
    const key1 = "key1", key2 = "key2", key3 = "key3";
    const executionTracker: string[] = [];
    noTimeoutQueue.submit(key1, onComplete => {
      executionTracker.push(key1);
      onComplete();
    });
    noTimeoutQueue.submit(key1, onComplete => {
      executionTracker.push(key1);
      onComplete();
    });
    noTimeoutQueue.submit(key2, onComplete => {
      executionTracker.push(key2);
      onComplete();
    });
    noTimeoutQueue.submit(key1, onComplete => {
      executionTracker.push(key1);
      onComplete();
    });
    noTimeoutQueue.submit(key3, onComplete => {
      executionTracker.push(key3);
      onComplete();
    });
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(executionTracker).toEqual([key1, key1, key2, key1, key3])
        resolve()
      }, 1);
    })
  })

  test("Should run each __key__ in submitted order when async.", async () => {
    const key1 = "key1", key2 = "key2", key3 = "key3";
    const executionTracker: string[] = [];
    /*
    * The order of when key1, key2, key3 are called cannot be reasoned since
    * the timeout for any given key could be called before the other and therefore
    * the interleaved order of when key1-2 is called vs key3-1 cannot be predetermined.
    * However, the "sub" order of when each task for a given key (e.g., key1) is
    * called can be determined and they should occur in the order submitted.
    * In these tests the keys should be called in the following "sub" order:
    * key1 = key1-0, key1-1, key1-2
    * key2 = key2-0
    * key3 = key3-0, key3-1
    * */
    // key1-0
    noTimeoutQueue.submit(key1, onComplete => {
      setTimeout(() => {
        executionTracker.push(key1 + "-0");
        onComplete();
      }, 0);
    });
    // key1-1
    noTimeoutQueue.submit(key1, onComplete => {
      setTimeout(() => {
        executionTracker.push(key1 + "-1");
        onComplete();
      }, 0);
    });
    // key2-0
    noTimeoutQueue.submit(key2, onComplete => {
      setTimeout(() => {
        executionTracker.push(key2 + "-0");
        onComplete();
      }, 0);
    });
    // key1-2
    noTimeoutQueue.submit(key1, onComplete => {
      setTimeout(() => {
        executionTracker.push(key1 + "-2");
        onComplete();
      }, 0);
    });
    // key3-0
    noTimeoutQueue.submit(key3, onComplete => {
      setTimeout(() => {
        executionTracker.push(key3 + "-0");
        onComplete();
      }, 0);
    });
    // key3-1
    noTimeoutQueue.submit(key3, onComplete => {
      setTimeout(() => {
        executionTracker.push(key3 + "-1");
        onComplete();
      }, 0)
    });
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(executionTracker.length).toEqual(6);
        const keys = [key1, key2, key3];
        for (let i = 0; i < keys.length; i++) {
          let callOrder = [];
          for (let j = 0; j < executionTracker.length; j++) {
            const val = executionTracker[j];
            if (val.indexOf(keys[i]) === 0) {
              callOrder.push(val);
            }
          }
          for (let j = 0; j < callOrder.length; j++) {
            const val = callOrder[j];
            expect(val.charAt(val.length - 1) === j.toString()).toBeTruthy()
          }
        }
        resolve();
      }, 100)
    })
  })

  test("Should not expire uncompleted task.", async () => {
    noTimeoutQueue.submit("key1", onComplete => {
    });
    noTimeoutQueue.submit("key2", onComplete => {
    });
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(noTimeoutQueue.runningCount()).toEqual(2);
        resolve();
      }, 5)
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(noTimeoutQueue.runningCount()).toEqual(2);
          resolve();
        }, 120);
      })
    })
  });

})

describe("Timeout tests.", () => {

  let timeoutQueue: AsyncOpQueue;
  beforeEach(() => {
    timeoutQueue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: 100, taskReaperIntervalMillis: 10});
  })
  afterEach(() => {
    timeoutQueue.stop(true);
  })

  test("Should use expiration.", async () => {
    // by default queue does not expiration
    let counter = 0;
    timeoutQueue.submit("1", onComplete => {
      counter++;
    }, 10)
    expect(timeoutQueue.queueSize()).toEqual(1);
    expect(timeoutQueue.runningCount()).toEqual(0)
    expect(counter).toEqual(0);
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(timeoutQueue.queueSize()).toEqual(0);
        expect(timeoutQueue.runningCount()).toEqual(1)
        expect(counter).toEqual(1);
        resolve()
      }, 3)
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(timeoutQueue.queueSize()).toEqual(0);
          expect(timeoutQueue.runningCount()).toEqual(0)
          expect(counter).toEqual(1);
          resolve()
        }, 30)
      })
    })
  })

  test("Should expire uncompleted task.", async () => {
    timeoutQueue.submit("key1", onComplete => {
    });
    timeoutQueue.submit("key2", onComplete => {
    });
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(timeoutQueue.runningCount()).toEqual(2);
        resolve()
      }, 5)
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(timeoutQueue.runningCount()).toEqual(0);
          resolve();
        }, 120);
      })
    })
  })

})

describe("Max concurrency tests.", () => {

  let lowMaxConcurrencyQueue: AsyncOpQueue;
  beforeEach(() => {
    lowMaxConcurrencyQueue = new AsyncOpQueue({maxConcurrency: 2, defaultTaskRunTimeoutMillis: 100});
  })
  afterEach(() => {
    lowMaxConcurrencyQueue.stop(true);
  })

  test("Should respect maxConcurrency.", async () => {
    const tasksRun: string[] = [];
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      tasksRun.push("key1-1");
      setTimeout(() => {
        onComplete();
      }, 20)
    })
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      tasksRun.push("key1-2");
      setTimeout(() => {
        onComplete();
      }, 20)
    })
    lowMaxConcurrencyQueue.submit("key2", onComplete => {
      tasksRun.push("key2");
      setTimeout(() => {
        onComplete();
      }, 20)
    })
    lowMaxConcurrencyQueue.submit("key3", onComplete => {
      tasksRun.push("key3")
      setTimeout(() => {
        onComplete();
      }, 20)
    })
    lowMaxConcurrencyQueue.submit("key4", onComplete => {
      tasksRun.push("key4");
      setTimeout(() => {
        onComplete();
      }, 20);
    })
    expect(tasksRun).toEqual([])
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(lowMaxConcurrencyQueue.runningCount()).toEqual(2);
        expect(tasksRun).toEqual(["key1-1", "key2"]);
        resolve();
      }, 5)
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(lowMaxConcurrencyQueue.runningCount()).toEqual(2);
          expect(tasksRun).toEqual(["key1-1", "key2", "key1-2", "key3"]);
          resolve();
        }, 20)
      })
    }).then(dontCare => {
      return new Promise<void>(resolve => {
        setTimeout(() => {
          expect(lowMaxConcurrencyQueue.runningCount()).toEqual(1);
          expect(tasksRun).toEqual(["key1-1", "key2", "key1-2", "key3", "key4"]);
          resolve();
        }, 20)
      })
    })
  });

  test("Should run in order with max concurrency (non-async).", async () => {
    const runOrder: string[] = []
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      runOrder.push("key1")
      onComplete();
    })
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      runOrder.push("key1")
      onComplete();
    })
    lowMaxConcurrencyQueue.submit("key2", onComplete => {
      runOrder.push("key2");
      onComplete();
    })
    lowMaxConcurrencyQueue.submit("key3", onComplete => {
      runOrder.push("key3");
      onComplete();
    })
    await new Promise<void>(resolve => {
      setTimeout(() => {
        /*
        * Because this is non-async, the execution of the task will complete and
        * remove the keys from the list and therefore each task will be able to
        * be executed in order submitted.
        * */
        expect(runOrder).toEqual(["key1", "key1", "key2", "key3"])
        resolve()
      }, 1)
    })
  })

  test("Should run in order with max concurrency (async).", async () => {
    const runOrder: string[] = [];
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      runOrder.push("key1-1")
      setTimeout(() => {
        onComplete()
      }, 1)
    })
    lowMaxConcurrencyQueue.submit("key1", onComplete => {
      runOrder.push("key1-2")
      setTimeout(() => {
        onComplete()
      }, 1)
    })
    lowMaxConcurrencyQueue.submit("key2", onComplete => {
      runOrder.push("key2")
      setTimeout(() => {
        onComplete()
      }, 1)
    })
    lowMaxConcurrencyQueue.submit("key3", onComplete => {
      runOrder.push("key3")
      setTimeout(() => {
        onComplete()
      }, 1)
    })
    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(runOrder).toEqual(["key1-1", "key2", "key1-2", "key3"])
        resolve()
      }, 10);
    })
  })

})

// Cannot test for uncaught exceptions in setImmediate(), the program will crash as expected.
describe("Test error caught when thrown within task.", () => {

  let queue: AsyncOpQueue

  beforeEach(() => {
    queue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: undefined, catchErrors: true});
  });

  afterEach(() => {
    queue.stop(true);
  });

  test("Should catch error and run next task.", completeTask => {
    let counter = 0;
    queue.submit("key1", () => {
      counter++;
      throw new Error("An error!");
    })
    queue.submit("key1", () => {
      counter++;
    })
    setTimeout(() => {
      expect(counter).toEqual(2);
      completeTask();
    }, 100);
  });
});

describe("Tests promise based tasks.", () => {

  let queue: AsyncOpQueue

  beforeEach(() => {
    queue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: undefined});
  });

  afterEach(() => {
    queue.stop(true);
  });

  test("Should complete when promise completes.", completeTest => {

    const runOrder: string[] = [];
    let receivedError = false;

    queue.submitPromiseTask("key1", () => new Promise((resolve, reject) => {
      runOrder.push("key1");
      setTimeout(() => {
        resolve("Done")
      }, 1)
    }));

    queue.submitPromiseTask("key2", () =>
      new Promise((resolve, reject) => {
        runOrder.push("key2");
        setTimeout(() => {
          reject("whatever")
        }, 1);
      }).catch(err => {
        receivedError = true;
      })
    );

    queue.submitPromiseTask("key1", () => new Promise((resolve, reject) => {
      runOrder.push("key1");
      setTimeout(() => {
        resolve("Done")
      }, 1);
    }));

    expect(queue.size).toEqual(3);

    // wait for queue to complete
    setTimeout(() => {
      expect(queue.size).toEqual(0);
      expect(runOrder).toEqual(["key1", "key2", "key1"])
      expect(receivedError).toEqual(true);
      completeTest();
    }, 10)

  });

})

