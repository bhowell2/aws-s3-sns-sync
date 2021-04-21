import * as fs from "fs"
import * as Http from "http";
import { IncomingHttpHeaders } from "http";
import * as Https from "https";
import { ConfirmSubscriptionCommand, SNSClient, SubscribeCommand, UnsubscribeCommand } from "@aws-sdk/client-sns";
import { log, LogLevel } from "./logger";
import { registerShutdownHook, StopService } from "./shutdown";
import { unlinkFile, writeS3Object } from "./filesystemOps";
import { applyTransformersToKey } from "./s3ObjectOps";
import {
  checkAndCopyCommonOptionsWithDefaults,
  CommonOptions,
  requireOptions,
  setOptionDefaultIfNotProvided
} from "./options";
import MessageValidator from "sns-validator";

/*
* Used to compare against the event version of the notification.
* AWS recommends an equal-to comparison for the major event version
* and a greater-than-or-equal-to comparison for the minor event version.
*
* The default notification listener uses this to ensure the message version
* is supported.
* */
const DEFAULT_MAJOR_EVENT_VERSION = 2;
const DEFAULT_MINOR_EVENT_VERSION = 1;

type AwsSnsMessageType = "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation"

/**
 * Headers provided in the AWS HTTP request.
 */
interface AwsSnsHttpEndpointHeaders extends IncomingHttpHeaders {
  "x-amz-sns-message-type": AwsSnsMessageType
  "x-amz-sns-message-id": string
  "x-amz-sns-topic-arn": string
  "x-amz-sns-subscription-arn": string;
}

/**
 * This is an inner object returned within the AwsSnsS3Record.
 * This provides information about the S3 Object that was changed
 * to generate the SNS event.
 */
interface AwsSnsS3RecordS3Object {
  bucket: {
    name: string
    arn: string
    ownerIdentity: { principalId: string }
  }
  configurationId: string
  object: {
    eTag: string
    key: string
    sequencer: string
    size: number
  }
  s3SchemaVersion: string
}

/**
 * As can be seen below at {@link AwsSnsS3NotificationMessage}, the record will
 * have this structure.
 */
interface AwsSnsS3Record {
  /**
   * The region where the S3 bucket resides that created the event.
   */
  awsRegion: string
  /**
   * E.g., ObjectCreated:Put
   */
  eventName: string
  /**
   * Source of the event. Will be 'aws:s3' for this.
   */
  eventSource: string
  /**
   * ISO 8601 UTC time. E.g., '2020-09-30T20:10:26.314Z'
   */
  eventTime: string
  /**
   * Version of the record. Can be checked to ensure that it is supported.
   * When using the SnsNotificationListener only version '2.2' is supported.
   */
  eventVersion: string
  /**
   * Information about the request that generated the event.
   */
  requestParameters: { sourceIpAddress: string }
  /**
   * Information that identifies the AWS' response to the request that
   * generated the SNS event.
   */
  responseElements: {"x-amz-request-id": string, "x-amz-id-2": string}
  /**
   * Contains S3 information about the request that generated the event.
   * This is used to obtain
   */
  s3: AwsSnsS3RecordS3Object
  userIdentity: {
    /**
     * The AWS user identity. E.g., AWS:ABCDEFGHIJ1234567.
     */
    principalId: string
  }
}

/**
 * The message will have the following structure (taken from
 * https://docs.aws.amazon.com/AmazonS3/latest/dev/notification-content-structure.html):
 {
   "Records":[
      {
         "eventVersion":"2.2",
         "eventSource":"aws:s3",
         "awsRegion":"us-west-2",
         "eventTime":"The time, in ISO-8601 format, for example, 1970-01-01T00:00:00.000Z, when Amazon S3 finished processing the request",
         "eventName":"event-type",
         "userIdentity":{
            "principalId":"Amazon-customer-ID-of-the-user-who-caused-the-event"
         },
         "requestParameters":{
            "sourceIPAddress":"ip-address-where-request-came-from"
         },
         "responseElements":{
            "x-amz-request-id":"Amazon S3 generated request ID",
            "x-amz-id-2":"Amazon S3 host that processed the request"
         },
         "s3":{
            "s3SchemaVersion":"1.0",
            "configurationId":"ID found in the bucket notification configuration",
            "bucket":{
               "name":"bucket-name",
               "ownerIdentity":{
                  "principalId":"Amazon-customer-ID-of-the-bucket-owner"
               },
               "arn":"bucket-ARN"
            },
            "object":{
               "key":"object-key",
               "size":"object-size",
               "eTag":"object eTag",
               "versionId":"object version if bucket is versioning-enabled, otherwise null",
               "sequencer": "a string representation of a hexadecimal value used to determine event sequence, only used with PUTs and DELETEs"
            }
         },
         "glacierEventData": {
            "restoreEventData": {
               "lifecycleRestorationExpiryTime": "The time, in ISO-8601 format, for example, 1970-01-01T00:00:00.000Z, of Restore Expiry",
               "lifecycleRestoreStorageClass": "Source storage class for restore"
            }
         }
      }
   ]
 }
 */
interface AwsSnsS3NotificationMessage {
  Records: AwsSnsS3Record[]
}

/**
 * The HTTP(S) S3 event notification body.
 */
interface AwsSnsHttpBody<T extends AwsSnsMessageType, Message> {
  Type: T
  MessageId: string
  TopicArn: string
  Subject: string
  /**
   * The message is a string if the Type is 'SubscriptionConfirmation' or
   * 'UnsubscribeConfirmation', but is a JSON object otherwise (i.e., it
   * is a 'Notification').
   */
  Message: Message
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  UnsubscribeURL: string
}

// not directly related to S3, but SNS
interface AwsSnsHttpSubConfirmBody extends AwsSnsHttpBody<"SubscriptionConfirmation", string> {
  Token: string
  SubscribeURL: string
}

// not directly related to S3, but SNS
interface AwsSnsHttpUnsubConfirmBody extends AwsSnsHttpBody<"UnsubscribeConfirmation", string>{}

// S3 message
interface AwsSnsHttpS3NotificationBody extends AwsSnsHttpBody<"Notification", AwsSnsS3NotificationMessage> {}

/**
 * The HTTP information of the "notification" request. Provided to the
 * SnsNotificationHandler so that the user may handle the notification
 * as desired.
 */
export interface AwsSnsHttpS3NotificationRequest {
  headers: AwsSnsHttpEndpointHeaders
  body: AwsSnsHttpS3NotificationBody
}

/**
 * Handles SNS S3 notifications. Abstracting here allows the user to provide a
 * custom implementation if desired. The default implementation will handle
 * creating/updating/deleting the S3 Object from the mirror directory.
 */
export type SnsNotificationListener = (notification: AwsSnsHttpS3NotificationRequest) => void;

export interface SnsServerOptions extends CommonOptions {
  /**
   * The SNS client to use to setup and/or confirm the SNS subscription.
   * (The SNS subscription will be set up if the 'topicArn' and 'endpoint'
   * options are provided.)
   */
  snsClient: SNSClient
  /**
   * Must be provided if an HTTP server is to be created to listen for
   * SNS notifications on S3 bucket changes.
   */
  port: number
  /**
   * The address to listen on for HTTP/S SNS events. Combined with {@link port} argument.
   *
   * Defaults to '0.0.0.0'.
   */
  host?: string
  /**
   * The httpPath for the HTTP/S server to listen on for SNS events.
   */
  httpPath?: string
  /**
   * If HTTPS is to be used, needs to be provided along with httpsCertKeyPath.
   */
  httpsCertPath?: string
  /**
   * Path to the certification's key. Required if httpsCertPath is provided.
   */
  httpsCertKeyPath?: string
  /**
   * The ARN of the SNS topic that should be subscribed to. If this is
   * provided then {@link endpoint} must also be provided.
   */
  topicArn?: string
  /**
   * The HTTP/S address that the SNS notifications should be sent to.
   * This is required if {@link topicArn} is provided.
   */
  endpoint?: string
  /**
   * The listener that will be used to handle HTTP(S) SNS events.
   * A default implementation that listens on all paths (that the
   * http server is listening on) is used if this is not provided.
   * If this is NOT provided then {@link snsNotificationListener}
   * must be provided. If this IS provided, then
   * {@link snsNotificationListener} is ignored.
   *
   * Generally the default will be acceptable for this and the user
   * need not provide this listener.
   */
  requestListener?: Http.RequestListener
  /**
   * Listener for when the body of the SNS event is received.
   * The 'SubscriptionConfirmation' and 'UnsubscribeConfirmation'
   * message types are handled and only 'Notification' messages
   * are sent to this handler. If the user wants to handle all
   * message types then they should implement {@link requestListener}
   * to do so.
   *
   * Generally the default implementation will be acceptable for this
   * and the user need not provide this listener.
   */
  snsNotificationListener?: SnsNotificationListener
  /**
   * Whether or not to issue an unsubscribe command for the topic when
   * the program is shutdown. This will only be run when topicArn/endpoint
   * are provided.
   *
   * Defaults to false (i.e., unsubscribe on shutdown).
   */
  ignoreUnsubscribeOnShutdown?: boolean
  /**
   * Whether or not to validate the received SNS message.
   *
   * Defaults to false (i.e., validate the message).
   */
  ignoreMessageValidation?: boolean
}

const SNS_MESSAGE_VALIDATOR = new MessageValidator();

function validateMessage(message: any): Promise<any> {
  return new Promise((resolve, reject) => {
    SNS_MESSAGE_VALIDATOR.validate(message, (err, msg) => {
      if (err) {
        reject(err);
      } else {
        resolve(msg);
      }
    })
  });
}

/**
 * The default implementation will handle creating/updating/deleting the
 * S3 Object from the mirror directory.
 */
export function createDefaultSnsNotificationListener(options: SnsServerOptions): SnsNotificationListener {
  const {s3Client, queue, bucket, rootDir, tmpSuffix, tmpDir, s3KeyTransformers, remove} = options;
  return notification => {
    const { Records } = notification.body.Message;
    if (Records && Records.length > 0) {
      for (let i = 0; i < Records.length; i++) {
        const record = Records[i];
        const {eventName, eventVersion} = record;
        const splitEventVersion = eventVersion.split(".");
        if (
          splitEventVersion.length < 2
          || Number.parseInt(splitEventVersion[0]) !== DEFAULT_MAJOR_EVENT_VERSION
          || Number.parseInt(splitEventVersion[1]) < DEFAULT_MINOR_EVENT_VERSION
        ) {
          // return instead?
          throw new Error("Unsupported event version");
        }
        /*
        * If the key DOES NOT begin with the prefix or if it DOES NOT end with the suffix
        * then ignore it.
        * */
        if (options.prefix && !(record.s3.object.key.indexOf(options.prefix) === 0)
          || options.suffix && !record.s3.object.key.endsWith(options.suffix)) {
          continue;
        }
        const transformedKey = applyTransformersToKey(record.s3.object.key, s3KeyTransformers);
        /*
        * Ensure that the event came from the correct bucket. It would easily be possible
        * to support multiple buckets, but as a safety measure only one bucket is currently
        * supported. The risk with multiple buckets is that they both have Keys of the same
        * name and thus could overwrite each other when mirrored to the same directory.
        * The current workaround would be the user starting multiple SNS HTTP/S server for
        * multiple buckets.
        * */
        if (record.s3.bucket.name === bucket) {
          if (eventName.indexOf("ObjectCreated:") === 0 || eventName.indexOf("ObjectRestore:") === 0) {
            /*
            * It is assumed that the S3 event came from the correct region that the
            * s3Client is using. If it did not an error will occur.
            * */
            const transformedKey = applyTransformersToKey(record.s3.object.key, s3KeyTransformers);
            // get the object
            writeS3Object({
                            s3Client,
                            queue,
                            transformedKey,
                            rootDir,
                            tmpSuffix,
                            tmpDir,
                            Bucket: bucket,
                            Key: record.s3.object.key,
                          });
          } else if (eventName.indexOf("ObjectRemoved:") === 0) {
            unlinkFile({
                         queue,
                         relativeFilePath: transformedKey,
                         rootDir,
                         remove,
                       })
          } else {
            log("Unhandled record event name '" + eventName + "'. Default snsNotificationListener handles " +
                  "'ObjectCreated:*', 'ObjectRestore:*', and 'ObjectRemoved:*' events.", LogLevel.DEBUG)
          }
        } else {
          log(`Received event from bucket (${record.s3.bucket.name}) that was not provided in settings (${bucket}). Currently this is not supported - reduces chances of crossing bucket contents in mirror.`, LogLevel.ERROR);
        }
      }
    }
  };
}


/**
 * The default request listener does not do any filtering based on httpPath,
 * headers, or any other request information; it simply waits for the
 * 'data' event and calls the SnsEndpointListener provided in the options.
 */
export function createDefaultRequestListener(snsClient: SNSClient,
                                             snsNotificationListener: SnsNotificationListener,
                                             ignoreMessageValidation: boolean = false): Http.RequestListener {
  if (!snsClient) {
    throw new Error("An 'snsClient' must be provided.");
  }
  if (!snsNotificationListener) {
    throw new Error("An 'snsNotificationListener' must be provided.");
  }
  return (req, resp) => {
    let chunks: Buffer[] = [];
    req.on('error', err => {
      console.error(err);
    }).on('data', chunk => {
      chunks.push(chunk);
    }).on('end', () => {
      /*
      * 1. Combine the chunks to get message. Convert to object.
      * 2. Check for message validity if required (defaults to check).
      * 3. Determine type of request and handle accordingly.
      * 4. Respond to request with success or failure.
      * */
      try {
        const body: AwsSnsHttpBody<AwsSnsMessageType, unknown> = JSON.parse(Buffer.concat(chunks).toString());
        (ignoreMessageValidation ? Promise.resolve(body) : validateMessage(body)).then(body => {
          if (body.Type === 'SubscriptionConfirmation') {
            log(`Received SubscriptionConfirmation ${JSON.stringify(body)}`, LogLevel.DEBUG);
            const {Token, TopicArn} = body as AwsSnsHttpSubConfirmBody;
            /*
            * Currently not handling the failure case for ConfirmSubscriptionCommand as
            * it seems an error confirming the subscription should result in failing the
            * program, because the user is expecting SNS to send notifications to the
            * program to update the changed files. Not handling this here will cause the
            * program to shutdown, because hooks are registered for 'uncaughtException'
            * and 'unhandledRejection' to trigger program shutdown.
            * */
            snsClient.send(new ConfirmSubscriptionCommand({Token, TopicArn}))
                     .then(confirmSubResp => {
                       console.log(`Confirmed subscription to TopicArn='${TopicArn}'. SubscriptionArn='${confirmSubResp.SubscriptionArn}'.`);
                       // TODO: handle this.
                       confirmSubResp.SubscriptionArn
                     });
          } else if (body.Type === 'Notification') {
            log(`Received notification: ${JSON.stringify(body)}.`, LogLevel.DEBUG);
            /*
            * Checks that body's message field is of expected form. In case it is
            * not this will respond to the request with a success, but will not cause
            * any event to occur here on the server.
            * */
            if ((body.Message as string).indexOf("Records") >= 0) {
              /*
              * Convert the message to JSON as it comes in as a string.
              * This will keep it from having to be converted downstream.
              * */
              body.Message = JSON.parse(body.Message as string);
              snsNotificationListener({
                                        headers: req.headers as AwsSnsHttpEndpointHeaders,
                                        body: body as AwsSnsHttpS3NotificationBody
                                      });
            } else {
              log(`Unhandled notification message. May have received a notification that was not an S3 Object change? Body='${JSON.stringify(body)}'.`, LogLevel.DEBUG);
            }
          } else if (body.Type === 'UnsubscribeConfirmation') {
            /*
            * This occurs when the endpoint is unsubscribed from a topic. Currently only
            * logging this and not shutting down the program, because the user may resubscribe
            * the endpoint to the topic and/or the program may also be setup on a
            * resynchronization schedule.
            * */
            console.log("Received UnsubscribeConfirmation message. '\n" + JSON.stringify(body) + "\n'.");
          } else {
            // not handled..
            log(`Received request of unknown/unsupported SNS type: ${JSON.stringify(body)}`, LogLevel.ERROR);
          }
          resp.statusCode = 200;
          resp.end();
        });
      } catch (e) {
        resp.statusCode = 500;
        resp.end();
      }
    });
  };
}


/**
 * Ensures that the required options are provided and defaults are set
 * where possible.
 */
export function checkAndCopySnsServerOptionsWithDefaults(options: Partial<SnsServerOptions>): SnsServerOptions {
  const snsOptions = checkAndCopyCommonOptionsWithDefaults(options);

  /*
  * Port is not assumed, because requiring it be provided makes it clear
  * that the user wanted to run the SNS HTTP/S server.
  * */
  requireOptions(snsOptions, ["port"]);
  const port = snsOptions.port!;

  let snsClient = snsOptions.snsClient;
  if (!snsClient) {
    // region will be supplied by common options defaults
    const region = snsOptions.region;
    if (!region) {
      throw new Error("Must provide region if client is not provided.");
    }
    const {accessKeyId, secretAccessKey} = snsOptions;
    if (accessKeyId && secretAccessKey) {
      snsClient = new SNSClient({region, credentials: {accessKeyId, secretAccessKey}});
    } else {
      snsClient = new SNSClient({region});
    }
  }

  setOptionDefaultIfNotProvided(snsOptions, 'host', "0.0.0.0");

  setOptionDefaultIfNotProvided(snsOptions, 'ignoreUnsubscribeOnShutdown', false);

  if (snsOptions.httpPath && snsOptions.httpPath.charAt(0) !== '/') {
    throw new Error("'httpPath' option must begin with forward slash.");
  }

  // requiring both topicArn and endpoint be provided (if one is provided)
  if (snsOptions.topicArn && !snsOptions.endpoint) {
    throw new Error("'endpoint' option must be provided if 'topicArn' is provided.")
  } else if (!snsOptions.topicArn && snsOptions.endpoint) {
    throw new Error("'topicArn' option must be provided if 'endpoint' is provided.")
  }

  // requiring both httpsCertPath and httpsCertKeyPath be provided (if one is provided)
  if (snsOptions.httpsCertPath && !snsOptions.httpsCertKeyPath) {
    throw new Error("'httpsCertKeyPath' option must be provided if 'httpsCertPath' is provided. " +
                      "Https will be used.")
  } else if (!snsOptions.httpsCertPath && snsOptions.httpsCertKeyPath) {
    throw new Error("'httpsCertPath' option must be provided if 'httpsCertKeyPath' is provided. " +
                      "Https will be used.")
  }

  let requestListener = snsOptions.requestListener;
  let snsNotificationListener = snsOptions.snsNotificationListener;

  if (!requestListener) {
    if (!snsNotificationListener) {
      // must set on options, because it is used
      snsNotificationListener = createDefaultSnsNotificationListener(snsOptions as SnsServerOptions);
    }
    requestListener = createDefaultRequestListener(snsClient,
                                                   snsNotificationListener,
                                                   snsOptions.ignoreMessageValidation);
  }

  return {
    ...snsOptions,
    snsClient,
    port,
    requestListener,
    snsNotificationListener
  }
}


/**
 * Will start an HTTP(S) server if options are supplied correctly.
 * Port must be provided, but other options may be dependent on
 * each other, causing a failure if a dependent is not supplied.
 */
export function startSnsServer(inputOptions: Partial<SnsServerOptions>): StopService {

  const options = checkAndCopySnsServerOptionsWithDefaults(inputOptions);

  /*
  * Need to track this, because it is possible that the user stops the service
  * via the returned StopService callback - this will make it possible for the
  * user to unsubscribe via the StopService callback or when the program is
  * shutdown via the shutdown hook.
  * */
  let hasUnsubscribed = false;
  let SubscriptionArn: string | undefined;

  const { snsClient } = options;

  const httpServer = (() => {
    if (options.httpsCertPath && options.httpsCertKeyPath) {
      return Https.createServer({
                                  cert: fs.readFileSync(options.httpsCertPath),
                                  key: fs.readFileSync(options.httpsCertKeyPath)
                                }, options.requestListener);
    }
    return Http.createServer(options.requestListener);
  })();

  const executeUnsubscribeCommand = () => {
    /*
    * Make sure that should unsubscribe when shutting down. currently this will
    * also unsubscribe when the SNS server has been manually closed via the
    * StopService callback.
    *
    * Note: ignoreUnsubscribeOnShutdown defaults to false (i.e., unsubscribe when
    * shutting down).
    * */
    if (!options.ignoreUnsubscribeOnShutdown && SubscriptionArn && !hasUnsubscribed) {
      console.log(`Unsubscribing from SNS topic (${options.topicArn}) with SubscriptionArn='${SubscriptionArn}'.`);
      hasUnsubscribed = true;
      return snsClient.send(new UnsubscribeCommand({SubscriptionArn}))
                      .catch(err => {
                        /*
                        * This is run on shutdown, so just log the error if there is one,
                        * nothing to do for recovery
                        * */
                        console.error(err);
                      });
    }
    return Promise.resolve();
  }

  httpServer.listen({
                      port: options.port,
                      host: options.host ? options.host : "0.0.0.0",
                      path: options.httpPath
                    }, () => {
    let listeningAddress = options.host + ":" + options.port;
    if (options.httpPath) {
      if (options.httpPath.charAt(0) === "/") {
        listeningAddress += options.httpPath
      } else {
        listeningAddress += "/" + options.httpPath;
      }
    }
    console.log(`Server has started listening for SNS events at '${listeningAddress}'.`);
    /*
    * Once the server is started, determine whether or not need to create
    * a subscription for this endpoint to the topic. There is no issue
    * here if this is run multiple times from the same endpoint. SNS
    * will not create multiple subscriptions for the exact same endpoint.
    * */
    if (options.topicArn) {
      const Protocol = options.httpsCertPath ? "HTTPS" : "HTTP";
      snsClient
        .send(new SubscribeCommand({
                                     TopicArn: options.topicArn,
                                     Endpoint: options.endpoint,
                                     Protocol,
                                     ReturnSubscriptionArn: true}
        ))
        .then(res => {
          console.log(`Subscribed to TopicArn='${options.topicArn}' with Endpoint='${options.endpoint}'. Pending confirmation.`);
          // need to set this so unsubscribe can be done if desired
          SubscriptionArn = res.SubscriptionArn;
          registerShutdownHook(() => executeUnsubscribeCommand());
        })
        .catch(err => {
          log(`Failed to subscribe to ${options.topicArn}. Error='${err}'`, LogLevel.ERROR);
          throw err;
        });
    }
  });

  const closeServerPromise = () => {
    return new Promise<void>((resolve, reject) => {
      // make sure server hasn't been closed already
      if (httpServer.listening) {
        console.log("Closing SNS server.");
        httpServer.close(err => {
          if (err) {
            reject(err);
          }
          resolve();
        })
      } else {
        resolve();
      }
    });
  }

  registerShutdownHook(() => closeServerPromise());

  /*
  * Returning a function that returns a promise that allows the user to manually
  * shutdown the server. This does not unsubscribe the
  * */
  return () => {
    let promises = [];
    promises.push(executeUnsubscribeCommand());
    promises.push(closeServerPromise());
    return Promise.all(promises).then(dontCare => void 1);
  }

}
