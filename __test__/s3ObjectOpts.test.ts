import requireActual = jest.requireActual;

describe("Test key is for directory.", () => {

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("Linux.", () => {
    jest.doMock("path", () => {
      const actual = requireActual("path");
      return {
        ...actual,
        sep: "/"
      }
    })
    const {keyIsDirectory} = require("../src/s3ObjectOps");
    expect(keyIsDirectory("1/2/3/")).toEqual(true);
    expect(keyIsDirectory("1/2/3")).toEqual(false);
  });

  test("Windows", () => {
    jest.doMock("path", () => {
      const actual = requireActual("path");
      return {
        ...actual,
        sep: "\\"
      }
    });
    const {keyIsDirectory} = require("../src/s3ObjectOps");
    expect(keyIsDirectory("1\\2\\3\\")).toEqual(true);
    expect(keyIsDirectory("1\\2\\3")).toEqual(false);
  });

});
