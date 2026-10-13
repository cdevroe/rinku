const fs = require('fs').promises;
const path = require('path');
const { buildSafari, HELPER_NAME } = require('./build-safari');

exports.default = async function bundleSafari(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const contents = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents');
  const plugins = path.join(contents, 'PlugIns');
  const arch = require('builder-util').Arch[context.arch];
  const { helperBinary } = await buildSafari({ outputDir: plugins, arch, version: context.packager.appInfo.version });
  await fs.rename(helperBinary, path.join(contents, 'MacOS', HELPER_NAME));
};
