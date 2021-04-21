import { log, LogLevel } from "./logger";

const placeholder = {}

/**
 * These are errors that will be rethrown. Other errors will just be logged.
 * These errors are non-recoverable.
 */
const UNHANDLED_AWS_ERRORS: {[key: string]: any} = {
  "NoSuchBucket": placeholder,
  "AccessDenied": placeholder
}

type AcceptableErrorNames =
  // AWS
  "NoSuchKey" |
  // FILE SYSTEM
  "ENOENT" |
  "ENOTEMPTY" |
  "EISDIR" |
  "EEXIST";

type AcceptableErrors = { [key in AcceptableErrorNames]: any};

/**
 * These are errors that should not shutdown the program. Other errors should
 * shutdown the program
 */
const ACCEPTABLE_ERRORS: AcceptableErrors = {
  // AWS
  "NoSuchKey": placeholder,
  /*
  * FILE SYSTEM
  * These are issues when
  * */
  // FILE SYSTEM
  "ENOENT": placeholder,
  "ENOTEMPTY": placeholder,
  "EISDIR": placeholder,
  "EEXIST": placeholder,
};

/**
 * Determines whether or not the provided error was an expected
 * error under certain conditions.
 * @param error the error that occurred to be checked against the acceptable errors
 * @param excludeAcceptableErrors acceptable errors that will not be included in the acceptable errors
 */
export function isAcceptableError(error: any,
                                  excludeAcceptableErrors?: Partial<AcceptableErrors>): boolean {
  const {name, code} = error;
  if (excludeAcceptableErrors) {
    return (
        name &&
        excludeAcceptableErrors[name as AcceptableErrorNames] === undefined &&
        ACCEPTABLE_ERRORS[name as AcceptableErrorNames] !== undefined
      )
      ||
      (
        code &&
        excludeAcceptableErrors[code as AcceptableErrorNames] === undefined &&
        ACCEPTABLE_ERRORS[code as AcceptableErrorNames] !== undefined
      );
  }
  return (name && ACCEPTABLE_ERRORS[name as AcceptableErrorNames]) ||
    (code && ACCEPTABLE_ERRORS[code as AcceptableErrorNames]);
}

/**
 * Can be passed to catch errors in promise chains.
 */
export function handleAcceptableError(error: any,
                                      logAcceptableError = true,
                                      excludeAcceptableErrors?: Partial<AcceptableErrors>)
  : Promise<any> {
  if (isAcceptableError(error, excludeAcceptableErrors)) {
    if (logAcceptableError) {
      log(error, LogLevel.ERROR);
    }
    return Promise.resolve();
  }
  return Promise.reject(error)
}
