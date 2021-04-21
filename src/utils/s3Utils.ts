import { MirrorS3Object, setTransformedKey } from "../s3ObjectOps";
import { _Object, GetObjectCommand, ListObjectsV2Command, ListObjectsV2Output, S3Client } from "@aws-sdk/client-s3";
import { log, LogLevel } from "../logger";
import { compareStringsUtf8BinaryOrder } from "./stringUtils";
import { Readable } from "stream";
import { StringTransformer } from "./transformers";

// S3 will send errors that have a "name" and possibly a code.
type S3Error = {
  name?: string
  code?: string
}

function getS3ErrorInfo(err: any): S3Error {
  const {name, code} = err;
  return {
    name,
    code
  }
}

export interface S3CommonOptions {
  s3Client: S3Client
}

export interface S3ListOptions extends S3CommonOptions {
  /**
   * The S3 bucket where the keys to list reside.
   *
   * Part of S3 API.
   */
  Bucket: string

  /**
   * Maximum number of keys to retrieve in List operation at a time.
   *
   * Part of S3 API.
   */
  MaxKeys?: number

  /**
   * Used to only retrieve keys that match the prefix.
   *
   * Part of S3 API.
   */
  Prefix?: string

  /**
   * Used to filter out keys that end with the provided suffix. This is
   * complementary to the S3 API's Prefix option, that allows for only
   * returning values that match the Prefix. The S3 API does not offer
   * the Suffix option, so this is used to filter out keys that do not
   * end with the Suffix after they have been returned.
   *
   * Is NOT part of S3 API.
   */
  suffix?: string

  /**
   * Transformers to be applied to each key
   */
  s3KeyTransformers?: StringTransformer[]
}

/**
 * Extends the original object returned by the S3 List operation,
 * adding the transformedKey. The original key cannot be overridden
 * by the transformedKey, because it would not be possible to know
 * the original key needed to retrieve the object from S3.
 */
export type S3ListObj = MirrorS3Object & _Object;

/**
 * Used to obtain a function that will handle providing the next value of the
 * retrieved S3 keys. Currently this retrieves __ALL__ S3 keys in the bucket.
 * This is the easiest solution even for a few hundred thousand objects (each
 * ten thousand objects takes up roughly 10MB). This is by far the easier solution
 * when it comes to transforming keys (e.g., normalizationForm), because if the keys
 * are not all retrieved at the same time latter keys may be transformed to a
 * key that occurred before the others in UTF-8 binary sorted order.
 */
export async function getS3List(options: S3ListOptions): Promise<S3ListObj[]> {
  /*
  * If transformers are used, need to create a "set" in case multiple keys
  * are transformed to the same value. The objects will then be sorted into an
  * array to be compared against the [sorted] list of local directory entries.
  *
  * A case where a transformer may cause multiple keys to be transformed to the
  * same value are when something like normalizationForm is used or, perhaps, even
  * .toLowerCase().
  *
  * Normalization: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
  * */
  const { s3Client, s3KeyTransformers } = options;
  const allBucketKeys: { [key: string]: S3ListObj } = {};
  // req will be set to null when there are no more objects to retrieve so loop will exit
  let req: Promise<ListObjectsV2Output> | null = s3Client.send(new ListObjectsV2Command(options));
  while (req !== null) {
    // so long as await is used here there will be no problem
    let resp: ListObjectsV2Output = await req;
    if (resp.NextContinuationToken) {
      /*
      * Go ahead and start next request since all will be listed.
      * Transforming and filtering them below will take less time
      * than retrieving the next list from S3.
      * */
      req = s3Client.send(new ListObjectsV2Command({
                                                     ...(options as any),
                                                     ContinuationToken: resp.NextContinuationToken
                                                   }))
    } else { // no more to retrieve. while loop will exit
      req = null;
    }
    const {Contents} = resp;
    if (!Contents) {
      break;  // stupid hack cause AWS's typing sucks
    }
    /*
    * Go through the returned objects, filter them out if a suffix is provided,
    * transform their keys, and then sort them.
    * */
    for (let i = 0; i < Contents.length; i++) {
      // type here to avoid typing again later, but still need to set the transformedKey
      const s3ListObj: S3ListObj = Contents[i] as S3ListObj
      /*
      * If suffix is provided it is treated as a filter and if the key DOES NOT
      * end with the suffix it will be ignored. (continue.)
      * */
      if (options.suffix && !s3ListObj.Key?.endsWith(options.suffix)) {
        continue;
      }
      /*
      * If transformers are provided then need to set the transformedKey
      * and use it as the index where it will be sorted. In the case that
      * a key is transformed and it collides with another key the latter
      * key will override the former - this will be logged as a warning.
      *
      * The regular key will always be used to retrieve an object, but
      * the transformedKey will be used as the file name to store it locally.
      * */
      try {
        // this could throw if key is undefined. should never happen.. but not assuming
        setTransformedKey(s3ListObj, 'Key', s3KeyTransformers);
        if (allBucketKeys.hasOwnProperty(s3ListObj.transformedKey!)) {
          // log in the case of overriding so that user can track if desired
          log(`Overriding {transformedKey: ${allBucketKeys[s3ListObj.transformedKey!].transformedKey}, `
                + `key: ${allBucketKeys[s3ListObj.transformedKey!].Key}} with {transformedKey: ${s3ListObj.transformedKey}, `
                + `key: ${s3ListObj.Key}}.`, LogLevel.WARN);
        }
        const {transformedKey} = s3ListObj;
        if (transformedKey === undefined || transformedKey === null ||
          transformedKey === "" || transformedKey === "/") {
          log(`Ignoring S3 Object with key='${s3ListObj.Key}' because the transformed key='${transformedKey}'.`,
              LogLevel.WARN);
        } else {
          allBucketKeys[s3ListObj.transformedKey!] = s3ListObj;
        }
      } catch (err) {
        // ignore key
      }
    }
  }
  const list: S3ListObj[] = [];
  for (let k in allBucketKeys) {
    list.push(allBucketKeys[k]);
  }
  list.sort((a, b) => compareStringsUtf8BinaryOrder(a.Key!, b.Key!))
  return list;
}

// options required to retrieve the S3 object
export interface GetS3ObjectOptions {
  s3Client: S3Client
  Bucket: string
  // this is the S3 key, not the transformed key.
  Key: string
}

/**
 * Retrieves the S3 object and returns the data of the S3 object as a buffer.
 */
export async function getS3Object(options: GetS3ObjectOptions): Promise<Buffer> {
  const {s3Client, Key, Bucket} = options;
  return s3Client
    .send(new GetObjectCommand({Bucket, Key}))
    .then(resp => (
            new Promise((resolve, reject) => {
              const {httpStatusCode} = resp.$metadata;
              if (httpStatusCode && httpStatusCode >= 200 && httpStatusCode < 300) {
                let chunks: Buffer[] = [];
                (resp.Body as Readable).on('data', (chunk: Buffer) => {
                  chunks.push(chunk);
                });
                (resp.Body as Readable).on('end', () => {
                  resolve(Buffer.concat(chunks));
                });
              } else {
                reject(new Error(`Received bad httpStatusCode '${httpStatusCode} for s3.GetObject request.'`))
              }
            })
          )
    );
}
