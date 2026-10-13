const path = require('path');
const { signAsync } = require('@electron/osx-sign');
const { EXTENSION_NAME, HELPER_NAME } = require('./build-safari');

exports.default = async function signMac(options) {
  const extension = path.join(options.app, 'Contents', 'PlugIns', EXTENSION_NAME);
  const baseOptionsForFile = options.optionsForFile;
  await signAsync({
    ...options,
    // Keep local builds usable without a certificate. Safari distribution still
    // requires a Developer ID identity and notarization.
    identity: options.identity || '-',
    // osx-sign discovers the extension executable, but does not discover .appex
    // bundles themselves. Sign the bundle too, before sealing its containing app.
    binaries: [...(options.binaries || []), extension],
    // electron-builder normally ignores Contents/PlugIns entirely.
    ignore: (filePath) => filePath === extension || filePath.startsWith(`${extension}${path.sep}`)
      ? false : (options.ignore ? options.ignore(filePath) : false),
    optionsForFile: (filePath) => {
      const base = baseOptionsForFile ? baseOptionsForFile(filePath) : {};
      if (filePath === extension || filePath.startsWith(`${extension}${path.sep}`)) {
        return { ...base, entitlements: path.join(__dirname, '..', 'safari', 'entitlements.plist'), hardenedRuntime: true };
      }
      if (path.basename(filePath) === HELPER_NAME) {
        return { ...base, entitlements: path.join(__dirname, '..', 'safari', 'helper-entitlements.plist'), hardenedRuntime: true };
      }
      return base;
    },
  });
};
