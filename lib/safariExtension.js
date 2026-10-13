const fs = require('fs').promises;
const path = require('path');

function createSafariExtension({ platform = process.platform, isPackaged, resourcesPath, loadNative = require }) {
  const contents = path.dirname(resourcesPath);
  const bridgePath = path.join(resourcesPath, 'rinku-safari-bridge.node');
  let bridge;
  const bundle = path.join(contents, 'PlugIns', 'RinkuSafariExtension.appex');
  async function bundled() {
    if (platform !== 'darwin' || !isPackaged) return false;
    try {
      await fs.access(bridgePath);
      await fs.access(path.join(bundle, 'Contents', 'Info.plist'));
      return true;
    } catch { return false; }
  }
  async function invoke(command) {
    bridge ||= loadNative(bridgePath);
    return bridge[command]();
  }
  return {
    async status() {
      const supported = platform === 'darwin';
      const available = await bundled();
      if (!available) return { supported, bundled: false, enabled: false };
      try {
        const result = await invoke('status');
        return { supported, bundled: true, enabled: Boolean(result.enabled), error: result.error || '' };
      } catch (error) {
        return { supported, bundled: true, enabled: false, error: error.message };
      }
    },
    async openSettings() {
      if (!await bundled()) throw new Error('The Safari extension is available in installed macOS builds of Rinku.');
      const result = await invoke('openSettings');
      if (result.error) throw new Error(result.error);
      return result;
    },
  };
}

exports.createSafariExtension = createSafariExtension;
