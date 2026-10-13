#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// app-builder-lib 26.15.3 creates a random keychain password, but passes the
// certificate password to set-key-partition-list. Keep the two credentials
// separate. This narrow patch must be reviewed when upgrading electron-builder.
const SUPPORTED_VERSION = '26.15.3';
const REPLACEMENTS = [
  ['return await importCerts(keychainFile, certPaths, cscPasswords);',
    'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);'],
  ['async function importCerts(keychainFile, paths, keyPasswords) {',
    'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {'],
  ['["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
    '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]'],
];

function patchSource(source, version) {
  if (version !== SUPPORTED_VERSION) {
    throw new Error(`Review the macOS signing patch for app-builder-lib ${version}; expected ${SUPPORTED_VERSION}.`);
  }
  const count = (text) => source.split(text).length - 1;
  if (REPLACEMENTS.every(([before, after]) => count(before) === 0 && count(after) === 1)) return source;
  if (!REPLACEMENTS.every(([before, after]) => count(before) === 1 && count(after) === 0)) {
    throw new Error('Unexpected app-builder-lib macOS signing source; refusing to apply a partial patch.');
  }
  return REPLACEMENTS.reduce((result, [before, after]) => result.replace(before, after), source);
}

function applyPatch(root = path.resolve(__dirname, '..')) {
  let packagePath;
  try {
    packagePath = require.resolve('app-builder-lib/package.json', { paths: [root] });
  } catch (error) {
    // Production-only dependency installs do not include the packaging tools.
    if (error.code === 'MODULE_NOT_FOUND') return false;
    throw error;
  }
  const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const file = path.join(path.dirname(packagePath), 'out/codeSign/macCodeSign.js');
  const source = fs.readFileSync(file, 'utf8');
  const patched = patchSource(source, version);
  if (patched === source) return false;
  fs.writeFileSync(file, patched);
  return true;
}

module.exports = { applyPatch, patchSource, REPLACEMENTS, SUPPORTED_VERSION };

if (require.main === module) {
  try {
    if (applyPatch()) console.log('Applied electron-builder macOS signing keychain password fix.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
