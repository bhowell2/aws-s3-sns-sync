import {
  addToOptionsArray,
  ensurePathEndsWithOsSeparator,
  replaceBackSlashesOnUnix
} from "../src/utils/utils";
import * as os from "os";
import * as path from "path";
import { checkKeyOrPathIsDirectory, getRelativePathToRootDir } from "../src/utils/keyAndPathUtils";

describe("Add to options array tests.", () => {

  test("Add to array without property.", () => {
    let options = {} as any;
    // add to beginning of a
    addToOptionsArray(options, 'a', true, 1, 2, 3, 4);
    expect(options['a']).toEqual([1, 2, 3, 4]);
    addToOptionsArray(options, 'a', true, 5, 6, 7, 8);
    expect(options['a']).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    // add to end of b
    addToOptionsArray(options, 'b', false, 1, 2, 3, 4);
    expect(options['b']).toEqual([1, 2, 3, 4]);
    addToOptionsArray(options, 'b', false, 5, 6, 7, 8);
    expect(options['b']).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  })

  test("Add to existing array.", () => {
    let options = {a: [], b: []} as any;
    // add to beginning of a
    addToOptionsArray(options, 'a', true, 1, 2, 3, 4);
    expect(options['a']).toEqual([1, 2, 3, 4]);
    addToOptionsArray(options, 'a', true, 5, 6, 7, 8);
    expect(options['a']).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    // add to end of b
    addToOptionsArray(options, 'b', false, 1, 2, 3, 4);
    expect(options['b']).toEqual([1, 2, 3, 4]);
    addToOptionsArray(options, 'b', false, 5, 6, 7, 8);
    expect(options['b']).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  })

})

describe("Test function ensurePathEndsWithOsSeparator().", () => {
  test("Linux tests.", () => {
    if (os.platform() !== "win32") {

    }
  })
  test("Windows tests.", () => {
    if (os.platform() === "win32") {
      expect(ensurePathEndsWithOsSeparator(""))
    }
  })
})

// describe("Test removeLeadingAndRepetitiveSlashes().", () => {
//   test("Should remove all leading forward-slashes.", () => {
//     expect(removeLeadingAndRepetitiveSlashes("/////")).toEqual("");
//     expect(removeLeadingAndRepetitiveSlashes("//1/2")).toEqual("1/2");
//     expect(removeLeadingAndRepetitiveSlashes("/1/2/3/")).toEqual("1/2/3/");
//   })
//   test("Should remove adjacent forward slashes", () => {
//     expect(removeLeadingAndRepetitiveSlashes("1/2//3")).toEqual("1/2/3");
//     expect(removeLeadingAndRepetitiveSlashes("1/2//3//")).toEqual("1/2/3/");
//     expect(removeLeadingAndRepetitiveSlashes("/1//2//3//")).toEqual("1/2/3/");
//   })
//   test("Should handle empty and no forward-slashes.", () => {
//     expect(removeLeadingAndRepetitiveSlashes("")).toEqual("");
//     expect(removeLeadingAndRepetitiveSlashes("123")).toEqual("123");
//   })
//   test("Should handle windows style backslash.", () => {
//     expect(removeLeadingAndRepetitiveSlashes("\\1\\2\\\\3")).toEqual("1\\2\\3");
//     expect(removeLeadingAndRepetitiveSlashes("\\\\\\1/2/3")).toEqual("1/2/3")
//     expect(removeLeadingAndRepetitiveSlashes("\\\\\\1/2/3\\\\")).toEqual("1/2/3\\");
//   })
// })


describe("Test replaceBackSlashesOnUnix().", () => {
  test("", () => {
    if (os.platform() !== 'win32') {
      expect(replaceBackSlashesOnUnix("1/2/3\\4\\5")).toEqual("1/2/3/4/5");
      expect(replaceBackSlashesOnUnix("1/2/3\\4\\5\\\\")).toEqual("1/2/3/4/5//");
      expect(replaceBackSlashesOnUnix("\\\\1\\2/3")).toEqual("//1/2/3");
    } else {
      expect(replaceBackSlashesOnUnix("1/2/3\\4\\5")).toEqual("1/2/3\\4\\5");
      expect(replaceBackSlashesOnUnix("1/2/3\\4\\5\\\\")).toEqual("1/2/3\\4\\5\\\\");
      expect(replaceBackSlashesOnUnix("\\\\1\\2/3")).toEqual("\\\\1\\2/3");
    }
  });
})

describe("Get S3 relative httpPath", () => {
  test("Should remove first character forward slash.", () => {
    const root = "1/2/3/";
    const curDir = "4/5/6";
    expect(getRelativePathToRootDir(path.resolve(root), path.resolve(root, curDir))).toEqual("4/5/6");
  })
})

describe("Check key/httpPath function is directory.", () => {
  test("Check whether or not the key/httpPath is a windows or linux directory.", () => {
    if (os.platform() === "win32") {
      expect(checkKeyOrPathIsDirectory("Condition:\\hey\\yo")).toEqual(false);
      expect(checkKeyOrPathIsDirectory("Condition:\\hey\\yo\\")).toEqual(true);
    } else {
      expect(checkKeyOrPathIsDirectory("/hey/yo")).toEqual(false);
      expect(checkKeyOrPathIsDirectory("/hey/yo/")).toEqual(true);
    }
  })
})
