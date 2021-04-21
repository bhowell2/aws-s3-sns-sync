import * as path from "path";
import * as os from "os";


/**
 * Because on linux '\' is a valid file name character it needs to be replaced
 * to create a consistent directory structure on both windows and linux from
 * the S3 key.
 * @param key
 */
export function replaceBackSlashesOnUnix(key: string): string {
  if (os.platform() !== 'win32') {
    if (key.indexOf("\\") >= 0) { // check that a back slash exists before recreating string
      let newKey = "";
      for (let i = 0; i < key.length; i++) {
        if (key.charAt(i) == '\\') {
          newKey += "/";
        } else {
          newKey += key.charAt(i);
        }
      }
      return newKey;
    } // else return key below
  }
  return key;
}

/**
 * This is used when listing a directory's entries to ensure that it is
 * easy to tell whether an entry is a subdirectory or not.
 */
export function ensurePathEndsWithOsSeparator(str: string): string {
  return str.charAt(str.length) === path.sep
    ?
    str
    :
    str + path.sep;
}

/**
 * Checks whether or not the provided httpPath is absolute. Throws an error
 * if it is not.
 * @param str
 * @param errMsg
 */
export function checkPathIsAbsolute(str: string, errMsg?: string) {
  if (!path.isAbsolute(str)) {
    if (errMsg) {
      throw new Error(errMsg);
    } else {
      throw new Error(`Path '${str}' was not absolute.`);
    }
  }
}

type ArrayType<T> = T extends Array<unknown> ? T : never

export function addToOptionsArray<
  O extends { [k: string]: any },
  K extends keyof O,
  T extends ArrayType<O[K]>
  >
(
  options: O,
  key: K,
  beginningOfArray: boolean,
  ...elements: T[]
) {
  if (elements && elements.length > 0) {
    if (Array.isArray(options[key])) {
      if (beginningOfArray) {
        options[key] = [...elements, ...options[key]] as O[K];
      } else {
        options[key] = [...options[key], ...elements] as O[K];
      }
    } else {
      options[key] = elements as O[K];
    }
  } // do nothing if there are no elements to add
}
