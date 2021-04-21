module.exports = {
  verbose: true,
  preset: "ts-jest",
  // rootDir: "./test",
  // testRegex: "(/test/.*|(\\.|/)(test|spec))\\.[jt]sx?$",
  silent: false,
  globals: {
    "ts-jest": {
      tsConfig: "./tsconfig.test.json"
    }
  }
}