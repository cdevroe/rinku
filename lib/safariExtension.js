const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const runFile = promisify(execFile);

function createSafariExtension({ platform = process.platform, isPackaged, resourcesPath, execute = runFile }) {
  const contents = path.dirname(resourcesPath);
  const helper = path.join(contents, 'MacOS', 'rinku-safari-helper');
  const bundle = path.join(contents, 'PlugIns', 'RinkuSafariExtension.appex');
  async function bundled() {
    if (platform !== 'darwin' || !isPackaged) return false;
    try {
      await fs.access(helper);
      await fs.access(path.join(bundle, 'Contents', 'Info.plist'));
      return true;
    } catch { return false; }
  }
  async function invoke(command) {
    let stdout;
    try {
      ({ stdout } = await execute(helper, [command], { timeout: 15000, maxBuffer: 16384 }));
    } catch (error) {
      try {
        const result = JSON.parse(error.stdout);
        if (result.error) throw new Error(result.error);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) throw new Error('Safari could not respond. Open Safari > Settings > Extensions and enable Rinku.');
        throw parseError;
      }
    }
    return JSON.parse(stdout);
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
      const result = await invoke('open-settings');
      if (result.error) throw new Error(result.error);
      return result;
    },
  };
}

exports.createSafariExtension = createSafariExtension;
