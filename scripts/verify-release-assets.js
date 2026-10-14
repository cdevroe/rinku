#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');

const repoRoot = path.resolve(__dirname, '..');
const dirIndex = process.argv.indexOf('--dir');
if (dirIndex !== -1 && (!process.argv[dirIndex + 1] || process.argv[dirIndex + 1].startsWith('--'))) {
  throw new Error('--dir requires a directory path');
}
const distDir = dirIndex === -1 ? path.join(repoRoot, 'dist') : path.resolve(process.argv[dirIndex + 1]);
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const builderConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron-builder.json'), 'utf8'));
const version = packageJson.version;
const allowPartial = process.argv.includes('--allow-partial');
const writeChecksums = process.argv.includes('--write-checksums');
if (allowPartial && writeChecksums) throw new Error('Checksums require a complete release; omit --allow-partial.');
const errors = [];
const warnings = [];

const requiredMetadataFiles = [
  'latest.yml',
  'latest-mac.yml',
  'latest-linux.yml',
  'latest-linux-arm64.yml',
];

const requiredArtifacts = [
  `rinku_${version}_mac_universal.dmg`,
  `rinku_${version}_mac_universal.zip`,
  `rinku_${version}_win.exe`,
  `rinku_${version}_linux_x86_64.AppImage`,
  `rinku_${version}_linux_amd64.deb`,
  `rinku_${version}_linux_arm64.AppImage`,
  `rinku_${version}_linux_arm64.deb`,
];
const metadataAssets = {
  'latest-mac.yml': requiredArtifacts.slice(0, 2),
  'latest.yml': [requiredArtifacts[2]],
  'latest-linux.yml': requiredArtifacts.slice(3, 5),
  'latest-linux-arm64.yml': requiredArtifacts.slice(5, 7),
};

const curatedDownloads = [
  { label: 'Download for macOS (Universal)', file: `rinku_${version}_mac_universal.dmg` },
  { label: 'Download for Windows', file: `rinku_${version}_win.exe` },
  { label: 'Linux AppImage (x64)', file: `rinku_${version}_linux_x86_64.AppImage` },
  { label: 'Linux AppImage (ARM64)', file: `rinku_${version}_linux_arm64.AppImage` },
  { label: 'Linux deb (x64)', file: `rinku_${version}_linux_amd64.deb` },
  { label: 'Linux deb (ARM64)', file: `rinku_${version}_linux_arm64.deb` },
];

if (!fs.existsSync(distDir)) {
  fail(`dist directory not found: ${distDir}`);
}

const distEntries = fs.existsSync(distDir) ? fs.readdirSync(distDir) : [];
const distEntrySet = new Set(distEntries);

validateArtifactTemplates();
validateRequiredArtifacts();
validateMetadataFiles();

if (errors.length > 0) {
  console.error(`\nRelease asset verification failed for version ${version}.\n`);
  errors.forEach((error) => console.error(`- ${error}`));
  if (warnings.length > 0) {
    console.error('\nWarnings:');
    warnings.forEach((warning) => console.error(`- ${warning}`));
  }
  process.exit(1);
}

console.log(`\nRelease asset verification passed for version ${version}.`);
if (warnings.length > 0) {
  console.log('\nWarnings:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
}

console.log('\nCurated release-body downloads:');
curatedDownloads
  .filter(({ file }) => distEntrySet.has(file))
  .forEach(({ label, file }) => console.log(`- ${label}: dist/${file}`));

console.log('\nUpload these files to the GitHub release:');
const uploadFiles = [
  ...requiredArtifacts.filter((name) => distEntrySet.has(name)),
  ...requiredArtifacts
    .filter(needsBlockmap)
    .map((name) => `${name}.blockmap`)
    .filter((name) => distEntrySet.has(name)),
  ...requiredMetadataFiles.filter((name) => distEntrySet.has(name)),
];
Array.from(new Set(uploadFiles)).sort().forEach((name) => console.log(`- dist/${name}`));
if (writeChecksums) {
  const manifest = Array.from(new Set(uploadFiles)).sort().map((name) => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(distDir, name))).digest('hex');
    return `${hash}  ${name}`;
  }).join('\n') + '\n';
  fs.writeFileSync(path.join(distDir, 'SHA256SUMS'), manifest);
  console.log('- dist/SHA256SUMS');
}

function validateArtifactTemplates() {
  ensureTokens(packageJson.build?.artifactName, 'package.json build.artifactName', ['${version}', '${os}', '${arch}']);
  ensureTokens(builderConfig.artifactName, 'electron-builder.json artifactName', ['${version}', '${os}', '${arch}']);
  ensureTokens(packageJson.build?.nsis?.artifactName, 'package.json build.nsis.artifactName', ['${version}', '${os}']);
  ensureTokens(builderConfig.nsis?.artifactName, 'electron-builder.json nsis.artifactName', ['${version}', '${os}']);
  ensureDoesNotInclude(packageJson.build?.nsis?.artifactName, 'package.json build.nsis.artifactName', '${arch}');
  ensureDoesNotInclude(builderConfig.nsis?.artifactName, 'electron-builder.json nsis.artifactName', '${arch}');
}

function validateRequiredArtifacts() {
  for (const artifact of requiredArtifacts) {
    if (!distEntrySet.has(artifact)) {
      addIssue(`Missing required artifact: dist/${artifact}`, allowPartial);
      continue;
    }
    const stat = fs.statSync(path.join(distDir, artifact));
    if (!stat.isFile() || stat.size === 0) addIssue(`Empty or invalid artifact: ${artifact}`, false);
    if (needsBlockmap(artifact) && !distEntrySet.has(`${artifact}.blockmap`)) {
      addIssue(`Missing blockmap for differential updates: dist/${artifact}.blockmap`, allowPartial);
    } else if (needsBlockmap(artifact)) {
      const blockmap = fs.statSync(path.join(distDir, `${artifact}.blockmap`));
      if (!blockmap.isFile() || blockmap.size === 0) addIssue(`Empty or invalid blockmap: ${artifact}.blockmap`, false);
    }
  }
}

function validateMetadataFiles() {
  for (const metadataFile of requiredMetadataFiles) {
    if (!distEntrySet.has(metadataFile)) {
      addIssue(`Missing updater metadata file: dist/${metadataFile}`, allowPartial);
      continue;
    }

    let metadata;
    try {
      metadata = yaml.load(fs.readFileSync(path.join(distDir, metadataFile), 'utf8'));
    } catch (error) {
      addIssue(`Could not parse metadata YAML ${metadataFile}: ${error.message}`, false);
      continue;
    }

    if (String(metadata?.version || '') !== version) {
      addIssue(`Metadata version mismatch in ${metadataFile}. Expected ${version}, found ${metadata?.version || '<missing>'}.`, false);
    }

    const files = Array.isArray(metadata?.files) ? metadata.files : [];
    if (files.length === 0) {
      addIssue(`Metadata file has no assets listed: dist/${metadataFile}`, false);
      continue;
    }
    for (const expected of metadataAssets[metadataFile]) {
      if (!files.some((entry) => entry?.url === expected)) {
        addIssue(`Metadata ${metadataFile} does not list ${expected}`, false);
      }
    }

    for (const entry of files) {
      const url = String(entry?.url || '').trim();
      if (!url) {
        addIssue(`Metadata file contains an entry without a URL: dist/${metadataFile}`, false);
      } else if (!distEntrySet.has(url)) {
        addIssue(`Metadata references missing file "${url}" in ${metadataFile}`, allowPartial);
      } else if (!metadataAssets[metadataFile].includes(url)) {
        addIssue(`Metadata references an unexpected release asset "${url}" in ${metadataFile}`, false);
      } else {
        const data = fs.readFileSync(path.join(distDir, url));
        const sha512 = crypto.createHash('sha512').update(data).digest('base64');
        if (entry.sha512 !== sha512) addIssue(`SHA-512 mismatch for ${url} in ${metadataFile}`, false);
        if (entry.size !== data.length) addIssue(`Size mismatch for ${url} in ${metadataFile}`, false);
      }
    }
    if (metadata.path) {
      const primary = files.find((entry) => entry.url === metadata.path);
      if (!primary || primary.sha512 !== metadata.sha512) {
        addIssue(`Legacy updater path/hash disagrees with files in ${metadataFile}`, false);
      }
    }
  }
}

function ensureTokens(value, label, tokens) {
  if (!value) {
    addIssue(`${label} is missing.`, false);
    return;
  }
  for (const token of tokens) {
    if (!String(value).includes(token)) {
      addIssue(`${label} must include ${token}.`, false);
    }
  }
}

function ensureDoesNotInclude(value, label, token) {
  if (value && String(value).includes(token)) {
    addIssue(`${label} must not include ${token}.`, false);
  }
}

function needsBlockmap(name) {
  return /\.(dmg|zip|exe)$/i.test(name);
}

function fail(message) {
  errors.push(message);
}

function addIssue(message, warningOnly) {
  if (warningOnly) {
    warnings.push(message);
  } else {
    errors.push(message);
  }
}
