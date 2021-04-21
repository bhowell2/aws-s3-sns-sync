const path = require('path');

module.exports = {
  target: "node",
  mode: "production",
  entry: "./dist/index.js",
  output: {
    path: path.resolve("./dist/"),
    filename: "bundle.js"
  }
}