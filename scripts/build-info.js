const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SOURCE_PATHS = [
  'app', 'bin', 'lib', 'static', 'safari', 'scripts',
  'main.js', 'preload.js', 'index.html', 'package.json', 'package-lock.json',
  'electron-builder.json', 'build/Icon.svg', 'build/entitlements.mac.plist',
];

function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  function add(relative) {
    const full = path.join(root, relative);
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) {
        if (name !== '.DS_Store') add(path.join(relative, name));
      }
    } else {
      hash.update(relative.split(path.sep).join('/'));
      hash.update('\0');
      const contents = fs.readFileSync(full);
      hash.update(String(contents.length));
      hash.update('\0');
      hash.update(contents);
    }
  }
  SOURCE_PATHS.forEach(add);
  return hash.digest('hex');
}

function buildInfo(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    version: pkg.version,
    electron: pkg.devDependencies.electron,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: sourceFingerprint(root),
    builtAt: process.env.RINKU_BUILD_TIME || new Date().toISOString(),
  };
}

module.exports = { sourceFingerprint, buildInfo };
