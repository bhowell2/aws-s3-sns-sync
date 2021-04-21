import os from "os";

export type NormalizationType = "NFC" | "NFD" | "NFKC" | "NFKD";
export type StringTransformer = (key: string) => string

/*
* Memoize the normalization transformers so that the StringTransformer for
* can be compared against other transformers to ensure duplicates are not
* provided - this is currently not done by the application, because if
* transformers are manually supplied the application does not add on to them.
*
* That being said, this is provided for possible future use or for when
* this is used programmatically.
* */
const memoizedNormKeyTransformers: {[K in NormalizationType]?: StringTransformer} = {};

export function createNormalizationTransformer(form: NormalizationType): StringTransformer {
  if (!form) {
    throw new Error("Normalization form not recognized.")
  }
  form = form.toUpperCase() as NormalizationType;
  if (memoizedNormKeyTransformers[form]) {
    return memoizedNormKeyTransformers[form] as StringTransformer;
  }
  switch (form) {
    case "NFC":
    case "NFD" :
    case "NFKC":
    case "NFKD":
      const transformer: StringTransformer = key => key.normalize(form)
      memoizedNormKeyTransformers[form] = transformer;
      return transformer;
    default:
      throw new Error("Normalization form not recognized. Should be 'NFC', 'NFD', 'NFKC', or 'NFKD'.")
  }
}

/*
* The typescript interface is a bit tight here, because some defaults are
* provided for certain parameters when they are not provided.
*
* The CLI will require a few options, but many will be optional.
* */

export interface S3KeyTransformerOptions {
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
  /**
   * By default forward-slashes ('/') in the key will be replaced with backslashes
   * ('\') on Windows and backslashes will be replaced by forward-slashes on Unix.
   * Replacing the characters creates a normalized directory structure across operating
   * systems. Setting this to true will make it so that no directory-separator characters
   * are replaced (the user can still supply their own {@link s3KeyTransformers} to
   * achieve a similar effect).
   *
   * Keep in mind setting this to false may cause some unexpected behavior. On Unix,
   * keys with a backslash will become filenames with a backslash, while on Windows
   * keys with a forward-slash will cause the forward-slash to be treated as a directory
   * since forward-slash is a reserved character on Windows.
   *
   * Defaults to false (i.e., the characters are replaced).
   */
  ignoreKeyPlatformDirCharReplacement?: boolean
  /**
   * By default, root file system characters will be removed from the beginning of an
   * S3 key (e.g., if a key begins with '/' the leading '/' will be removed). This same
   * rules will be applied to all platforms (e.g., a key beginning with 'A:\1\2' will
   * become '1\2' on Windows or '1/2' on Unix).
   *
   * When false, this will remove the characters: '/', '\', '[A-Z]:\' or '[A-Z]:/'
   * from the beginning of a key.
   *
   * Defaults to false (i.e., remove root characters).
   */
  ignoreKeyRootCharReplacement?: boolean
}

/**
 * On Unix systems it will likely be desirable to replace an S3 key's backslash with
 * a forward-slash and on Windows systems replace the forward-slash with a backslash.
 * This makes the key normalized to the system's httpPath structure and allows for easily
 * comparing the mirror directory structure to the S3 Key.
 */
export function replaceKeyDirCharsWithSystemSep(str: string): string {
  if (os.platform() === 'win32') {
    if (str.indexOf('/') < 0) {
      // nothing to replace. short circuit.
      return str;
    }
    let retStr = "";
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      retStr += c === '/' ? '\\' : c;
    }
    return retStr;
  } else {  // is Unix type. replace windows '\' with '/'
    if (str.indexOf('\\') < 0) {
      // nothing to replace. short circuit.
      return str;
    }
    let retStr = "";
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      retStr += c === '\\' ? '/' : c;
    }
    return retStr;
  }
}

/**
 * Removes any characters from the key that would be considered to
 * start at the root drive (i.e., '/', '\', or '[A-Z]:\'. This will
 * remove recurring root characters.
 * @param key
 */
export function removeRootDirCharsFromS3Key(key: string): string {
  let startPos = 0;
  let windowsTestRes = false;
  while (
    key.charAt(startPos) === '/' ||
    key.charAt(startPos) === '\\' ||
    (
      key.length - startPos >= 2 &&
      // char between A and Z (inclusive)
      key.charAt(startPos) >= 'A' &&
      key.charAt(startPos) <= 'Z' &&
      // then contains : and '/' or '\'
      key.charAt(startPos + 1) === ':' &&
      (
        key.charAt(startPos + 2) === '\\'
        ||
        key.charAt(startPos + 2) === '/'
      )
      &&
      (windowsTestRes = true)
    )
    ) {
    startPos++;
    if (windowsTestRes) {
      startPos += 2;
      windowsTestRes = false;
    }
  }
  return key.substr(startPos);
}


/**
 * Returns transformers to be applied to all S3 keys.
 *
 * If 'ignoreKeyRootCharReplacement' is undefined/false a transformer will be provided
 * that will remove root directory characters (e.g., '/', 'A:\', 'A:/') from the keys.
 *
 * If 'ignoreKeyPlatformDirCharReplacement' is undefined/false a transformer will be
 * provided that will replace directory separators to normalize the file system on
 * different platforms. E.g., on Windows both '/' and '\' are treated as directory
 * separators by Node.js ('/' is a reserved character on FS with Windows, so httpPath.resolve()
 * converts it to a '\' anyway), but on Unix only '/' is treated as a directory separator.
 * On Windows, converting '\' to '/' makes it easy to compare the local file system to the
 * S3 Key (and determine whether or not the key exists locally). This is not the same on Unix,
 * however as '\' will is a valid character and will be part of file name and is not treated
 * as a directory separator - to create consistency between platforms, by default, '\' will be
 * converted to '/' on Unix. If this is not desired the user can set 'ignoreKeyPlatformDirCharReplacement'
 * to true (note as mentioned above this will create inconsistencies between platforms).
 *
 * If 'normalizationForm' is provided then a transformer will be provided to normalize the key -
 * this can also help create consistency across platforms.
 *
 */
export function getDefaultS3KeyTransformers(options: S3KeyTransformerOptions): StringTransformer[] | undefined {
  const transformer = [];
  if (!options.ignoreKeyRootCharReplacement) {
    transformer.push(removeRootDirCharsFromS3Key)
  }
  if (!options.ignoreKeyPlatformDirCharReplacement) {
    transformer.push(replaceKeyDirCharsWithSystemSep)
  }
  if (options.normalizationForm) {
    transformer.push(createNormalizationTransformer(options.normalizationForm));
  }
  return transformer.length > 0 ? transformer : undefined;
}
