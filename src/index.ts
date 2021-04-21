/**
 * This is mostly meant to be a self-contained program and it's not expected the
 * user will extend it. Using the index file this way (i.e., running from it)
 * slightly decreases developer ergonomics when they are using the library programmatically,
 * but it
 */

import { run } from "./run";
import cli from "./cli";

if (require.main === module) {
  const cliOptions = cli();
  run(cli());
}
