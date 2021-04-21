import { createCommand } from 'commander';
import { LogLevel, setLogLevelFromString } from "./logger";
import { SnsServerOptions } from "./SnsServer";
import { SyncOptions } from "./sync";
import { CommonOptions } from "./options";

/**
 * All options that can be provided via CLI.
 *
 * Defining CommonOptions, SyncOptions, and SnsServerOptions separately is
 * easier than defining CliOptions and then omitting in each of the aforementioned
 * interfaces.
 */
export type CliOptions =
  Omit<
    CommonOptions & SyncOptions & SnsServerOptions,
    "snsClient" | "s3Client" | "queue" | "s3KeyTransformers"
    >

export default function cli() {
  const program = createCommand();

  /*
  *
  * COMMON OPTIONS
  *
  * */

  program.requiredOption("--bucket <bucket>",
                         "The S3 bucket to synchronize against.");

  program.requiredOption("--region <region>",
                         "The region where the bucket resides. Defaults to us-east-1.",
                         "us-east-1");

  program.requiredOption("--root-dir <dir>",
                         "The local directory that will mirror the supplied S3 bucket's contents.");

  program.option("--tmp-suffix <suf>",
                 "Suffix to use when writing filesAndDirs temporarily. Will be moved/renamed once they have completed writing.",
                 ".tmp")

  program.option("--tmp-dir <dir>",
                 "Local directory to write filesAndDirs temporarily before moving them to their final destination. Helps when watching a directory for changes.");

  program.option("--remove",
                 "Whether or not to remove filesAndDirs from the local directory when they are removed from the S3 " +
                   "bucket. Defaults to false to ensure accidental deletion does not occur.",
                 false);

  program.option("--prefix <pre>",
                 "The [filter] prefix to use when listing S3 objects or receiving notifications. " +
                   "With listing, this will filter the keys by passing in the prefix to the list command. " +
                   "With SNS events the prefix will be checked against the event's key for a match. If there " +
                   "is no match then the key will be ignored.");

  program.option("--suffix <suff>",
                 "The [filter] suffix to use when listing S3 objects or receiving notifications. " +
                   "With listing and SNS events this will filter the keys/events after they are retrieved, " +
                   "because S3 does not provide the functionality to list keys by suffix.");


  /*
  * Normalization is useful to reduce strings that will normalize to the same string.
  * This helps to keep a file from being written to multiple times on a file system
  * that normalizes the names (e.g., Mac OSX).
  * */
  program.option("--normalization-form <norm>",
                 "The normalization method to use on local paths and keys. This ensures that if there are conflicts " +
                   "when keys are normalized they can be resolved before writing. Can be 'NFC', 'NFD', " +
                   "'NFKC', or 'NFKD'.",
                 (value, previous) => {
                   switch (value.toUpperCase()) {
                     case "NFC":
                     case "NFD":
                     case "NFKC":
                     case "NFKD":
                       break;
                     default:
                       throw new Error("Unrecognized normalization form. Can only be 'NFC', 'NFD', 'NFKC', or 'NFKD'.");
                   }
                   return value;
                 });

  /*
  * Windows has many reserved characters for file names, but Unix has only one reserved
  * character: '/'. This can create inconsistencies between writing filesAndDirs from S3 to the
  * local file-system (across platforms). By default backslashes ('\') will be replaced by
  * forward-slashes ('/') on Unix platforms and forward-slashes will be replaced by
  * backslashes on Windows. In the case of backslashes to forward-slashes on Unix the directory
  * structure will look the same as it does on Windows. In the case of forward-slashes to
  * backslashes on Windows (forward-slashes are reserved and cannot be used) Node.js would
  * treat the forward-slashes as directory delimiters (backslashes) anyway, and it makes it
  * easy to compare the directory's entries (with subdirectories) to the S3 key.
  *
  * E.g.,
  * Windows: httpPath.resolve('1/2/3') = '1\\2\\3'
  * Windows: httpPath.resolve('1\\2\\3') = '1\\2\\3'
  * Unix: httpPath.resolve('1/2/3') = '1/2/3'
  * Unix: httpPath.resolve('1\\2\\3') = '1\\2\\3' - a single file
  * */

  program.option("--ignore-key-platform-dir-char-replacement",
                 "Do NOT replace directory characters based on the platform. " +
                   "On Windows forward-slashes ('/') will be replaced with backslashes ('\\') " +
                   "and on Unix backslashes ('\\') will be replaced with forward-slashes ('/'). This " +
                   "allows for a more consistent directory structure across platforms and makes it clear where " +
                   "a character in a key will be treated as a directory. " +
                   "Defaults to false (i.e., replace directory delimiters based on operating system).",
                 false)

  program.option("--ignore-key-root-char-replacement",
                 "Do NOT replace root directory characters at the beginning of a key. By default this is FALSE " +
                   "(disabled) as it could easily lead to unintended problems. Use with caution. The default " +
                   "implementation will remove '\\', '/', and '[A-Z]:\\' from (the beginning of) S3 keys on" +
                   " Windows AND Unix.",
                 false);

  program.option("--access-key-id",
                 "Not advisable to use this. Will be used for the SNS and S3 clients' credentials. Must " +
                   "also provide --secret-access-key if this is provided.");

  program.option("--secret-access-key",
                 "Not advisable to use this. Will be used for the SNS and S3 clients' credentials. Must " +
                   "also provide --access-key-id if this is provided.");

  program.option("--max-concurrency <max>",
                 "Maximum number of concurrent S3 object requests as well as file operations performed. "
                   + "Defaults to 300.",
                 (value) => {
                   const maxConcurrency = Number.parseInt(value, 10);
                   if (isNaN(maxConcurrency)) {
                     throw new Error("'max-concurrency' is not a number (NaN).")
                   }
                   return maxConcurrency;
                 },
                 300);

  /*
  *
  * SYNC OPTIONS
  *
  * */

  program.option("--max-keys <max>",
                 "The maximum number of keys to retrieve at a time when listing the S3 bucket's objects. "
                   + "Default is 1000.",
                 ((value, previous) => {
                   const maxKeys = Number.parseInt(value, 10);
                   if (isNaN(maxKeys)) {
                     throw new Error("'max-keys' argument is not a number (NaN).")
                   }
                   return maxKeys;
                 }),
                 1000);

  program.option("--skip-initial-sync",
                 "Keeps program from synchronizing with the S3 bucket on startup.",
                 false);

  program.option("--resync-interval <ms>",
                 "Polls the S3 bucket for changes by listing every key and comparing them (this is "
                   + "what is done on initial synchronization). This can be useful if an SNS notification "
                   + "is missed, but it will increase your AWS bill as List requests are not free.",
                 ((value, previous) => {
                   const resyncPeriodMillis = Number.parseInt(value, 10);
                   if (isNaN(resyncPeriodMillis)) {
                     throw new Error("'resync-interval' argument is not a number (NaN).");
                   }
                   return resyncPeriodMillis;
                 }),
                 0);

  /*
  *
  * SNS SERVER OPTIONS
  *
  * */

  program.option("--host <host>",
                 "The address to listen on for HTTP/S SNS events. Defaults to '0.0.0.0'.",
                 "0.0.0.0");

  program.option("--port <port>",
                 "The port to listen on for HTTP/S SNS events. This does not have a default, because if it is "
                   + "not provided no server will be started to listen for SNS events.");

  program.option("--https-cert-httpPath <cert>",
                 "The HTTPS certificate to use for the HTTPS SNS event server. The 'cert-key' parameter must "
                   + "be provided if this is provided. If this is not provided (and 'port' is) an HTTP server "
                   + "will be used instead of HTTPS to listen for SNS events.");

  program.option("--https-cert-key-httpPath <cert>",
                 "The key for the provided HTTPS certificate. Required if 'cert' is provided.")

  program.option("--http-path <httpPath>",
                 "Path to listen on for HTTP/S server.");

  program.option("--topic-arn <arn>",
                 "The SNS topic ARN to subscribe to for the events. If this is provided a subscription will be "
                   + "created to the provided ARN and 'endpoint'. This is not required, because the user may "
                   + "not want to create a subscription to a topic with this program or the user may simply "
                   + "want to poll for changes in the bucket using 'resyncInterval'. The 'endpoint' parameter "
                   + "is required if this is provided.");

  program.option("--endpoint <endpoint>",
                 "The fully qualified HTTP/S endpoint that events should be published to for the provided bucket." +
                   "This is required if the 'topicArn' parameter is provided.");

  program.option("--ignore-unsubscribe-on-shutdown",
                 "If the topicArn/endpoint options are provided a subscription will be created when the program " +
                   "starts. To complement this behavior, by default, the topic will be unsubscribed from " +
                   "when the program is shutdown. Defaults to false (i.e., unsubscribe on shutdown).",
                 false);

  program.option("--ignore-message-validation",
                 "Specifies that SNS messages should NOT be validated (checking the signature). By default message validation is used, but specifying this option will override this behavior to avoid validation.",
                 false);

  // retrieves the different log levels for the CLI information.
  let logLevels = "";
  for (let key in LogLevel) {
    if (parseInt(key, 10) >= 0) {
      logLevels += LogLevel[key] + ", ";
    }
  }
  logLevels = logLevels.substr(0, logLevels.length - 2);

  program.option("--log <loglevel>",
                 "Sets the amount of information that is logged when operations are performed. "
                   + "Possible values: " + logLevels + ".", "WARN");

  program.parse(process.argv);

  let cliOptions = program.opts() as CliOptions;

  setLogLevelFromString(cliOptions.log as string);
  // cliOptions.httpsCertPath = (cliOptions as any).cert;
  // cliOptions.httpsCertKeyPath = (cliOptions as any).certKey

  return cliOptions;
};
