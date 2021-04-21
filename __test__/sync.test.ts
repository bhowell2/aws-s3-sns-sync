import * as fs from "fs";
import { getDirectoryEntries } from "../src/filesystemOps";
import { _Object, ListObjectsV2Command } from "@aws-sdk/client-s3";
import AsyncOpQueue from "../src/AsyncOpQueue";
import { TestFileOrDir } from "../__mocks__/fs";

jest.mock('fs');
jest.mock("../src/shutdown");

// set in beforeEach
let rootDir: string;
let bucket = "TestBuck";

// should be overridden by each tests to set the content returned by send of list objects
let mockedS3Contents: _Object[] = [];

function getNumberOfDirectoriesInMockedEntries(mockedEntries: any[]) {
  return mockedEntries.filter((entry: any) =>
                                entry.relativePath.charAt(entry.relativePath.length - 1) === "/"
                                || entry.relativePath.charAt(entry.relativePath.length - 1) === "\\").length
}

let mockedDirStructure: TestFileOrDir;

let queue: AsyncOpQueue;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.mock('@aws-sdk/client-s3', () => ({
    ListObjectsV2Command: ListObjectsV2Command,
    S3Client: jest.fn(() => {
      return {
        send: jest.fn((command: any) => {
          if (command instanceof ListObjectsV2Command) {
            return Promise.resolve({
                                     Contents: mockedS3Contents
                                   });
          } else {
            throw new Error("Not handled.");
          }
        })
      }
    })
  }));
  jest.doMock("../src/options", () => {
    const allOptions = jest.requireActual("../src/options");
    const {checkAndCopyCommonOptionsWithDefaults} = allOptions;
    return {
      ...allOptions,
      // wrapping so that queue can be shut down
      checkAndCopyCommonOptionsWithDefaults: jest.fn((opts: any) => {
        const commOps = checkAndCopyCommonOptionsWithDefaults(opts);
        queue = commOps.queue;
        return commOps;
      })
    }
  });
  rootDir = (fs as any).__testRootDir;
  mockedDirStructure = (fs as any).__mockDirStructure;
});

afterEach(() => {
  if (queue) {
    queue.stop(true);
  }
})

describe("Sync options test.", () => {

  test("Ensure sync options calls checkAndCopyCommonOptionsWithDefaults().", () => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock("../src/options", () => {
      const actual = jest.requireActual('../src/options');
      return {
        ...actual,
        checkAndCopyCommonOptionsWithDefaults: jest.fn((opts: any) => {
          return opts;
        })
      };
    });
    const {checkAndCopyCommonOptionsWithDefaults} = require('../src/options');
    const {checkAndCopySyncOptionsWithDefaults} = require("../src/sync");
    checkAndCopySyncOptionsWithDefaults({rootDir, bucket})
    expect(checkAndCopyCommonOptionsWithDefaults).toBeCalledTimes(1);
  });

});

describe("Test sync initialization and resynchronization.", () => {

  beforeEach(() => {
    // need normal options to be called here
    // jest.dontMock("../src/options");
    jest.resetModules();
  });

  test("Ensure sync attempts to resync.", async () => {
    jest.doMock("../src/filesystemOps", () => (
      {
        getDirectoryEntries: jest.fn(() => {
          return Promise.resolve([]);
        })
      }
    ));
    jest.doMock("../src/utils/s3Utils", () => (
      {
        getS3List: jest.fn(() => {
          return Promise.resolve([]);
        })
      }
    ));

    // make sure they are mocked first
    const {getDirectoryEntries} = require('../src/filesystemOps')
    const {getS3List} = require("../src/utils/s3Utils");
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    const stopResync = await sync({
                                    rootDir,
                                    bucket,
                                    // every 100 ms resyncInterval
                                    resyncInterval: 100
                                  });

    expect(getDirectoryEntries).toHaveBeenCalledTimes(1);
    expect(getS3List).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, 600);
    });

    /*
    * Should have been called the first time and then every 100ms thereafter.
    * The promise waits for 600ms before completion, so expecting the two
    * functions to have been called at least 5 times - timing is hard to
    * guarantee, so take the lower limit.
    * */
    expect((getDirectoryEntries as any).mock.calls.length >= 5).toBeTruthy();
    expect((getS3List as any).mock.calls.length >= 5).toBeTruthy();
    // must stop it or else continues indefinitely
    stopResync();
  });

  test("Ensure sync attempts initial synchronization.", async () => {
    jest.doMock("../src/filesystemOps", () => (
      {
        getDirectoryEntries: jest.fn(() => {
          return Promise.resolve([]);
        })
      }
    ));
    jest.doMock("../src/utils/s3Utils", () => (
      {
        getS3List: jest.fn(() => {
          return Promise.resolve([]);
        })
      }
    ));
    // // make sure they are mocked first
    const {getDirectoryEntries} = require('../src/filesystemOps')
    const {getS3List} = require("../src/utils/s3Utils");
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });

    expect(getDirectoryEntries).toHaveBeenCalledTimes(1);
    expect(getS3List).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, 600);
    });

    // should not have been called again as resyncInterval is undefined
    expect(getDirectoryEntries).toHaveBeenCalledTimes(1);
    expect(getS3List).toHaveBeenCalledTimes(1);
  });

});

describe("Test sync behavior.", () => {

  let queue: AsyncOpQueue
  beforeEach(() => {
    jest.doMock("../src/filesystemOps", () => (
      {
        ...(jest.requireActual('../src/filesystemOps') as any),
        // getDirectoryEntries: jest.fn(() => {
        //   return Promise.resolve([]);
        // }),
        writeS3Object: jest.fn(),
        rmdirRecursive: jest.fn(),
        unlinkFile: jest.fn()
      }
    ));
    jest.doMock("../src/utils/s3Utils", () => (
      {
        ...(jest.requireActual("../src/utils/s3Utils") as any),
        getS3Object: jest.fn(() => {
          return Promise.resolve(Buffer.of(1, 2, 3));
        })
      }
    ));
  });

  test("Ensure file is written when it does not exist.", async () => {
    mockedS3Contents = [
      // 0.txt should come before any other files in the mock directory
      {
        Key: "0.txt",
        // transformedKey: "0.txt"
      },
      {
        Key: "whatever.txt",
        // transformedKey: "whatever.txt"
      },
      {
        Key: "zzz.txt"
      }
    ]

    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called for write 0.txt, whatever.txt, and zzz.txt
    expect(writeS3Object).toHaveBeenCalledTimes(3);

    // 0.txt
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("0.txt");

    // whatever.txt
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[1].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[1][0].Key).toEqual("whatever.txt");

    // zzz.txt
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[2].length).toEqual(1);
    expect(writeS3Object.mock.calls[2][0].Key).toEqual("zzz.txt");

    // no files should have been removed since removed is undefined
    expect(unlinkFile).toHaveBeenCalledTimes(0);
    expect(rmdirRecursive).toHaveBeenCalledTimes(0);
  });

  test("Ensure files are written if they do not exists, files are untouched if they are the same, files are updated if they have changed, and files/dirs are removed if they do not exist in the bucket.", async () => {
    /*
    * The following should occur:
    * 0.txt - added
    * 1.txt - removed
    * a.txt - removed
    * dir1/2.txt - removed
    * dir1/22.txt - removed
    * dir1/dir1_1/aa.txt - updated
    * dir2/ - removed
    * z.txt - untouched
    * ñ.txt - removed
    * */
    mockedS3Contents = [
      // 0.txt should come before any other files in the mock directory
      {
        Key: "0.txt",
        // transformedKey: "0.txt"
      },
      {
        Key: "whatever.txt",
        // transformedKey: "whatever.txt"
      },
      {
        Key: "dir1/dir1_1/aa.txt",
        LastModified: mockedDirStructure.filesAndDirs!["dir1"].filesAndDirs!["dir1_1"].filesAndDirs!["aa.txt"].stats.mtime,
        Size:
          mockedDirStructure
            .filesAndDirs!["dir1"]
            .filesAndDirs!["dir1_1"]
            .filesAndDirs!["aa.txt"].stats.size + 11,

      },
      // in this case z.txt is not removed or overwritten, because it is the same
      {
        Key: "z.txt",
        LastModified: mockedDirStructure.filesAndDirs!["z.txt"].stats.mtime,
        Size: mockedDirStructure.filesAndDirs!["z.txt"].stats.size,
      }
    ]

    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
                 remove: true,
               });
    // should be called for write 0.txt, whatever.txt, and dir1/dir1_1/aa.txt
    expect(writeS3Object).toHaveBeenCalledTimes(3);

    // 0.txt
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("0.txt");

    // whatever.txt
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[1].length).toEqual(1);
    expect(writeS3Object.mock.calls[1][0].Key).toEqual("dir1/dir1_1/aa.txt");

    expect(writeS3Object.mock.calls[2].length).toEqual(1);
    expect(writeS3Object.mock.calls[2][0].Key).toEqual("whatever.txt");

    // 1.txt, a.txt, dir1/2.txt, dir1/22.txt, and ñ.txt are removed (z is untouched, because is same)
    expect(unlinkFile).toHaveBeenCalledTimes(5);
    // only dir2 is removed as dir1/dir1_1/ has content that is updated (aa.txt)
    expect(rmdirRecursive).toHaveBeenCalledTimes(1);
  });

  test("Ensure files are removed if they do not exists in S3 bucket.", async () => {
    mockedS3Contents = [
      // 0.txt should come before any other files in the mock directory
      {
        Key: "0.txt",
        // transformedKey: "0.txt"
      },
      {
        Key: "whatever.txt",
        // transformedKey: "whatever.txt"
      }
    ]

    // all these should be called on remove
    const mockedEntries = await getDirectoryEntries(rootDir, rootDir);

    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
                 remove: true
               });
    // should be called to write 0.txt
    expect(writeS3Object).toHaveBeenCalledTimes(2);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("0.txt");
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[1].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[1][0].Key).toEqual("whatever.txt");
    // not testing getS3Object, because writeS3Object calls it (has been tested in filesystemOps.test)
    // const numOfDirs = getNumberOfDirectoriesInMockedEntries(mockedEntries);
    /*
    * There are 4 files that are in the root directory and 2 sub-directories (with files
    * in them). Everything will be removed, but when directories are removed, all of their
    * entries are skipped (so unlink operations are not called on entries within the subdirectories).
    * */
    expect(unlinkFile).toHaveBeenCalledTimes(4);
    expect(rmdirRecursive).toHaveBeenCalledTimes(2);
  });

  test("Ensure file is not written when date and size are the same.", async () => {
    mockedS3Contents = [
      {
        Key: "1.txt",
        Size: mockedDirStructure.filesAndDirs!["1.txt"].stats.size,
        LastModified: mockedDirStructure.filesAndDirs!["1.txt"].stats.mtime,
      }
    ];
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps');
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });
    expect(writeS3Object).toHaveBeenCalledTimes(0);
    // -1, because 1.txt should not be removed
    expect(unlinkFile).toHaveBeenCalledTimes(0);
    expect(rmdirRecursive).toHaveBeenCalledTimes(0);
  });

  test("Ensure file is written when date of S3 object is after current date on file.", async () => {

    mockedS3Contents = [
      {
        Key: "1.txt",
        Size: mockedDirStructure.filesAndDirs!["1.txt"].stats.size,
        LastModified: new Date((mockedDirStructure.filesAndDirs!["1.txt"].stats.mtime as Date).getTime() + 1),
      }
    ];
    // all these should be called on remove
    const mockedEntries = await getDirectoryEntries(rootDir, rootDir);

    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("1.txt");
    expect(unlinkFile).toHaveBeenCalledTimes(0);
    expect(rmdirRecursive).toHaveBeenCalledTimes(0);
  });

  test("Ensure file is written when size of S3 object is different.", async () => {

    mockedS3Contents = [
      {
        Key: "1.txt",
        Size: mockedDirStructure.filesAndDirs!["1.txt"].stats.size + 5,
        LastModified: (mockedDirStructure.filesAndDirs!["1.txt"].stats.mtime as Date),
      }
    ];
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("1.txt");
    // -1, because 1.txt should not be removed, but replaced
    expect(unlinkFile).toHaveBeenCalledTimes(0);
    expect(rmdirRecursive).toHaveBeenCalledTimes(0);
  });

  test("Ensure file and directory are added.", async () => {
    mockedS3Contents = [
      {
        Key: "dne_dir/1.txt",
      }
    ];
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    // should call getDirectoryEntries and getS3List
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("dne_dir/1.txt");
    // -1, because 1.txt should not be removed, but replaced
    expect(unlinkFile).toHaveBeenCalledTimes(0);
    expect(rmdirRecursive).toHaveBeenCalledTimes(0);
  });

  test("Ensure sub directory and file are added.", async () => {
    mockedS3Contents = [
      {
        // dir2 already exists
        Key: "dir2/1.txt",
      },
      // should cause directory to be added
      {
        Key: "dir2/dir2_1/"
      },
      // should add directory and file
      {
        Key: "dir2/dir2_2/file1.txt"
      },
      {
        Key: "dir3/"
      },
      {
        Key: "dir4/1.txt"
      }
    ];

    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(5);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("dir2/1.txt");
    expect(writeS3Object.mock.calls[4][0].Key).toEqual("dir4/1.txt");
  });

  test("Ensure codepoints are treated differently when NOT normalized.", async () => {
    mockedS3Contents = [
      {
        Key: "\u006E\u0303.txt"
      }
    ]
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    await sync({
                 rootDir,
                 bucket,
               });
    // should be called to write \u006E\u0303.txt
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("\u006E\u0303.txt");
  });

  test("Ensure codepoints are treated the same when normalized (file changed).", async () => {
    mockedS3Contents = [
      {
        Key: "\u006E\u0303.txt",
        Size: mockedDirStructure.filesAndDirs!["\u00F1.txt"].stats.size + 5,
        LastModified: (mockedDirStructure.filesAndDirs!["\u00F1.txt"].stats.mtime as Date),
      }
    ]
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps') as any;
    const sync = require("../src/sync").default;
    await sync({
                 rootDir,
                 bucket,
                 normalizationForm: "NFC"
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(1);
    // number of arguments should be 1
    expect(writeS3Object.mock.calls[0].length).toEqual(1);
    // get first argument
    expect(writeS3Object.mock.calls[0][0].Key).toEqual("\u006E\u0303.txt");
  });

  test("Ensure codepoints are treated the same when normalized (no change).", async () => {
    mockedS3Contents = [
      {
        Key: "\u006E\u0303.txt",
        Size: mockedDirStructure.filesAndDirs!["\u00F1.txt"].stats.size,
        LastModified: (mockedDirStructure.filesAndDirs!["\u00F1.txt"].stats.mtime as Date),
      }
    ]
    // make sure they are mocked first
    const {writeS3Object, unlinkFile, rmdirRecursive} = require('../src/filesystemOps');
    const sync = require("../src/sync").default;
    await sync({
                 rootDir,
                 bucket,
                 normalizationForm: "NFC"
               });
    // should be called to write 1.txt
    expect(writeS3Object).toHaveBeenCalledTimes(0);
  });

});
