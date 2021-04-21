# AWS S3 SNS Sync
Mirrors the contents of an S3 bucket locally. This is achieved by SNS notifications (http/s) and/or polling on a 
synchronization interval. Usually the user will want to synchronize the directory on start-up and then watch for changes 
via SNS notifications. Resynchronization on a provided interval is also possible in the case that an SNS notification 
is missed, or the user just doesn't want to use SNS events. Generally the user will not want to poll (resync) too often  
as it *could* dramatically increase their S3 costs and SNS events will (almost always) be faster at ensuring the mirror 
directory is updated.

If the user does not need to add any [configuration](#configuration) outside of what is available by the CLI then they 
can use the docker image: `bhowell2/aws-s3-sns-sync`. See [hub](https://hub.docker.com/r/bhowell2/aws-s3-sns-sync) for 
versions.

In the case that the user wants to provide custom options (such as `keyTransformers`) not available to the CLI they can 
use the NPM package to run it programmatically: `npm install aws-s3-sns-sync`.

This will write files in the most atomic fashion possible. I.e., the S3 object will be written to a temporary file first
(file with suffix `.tmp`, or can be specified via `--tmp` arg) and then moved to its real location. This helps avoid 
multiple events when watching a file for changes. To further this atomic and watchable goal, the user may also supply  
`--tmp-dir` so that the temporary files are written in another directory entirely, allowing the user to avoid the 
temporary write events when watching a folder for changes.

## Quick run 
**You should REALLY read [Limitations and Warnings](#limitations-and-warnings) and [Configuration](#configuration)) first 
as you may run into issues on certain file systems.**

`node index.js --bucket abucket --root-dir /a/directory/to/mirror/to --host 0.0.0.0 --port 80 `

When using the dockerized version you'll likely want to share the directory in some way. There are a few different ways 
to do this, but all boil down to mounting a volume or binding a host directory in some way.

See: https://docs.docker.com/storage/volumes/ for more info.

`docker run -d -v /aws/sync/dir:/s3 bhowell2/aws-s3-mirror --bucket abucket --root-dir /s3`

## Supported Versions
Node >= 10 (b/c of jest-cli try/catch block.)
Windows, Linux (tested ubuntu), Mac OS (tested 10.x)

AWS SNS event version >= 2.1 

## Limitations and Warnings
**Warning: Know your file system and know your bucket's keys!**

Windows and Mac OS (by default, and issues tend to arise when this is changed) are case-insensitive, but case preserving 
(E.g., a file named `a.txt` is treated the same as `A.txt` and whichever is created first is how it will appear.) This 
creates a problem when mirroring the S3 Bucket, because `A` will be overwritten by the data of `a` later (the list of 
keys are returned in UTF-8 binary order). However, on Linux (by default), files are case-sensitive and `A` and `a` will 
result in two different files being written. This is not directly handled, but the user may (manually) supply 
[`KeyTransformer`s](#key-transformers) for more control over the process. When no transformer is supplied and there are 
two keys, say `A` and `a`, the latter (in UTF-8 binary order) will overwrite the former on a case-insensitive file system.

There is also the issue of file system/bucket key character encoding. E.g., the encoding for the character `é` can be
`\u00e9` or `\u0065\u0301` (check out composed and decomposed unicode format if you are not familiar), which will result
in two different keys/objects in S3, but on some file systems (e.g., APFS) will result in only one file of the character `é`. 
This can be handled by supplying the `--normalization-form` option, or manually supplying your own `KeyTransformer`, which 
will normalize all keys and directory entries before comparing them. 

Keys that begin with a forward-slash (e.g., `/foo`) or are within a folder and contain multiple forward-slashes
(e.g., `foo//bar`) will be treated as if they to reside in the local directory. E.g., The key `/foo` will reside in the
root mirror directory as `foo` and `/bar//abc` will have a directory named `bar` (within the root mirror directory) and
a file within the `bar` directory named `abc` - `abc` will not be treated as a directory within the `bar` directory
(unless it ends with a forward-slash).

## Simple Notification Service (SNS)
Using SNS is the most efficient way to update the mirrored directory with changes to an S3 Bucket (after initial 
synchronization.) The user needs to set up an SNS topic and then subscribe to the topic - the mirror uses an HTTP(S) 
subscription.

*See https://docs.aws.amazon.com/AmazonS3/latest/dev/NotificationHowTo.html for more S3 event notification information/setup.*  

```hcl-terraform
provider "aws" {
  region = "us-east-1"
}

/*
  Probably do not want to put the S3 bucket in terraform as (IMO) buckets are
  rarely deleted. However, you may want to access the bucket's information
  with a terraform data source.
*/
data "aws_s3_bucket" "test_bucket" {
  bucket = "test-bucket"
}

# Shamelessly copied from Terraform docs. (Take care to set the appropriate principal/conditions.)
resource "aws_sns_topic" "test_bucket_topic" {
  name   = "s3-event-notification-topic"
  policy = <<POLICY
{
    "Version":"2012-10-17",
    "Statement":[{
        "Effect": "Allow",
        "Principal": {"AWS":"*"},
        "Action": "SNS:Publish",
        "Resource": "arn:aws:sns:*:*:s3-event-notification-topic",
        "Condition":{
            "ArnLike":{"aws:SourceArn":"${data.aws_s3_bucket.test_bucket.arn}"}
        }
    }]
}
POLICY
}

resource "aws_s3_bucket_notification" "test_bucket_change_notification" {
  bucket = data.aws_s3_bucket.test_bucket.bucket
  topic {
    events    = ["s3:ObjectCreated:*", "s3:ObjectRemoved:Delete"]
    topic_arn = aws_sns_topic.test_bucket_topic.arn
  }
}

resource "aws_sns_topic_subscription" "test_bucket_topic_sub" {
  topic_arn = aws_sns_topic.test_bucket_topic.arn
  protocol  = "http"
  # can use ngrok to test locally. amazing tool!
  endpoint  = "http://eaae8ce5aba2.ngrok.io"
  endpoint_auto_confirms = true
}
```

## AWS IAM Access Policy
It is possible to run this program with only READ permissions, but there is one option with SNS that requires WRITE 
access if used, which is subscribing to a topic. *Subscribing to a topic will happen when the user provides the 
`--topic-arn` argument.*

As far as S3 bucket access goes only `GET` and `LIST` operations are required.
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:Get*",
                "s3:List*"
            ],
            "Resource": "*"
        }
    ]
}
```

**`WARNING: although S3 would allow a key with the name `fileOrDir` and `fileOrDir/`, this is not allowed with mirroring 
as there cannot be a file and a directory with the same name.**

## CLI Configuration
|argument|required|default value|description|
|--------|:------:|-----------|--------|
|--bucket| true | |The S3 bucket that will be mirrored.|
|--region| false | us-east-1 | The region where the S3 bucket that is being mirrored resides. |
|--root-dir| true | | The local directory where the bucket should be mirrored. |
|--tmp-suffix| false | `.tmp` | If `tmp-dir` is not supplied, the file will be written to `root-dir` and appended with this suffix when it is being written, then it will be removed by renaming the file. Note, the file will also have a random string appended to it to avoid concurrent writes to the same file if multiple events are received for the same S3 key. If `tmp-dir` is supplied, this will still be used to append to the file in the temporary directory, but it is irrelevant since the file is renamed when moved to the `root-dir`. This makes it possible to ignore files with this suffix when watching a directory. This also makes it easier to avoid issues that may arise across file-systems when using `tmp-dir`. |
|--tmp-dir| false | | The directory where files will temporarily be written before they are moved to their final destination. This makes it more likely that only one event will be triggered if the user is watching `root-dir` for changes. Move is generally atomic on all systems (Windows may have some caveats with this, so look further into it if you are worried on Windows). It should be noted that `move` is not atomic across file-systems - this also applies to docker volumes, which count as their own file-system, so `tmp-dir` needs to be within the same volume as the mirror directory for `move` to be atomic. Between `tmp-suffix` or `tmp-dir` the user's atomicity concerns can be handled. |
|--remove| false | false | Whether or not to remove files/directories from the mirror directory (`root-dir`) when they are removed (or do not exist in) from the bucket. This defaults to false for safety reasons.|
|--prefix| false | | The [filter] (only keys that match) prefix to use when listing S3 objects or receiving notifications. With listing, this will filter the keys by passing in the prefix to the list command. With SNS events the prefix will be checked against the event's key for a match. If there is no match then the key will be ignored.|
|--suffix| false | | The [filter] (only keys that match) suffix to use when listing S3 objects or receiving notifications. With listing and SNS events this will filter the keys/events after they are retrieved/received, because S3 does not provide the functionality to list keys by suffix. |
|--normalization-form| false | | The normalization method to use on local paths and keys. This ensures that if there are conflicts when keys are normalized they can be resolved before writing. Can be 'NFC', 'NFD', 'NFKC', or 'NFKD'. |
|--ignore-key-platform-dir-char-replacement| false | false | By default forward-slashes ('/') in the key will be replaced with backslashes ('\') on Windows and backslashes will be replaced by forward-slashes on Unix. Replacing the characters creates a normalized directory structure across operating systems. Setting this to `true` will make it so that no directory-separator characters are replaced (the user can still supply their own `s3KeyTransformers` when running this programmatically to achieve a similar effect). Keep in mind setting this to false may cause some unexpected behavior. On Unix, keys with a backslash will become filenames with a backslash, while on Windows keys with a forward-slash will cause the forward-slash to be treated as a directory anyway since forward-slash is a reserved character on Windows. |
|--ignore-key-root-char-replacement| false | false | By default, root file system characters will be removed from the beginning of an S3 key (e.g., if a key begins with '/' the leading '/' will be removed). This same rule will be applied to all platforms (e.g., a key beginning with 'A:\1\2' will become '1\2' on Windows or '1/2' on Unix). When false (i.e., option not provided or set to false), this will remove the characters: '/', '\', '[A-Z]:\' or '[A-Z]:/' from the beginning of a key. |
|--max-concurrency| false | 300 | Maximum number of concurrent S3 object requests as well as file operations performed. |
|--max-keys| false | 1000 | The maximum number of keys to retrieve at a time when listing the S3 bucket's contents. (1000 is max, by AWS) |
|--skip-initial-sync| false | false | Keeps the program from synchronizing with the S3 bucket on startup. By default synchronization is done on startup. |
|--resync-interval| false | 0 (do not resync) | Interval (milliseconds) to poll the S3 bucket for changes - listing every key and comparing to the contents of the mirror directory (`root-dir`). This is useful if the SNS server misses an event. Be careful with this, though, as having a low value will result in many LIST API requests to the S3 bucket. |
|--host| false | 0.0.0.0 | The address to listen on for HTTP/S SNS events. |
|--port| false | | The port to listen on for HTTP/S SNS events. This does not have a default value, because if it is not provided an http server will not be started to listen for SNS events. | 
|--https-cert-path| false | | The HTTPS certificate to use for the HTTPS SNS event server. The 'cert-key' parameter must be provided if this is provided. If this is not provided (and 'port' is) an HTTP server will be used instead of HTTPS to listen for SNS events. |
|--https-cert-key-path| false | | The key for the provided HTTPS certificate. Required if 'cert' is provided. |
|--http-path| false | | Path for HTTP/S server to listen on. |
|--topic-arn| false | | The SNS topic ARN to subscribe to for the events. If this is provided a subscription will be created to the provided ARN and `endpoint`. This is not required, because the user may not want to create a subscription to a topic with this program or the user may simply want to poll for changes in the bucket using `resync`. The `endpoint` parameter is required if this is provided. |
|--endpoint| false | | The fully qualified HTTP/S endpoint that events should be published to for the provided bucket. This is required if the `topicArn` parameter is provided. |
|--ignore-unsubscribe-on-shutdown| false | false | If the topicArn/endpoint options are provided a subscription will be created when the program starts. To complement this behavior, by default, the topic will be unsubscribed from when the program is shutdown. Defaults to false (i.e., unsubscribe on shutdown). |
|--ignore-message-validation| false | false | When option provided/set true, specifies that SNS messages should NOT be validated (checking the signature). By default message validation is used, but specifying this option will override this behavior to avoid validation. |
|--log| false | WARN | Sets the amount of information that is logged when operations are performed or errors occur. Possible values are 'NONE', 'ERROR', 'WARN', 'DEBUG'.|

### Key Transformers
The user may provide `KeyTransformer`s when wrapping this program themselves (i.e., not using the default CLI). This 
allows the user to control how the S3 key and directory entry strings are processed. The transformers are applied 
**BEFORE** any sorting is done.
