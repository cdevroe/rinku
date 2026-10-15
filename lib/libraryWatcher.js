const fs = require('fs');
const path = require('path');

// Watch the shared index rather than an individual inode: writes replace it
// atomically. Stat polling also works on cloud folders and across platforms.
function watchLibrary(libraryRoot, onChange, options = {}) {
  const files = ['.rinku/index.json', 'rinku-settings.md'];
  const listeners = [];
  let timer = null;
  let closed = false;
  const changed = new Set();
  for (const relativePath of files) {
    const filePath = path.join(libraryRoot, relativePath);
    const listener = (current, previous) => {
      if (closed || (current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs
        && current.size === previous.size && current.ino === previous.ino)) return;
      changed.add(relativePath);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const payload = { libraryRoot, files: [...changed] };
        changed.clear();
        onChange(payload);
      }, options.debounceMs ?? 150);
      timer.unref();
    };
    fs.watchFile(filePath, { persistent: false, interval: options.intervalMs ?? 500 }, listener);
    listeners.push([filePath, listener]);
  }
  return () => {
    closed = true;
    clearTimeout(timer);
    for (const [filePath, listener] of listeners) fs.unwatchFile(filePath, listener);
  };
}

module.exports = { watchLibrary };
