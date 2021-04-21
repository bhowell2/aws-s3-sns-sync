import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { log, LogLevel } from "./logger";
import * as path from "path";
import { getDirectoryEntries, rmdirRecursive, unlinkFile, writeS3Object } from "./filesystemOps";
import {
  checkAndCopyCommonOptionsWithDefaults,
  CommonOptions,
  setOptionDefaultIfNotProvided
} from "./options";
import { getS3List } from "./utils/s3Utils";
import { compareStringsUtf8BinaryOrder } from "./utils/stringUtils";
import {
  checkKeyOrPathIsDirectory,
  keyBelongsInCurrentDirectory
} from "./utils/keyAndPathUtils";
import Timeout = NodeJS.Timeout;
import { registerShutdownHook, StopService } from "./shutdown";
import { createNormalizationTransformer, NormalizationType, StringTransformer } from "./utils/transformers";

/**
 * Options for the sync implementation. This is a combination of options
 * available from the CLI and some that must be created manually by the
 * user. The program will provide a default implementation of the manual
 * options; if the user would like to override them they will be able to
 * call the sync function on their own (extending the program).
 */
export interface SyncOptions extends CommonOptions {
  /**
   * How many keys to retrieve at one time when listing the bucket's keys.
   * All keys will still be retrieved before the bucket is synchronized
   * with the local directory so that transformers can be applied and then
   * they can be sorted.
   *
   * Defaults to 1000.
   */
  maxKeys?: number
  /**
   * Whether or not the local directory should be synchronized with the S3
   * bucket on startup.
   *
   * Defaults to false (i.e., synchronize on startup).
   */
  skipInitialSync?: boolean
  /**
   * The interval to poll the bucket on for changes.
   */
  resyncInterval?: number
  /**
   * Applied to all directory entries before they are sorted and compared
   * against the S3 key (which will also have their transformers applied
   * before comparison).
   *
   * Note if the user supplies these then no additional transformers will be
   * added to this array. (E.g., when this is undefined and the normalizationForm
   * option is supplied then a transformer to normalize the entry is added,
   * but if this is not undefined the normalizationTransformer should have
   * already been added.)
   */
  dirEntryTransformers?: StringTransformer[]
}

export interface DirEntryTransformerOptions {
  /**
   * The normalization form type to apply to S3 keys and directory entries. This will
   * set a s3KeyTransformer and a dirEntryTransformer to be used on every key and
   * entry.
   *
   * Normalization is helpful to ensure that keys/entries (strings) reduce to the
   * same value before they are written to the file system - reducing the chance
   * of issues when writing to the file system.
   *
   * Default: undefined (i.e., do not normalize)
   */
  normalizationForm?: NormalizationType
}

/**
 * Directory entry paths are system dependent and the S3 keys may or may not match
 * the OS's structure. This means the entries and/or keys need to be transformed so
 * they can be compared in a logical manner.
 *
 * Currently, by default, the directory entries are not transformed and the keys are
 * transformed to match the system's directory structure (e.g., httpPath separators).
 *
 * If the normalizationForm option is supplied then a transformer will be applied to
 * both directory entries and S3 keys.
 */
export function getDefaultDirEntryTransformers(options: DirEntryTransformerOptions): StringTransformer[] | undefined {
  const transformer = [];
  if (options.normalizationForm) {
    transformer.push(createNormalizationTransformer(options.normalizationForm));
  }
  return transformer.length > 0 ? transformer : undefined;
}


/**
 * Checks and copies the common options and then checks and copies the
 * options directly related to synchronization.
 */
export function checkAndCopySyncOptionsWithDefaults(initialOptions: Partial<SyncOptions>): SyncOptions {
  const options = checkAndCopyCommonOptionsWithDefaults(initialOptions);

  setOptionDefaultIfNotProvided(options, 'skipInitialSync', false);
  setOptionDefaultIfNotProvided(options, 'maxKeys', 1000);
  // setOptionDefaultIfNotProvided(options, 'resyncInterval', 0);

  if (options.resyncInterval && options.resyncInterval < 60 * 1000) {
    console.warn("Resync is set to " + options.resyncInterval + " (ms), which will cause the S3 bucket to "
                   + "be polled quite often and could dramatically increase your S3 bill (depends "
                   + "on frequency and number of objects listed).");
  }

  let dirEntryTransformers = options.dirEntryTransformers;
  // only add the normalizationForm transformer if no dirEntry transformers were supplied
  if (!dirEntryTransformers && options.normalizationForm) {
    dirEntryTransformers = getDefaultDirEntryTransformers(options);
  }

  return {
    ...options,
    dirEntryTransformers
  };
}

function getAbsoluteFilePath(rootDir: string, p: string): string {
  return path.resolve(rootDir, p);
}

/**
 * This should take in the (transformed) key and provide the local
 * httpPath that the key will be written to.
 * @param rootDir
 * @param key
 */
function getLocalPathForKey(rootDir: string, key: string): string {
  return path.resolve()
}


/**
 * Makes sure that the user has access to the bucket.
 * @param s3Client
 * @param Bucket
 */
function checkBucketAccess(s3Client: S3Client, Bucket: string) {
  s3Client
    .send(new ListObjectsV2Command({Bucket, MaxKeys: 1}))
    // Need to know that LIST and GET access are available
    .then(resp => {
      const list = resp.Contents;
      if (list) {
        let smallestObjSize = Number.MAX_SAFE_INTEGER, smallestIndex = 0;
        for (let i = 0; i < list.length; i++) {
          if (list[i].Size! < smallestObjSize) {
            smallestObjSize = list[i].Size!
            smallestIndex = i;
          }
        }
        // retrieve the smallest object
        return s3Client.send(new GetObjectCommand({Bucket, Key: list[smallestIndex].Key}))
      }
      // assuming here that GET is available
      return Promise.resolve() as any;
    })
    .then(resp => {
      // dont care so long as error not returned
    })
}

/**
 * Synchronizes the specified directory with the specified S3 bucket. This will list
 * all keys in S3 and all directory entries apply any supplied transformers, sort the
 * keys/entries and then compare them to determine whether or not the key exists locally.
 *
 * If the key does not exists locally it will be downloaded and added.
 *
 * If the directory contains entries that are not in the S3 bucket, they will be removed
 * if the `remove` option is `true`.
 *
 * @param inputOptions
 */
export default async function sync(inputOptions: Partial<SyncOptions>): Promise<StopService> {

  const options = checkAndCopySyncOptionsWithDefaults(inputOptions);

  const { s3Client, queue, rootDir, remove, tmpSuffix, tmpDir } = options;

  // go ahead and capture here. used multiple times below
  const Bucket = options.bucket;
  const MaxKeys = options.maxKeys;
  const Prefix = options.prefix;
  const suffix = options.suffix;

  async function sync() {
    log(`Syncing S3 Bucket '${Bucket}' with local directory '${rootDir}'.`, LogLevel.DEBUG);
    const s3ListPromise = getS3List({
                                      s3Client,
                                      Bucket,
                                      MaxKeys,
                                      Prefix,
                                      suffix,
                                      s3KeyTransformers: options.s3KeyTransformers});
    const dirEntriesPromise = getDirectoryEntries(rootDir, rootDir);
    /*
    * All S3 keys and directory entries have been retrieved and sorted.
    * Can compare them to determine what needs to be added, updated, or removed.
    * */
    const [s3List, dirEntries] = await Promise.all([s3ListPromise, dirEntriesPromise]);
    let dirEntPos = 0;
    const getNextDirEntry = () => {
      return dirEntries[dirEntPos++];
    }
    const getNextDirEntryAfterRemovedDir = (removedDir: string) => {
      let curVal = dirEntries[dirEntPos++];
      while (curVal !== undefined && curVal.relativePath.indexOf(removedDir) === 0) {
        curVal = dirEntries[dirEntPos++];
      }
      return curVal;
    }
    let s3ListPos = 0;
    const getNextS3ListObj = () => {
      return s3List[s3ListPos++];
    }
    let s3ListObj = getNextS3ListObj();
    let dirEntry = getNextDirEntry();
    /*
    * Iterate through the S3 Objects and the local directory entries and
    * add, update, or remove them as necessary.
    *
    * Note that both arrays are sorted at this point, so now can iterate
    * through each array as required. This creates the following conditions:
    *
    * Only care about the S3 objects that are part of the current directory.
    * This means that the S3 key likely will be available, but it should be
    * ignored, because it is not part of the current directory. In this case
    * still need to loop through all of the current directory's entries so
    * that they can be deleted if required.
    *
    * 1. DirEntry < S3Key - need to remove the DirEntry (if deleteOnSync = true),
    *                       because it does not exist in the bucket
    * 2. DirEntry = S3Key - need to check DirEntry stats and update the DirEntry if
    *                       it is outdated
    * 3. DirEntry > S3Key - need to download the object, because it does not exist
    *                       in the local directory
    * */
    while (dirEntry !== undefined || s3ListObj !== undefined) {
      if (dirEntry !== undefined && s3ListObj !== undefined) {
        const { transformedKey } = s3ListObj;
        switch (compareStringsUtf8BinaryOrder(dirEntry.relativePath, transformedKey!)) {
          case -1:  // case 1 above (DirEntry < S3Key)
            /*
            * At this point it is possible that the directory entry is a directory
            * (i.e., ends with the httpPath.sep) - in this case need to check whether
            * or not the S3 key is within the directory.
            * - If the key is within the directory then can skip the entry.
            * - If the key is NOT within the directory need to remove it (when deleteOnSync = true).
            * */
            log(`Dir entry (${dirEntry.relativePath}) comes before the S3 key (${transformedKey}); remove it.`,
                LogLevel.DEBUG);
            if (remove) {
              /*
              * If: DirEntry is a directory and the key is NOT within the directory,
              * then remove the directory, because it occurs before the S3 Key and
              * therefore is not within the S3 bucket - remove it (remove = true here).
              *
              * Else: DirEntry is NOT a directory and it occurs before the S3 Key and
              * therefore is not within the S3 bucket - remove it (remove = true).
              * */
              if (checkKeyOrPathIsDirectory(dirEntry.relativePath) &&
                !keyBelongsInCurrentDirectory(dirEntry.relativePath, transformedKey)) {
                rmdirRecursive({
                                 queue,
                                 rootDir,
                                 relativeDirPath: dirEntry.relativePath
                               });
                /*
                * When an entire directory is removed, need to go back through the list of
                * dirEntries and ensure that
                * */
                dirEntry = getNextDirEntryAfterRemovedDir(dirEntry.relativePath);
              } else if (!checkKeyOrPathIsDirectory(dirEntry.relativePath)) {
                /*
                 * Only unlink when the dirEntry is NOT a directory. Otherwise it is a
                 * directory and the key resides within it.
                 * */
                unlinkFile({
                             queue,
                             rootDir,
                             remove,
                             relativeFilePath: dirEntry.relativePath
                           });
                // advance dir entry
                dirEntry = getNextDirEntry();
              } else {  // key belongs in directory, advance to next entry
                dirEntry = getNextDirEntry();
              }
            } else {
              /*
              * Skipping removal (remove = false), but need to advance to next position.
              * This is an else condition, because the remove condition above advances
              * the directory conditionally (based on whether an entire directory was removed).
              * */
              dirEntry = getNextDirEntry();
            }
            break;
          case 0: // case 2 above (DirEntry = S3Key)
            log(`Dir entry (${dirEntry.relativePath}) equals the S3 key (${transformedKey}); check for changes.`,
                LogLevel.DEBUG);
            /*
            * Are equal, check to see which is the more recent. In the case that the
            * local file is more recent can ignore, however if it is older it should
            * be updated -- because this is a MIRROR. If they are not the same size
            * then they are not the same and the S3 object will be downloaded.
            *
            * Because the directory separator is added to the directory entry httpPath,
            * these will compare exactly if the key is considered a directory.
            *
            * Note, skipping if the dirEntry is a directory as there is nothing to do
            * since the key is equal to the dirEntry and the directory already exists.
            * */
            if (!checkKeyOrPathIsDirectory(dirEntry.relativePath) &&
              (
                s3ListObj.LastModified!.getTime() > dirEntry.stats.mtime.getTime() ||
                s3ListObj.Size !== dirEntry.stats.size
              )
            ) {
              log(`Updating dir entry '${dirEntry.relativePath}'.`, LogLevel.DEBUG);
              writeS3Object({
                              s3Client,
                              queue,
                              transformedKey,
                              rootDir,
                              tmpSuffix,
                              tmpDir,
                              Bucket,
                              Key: s3ListObj.Key!
                            });
            }
            dirEntry = getNextDirEntry();
            s3ListObj = getNextS3ListObj();
            break;
          case 1: // case 3 above (DirEntry > S3Key)
            log(`Dir entry (${dirEntry.relativePath}) comes after the S3 key (${transformedKey}); download S3 object.`,
                LogLevel.DEBUG);
            writeS3Object({
                            s3Client,
                            queue,
                            transformedKey,
                            rootDir,
                            tmpSuffix,
                            tmpDir,
                            Bucket,
                            Key: s3ListObj.Key!
                          });
            s3ListObj = getNextS3ListObj();
            break;
        }
      } else if (dirEntry !== undefined) {
        // dir entry occurs after all s3 keys have finished. thus, it is not in s3. remove if required.
        if (remove) {
          if (checkKeyOrPathIsDirectory(dirEntry.relativePath)) {
            rmdirRecursive({
                             rootDir,
                             queue,
                             relativeDirPath: dirEntry.relativePath
                           })
            dirEntry = getNextDirEntryAfterRemovedDir(dirEntry.relativePath);
          } else {
            unlinkFile({
                         queue,
                         rootDir,
                         remove,
                         relativeFilePath: dirEntry.relativePath
                       });
            dirEntry = getNextDirEntry();
          }
        } else {
          /*
          * Skipping removal (remove = false), but need to advance to next position.
          * This is an else condition, because the remove condition above advances
          * the directory conditionally (based on whether an entire directory was removed).
          * */
          dirEntry = getNextDirEntry();
        }
      } else { // s3ListObj !== undefined
        const { transformedKey } = s3ListObj!;
        writeS3Object({
                        s3Client,
                        queue,
                        transformedKey,
                        rootDir,
                        tmpSuffix,
                        tmpDir,
                        Bucket,
                        Key: s3ListObj!.Key!
                      })
        s3ListObj = getNextS3ListObj();
      }
    }
  }

  let currentlySyncing = false;

  if (!options.skipInitialSync) {
    currentlySyncing = true;
    await sync();
    currentlySyncing = false;
  }

  // tracks the timeout for the sync operation
  let timeout: Timeout;

  /*
  * Currently, the resync interval is reset AFTER the resynchronization operation has
  * occurred. E.g. if the interval is 1min, but it takes 5 minutes to resynchronize, then
  * the next resynchronization will not occur until 6 minutes has elapsed.
  * */
  const {resyncInterval} = options;
  if (resyncInterval) {
    log("Setting resyncInterval interval to " + resyncInterval + " milliseconds.", LogLevel.DEBUG);
    const executeResync = async () => {
      if (!currentlySyncing) {
        log("Resynchronizing. Interval = " + resyncInterval + " milliseconds.", LogLevel.DEBUG);
        currentlySyncing = true;
        await sync();
        currentlySyncing = false;
      }
      timeout = setTimeout(executeResync, resyncInterval);
    }
    timeout = setTimeout(executeResync, resyncInterval);
  }

  registerShutdownHook(() => {
    clearTimeout(timeout);
  });

  return () => {
    clearTimeout(timeout);
  }

}
