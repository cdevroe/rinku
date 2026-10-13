const path = require('path');
const { spawn, execFileSync } = require('child_process');
require('dotenv').config({ quiet: true });

const skipNotarization = ['1', 'true', 'yes'].includes(String(process.env.RINKU_SKIP_NOTARIZATION || '').toLowerCase());
if (!skipNotarization) {
  const missing = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Configure ${missing.join(', ')} in .env before building a signed macOS release. See docs/macos-signing.md. For a local preview, use dist:mac:arm64:no-notarize.`);
    process.exit(1);
  }
  process.env.RINKU_REQUIRE_SIGNING = '1';
}

// The native extension, notarytool, and stapler work with either full Xcode or
// Apple's installed Command Line Tools. Do not accept license prompts silently.
try {
  execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { stdio: 'pipe' });
} catch {
  const env = { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' };
  try {
    execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { env, stdio: 'pipe' });
    process.env.DEVELOPER_DIR = env.DEVELOPER_DIR;
  } catch {
    console.error('Install and configure Xcode or Apple’s Command Line Tools before building macOS releases.');
    process.exit(1);
  }
}

// Apply even after an npm install that skipped lifecycle scripts.
require('./patch-mac-signing').applyPatch();
const cli = require.resolve('electron-builder/cli.js');
const child = spawn(process.execPath, [cli, '--config', path.join(__dirname, '..', 'electron-builder.json'),
  ...(!skipNotarization ? ['--config.mac.forceCodeSigning=true'] : []),
  '--mac', ...process.argv.slice(2), '--publish', 'never'], { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });

// Packaging errors sometimes include the arguments sent to security/notarytool.
// Buffer complete lines before redacting so chunk boundaries cannot expose a password.
const secrets = ['CSC_KEY_PASSWORD', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID', 'CSC_LINK'].map((key) => process.env[key]).filter(Boolean);
for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  stream.setEncoding('utf8');
  let pending = '';
  const write = (line) => destination.write(secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), line));
  stream.on('data', (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      write(pending.slice(0, end + 1));
      pending = pending.slice(end + 1);
    }
  });
  stream.on('end', () => { if (pending) write(pending); });
}
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('close', (code, signal) => {
  if (signal) console.error(`macOS packaging ended with ${signal}.`);
  process.exitCode = code == null ? 1 : code;
});
