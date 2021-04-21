import { removeRootDirCharsFromS3Key } from "../src/utils/transformers";
import mock = jest.mock;
import requireActual = jest.requireActual;

describe("Test removeRootDirCharsFromS3Key().", () => {
  test("Windows root paths.", () => {
    expect(removeRootDirCharsFromS3Key("\\1\\2\\3")).toEqual("1\\2\\3");
    expect(removeRootDirCharsFromS3Key("\\\\\\1\\2\\3")).toEqual("1\\2\\3");
    expect(removeRootDirCharsFromS3Key("A:\\1\\2\\3")).toEqual("1\\2\\3");
    expect(removeRootDirCharsFromS3Key("Z:\\1\\2\\3")).toEqual("1\\2\\3");
    expect(removeRootDirCharsFromS3Key("1\\2\\3")).toEqual("1\\2\\3");
  });
  test("Linux root paths.", () => {
    expect(removeRootDirCharsFromS3Key("/1/2/3")).toEqual("1/2/3");
    expect(removeRootDirCharsFromS3Key("///1/2/3")).toEqual("1/2/3");
    expect(removeRootDirCharsFromS3Key("1/2/3")).toEqual("1/2/3");
  });
});

describe("Test replaceKeyDirCharsWithSystemSep().", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  })
  test("Windows char replacement.", () => {
    mock('os', () => {
      const os = requireActual('os');
      return {
        ...os,
        platform: () => {
          return "win32";
        }
      }
    });
    const {replaceKeyDirCharsWithSystemSep} = require('../src/utils/transformers');
    expect(replaceKeyDirCharsWithSystemSep("1/2/3")).toEqual("1\\2\\3");
  });
  test("Linux char replacement.", () => {
    mock('os', () => {
      const os = requireActual('os');
      return {
        ...os,
        platform: () => {
          return "linux";
        }
      }
    });
    const {replaceKeyDirCharsWithSystemSep} = require('../src/utils/transformers');
    expect(replaceKeyDirCharsWithSystemSep("1\\2\\3")).toEqual("1/2/3");
  })
})
