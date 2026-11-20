const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function captureRuntimeInfo(options = {}) {
  const appPath = options.appPath || path.resolve(__dirname, '..');
  const pkg = options.package || require('../package.json');
  const packaged = options.packaged ?? path.basename(appPath).endsWith('.asar');
  const metadataPath = options.metadataPath || path.join(path.dirname(appPath), 'rinku-build.json');
  const info = { version: pkg.version, mode: packaged ? 'packaged' : 'source',
    commit: null, sourceSha256: null, builtAt: null,
    configuredElectron: pkg.devDependencies?.electron || null,
    electron: process.versions.electron || null, node: process.versions.node,
    executablePath: process.execPath, appPath, pid: process.pid, startedAt: new Date().toISOString() };
  try {
    if (packaged) {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      if (metadata.version !== pkg.version || !/^[a-f0-9]{64}$/.test(metadata.sourceSha256 || '')) throw new Error('Invalid packaged build metadata.');
      Object.assign(info, { commit: metadata.commit, sourceSha256: metadata.sourceSha256,
        builtAt: metadata.builtAt, configuredElectron: metadata.electron });
    } else {
      info.sourceSha256 = (options.sourceFingerprint || require('../scripts/build-info').sourceFingerprint)(appPath);
      try {
        info.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch { /* A transferred source snapshot need not have Git metadata. */ }
    }
  } catch (error) {
    info.identityError = error.message;
  }
  return Object.freeze(info);
}

// Capture once, before serving requests. A long-lived server must not claim a
// newer identity merely because source files or the installed app changed later.
const runtimeInfo = captureRuntimeInfo();
module.exports = { runtimeInfo, captureRuntimeInfo };
