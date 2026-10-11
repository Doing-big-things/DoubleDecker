#!/usr/bin/env node
// decker <path-to-repo>: starts the local server and opens the browser.
import { main } from '../src/cli.ts';

main(process.argv.slice(2)).catch((err) => {
  console.error(`decker: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
