import { S3Client } from "@aws-sdk/client-s3";
import AsyncOpQueue, { PromiseTask } from "./AsyncOpQueue";
import { log, LogLevel } from "./logger";
import * as path from "path";
import * as fs from "fs";
import { ensurePathEndsWithOsSeparator } from "./utils/utils";
import { keyIsDirectory } from "./s3ObjectOps";
import { getRelativePathToRootDir } from "./utils/keyAndPathUtils";
import { compareStringsUtf8BinaryOrder } from "./utils/stringUtils";
import { Stats } from "fs";
import { getS3Object } from "./utils/s3Utils";

/**
 * Options for file system operations (e.g., unlink, mkdir) .
 */
interface CommonFsOptions {
  /**
   * Queue to submit to for retrieving and writing the object.
   */
  queue: AsyncOpQueue
  /**
   * Root directory where mirrored objects are written. Used to resolve
   * the correct write httpPath from the transformed key.
   */
  rootDir: string
}

interface WriteS3ObjectOptions extends CommonFsOptions {
  /**
   * Client used to retrieve the S3 object's contents (if not directory).
   */
  s3Client: S3Client
  /**
   * bucket where key resides.
   */
  Bucket: string
  /**
   * key of S3 object to retrieve. This may differ from transformed key.
   */
  Key: string
  /**
   * This will be appended to the temporary file that is written when an S3 object
   * is downloaded. This ensures that the file change appears atomically for the
   * expected file name (the temporary file is moved/renamed to the expected file).
   */
  tmpSuffix: string
  /**
   * Directory where S3 object will be written before moving it to rootDir.
   */
  tmpDir?: string
  /**
   * The key to be used to write the file locally. This may differ from key
   * and will be used when actually writing the file name.
   */
  transformedKey: string
}

/**
 * Writes the file to the temporary directory (or httpPath) and then moves it
 * to the final location (relativeFilePath) once it has been
 * fully written.
 *
 * The temporary directory or file are used to make the write operation on
 * the file appear atomic. This way if the user is watching the directory
 * or file for changes it will be more likely to only pick up once change
 * rather than multiple with the create/write operation on the file.
 */
export function writeS3Object(options: WriteS3ObjectOptions): void {

  const { queue, Bucket, Key, rootDir, tmpSuffix, tmpDir, transformedKey } = options;

  /*
  * writeFilePath is the full write httpPath of the s3Object. This is used
  * to ensure that only one operation is performed on the file at the
  * same time as the AsyncOpQueue key.
  * */
  const writeFilePath = path.resolve(rootDir, transformedKey);

  let queueOp: PromiseTask<any>

  if (keyIsDirectory(transformedKey)) {
    // The Key is considered a directory. Make the directory.
    queueOp = () => {
      log(`Creating directory '${writeFilePath}'.`, LogLevel.DEBUG);
      return fs.promises.mkdir(writeFilePath, {recursive: true});
    }
  } else {
    queueOp = () => {
      log(`Sending request for key='${Key}' to bucket='${Bucket}'. ${tmpDir ? `Writing to tmpDir='${tmpDir}'` : ""} final destination='${writeFilePath}'.`, LogLevel.DEBUG);
      return getS3Object(options).then(s3Data => {
        /*
        * Random chunk is added to the file name to ensure that concurrent updates
        * of a file do not conflict - it's possible that multiple SNS events are
        * received for a single file OR sync and SNS happen at the same time. This
        * case should be handled by the AsyncOpQueue, but this is just an extra
        * insurance policy.
        * */
        const tmpFileName = transformedKey + "." + Math.random().toString(36).substr(2) + tmpSuffix;
        const tmpFilePath = tmpDir ? path.resolve(tmpDir, tmpFileName) : path.resolve(rootDir, tmpFileName);
        const parsedFilePath = path.parse(writeFilePath);
        /*
        * Ensure directory exists where file will be written. Do this first,
        * because the tmpFilePath may be here as well if tmpDir is undefined.
        * */
        return fs.promises.mkdir(parsedFilePath.dir, {recursive: true})
                 .then(() => fs.promises.writeFile(tmpFilePath, s3Data))
                 .then(() => fs.promises.rename(tmpFilePath, writeFilePath))
                 .catch(err => {
                   log(`Key='${Key}', filePath='${writeFilePath}', tmpFilePath='${tmpFilePath}'.\n${err}`, LogLevel.ERROR)
                   return Promise.reject(err);
                 })
      })
    }
  }
  queue.submitPromiseTask(writeFilePath, queueOp);
}


interface UnlinkFileOptions extends CommonFsOptions {
  /**
   * The httpPath to the file to remove.
   */
  relativeFilePath: string
  /**
   * Whether or not to remove the directory where the file to remove resides
   * if it is empty.
   */
  remove: boolean | undefined
}

/**
 * Handles removing the provided file and the parent directory if the directory
 * becomes empty. This does not remove the root directory.
 * @param options
 */
export function unlinkFile(options: UnlinkFileOptions): void {
  const {queue, rootDir, relativeFilePath, remove} = options;
  const removeFilePath = path.resolve(rootDir, relativeFilePath);
  queue.submitPromiseTask(removeFilePath, () => {
    const parsedPath = path.parse(removeFilePath);
    log(`Removing file '${removeFilePath}'.`, LogLevel.DEBUG);
    return fs.promises.unlink(removeFilePath).then(() => {
      if (remove && parsedPath.dir !== rootDir) {
        return fs.promises.readdir(parsedPath.dir).then(entries => {
          if (entries.length === 0) {
            log(`Removing directory '${parsedPath.dir}' because it is empty.`, LogLevel.DEBUG);
            return fs.promises.rmdir(parsedPath.dir);
          }
        })
      }
    }).catch(err => {
      // already unlinked?
      log(err, LogLevel.ERROR)
      return Promise.reject(err);
    })
  })
}

interface MkdirOptions extends CommonFsOptions {
  relativeDirPath: string
}

/**
 * Creates a directory with the provided options.
 * @param options
 */
export function mkdirRecursive(options: MkdirOptions): void {
  const {queue, rootDir, relativeDirPath} = options;
  const mkdirPath = path.resolve(rootDir, relativeDirPath);
  queue.submitPromiseTask(mkdirPath, () => {
    log(`Creating directory '${mkdirPath}'.`, LogLevel.DEBUG);
    return fs.promises.mkdir(mkdirPath, {recursive: true});
  });
}

interface RmdirOptions extends MkdirOptions {
}

const windowsRootRegex = new RegExp("^[A-Za-z]:\\\\$")

/**
 * This will remove the directory and all of its entries.
 */
export function rmdirRecursive(options: RmdirOptions): void {
  const {queue, rootDir, relativeDirPath} = options;
  // make sure they both end with the OS separator so that they can be compared for equality
  if (ensurePathEndsWithOsSeparator(relativeDirPath) !== ensurePathEndsWithOsSeparator(rootDir)) {
    const rmDirPath = path.resolve(rootDir, relativeDirPath);
    if (rmDirPath === "/" || rmDirPath.match(windowsRootRegex) !== null) {
      throw new Error("The root directory should never be removed. Was = '" + rmDirPath + "'.");
    }
    queue.submitPromiseTask(rmDirPath, () => {
      log(`Recursively removing directory '${rmDirPath}'.`, LogLevel.DEBUG);
      return fs.promises.rmdir(rmDirPath, {recursive: true});
    });
  } else {
    log(`Directory (${relativeDirPath}) will not be removed because it is the root mirror directory.`, LogLevel.DEBUG);
  }
}

interface DirEntry {
  /**
   * Relative httpPath to the root mirror directory. This should match
   * the S3 key.
   */
  relativePath: string
  /**
   * Stats for the object
   */
  stats: Stats
}

/**
 * Returns the directory's entries in their entirety. This will append
 * the platform's directory separator to the end of directories, making
 * it easier to compare the entry against the S3 key.
 *
 * In S3 a key could be returned with only a directory separator and/or
 * the directory separator could be part of a greater key.
 * E.g.:
 * dir1/ or dir1/file1
 *
 * Depending on how the user has structured their S3 bucket either of the
 * following could be returned when listing keys:
 * 1. dir1/, dir1/file1
 * 2. dir1/file1
 *
 * This leaves two possibilities when creating a list of the entries for
 * a given directory:
 * 1. Include only the directory entry with directory separator (e.g., dir1/).
 * 2. Do not include the directory with a
 *
 * Usage of the appended directory separator:
 * Key    = 1/2/3/ (meaning it should be a directory)
 * Entry  = 1/2/3  (is a directory)
 *
 * @param rootDir the root directory that is used to
 * @param dir the directory from which entries are obtained
 */
export async function getDirectoryEntries(rootDir: string, dir: string): Promise<DirEntry[]> {
  return fs.promises.readdir(dir, {encoding: "utf-8"}).then(entries => {
    let innerPromises: Promise<DirEntry | DirEntry[] | undefined>[] = [];
    for (let i = 0; i < entries.length; i++) {
      let entryPath = path.resolve(dir, entries[i]);
      innerPromises.push(
        fs.promises.stat(entryPath).then<DirEntry | DirEntry[]>(stats => {
          if (stats.isDirectory()) {
            let dirStats = {
              // directories end with a forward or back slash (system dependent)
              relativePath: getRelativePathToRootDir(rootDir, entryPath) + path.sep,
              stats
            }
            return getDirectoryEntries(rootDir, entryPath).then(entries => {
              // add in the directory itself, before all of its entries (will be alphabetical order)
              entries.splice(0, 0, dirStats)
              return entries;
            })
          }
          return {relativePath: getRelativePathToRootDir(rootDir, entryPath), stats}
        }).catch(err => {
          log(err, LogLevel.ERROR)
          return undefined;
        })
      )
    }
    return Promise.all(innerPromises)
                  .then(res => res.filter(val => val !== undefined)) as Promise<(DirEntry | DirEntry[])[]>;
  }).then(res => {
    // note, the result will be DirEntry or an array of DirEntries. flatten them if they're an array.
    let retList: DirEntry[] = [];
    for (let i = 0; i < res.length; i++) {
      let dirEntryOrEntries = res[i];
      if (Array.isArray(dirEntryOrEntries)) {
        retList.push(...dirEntryOrEntries);
      } else {
        retList.push(dirEntryOrEntries);
      }
    }
    return retList.sort((a, b) => compareStringsUtf8BinaryOrder(a.relativePath, b.relativePath));
  })
}
