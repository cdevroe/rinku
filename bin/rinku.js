#!/usr/bin/env node
const { executeCli } = require('../lib/cliApp');

executeCli(process.argv.slice(2), 'rinku').then(({ stdout, stderr, exitCode }) => {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

