#!/usr/bin/env node
const { runCli } = require('../lib/cliApp');

runCli(process.argv.slice(2), 'rinku').then((output) => {
  if (output) {
    process.stdout.write(output);
  }
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

