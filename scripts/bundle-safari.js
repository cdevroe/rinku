const fs = require('fs').promises;
const path = require('path');
const { buildSafari, BRIDGE_NAME } = require('./build-safari');

exports.default = async function bundleSafari(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const contents = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents');
  const plugins = path.join(contents, 'PlugIns');
  const arch = require('builder-util').Arch[context.arch];
  const { bridgeBinary } = await buildSafari({ outputDir: plugins, arch, version: context.packager.appInfo.version });
  await fs.rename(bridgeBinary, path.join(contents, 'Resources', BRIDGE_NAME));
};
