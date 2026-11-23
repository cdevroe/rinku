const { spawn } = require('child_process');
const path = require('path');

// NSIS cannot extract the newer ARM64 7-Zip filter used by this pinned builder.
// BCJ works with both architectures in the universal Windows installer.
const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'),
  '--config', path.join(__dirname, '..', 'electron-builder.json'),
  '--win', 'nsis', ...process.argv.slice(2), '--publish', 'never'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: 'BCJ' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code == null ? 1 : code; });
