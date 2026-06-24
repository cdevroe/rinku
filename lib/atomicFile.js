const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');

async function syncDirectory(directoryPath) {
  let handle = null;

  try {
    handle = await fs.open(directoryPath, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is best-effort and not supported everywhere.
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}

async function atomicWriteFile(filePath, data, options = 'utf8') {
  const resolvedPath = path.resolve(filePath);
  const directoryPath = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);
  const tempPath = path.join(
    directoryPath,
    `.${baseName}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  let handle = null;
  let cleanup = true;

  await fs.mkdir(directoryPath, { recursive: true });

  try {
    handle = await fs.open(tempPath, 'wx');
    await handle.writeFile(data, options);
    await handle.sync();
    await handle.close();
    handle = null;

    await fs.rename(tempPath, resolvedPath);
    cleanup = false;
    await syncDirectory(directoryPath);
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
    if (cleanup) {
      await fs.unlink(tempPath).catch(() => {});
    }
  }
}

module.exports = {
  atomicWriteFile,
};

