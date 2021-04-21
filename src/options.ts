import { S3Client } from "@aws-sdk/client-s3";
import AsyncOpQueue from "./AsyncOpQueue";
import * as path from "path";
import { log, LogLevel } from "./logger";
import * as fs from "fs";
import {
  getDefaultS3KeyTransformers,
  S3KeyTransformerOptions,
  StringTransformer
} from "./utils/transformers";

export interface CommonOptions extends S3KeyTransformerOptions {
  /**
   * The S3 bucket that will be mirrored.
   */
  bucket: string
  /**
   * The region where the bucket resides. Used to create the S3 and SNS clients.
   *
   * Defaults to us-east-1.
   */
  region: string
  /**
   * The local directory where the bucket will be mirrored.
   *
   * Used by SNS and SYNC.
   */
  rootDir: string
  /**
   * The S3 client to use to make requests to retrieve the notification's object.
   */
  s3Client: S3Client
  /**
   * The sets the maximum number of concurrent S3 object requests as well as file
   * operations that will be performed. This is useful for when the system is
   * constrained by resources and/or has ulimit issues that they do not have access
   * to adjust.
   *
   * (This is for the queue and if the queue is provided is ignored.)
   *
   * Defaults to 300.
   */
  maxConcurrency?: number
  /**
   * The queue to use when submitting tasks. This is shared between the sync function
   * and the SNS server so that concurrent operations do not occur for the same file.
   * The tasks names are unique and are determined by what the resulting file name will
   * be (if some of the edge cases with case-sensitivity are not handled this could
   * still result in concurrent operations for a given file on some file systems).
   */
  queue: AsyncOpQueue
  /**
   * Either this (tmpSuffix) or tmpDir must be provided.
   *
   * When a file is downloaded and written to the file system it will first be
   * written to a temporary file (or folder when tmpDir opt is supplied) before
   * it is renamed (moved) to the expected file name. If tmpDir is not provided,
   * this will occur in the rootDir (where filesAndDirs are mirrored).
   *
   * This allows the user to filter changes on filesAndDirs with the given suffix if
   * they are watching the directory (if they are only watching the file then
   * the change to it will appear atomically).
   *
   * Defaults to '.tmp'. This cannot be the empty string - will be overridden with '.tmp'.
   */
  tmpSuffix: string
  /**
   * Local directory to be used to temporarily write the mirrored S3 objects,
   * which will then be moved to {@link rootDir} once write has completed.
   *
   * This does not default to anything, because when Docker is used with volumes
   * it will not work as expected. When using a Docker volume for the mirrored
   * content, this should be set to a directory within that volume and the mirrored
   * content in a separate directory where the user can watch only the mirrored directory
   * and pick up atomic changes to the directory. E.g., /dockVol1/mirDir, /dockVol1/tmpDir
   * where the user watches the former and the latter is used for temporary file writes.
   *
   * Used by SNS and sync.
   */
  tmpDir?: string
  /**
   * Whether or not to remove filesAndDirs/directories when an object is
   * removed from the S3 bucket.
   */
  remove?: boolean
  /**
   * The prefix used when listing keys and filtering SNS events.
   */
  prefix?: string
  /**
   * The suffix used when filtering keys from listing or SNS events.
   * If the key does not end with the provided string it will be ignored.
   * Note this should not be a regex, but simply a string that is checked
   * with String.prototype.endsWith(suffix).
   */
  suffix?: string
  /**
   * Applied to all S3 bucket keys before they are sorted and compared against
   * the local directory entries (which will also have their transformers applied
   * before comparison).
   *
   * When the user does not provide this, defaults will be provided based on the
   * 'ignoreKeyPlatformDirCharReplacement' (false or undefined),
   * 'ignoreKeyRootCharReplacement' (false or undefined), and 'normalizationForm'
   * options. If the user provides this, then the defaults will not be provided;
   * use {@link getDefaultS3KeyTransformers} and append to the returned array if
   * the user desires to add on to the defaults.
   */
  s3KeyTransformers?: StringTransformer[]
  /**
   * Sets the log level of the program.
   * Possible values: 'NONE', 'ERROR', 'WARN', 'DEBUG'.
   * If an unknown value
   *
   * Defaults to 'ERROR'.
   */
  log?: LogLevel | string
  /**
   * It is highly recommended that this option not be used and the credentials
   * be provided by other means. However, the user may want to test with these
   * or (somehow) has no other way to provide the credentials.
   */
  accessKeyId?: string
  /**
   * It is highly recommended that this option not be used and the credentials
   * be provided by other means. However, the user may want to test with these
   * or (somehow) has no other way to provide the credentials.
   */
  secretAccessKey?: string
}


/**
 * Ensures that the option is provided.
 * @param opts
 * @param key
 */
export function requireOption<T>(opts: T, key: keyof T) {
  if (!opts[key]) {
    throw new Error(`'${key}' must be provided in options.`)
  }
}

export function requireOptions<T>(opts: T, keys: (keyof T)[]) {
  for (let i = 0; i < keys.length; i++) {
    requireOption(opts, keys[i]);
  }
}

export function setOptionDefaultIfNotProvided<T, K extends keyof T>(opts: T, key: K, defaultValue: T[K]) {
  if (!opts[key]) {
    opts[key] = defaultValue;
  }
}

/**
 * Ensures that the bare minimum of options are provided and sets defaults for
 * options that can be assumed (e.g. tmpDir) and are not provided.
 *
 * This should be called by the sync and SNS server options validator as well,
 * ensuring that if the user doe
 */
export function checkAndCopyCommonOptionsWithDefaults<T extends Partial<CommonOptions>>(options: T): T & CommonOptions {

  // only requiring bucket and rootDir here as the others will be created if not provided
  requireOptions(options, ["bucket", "rootDir"]);

  // pulling out here so that it can be included in merged return object and provide type safety
  const bucket = options.bucket!; // exists
  const rootDir = path.resolve(options.rootDir!);

  /*
  * No need to check for existence. Will be created if it does not exists,
  * will be ignored if it does exists (as a directory), or will throw an
  * error if it is a file that exists.
  * */
  log(`Creating rootDir ('${rootDir}') if it does not already exist.`, LogLevel.DEBUG);
  fs.mkdirSync(rootDir, {recursive: true});

  let tmpSuffix = options.tmpSuffix;
  if (!tmpSuffix) {
    log(`Setting tmpSuffix to '.tmp'.`, LogLevel.DEBUG);
    tmpSuffix = ".tmp";
  }

  let tmpDir = options.tmpDir;
  if (tmpDir) {
    /*
    * No need to check for existence. Will be created if it does not exists,
    * will be ignored if it does exists (as a directory), or will throw an
    * error if it is a file that exists.
    * */
    log(`Creating temporary directory ('${tmpDir}') for files if it doesn't already exist.`, LogLevel.DEBUG);
    fs.mkdirSync(path.resolve(tmpDir), {recursive: true});
  }

  let region = options.region;
  if (!region) {
    log("Defaulting region to 'us-east-1'. If the clients have already been provided then this"
          + " wont matter as it is not used otherwise.",
        LogLevel.WARN);
    region = "us-east-1";
  }

  let s3Client = options.s3Client;
  if (!s3Client) {
    // s3 client used by sync and SNS server.
    let {accessKeyId, secretAccessKey} = options
    if (accessKeyId && secretAccessKey) {
      s3Client = new S3Client({
                                region,
                                credentials: {
                                  accessKeyId,
                                  secretAccessKey
                                }
                              });
    } else { // doesn't need credentials, must be using Instance Metadata / Roles
      s3Client = new S3Client({region});
    }
  }

  setOptionDefaultIfNotProvided(options, "maxConcurrency", 300);

  let queue = options.queue;
  if (!queue) {
    queue = new AsyncOpQueue({
                               defaultTaskRunTimeoutMillis: 60_000,
                               maxConcurrency: options.maxConcurrency
                             })
  }

  let s3KeyTransformers = options.s3KeyTransformers;
  if (!s3KeyTransformers) { // if they haven't already been provided, set defaults
    // s3KeyTransformers used by sync and SNS server
    s3KeyTransformers = getDefaultS3KeyTransformers(options);
  }

  // make copy so they can't be changed
  return {
    ...options,
    region,
    bucket,
    rootDir,
    tmpSuffix,
    tmpDir,
    s3Client,
    queue,
    s3KeyTransformers,
  };

}
