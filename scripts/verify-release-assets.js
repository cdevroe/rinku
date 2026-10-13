#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const builderConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'electron-builder.json'), 'utf8'));
const version = packageJson.version;
const allowPartial = process.argv.includes('--allow-partial');
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
    if (needsBlockmap(artifact) && !distEntrySet.has(`${artifact}.blockmap`)) {
      addIssue(`Missing blockmap for differential updates: dist/${artifact}.blockmap`, allowPartial);
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
      addIssue(`Metadata version mismatch in ${metadataFile}. Expected ${version}, found ${metadata?.version || '<missing>'}.`, allowPartial);
    }

    const files = Array.isArray(metadata?.files) ? metadata.files : [];
    if (files.length === 0) {
      addIssue(`Metadata file has no assets listed: dist/${metadataFile}`, false);
      continue;
    }

    for (const entry of files) {
      const url = String(entry?.url || '').trim();
      if (!url) {
        addIssue(`Metadata file contains an entry without a URL: dist/${metadataFile}`, false);
      } else if (!distEntrySet.has(url)) {
        addIssue(`Metadata references missing file "${url}" in ${metadataFile}`, allowPartial);
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
