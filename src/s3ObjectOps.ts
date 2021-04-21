/*
* Operations performed on the retrieved S3 Object
* */

import { KeysOfType } from "./typeUtils";
import { log, LogLevel } from "./logger";
import * as path from "path";
import { StringTransformer } from "./utils/transformers";

/**
 * This is an extension of the S3Object
 */
export interface MirrorS3Object {
  /**
   * The resulting S3 key after KeyTransformations have been applied
   * to it. This is the the value that is used to determine the write
   * httpPath of the mirrored object as to order the S3 objects when syncing.
   */
  transformedKey: string
}

/**
 * Takes in a key and returns the key after the transformers have been applied.
 */
export function applyTransformersToKey(key: string, transformers?: StringTransformer[]): string {
  let transKey = key;
  if (transformers && transformers.length > 0) {
    for (let i = 0; i < transformers.length; i++) {
      transKey = transformers[i](transKey);
    }
  }
  return transKey;
}

/**
 * Sets {@link MirrorS3Object.transformedKey} of the provided object, by
 * transforming the key supplied as the 'keyName' parameter.
 * @param obj the object to retrieve the original key and set 'transformedKey' on
 * @param keyName name of the original key before transforming
 * @param transformers to be applied to key. if not supplied will set 'transformedKey' to same value as 'keyName'.
 * @throws throws error when the key is empty, undefined, or null
 */
export function setTransformedKey<T extends MirrorS3Object>(obj: T,
                                                            keyName: KeysOfType<T, string | undefined>,
                                                            transformers?: StringTransformer[]) {
  // can cast fine here as keyName is constrained to only be valid for string types
  const key = obj[keyName] as unknown as string;
  if (!key) {
    const errMsg = "key was undefined, null, or empty. This is unexpected. Obj = '" + JSON.stringify(obj) + "'";
    log(errMsg, LogLevel.ERROR);
    throw new Error(errMsg);
  } else {
    obj.transformedKey = applyTransformersToKey(key, transformers);
  }
}

/**
 * Checks whether or not the key ends with the current platforms httpPath separator.
 */
export function keyIsDirectory(key: string): boolean {
  return key.charAt(key.length - 1) === path.sep;
}
