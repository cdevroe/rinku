const path = require('path');
const { signAsync } = require('@electron/osx-sign');
const { EXTENSION_NAME, BRIDGE_NAME } = require('./build-safari');

exports.default = async function signMac(options) {
  if (process.env.RINKU_REQUIRE_SIGNING === '1' && (!options.identity || options.identity === '-')) {
    throw new Error('A Developer ID Application certificate and private key are required. Configure CSC_LINK and CSC_KEY_PASSWORD or install the signing identity in Keychain Access.');
  }
  const extension = path.join(options.app, 'Contents', 'PlugIns', EXTENSION_NAME);
  const bridge = path.join(options.app, 'Contents', 'Resources', BRIDGE_NAME);
  const baseOptionsForFile = options.optionsForFile;
  await signAsync({
    ...options,
    // Keep local builds usable without a certificate. Safari distribution still
    // requires a Developer ID identity and notarization.
    identity: options.identity || '-',
    identityValidation: options.identity && options.identity !== '-' ? options.identityValidation : false,
    // osx-sign discovers the extension executable, but does not discover .appex
    // bundles themselves. Sign the bundle too, before sealing its containing app.
    binaries: [...(options.binaries || []), extension],
    // electron-builder normally ignores Contents/PlugIns entirely.
    ignore: (filePath) => filePath === bridge || filePath === extension || filePath.startsWith(`${extension}${path.sep}`)
      ? false : (options.ignore ? options.ignore(filePath) : false),
    optionsForFile: (filePath) => {
      const base = baseOptionsForFile ? baseOptionsForFile(filePath) : {};
      if (filePath === extension || filePath.startsWith(`${extension}${path.sep}`)) {
        return { ...base, entitlements: path.join(__dirname, '..', 'safari', 'entitlements.plist'), hardenedRuntime: true };
      }
      if (filePath === bridge) {
        return { ...base, entitlements: path.join(__dirname, '..', 'safari', 'bridge-entitlements.plist'), hardenedRuntime: true };
      }
      return base;
    },
  });
};
