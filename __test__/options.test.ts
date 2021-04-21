/*
* These tests ensure that the services start or fail as expected when
* certain options are provided.
* */

import { S3Client } from "@aws-sdk/client-s3";
import { checkAndCopyCommonOptionsWithDefaults } from "../src/options";
import AsyncOpQueue from "../src/AsyncOpQueue";
import * as path from "path";
import * as fs from "fs";
import { PathLike } from "fs";

const rootDir = "./__test_dir__";
const bucket = "test";

jest.mock("../src/AsyncOpQueue");
jest.mock("@aws-sdk/client-s3");
jest.mock('fs');

describe("Common options tests with mocks.", () => {

  // const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options')

  beforeEach(() => {
    jest.clearAllMocks();
  })

  test("Should pass with bare minimum number of options.", () => {
    const opts = checkAndCopyCommonOptionsWithDefaults({
                                                         bucket,
                                                         rootDir
                                                       });
    // should create s3 client
    expect(S3Client).toHaveBeenCalledTimes(1);
    expect(AsyncOpQueue).toHaveBeenCalledTimes(1);
    expect(opts.rootDir).toEqual(path.resolve(rootDir));
    expect(opts.bucket).toEqual(bucket);
    expect(opts.tmpSuffix).toEqual(".tmp");
    expect(opts.tmpDir).toBeFalsy();
    expect(opts.region).toEqual("us-east-1");
    expect(opts.s3Client).toBeTruthy();
    expect(opts.queue).toBeTruthy();
    expect((fs.mkdirSync as any).mock.calls[0][0]).toEqual(path.resolve(rootDir));
    // expect(registerShutdownHook).toHaveBeenCalledTimes(1);
  });

  test("Should pass when supplying s3 client", () => {
    const s3Client = new S3Client({region: "us-east-1"});
    const opts = checkAndCopyCommonOptionsWithDefaults({
                                                         s3Client,
                                                         bucket,
                                                         rootDir
                                                       });
    expect(S3Client).toHaveBeenCalledTimes(1);  // still only called one time
    expect(opts.s3Client).toBe(s3Client)
    expect(AsyncOpQueue).toHaveBeenCalledTimes(1);
    expect(opts.rootDir).toEqual(path.resolve(rootDir));
    expect(opts.bucket).toEqual(bucket);
    expect(opts.tmpSuffix).toEqual(".tmp");
    expect(opts.tmpDir).toBeFalsy();
    expect(opts.region).toEqual("us-east-1");
    expect(opts.queue).toBeTruthy();
    expect((fs.mkdirSync as any).mock.calls[0][0]).toEqual(path.resolve(rootDir));
  });

  test("Should set tmpSuffix to .tmp when empty string.", () => {
    const s3Client = new S3Client({region: "us-east-1"});
    const opts = checkAndCopyCommonOptionsWithDefaults({
                                                         s3Client,
                                                         bucket,
                                                         rootDir,
                                                         tmpSuffix: ""
                                                       });
    expect(S3Client).toHaveBeenCalledTimes(1);  // still only called one time
    expect(opts.s3Client).toBe(s3Client)
    expect(AsyncOpQueue).toHaveBeenCalledTimes(1);
    expect(opts.rootDir).toEqual(path.resolve(rootDir));
    expect(opts.bucket).toEqual(bucket);
    expect(opts.tmpSuffix).toEqual(".tmp");
    expect(opts.tmpDir).toBeFalsy();
    expect(opts.region).toEqual("us-east-1");
    expect(opts.queue).toBeTruthy();
    expect((fs.mkdirSync as any).mock.calls[0][0]).toEqual(path.resolve(rootDir));
  });

  test("Should fail when root directory and bucket are not supplied.", () => {
    expect(() => {
      checkAndCopyCommonOptionsWithDefaults({})
    }).toThrow();

    expect(() => {
      checkAndCopyCommonOptionsWithDefaults({bucket})
    }).toThrow();

    expect(() => {
      checkAndCopyCommonOptionsWithDefaults({rootDir})
    }).toThrow();
  });

});


describe("Common options without mocks.", () => {


  beforeEach(() => {
    jest.resetModules();
    jest.unmock("fs");
  });

  test("Should fail when directories are filesAndDirs.", () => {
    const rootDirFile = "./jest.config.js";
    jest.doMock('fs', () => {
      const actual = jest.requireActual('fs') as any
      return {
        ...actual,
        // do nothing
        mkdirSync: (dir: PathLike) => {
          if (dir.toString().indexOf("jest.config.js") >= 0) {
            // should cause to throw because the "dir" is a file and already exists
            return actual.mkdirSync(dir);
          } else {
            // do not want to create an actual directory
            return;
          }
        }
      }
    });
    // need to reimport here so it's not mocked
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options')

    expect(() => {
      checkAndCopyCommonOptionsWithDefaults({
                                              rootDir: "./jest.config.js",
                                              bucket
                                            })
    }).toThrow()

    expect(() => {
      checkAndCopyCommonOptionsWithDefaults({
                                              rootDir,
                                              bucket,
                                              tmpDir: "./jest.config.js"
                                            })
    }).toThrow();

  });

});

test("Check s3KeyTransformers provides removeRootDirCharsFromS3Key and replaceBackslashesOnUnix.", () => {
  const opts = checkAndCopyCommonOptionsWithDefaults({
                                                       bucket,
                                                       rootDir
                                                     });
  /*
  * When no options are provided then this defaults to
  * */
  expect(opts.s3KeyTransformers?.length).toEqual(2);
  expect(opts.s3KeyTransformers![0].name).toEqual("removeRootDirCharsFromS3Key");
  expect(opts.s3KeyTransformers![1].name).toEqual("replaceKeyDirCharsWithSystemSep");

  const opts2 = checkAndCopyCommonOptionsWithDefaults({
                                                        bucket,
                                                        rootDir,
                                                        ignoreKeyPlatformDirCharReplacement: true
                                                      });
  expect(opts2.s3KeyTransformers?.length).toEqual(1);
  expect(opts2.s3KeyTransformers![0].name).toEqual("removeRootDirCharsFromS3Key");

  const opts3 = checkAndCopyCommonOptionsWithDefaults({
                                                        bucket,
                                                        rootDir,
                                                        ignoreKeyPlatformDirCharReplacement: true,
                                                        ignoreKeyRootCharReplacement: true
                                                      });
  expect(opts3.s3KeyTransformers === undefined).toBeTruthy();
})
