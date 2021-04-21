
jest.mock('fs');
jest.mock("../src/shutdown");

jest.mock(
  'sns-validator',
  () => (
    jest.fn(() => ({
              validate: (message: any, callback: any) => {
                callback(null, message);
              }
            })
    )
  )
);

let snsClientSendCalls: any[];

import AsyncOpQueue from "../src/AsyncOpQueue";
import * as fs from "fs";
import * as http from "http";
import { ConfirmSubscriptionCommand, SubscribeCommand, UnsubscribeCommand } from "@aws-sdk/client-sns";

const bucket = "TestBuck";
const rootDir = (fs as any).__testRootDir;

// queue is provided or else have issues shutting down when
let queue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: 1000});

const SubscriptionArn = "an arn! need it to mock unsubscribe";

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.doMock("../src/options", () => {
    const optionsActual = jest.requireActual("../src/options");
    const checkAndCopyCommonOptionsWithDefaultsActual = optionsActual.checkAndCopyCommonOptionsWithDefaults;
    return {
      ...optionsActual,
      checkAndCopyCommonOptionsWithDefaults: jest.fn((opts: any) => {
        return checkAndCopyCommonOptionsWithDefaultsActual({
                                                             ...opts,
                                                             queue
                                                           });
      })
    }
  });
  jest.doMock('@aws-sdk/client-sns', () => {
    // jest.requireActual('@aws-sdk/client-sns')
    return {
      ConfirmSubscriptionCommand: ConfirmSubscriptionCommand,
      SubscribeCommand: SubscribeCommand,
      UnsubscribeCommand: UnsubscribeCommand,
      SNSClient: jest.fn(() => {
        return {
          send: jest.fn((command: any) => {
            snsClientSendCalls.push(command);
            if (command instanceof SubscribeCommand) {
              return Promise.resolve({
                                       SubscriptionArn
                                     });
            } else if (command instanceof ConfirmSubscriptionCommand) {
              return Promise.resolve({});
            } else if (command instanceof UnsubscribeCommand) {
              return Promise.resolve({})
            } else {
              throw new Error("Unhandled SNS client test command.");
            }
          })
        }
      })
    }
  });
  snsClientSendCalls = [];
});

afterEach(() => {
})

afterAll(() => {
  if (queue) {
    queue.stop(true);
  }
})


describe("SNS Server options tests.", () => {

  test("Ensure common options are called.", () => {
    const {SNSClient} = require('@aws-sdk/client-sns');
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {checkAndCopySnsServerOptionsWithDefaults} = require('../src/snsServer');
    checkAndCopySnsServerOptionsWithDefaults({bucket, rootDir, port: 8888});
    expect(checkAndCopyCommonOptionsWithDefaults).toHaveBeenCalledTimes(1);
    expect(SNSClient).toHaveBeenCalledTimes(1);
  })

  test("Ensure options fail when expected.", () => {
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {checkAndCopySnsServerOptionsWithDefaults} = require('../src/snsServer');

    expect(() => {
      checkAndCopySnsServerOptionsWithDefaults({
                                                 // doesn't have bucket
                                                 rootDir,
                                                 queue
                                               });
    }).toThrow(new RegExp("^'bucket' must be provided in options."));

    expect(() => {
      checkAndCopySnsServerOptionsWithDefaults({
                                                 // doesn't have rootdir
                                                 bucket,
                                               });
    }).toThrow(new RegExp("^'rootDir' must be provided in options."));

    expect(() => {
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                               });
    }).toThrow(new RegExp("^'port' must be provided in options."));

    expect(() => {
      // httpPath must begin with forward slash
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                                 port: 8888,
                                                 httpPath: "sns"
                                               });
    }).toThrow(new RegExp("^'httpPath'.*"));

    // shouldn't throw here, because httpPath begins with forward slash
    checkAndCopySnsServerOptionsWithDefaults({
                                               rootDir,
                                               bucket,
                                               port: 8888,
                                               httpPath: "/sns"
                                             });

    expect(() => {
      // endpoint must be provided when topicArn is provided
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                                 port: 8888,
                                                 topicArn: "anything"
                                               });
    }).toThrow(new RegExp("^'endpoint'.*"));

    expect(() => {
      // topicArn must be provided when endpoint is provided
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                                 port: 8888,
                                                 endpoint: "anything"
                                               });
    }).toThrow(new RegExp("^'topicArn'.*"));

    // should pass
    checkAndCopySnsServerOptionsWithDefaults({
                                               rootDir,
                                               bucket,
                                               port: 8888,
                                               endpoint: "anything",
                                               topicArn: "whatever"
                                             });

    expect(() => {
      // httpsCertPath must be provided when httpsCertKeyPath is provided
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                                 port: 8888,
                                                 httpsCertKeyPath: "whatever"
                                               });
    }).toThrow(new RegExp("^'httpsCertPath'.*"));


    expect(() => {
      // httpsCertKeyPath must be provided when httpsCertPath is provided
      checkAndCopySnsServerOptionsWithDefaults({
                                                 rootDir,
                                                 bucket,
                                                 port: 8888,
                                                 httpsCertPath: "whatever"
                                               });
    }).toThrow(new RegExp("^'httpsCertKeyPath'.*"));

    checkAndCopySnsServerOptionsWithDefaults({
                                               rootDir,
                                               bucket,
                                               port: 8888,
                                               httpsCertPath: "whatever",
                                               httpsCertKeyPath: "anything"
                                             });

  });

});

describe("SNS http server tests.", () => {

  let stopSnsServer: any;

  beforeEach(() => {

  });

  afterEach(async () => {
    if (stopSnsServer) {
      await stopSnsServer();
    }
  })


  test("Ensure subscription made when topicArn is provided.", async () => {
    /*
    * Import here so that the mocked version is used in tests and thus the queue
    * is closed at end with afterAll(). The server still needs to be shutdown or
    * else the test will be left hanging (without jest forcing shutdown, at least).
    * */
    // const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {SNSClient} = require("@aws-sdk/client-sns");
    const {startSnsServer} = require('../src/snsServer');
    const topicArn = "whatever";
    const endpoint = "http://whatever.com"
    stopSnsServer = startSnsServer({
                                     rootDir,
                                     bucket,
                                     topicArn,
                                     endpoint,
                                     port: 8080,
                                   });
    // wait a sec to make sure server is setup and receives events
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    /*
    * At this point should have sent the SubscribeCommand. If this is true, the
    * SNS server should have sent a SubscriptionConfirmation-type request to the
    * server. Check subscribe was issued and then mimic the SubscriptionConfirmation
    * sent from AWS.
    * */
    expect(SNSClient).toHaveBeenCalledTimes(1);
    expect(snsClientSendCalls.length).toEqual(1);
    expect(snsClientSendCalls[0] instanceof SubscribeCommand).toBeTruthy();
    expect(snsClientSendCalls[0].input.TopicArn).toEqual(topicArn);
    expect(snsClientSendCalls[0].input.Endpoint).toEqual(endpoint);
    expect(snsClientSendCalls[0].input.Protocol.toLowerCase()).toEqual("http");
    expect(snsClientSendCalls[0].input.ReturnSubscriptionArn).toEqual(true);

    const SubscribeURL = "something.com";
    const Token = "some rand token";

    // mimic SubscriptionConfirmation
    const subConfirmBody = JSON.stringify({
                                            Type: "SubscriptionConfirmation",
                                            Token,
                                            SubscribeURL,
                                            TopicArn: topicArn
                                          });

    const req = http.request(
      {
        port: 8080,
        host: "0.0.0.0",
        method: "POST",
      }, res => {

      }
    );
    req.write(subConfirmBody);
    req.end();
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    expect(snsClientSendCalls[1] instanceof ConfirmSubscriptionCommand).toBeTruthy();
    expect(snsClientSendCalls[1].input.Token).toEqual(Token);
    expect(snsClientSendCalls[1].input.TopicArn).toEqual(topicArn);

    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });

    // should unsubscribe
    await stopSnsServer();
    expect(snsClientSendCalls[2] instanceof UnsubscribeCommand).toBeTruthy();
    expect(snsClientSendCalls[2].input.SubscriptionArn).toEqual(SubscriptionArn);
  });

  test("Ensure subscription is not made when topicArn is not provided.", async () => {
    /*
    * Import here so that the mocked version is used in tests and thus the queue
    * is closed at end with afterAll(). The server still needs to be shutdown or
    * else the test will be left hanging (without jest forcing shutdown, at least).
    * */
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {SNSClient} = require("@aws-sdk/client-sns");
    const {startSnsServer} = require('../src/snsServer');
    const topicArn = "whatever";
    const endpoint = "http://whatever.com"
    stopSnsServer = startSnsServer({
                                     rootDir,
                                     bucket,
                                     port: 8080,
                                   });
    // wait a sec to make sure server is setup and receives events
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    /*
    * Should have created the client, but should not have sent anything to the client,
    * because the TopicArn of the SnsServer options was not provided.
    * */
    expect(SNSClient).toHaveBeenCalledTimes(1);
    expect(snsClientSendCalls.length).toEqual(0);

    const SubscribeURL = "something.com";
    const Token = "some rand token";

    // mimic SubscriptionConfirmation
    const subConfirmBody = JSON.stringify({
                                            Type: "SubscriptionConfirmation",
                                            Token,
                                            SubscribeURL,
                                            TopicArn: topicArn
                                          });

    const req = http.request(
      {
        port: 8080,
        host: "0.0.0.0",
        method: "POST",
      }, res => {

      }
    );
    req.write(subConfirmBody);
    req.end();
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    // should still confirm subscription when server receives a SubscriptionConfirmation-type request
    expect(snsClientSendCalls[0] instanceof ConfirmSubscriptionCommand).toBeTruthy();
    expect(snsClientSendCalls[0].input.Token).toEqual(Token);
    expect(snsClientSendCalls[0].input.TopicArn).toEqual(topicArn);

    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });

    // should not unsubscribe, because did not subscribe
    await stopSnsServer();
    expect(snsClientSendCalls.length).toEqual(1);
  });

  test("Test notification handler.", async () => {
    jest.doMock("../src/filesystemOps", () => (
      {
        writeS3Object: jest.fn(),
        unlinkFile: jest.fn()
      }
    ));
    const {writeS3Object, unlinkFile} = require('../src/filesystemOps') as any;
    // check expected write s3 object, unlink file, etc are called
    /*
    * Import here so that the mocked version is used in tests and thus the queue
    * is closed at end with afterAll(). The server still needs to be shutdown or
    * else the test will be left hanging (without jest forcing shutdown, at least).
    * */
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {SNSClient} = require("@aws-sdk/client-sns");
    const {startSnsServer} = require('../src/snsServer');
    const topicArn = "whatever";
    const endpoint = "http://whatever.com"
    stopSnsServer = startSnsServer({
                                     rootDir,
                                     bucket,
                                     port: 8080,
                                   });
    // wait a sec to make sure server is setup and receives events
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    /*
    * At this point should have sent the SubscribeCommand. If this is true, the
    * SNS server should have sent a SubscriptionConfirmation-type request to the
    * server. Check subscribe was issued and then mimic the SubscriptionConfirmation
    * sent from AWS.
    * */
    expect(SNSClient).toHaveBeenCalledTimes(1);
    expect(snsClientSendCalls.length).toEqual(0);

    const SubscribeURL = "something.com";
    const Token = "some rand token";

    /*
    * Not providing signing information as AWS does that and the sns-validator
    * module will be mocked.
    * */
    const notificationBody = JSON.stringify({
                                              Type: "Notification",
                                              TopicArn: topicArn,
                                              Message: JSON.stringify(
                                                {
                                                  Records: [
                                                    {
                                                      "eventVersion": "2.2",
                                                      "eventSource": "aws:s3",
                                                      "awsRegion": "us-east-1",
                                                      "eventTime": new Date().toString(),
                                                      "eventName": "ObjectCreated:",
                                                      "s3": {
                                                        "s3SchemaVersion": "1.0",
                                                        "configurationId": "whatever",
                                                        "bucket": {
                                                          "name": bucket,
                                                          "ownerIdentity": {
                                                            "principalId": "a1234567890"
                                                          },
                                                          "arn": "bucket-arn"
                                                        },
                                                        "object": {
                                                          "key": "1.txt",
                                                          /*
                                                          * Currently size, etag, etc are not used, because if a
                                                          * notification is received it is assumed that the object
                                                          * has changed in some way and thus needs to be updated.
                                                          * */
                                                        }
                                                      }
                                                    }
                                                  ]
                                                }
                                              )
                                            });

    const req = http.request(
      {
        port: 8080,
        host: "0.0.0.0",
        method: "POST",
      }, res => {

      }
    );
    req.write(notificationBody);
    req.end();

    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });
    expect(snsClientSendCalls.length).toEqual(0);
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("1.txt");

    /*
    * Not providing signing information as AWS does that and the sns-validator
    * module will be mocked.
    * */
    const notificationBody2 = JSON.stringify({
                                               Type: "Notification",
                                               TopicArn: topicArn,
                                               Message: JSON.stringify(
                                                 {
                                                   Records: [
                                                     {
                                                       "eventVersion": "2.2",
                                                       "eventSource": "aws:s3",
                                                       "awsRegion": "us-east-1",
                                                       "eventTime": new Date().toString(),
                                                       "eventName": "ObjectCreated:",
                                                       "s3": {
                                                         "s3SchemaVersion": "1.0",
                                                         "configurationId": "whatever",
                                                         "bucket": {
                                                           "name": bucket,
                                                           "ownerIdentity": {
                                                             "principalId": "a1234567890"
                                                           },
                                                           "arn": "bucket-arn"
                                                         },
                                                         "object": {
                                                           "key": "5.txt",
                                                           /*
                                                           * Currently size, etag, etc are not used, because if a
                                                           * notification is received it is assumed that the object
                                                           * has changed in some way and thus needs to be updated.
                                                           * */
                                                         }
                                                       }
                                                     },
                                                     {
                                                       "eventVersion": "2.2",
                                                       "eventSource": "aws:s3",
                                                       "awsRegion": "us-east-1",
                                                       "eventTime": new Date().toString(),
                                                       "eventName": "ObjectRestore:",
                                                       "s3": {
                                                         "s3SchemaVersion": "1.0",
                                                         "configurationId": "whatever",
                                                         "bucket": {
                                                           "name": bucket,
                                                           "ownerIdentity": {
                                                             "principalId": "a1234567890"
                                                           },
                                                           "arn": "bucket-arn"
                                                         },
                                                         "object": {
                                                           "key": "a.txt",
                                                           /*
                                                           * Currently size, etag, etc are not used, because if a
                                                           * notification is received it is assumed that the object
                                                           * has changed in some way and thus needs to be updated.
                                                           * */
                                                         }
                                                       }
                                                     },
                                                     {
                                                       "eventVersion": "2.2",
                                                       "eventSource": "aws:s3",
                                                       "awsRegion": "us-east-1",
                                                       "eventTime": new Date().toString(),
                                                       "eventName": "ObjectRemoved:",
                                                       "s3": {
                                                         "s3SchemaVersion": "1.0",
                                                         "configurationId": "whatever",
                                                         "bucket": {
                                                           "name": bucket,
                                                           "ownerIdentity": {
                                                             "principalId": "a1234567890"
                                                           },
                                                           "arn": "bucket-arn"
                                                         },
                                                         "object": {
                                                           "key": "z.txt",
                                                           /*
                                                           * Currently size, etag, etc are not used, because if a
                                                           * notification is received it is assumed that the object
                                                           * has changed in some way and thus needs to be updated.
                                                           * */
                                                         }
                                                       }
                                                     },

                                                   ]
                                                 }
                                               )
                                             });

    const req2 = http.request(
      {
        port: 8080,
        host: "0.0.0.0",
        method: "POST",
      }, res => {

      }
    );
    req2.write(notificationBody2);
    req2.end();

    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null);
      }, 50);
    });

    expect(snsClientSendCalls.length).toEqual(0);
    // 2 more calls for ObjectCreated and ObjectRestore
    expect(writeS3Object).toHaveBeenCalledTimes(3);
    // index 0 same as before
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("1.txt");
    expect(writeS3Object.mock.calls[1][0].Key).toEqual("5.txt");
    expect(writeS3Object.mock.calls[2][0].Key).toEqual("a.txt");
    expect(unlinkFile).toHaveBeenCalledTimes(1);
    expect(unlinkFile.mock.calls[0][0].relativeFilePath).toEqual("z.txt");

    // should unsubscribe
    await stopSnsServer();
  });

  test("Check failure on unsupported event version.", async () => {
    const {
      createDefaultSnsNotificationListener
    } = require("../src/snsServer");
    const listener = createDefaultSnsNotificationListener({bucket, rootDir} as any)

    const topicArn = "whatever";

    const notificationBody = {
      Type: "Notification",
      TopicArn: topicArn,
      Message:
        {
          Records: [
            {
              "eventVersion": "2.0",
              "eventSource": "aws:s3",
              "awsRegion": "us-east-1",
              "eventTime": new Date().toString(),
              "eventName": "ObjectCreated:",
              "s3": {
                "s3SchemaVersion": "1.0",
                "configurationId": "whatever",
                "bucket": {
                  "name": bucket,
                  "ownerIdentity": {
                    "principalId": "a1234567890"
                  },
                  "arn": "bucket-arn"
                },
                "object": {
                  "key": "1.txt",
                  /*
                  * Currently size, etag, etc are not used, because if a
                  * notification is received it is assumed that the object
                  * has changed in some way and thus needs to be updated.
                  * */
                }
              }
            }
          ]
        }
    };

    expect(() => {
      listener({body: notificationBody} as any);
    }).toThrow(new RegExp("^Unsupported"))

  });

})