const fs = require('fs').promises;
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'safari');
const EXTENSION_NAME = 'RinkuSafariExtension.appex';
const BRIDGE_NAME = 'rinku-safari-bridge.node';

function toolbarPDF() {
  // A transparent, scalable bookmark with a plus; Safari supplies its tint.
  const drawing = '0 G 1.8 w 1 J 1 j 6 3 m 6 21 l 18 21 l 18 3 l 12 7 l h S 9 14 m 15 14 l S 12 11 m 12 17 l S\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 24 24] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(drawing)} >>\nstream\n${drawing}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return pdf;
}

async function buildSafari({ outputDir = path.join(repoRoot, 'build', 'safari'), arch = 'universal', version = require('../package.json').version } = {}) {
  if (process.platform !== 'darwin') throw new Error('Building the Safari extension requires macOS and Xcode.');
  const architectures = arch === 'universal' ? ['arm64', 'x86_64'] : arch === 'x64' ? ['x86_64'] : arch === 'arm64' ? ['arm64'] : [];
  if (!architectures.length) throw new Error(`Unsupported Safari architecture: ${arch}`);
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Invalid Safari extension version.');
  const bundleVersion = version.split(/[-+]/)[0];
  await fs.mkdir(outputDir, { recursive: true });
  const temp = await fs.mkdtemp(path.join(outputDir, '.compile-'));
  const bundlePath = path.join(outputDir, EXTENSION_NAME);
  try {
    let toolEnv = process.env;
    let sdk;
    try {
      sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (error) {
      // An installed Command Line Tools SDK can build this Objective-C target
      // even when full Xcode has not completed its first-run setup.
      toolEnv = { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' };
      try {
        sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8', env: toolEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      } catch { throw new Error(`Install/configure Xcode or Apple's Command Line Tools before building Safari. ${error.message}`); }
    }
    const runTool = (args) => execFileSync('xcrun', args, { env: toolEnv, stdio: 'inherit' });
    for (const cpu of architectures) {
      const args = ['clang', '-fobjc-arc', '-fblocks', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-Os', '-isysroot', sdk, '-target', `${cpu}-apple-macos11.0`, '-framework', 'AppKit', '-framework', 'SafariServices'];
      runTool([...args, '-fapplication-extension', '-framework', 'Foundation', '-Wl,-e,_NSExtensionMain', path.join(sourceDir, 'SafariExtensionHandler.m'), path.join(sourceDir, 'CaptureURL.m'), '-o', path.join(temp, `extension-${cpu}`)]);
      runTool([...args, '-bundle', '-undefined', 'dynamic_lookup', '-DNAPI_VERSION=8',
        '-DNODE_GYP_MODULE_NAME=rinku_safari_bridge', '-I', require('node-api-headers').include_dir,
        path.join(sourceDir, 'SafariBridge.m'), '-o', path.join(temp, `bridge-${cpu}`)]);
    }
    // Clear an earlier bundle so old code signatures/resources cannot survive a rebuild.
    await fs.rm(bundlePath, { recursive: true, force: true });
    const contents = path.join(bundlePath, 'Contents');
    await fs.mkdir(path.join(contents, 'MacOS'), { recursive: true });
    await fs.mkdir(path.join(contents, 'Resources'), { recursive: true });
    const extensionBinary = path.join(contents, 'MacOS', 'RinkuSafariExtension');
    const bridgeBinary = path.join(outputDir, BRIDGE_NAME);
    for (const [kind, destination] of [['extension', extensionBinary], ['bridge', bridgeBinary]]) {
      runTool(['lipo', '-create', ...architectures.map((cpu) => path.join(temp, `${kind}-${cpu}`)), '-output', destination]);
      await fs.chmod(destination, 0o755);
    }
    const plist = (await fs.readFile(path.join(sourceDir, 'Info.plist'), 'utf8')).replaceAll('__VERSION__', bundleVersion);
    await fs.writeFile(path.join(contents, 'Info.plist'), plist);
    await fs.writeFile(path.join(contents, 'Resources', 'ToolbarIcon.pdf'), toolbarPDF());
    await fs.writeFile(path.join(contents, 'PkgInfo'), 'XPC!????');
    execFileSync('plutil', ['-lint', path.join(contents, 'Info.plist')], { stdio: 'inherit' });
    return { bundlePath, bridgeBinary };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

exports.buildSafari = buildSafari;
exports.EXTENSION_NAME = EXTENSION_NAME;
exports.BRIDGE_NAME = BRIDGE_NAME;

if (require.main === module) {
  const arch = process.argv[2] || 'universal';
  buildSafari({ arch }).then(({ bundlePath }) => console.log(`Built Safari extension: ${bundlePath}`)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
