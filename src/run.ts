import { checkAndCopyCommonOptionsWithDefaults, CommonOptions } from "./options";
import sync, { SyncOptions } from "./sync";
import { SnsServerOptions, startSnsServer } from "./SnsServer";
import { setLogLevel } from "./logger";
import { registerShutdownHook, StopService } from "./shutdown";

/**
 * Can be used to programmatically run the application. (This is called with the
 * CLI options if the user does not wrap the program to call this themselves.)
 */
export function run(options: Partial<CommonOptions & SyncOptions & SnsServerOptions>): Promise<StopService> {
  const stopServicePromises: Promise<any>[] = [];
  /*
  * Even though both startSnsServer and sync call this, it is called here to create an
  * S3Client that both will use.
  * */
  const commonOptions = checkAndCopyCommonOptionsWithDefaults(options);
  registerShutdownHook(() => {
    // stop the queue
    commonOptions.queue.stop();
  })
  if (commonOptions.log) {
    setLogLevel(commonOptions.log);
  }
  if (commonOptions.port) {
    stopServicePromises.push(Promise.resolve(startSnsServer(commonOptions)));
  }
  if (!commonOptions.skipInitialSync || commonOptions.resyncInterval) {
    stopServicePromises.push(sync(commonOptions));
  }
  /*
  * Combines the two StopService functions of startSnsServer and sync into one StopService
  * function that the user can call to stop the program.
  * */
  return Promise.all(stopServicePromises).then(stopServices => {
    return () => {
      for (let i = 0; i < stopServices.length; i++) {
        stopServices[i]()
      }
      commonOptions.queue.stop();
    }
  });
}

// run({
//       log: LogLevel.DEBUG,
//       rootDir: "./tmp1",
//       bucket: "tmp-test-buck",
//       resyncInterval: 60_000,
//       remove: true,
//       port: 8080,
//       topicArn: "arn:aws:sns:us-east-1:930263459217:s3-topic",
//       endpoint: "http://5d4330e6cd5d.ngrok.io",
//     });

// run({
//       log: LogLevel.DEBUG,
//       rootDir: "./tmp1",
//       bucket: "tmp-test-buck",
//       skipInitialSync: true,
//       ignoreMessageValidation: true,
//       // resyncInterval: 60_000,
//       remove: true,
//       port: 8080,
//       // topicArn: "arn:aws:sns:us-east-1:930263459217:s3-topic",
//       // endpoint: "http://5d4330e6cd5d.ngrok.io",
//     });
