import * as path from "path";
import { getRelativePathToRootDir } from "../src/utils/keyAndPathUtils";

const fs = jest.createMockFromModule('fs') as any;

interface MockStat {
  isDirectory: () => boolean,
  mtime: Date,
  size: number
}

export interface TestFileOrDir {
  // do not want to import stats as this will likely cause a mocking issue
  stats: MockStat,
  // set empty when it is an empty directory
  filesAndDirs?: {
    [fileOrDirName: string]: TestFileOrDir
  }
}

function mockStats(modTime: Date, size: number, isDir?: boolean) {
  return {
    isDirectory(): boolean {
      return !!isDir;
    },
    mtime: modTime,
    size: size
  }
}

fs.__testRootDir = path.resolve("__test_mock_dir__");

/*
* When the application generates paths and compares paths they are based on the
* S3 key which may not know about the root directory (S3 keys will not know about
* the root directory if `ignoreKeyRootCharReplacement` option is not true).
*
* Directory structure as follows:
* __test_mock_dir__/
*     __test_mock_dir__/1.txt
*     __test_mock_dir__/a.txt
*     __test_mock_dir__/dir1/
*         __test_mock_dir__/dir1/2.txt
*         __test_mock_dir__/dir1/22.txt
*         __test_mock_dir__/dir1/dir1_1/
*             __test_mock_dir__/dir1/dir1_1/aa.txt
*     __test_mock_dir__/dir2/
*
* */
const MOCK_FS_STRUCTURE: { [fileOrDirName: string]: TestFileOrDir } = {
  [fs.__testRootDir]: {
    stats: mockStats(new Date(2000, 1,1), 5, true),
    filesAndDirs: {
      "1.txt": {
        stats: mockStats(new Date(2020, 0, 1), 123)
      },
      "a.txt": {
        stats: mockStats(new Date(2020, 1, 1), 111)
      },
      "dir1": {
        stats: mockStats(new Date(2020, 1, 2), 555, true),
        filesAndDirs: {
          "2.txt": {
            stats: mockStats(new Date(2020, 1, 2), 55)
          },
          "22.txt": {
            stats: mockStats(new Date(2020, 2, 3), 55)
          },
          "dir1_1": {
            stats: mockStats(new Date(2020, 3, 3), 11, true),
            filesAndDirs: {
              "aa.txt": {
                stats: mockStats(new Date(2020, 3, 3, 1, 1, 1), 9999)
              }
            }
          }
        },
      },
      "dir2": {
        stats: mockStats(new Date(2020, 1, 1), 99, true),
        filesAndDirs: {}
      },
      "z.txt": {
        stats: mockStats(new Date(2020, 1, 1), 123)
      },
      "\u00F1.txt": { // ñ can test normalization with ñ = \u006E\u0303
        stats: mockStats(new Date(2020, 1, 4), 111)
      }
    }
  }
};

fs.__mockDirStructure = MOCK_FS_STRUCTURE[fs.__testRootDir];

function getTestFileOrDir(fileOrDirName: string) {
  if (fileOrDirName.endsWith(fs.__testRootDir)) {
    return MOCK_FS_STRUCTURE[fs.__testRootDir];
  }
  const relativeToRootPath = getRelativePathToRootDir(fs.__testRootDir, fileOrDirName);
  /*
  * At this point if an error was not thrown then it is a httpPath that is relative
  * to the root httpPath and therefore should grab the TEST_MOCK_ROOT_DIR. getRelativePathToRoot
  * does not return the root directory itself, but only paths relative to it.
  * */
  let retFileOrDir: TestFileOrDir = MOCK_FS_STRUCTURE[fs.__testRootDir];
  const split = relativeToRootPath.split('/');
  // should always have length of at least 1
  for (let i = 0; i < split.length; i++) {
    if (retFileOrDir.filesAndDirs) {
      retFileOrDir = retFileOrDir.filesAndDirs[split[i]];
    } else if (i !== split.length - 1) {
      throw new Error(`${fileOrDirName} was passed in as a directory, but it is a file.`)
    }
    if (!retFileOrDir) {
      throw new Error(`Could not find ${fileOrDirName} in mocked directory structure.`);
    }
  }
  return retFileOrDir;
}

/*
* When readdir is called, want to return some part of MOCK_FS_STRUCTURE.
* In the case that dirName is equal to testRootDir then return the
* root directory entries.
* */
function readdirSync(dirName: string) {
  const dir = getTestFileOrDir(dirName);
  if (!dir || (dir && !dir.stats.isDirectory())) {
    throw new Error(`${dirName} was not a directory.`);
  }
  const entries = [];
  for (const filesAndDirsKey in dir.filesAndDirs) {
    entries.push(filesAndDirsKey);
  }
  return entries;
}

function readdir(dirName: string, callback: (err: Error | undefined, entries: string[] | undefined) => void) {
  setImmediate(() => {
    try {
      callback(undefined, readdirSync(dirName));
    } catch (e) {
      callback(e, undefined);
    }
  })
}

function readdirPromise(name: string): Promise<string[]> {
  try {
    return Promise.resolve(readdirSync(name));
  } catch (e) {
    return Promise.reject(e);
  }
}

function statSync(fileOrDirName: string): MockStat {
  return getTestFileOrDir(fileOrDirName).stats;
}

function stat(fileOrDirName: string, callback: (err: Error | undefined, stats: MockStat | undefined) => void) {
  setImmediate(() => {
    try {
      callback(undefined, statSync(fileOrDirName));
    } catch (e) {
      callback(e, undefined)
    }
  })
}

function statPromise(fileOrDirName: string): Promise<MockStat> {
  try {
    return Promise.resolve(statSync(fileOrDirName));
  } catch (e) {
    return Promise.reject(e);
  }
}

fs.promises = {
  readdir: readdirPromise,
  stat: statPromise,
  mkdir: jest.fn((path, o) => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
  rename: jest.fn(() => Promise.resolve()),
}

//
// /*
// * Test FS Structure (starting at root):
// * /1.txt
// * /a.txt
// * /dir1/
// *     /dir1/dir3/
// *       /dir1/dir3/a.txt
// *     /dir1/1.txt
// *     /dir1/a.txt
// * /dir2/
// *
// * All dates for this test file structure will occur "now", when the test
// * is run. All generated dates and sizes that will be used to test functionality
// * should be generated by retrieving this first, ensuring that
// * */
// export const MOCK_FS_STRUCTURE: TestFileOrDir = {
//   "1.txt": {
//     stats: mockStats(new Date(2020, 0, 1), 123)
//   },
//   "a.txt": {
//     stats: mockStats(new Date(2020, 1, 1), 111)
//   },
//   dir1: {
//     stats: mockStats(new Date(2020, 1, 2), 555, true),
//     filesAndDirs: {
//       "2.txt": {
//         stats: mockStats(new Date(2020, 1, 2), 55)
//       },
//       "22.txt": {
//         stats: mockStats(new Date(2020, 2, 3), 55)
//       },
//       dir1_1: {
//         stats: mockStats(new Date(2020, 3, 3), 11, true),
//         filesAndDirs: {
//           "aa.txt": {
//             stats: mockStats(new Date(2020, 3, 3, 1, 1, 1), 9999)
//           }
//         }
//       }
//     },
//   },
//   dir2: {
//     stats: mockStats(new Date(2020, 1, 1), 99, true)
//   }
// }
//
// // need to export this way
module.exports = fs;