import * as os from "os";

/**
 * Used to obtain the relative httpPath of the current directory to the
 * root mirror directory. This is then used to compare the current
 * directory against the S3 key.
 *
 * E.g.,
 * getRelativePathToRootDir("/root/mir/dir/", "/root/mir/dir/folder1") = "folder1"
 *
 * @param rootDir the fully resolved httpPath to the root mirror directory
 * @param curDir the fully resolved httpPath to the current directory
 * @return the remaining part of the httpPath
 */
export function getRelativePathToRootDir(rootDir: string, curDir: string): string {
  if (curDir.indexOf(rootDir) < 0) {
    throw new Error(`Could not get relative path to root directory, because root `
                      + `directory path (${rootDir}) was not within the current `
                      + `directory path (${curDir}).`);
  }
  return curDir.substring(rootDir.length + 1);  // +1 to remove the leading forward-slash
}

/**
 * Checks whether or not the s3 key belongs in the current directory. This
 * INCLUDES subdirectories - i.e., just because this is true does not mean
 * that the key does not actually belong in a directory within the current
 * directory.
 *
 * The key is only considered to belong in the current directory if the key
 * begins at the start of the directory
 */
export function keyBelongsInCurrentDirectory(curDir: string, s3Key: string): boolean {
  return s3Key.indexOf(curDir) === 0;
}

/**
 * Determines if the string should be considered a directory. This differs
 * on Windows and Unix (especially with Node.js) as the two treat directory
 * delimiters differently.
 *
 * On Windows forward-slash is a reserved character and Node.js will treat
 * backslash and forward-slash as directory delimiters, therefore if the key
 * ends with either it should be considered a directory.
 *
 * On Unix only forward-slashes are treated as a directory.
 */
export function checkKeyOrPathIsDirectory(key: string): boolean {
  const c = key.charAt(key.length - 1);
  if (os.platform() === "win32")
    return c === "\\" || c === '/';
  else
    return c === "/";
}
