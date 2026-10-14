const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { version } = require('../package.json');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rinku-release-'));
const prefix = `rinku_${version}_`;
const groups = {
  'latest-mac.yml': ['mac_universal.zip', 'mac_universal.dmg'],
  'latest.yml': ['win.exe'],
  'latest-linux.yml': ['linux_x86_64.AppImage', 'linux_amd64.deb'],
  'latest-linux-arm64.yml': ['linux_arm64.AppImage', 'linux_arm64.deb'],
};
function verify(...args) {
  return spawnSync(process.execPath, [path.join(__dirname, 'verify-release-assets.js'), '--dir', dir, ...args], { encoding: 'utf8' });
}
try {
  for (const [metadata, names] of Object.entries(groups)) {
    const files = names.map((name) => {
      const url = prefix + name;
      const data = Buffer.from(`Fixture for ${url}`);
      fs.writeFileSync(path.join(dir, url), data);
      if (/\.(zip|dmg|exe)$/.test(name)) fs.writeFileSync(path.join(dir, `${url}.blockmap`), 'blockmap');
      return { url, sha512: crypto.createHash('sha512').update(data).digest('base64'), size: data.length };
    });
    fs.writeFileSync(path.join(dir, metadata), yaml.dump({ version, files, path: files[0].url, sha512: files[0].sha512 }));
  }
  let result = verify('--write-checksums');
  assert.equal(result.status, 0, result.stderr);
  const manifest = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
  assert.equal(manifest.trim().split('\n').length, 14);
  for (const line of manifest.trim().split('\n')) {
    const [hash, name] = line.split('  ');
    assert.equal(hash, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'));
  }
  const blockmap = path.join(dir, `${prefix}win.exe.blockmap`);
  fs.writeFileSync(blockmap, '');
  assert.match(verify().stderr, /Empty or invalid blockmap/);
  fs.writeFileSync(blockmap, 'blockmap');
  const windowsMetadata = path.join(dir, 'latest.yml');
  const originalMetadata = fs.readFileSync(windowsMetadata, 'utf8');
  const wrongMetadata = yaml.load(originalMetadata);
  wrongMetadata.files[0].url = `${prefix}mac_universal.zip`;
  fs.writeFileSync(windowsMetadata, yaml.dump(wrongMetadata));
  assert.match(verify().stderr, /does not list .*win.exe/);
  fs.writeFileSync(windowsMetadata, originalMetadata);
  const appImage = path.join(dir, `${prefix}linux_arm64.AppImage`);
  fs.appendFileSync(appImage, 'corrupt');
  result = verify('--allow-partial');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-512 mismatch/);
  fs.unlinkSync(appImage);
  assert.equal(verify().status, 1);
  assert.equal(verify('--allow-partial').status, 0);
  const metadataPath = path.join(dir, 'latest-mac.yml');
  const metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8'));
  metadata.version = '0.0.0';
  fs.writeFileSync(metadataPath, yaml.dump(metadata));
  result = verify('--allow-partial');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version mismatch/);
  console.log('test-release-assets passed');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
