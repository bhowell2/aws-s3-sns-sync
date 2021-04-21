import * as fs from "fs";
import AsyncOpQueue from "../src/AsyncOpQueue";
import { getDirectoryEntries, writeS3Object } from "../src/filesystemOps";
import * as path from "path";

jest.mock('fs');

jest.mock('../src/utils/s3Utils', () => ({
  getS3Object: jest.fn((opts: any) => {
    return Promise.resolve(Buffer.of(1, 2, 3));
  })
}));

// set by beforeEach, getting the mocked file system root
let rootDir: string;
let queue: AsyncOpQueue;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  rootDir = (fs as any).__testRootDir;
  queue = new AsyncOpQueue({defaultTaskRunTimeoutMillis: 5_000});
});

afterEach(() => {
  if (queue) {
    queue.stop(true);
  }
})

test("Ensure getDirectoryEntries sorts and flattens directory entries.", async () => {
  const entries = await getDirectoryEntries(rootDir, rootDir)
    .then((entries: any) => entries.map((e: any) => e.relativePath));
  expect(entries).toEqual([
                            // these are from the mock directory structure (see __mocks__/fs.ts)
                            "1.txt",
                            "a.txt",
                            "dir1/",
                            "dir1/2.txt",
                            "dir1/22.txt",
                            "dir1/dir1_1/",
                            "dir1/dir1_1/aa.txt",
                            "dir2/",
                            "z.txt",
                            "\u00F1.txt"
                          ]);
});

const Bucket = 'TestBuck';
const tmpSuffix = ".tmp";
const tmpDir = "tmp";

describe("writeS3Object tests.", () => {

  test("Ensure directory created when key is considered a directory.", async () => {
    const Key = "key1/";
    const transformedKey = "key1/";

    writeS3Object({
                    rootDir,
                    transformedKey,
                    Key,
                    tmpSuffix,
                    tmpDir,
                    Bucket,
                    queue,
                    s3Client: null as any  // dont need in this test
                  });

    let wasChecked = false;
    await new Promise((resolve) => {
      setTimeout(() => {
        // ensure that
        expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
        expect((fs.promises.mkdir as any).mock.calls[0][0]).toEqual(path.resolve(rootDir, transformedKey));
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(0);
        expect(fs.promises.rename).toHaveBeenCalledTimes(0);
        wasChecked = true;
        resolve(null)
      }, 200);
    });
    expect(wasChecked).toBeTruthy();
  });

  test("Ensure object is retrieved and written to temporary directory and then renamed/moved to root mirror directory.", async () => {
    jest.doMock('@aws-sdk/client-s3');

    const {S3Client} = require('@aws-sdk/client-s3');

    const Key = "key1";
    const transformedKey = "key1";

    writeS3Object({
                    rootDir,
                    transformedKey,
                    Key,
                    tmpSuffix,
                    tmpDir,
                    Bucket,
                    queue,
                    s3Client: new S3Client({})
                  });

    let wasChecked = false;
    await new Promise((resolve) => {
      setTimeout(() => {

        // ensure mkdir is called. always attempted.
        expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
        expect((fs.promises.mkdir as any).mock.calls[0][0])
          .toEqual(path.parse(path.resolve(rootDir, transformedKey)).dir);

        // ensure tmp file is written
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
        let tmpWriteFile = (fs.promises.writeFile as any).mock.calls[0][0] as string;
        expect(tmpWriteFile.indexOf(path.resolve(tmpDir, transformedKey))).toBeGreaterThanOrEqual(0)
        expect(tmpWriteFile.endsWith(tmpSuffix)).toBeTruthy();

        // should be renamed
        expect(fs.promises.rename).toHaveBeenCalledTimes(1);
        expect((fs.promises.rename as any).mock.calls[0][0])
          .toEqual(tmpWriteFile)
        expect((fs.promises.rename as any).mock.calls[0][1])
          .toEqual(path.resolve(rootDir, transformedKey));
        wasChecked = true;

        resolve(null)
      }, 200);
    });
    expect(wasChecked).toBeTruthy();
  });

  test("Ensure object is retrieved and written to temporary file and then renamed.", async () => {
    // const fs = require('fs');
    jest.doMock('@aws-sdk/client-s3');

    const {S3Client} = require('@aws-sdk/client-s3');

    const Key = "key1";
    const transformedKey = "key1";

    writeS3Object({
                    rootDir,
                    transformedKey,
                    Key,
                    tmpSuffix,
                    Bucket,
                    queue,
                    s3Client: new S3Client({})
                  });

    let wasChecked = false;
    await new Promise((resolve) => {
      setTimeout(() => {

        // ensure mkdir is called. always attempted.
        expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
        expect((fs.promises.mkdir as any).mock.calls[0][0])
          .toEqual(path.parse(path.resolve(rootDir, transformedKey)).dir);

        // ensure tmp file is written, but in root directory, not temporary directory
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
        let tmpWriteFile = (fs.promises.writeFile as any).mock.calls[0][0] as string;
        expect(tmpWriteFile.indexOf(path.resolve(rootDir, transformedKey))).toBeGreaterThanOrEqual(0)
        expect(tmpWriteFile.endsWith(tmpSuffix)).toBeTruthy();

        // should be renamed
        expect(fs.promises.rename).toHaveBeenCalledTimes(1);
        expect((fs.promises.rename as any).mock.calls[0][0])
          .toEqual(tmpWriteFile)
        expect((fs.promises.rename as any).mock.calls[0][1])
          .toEqual(path.resolve(rootDir, transformedKey));
        wasChecked = true;

        resolve(null)
      }, 200);
    });
    expect(wasChecked).toBeTruthy();
  });

  test("Ensure directory is created when key contains new directory.", async () => {
    // const fs = require('fs');
    jest.doMock('@aws-sdk/client-s3');

    const {S3Client} = require('@aws-sdk/client-s3');

    const Key = "dir55/key1.txt";
    const transformedKey = "dir55/key1.txt";

    writeS3Object({
                    rootDir,
                    transformedKey,
                    Key,
                    tmpSuffix,
                    Bucket,
                    queue,
                    s3Client: new S3Client({})
                  });

    let wasChecked = false;
    await new Promise((resolve) => {
      setTimeout(() => {

        // ensure mkdir is called. always attempted.
        expect(fs.promises.mkdir).toHaveBeenCalledTimes(1);
        expect(((fs.promises.mkdir as any).mock.calls[0][0] as string).endsWith("dir55")).toBeTruthy();
        // .toEqual(httpPath.parse(httpPath.resolve(rootDir, transformedKey)).dir);
        // ensure tmp file is written, but in root directory, not temporary directory
        expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
        let tmpWriteFile = (fs.promises.writeFile as any).mock.calls[0][0] as string;
        expect(tmpWriteFile.indexOf(path.resolve(rootDir, transformedKey))).toBeGreaterThanOrEqual(0)
        expect(tmpWriteFile.endsWith(tmpSuffix)).toBeTruthy();

        // should be renamed
        expect(fs.promises.rename).toHaveBeenCalledTimes(1);
        expect((fs.promises.rename as any).mock.calls[0][0])
          .toEqual(tmpWriteFile)
        expect((fs.promises.rename as any).mock.calls[0][1])
          .toEqual(path.resolve(rootDir, transformedKey));
        wasChecked = true;

        resolve(null)
      }, 200);
    });
    expect(wasChecked).toBeTruthy();
  });

});


