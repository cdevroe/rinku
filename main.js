const path = require('path');

if (process.argv.includes('--mcp-server')) {
  const { startMcpServer } = require('./lib/mcpServer');
  startMcpServer().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
} else {
  let electron;
  try {
    electron = require('electron');
  } catch (error) {
    process.stderr.write('Electron is not installed. Run `npm install` before `npm start`.\n');
    process.exit(1);
  }

  const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    shell,
  } = electron;
  const {
    archiveLink,
    createLibrary,
    createLink,
    listLinks,
    readLink,
    readSettings,
    rebuildIndex,
    restoreLink,
    updateLink,
  } = require('./lib/library');
  const { importUnmarkExport } = require('./lib/importers');

  let mainWindow = null;

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 920,
      minHeight: 560,
      title: 'Rinku',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  async function chooseDirectory(title) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return '';
    }

    return result.filePaths[0];
  }

  async function chooseFile(title, filters) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      filters,
      properties: ['openFile'],
    });

    if (result.canceled || !result.filePaths[0]) {
      return '';
    }

    return result.filePaths[0];
  }

  ipcMain.handle('rinku:choose-library-directory', () => chooseDirectory('Choose Rinku Library Folder'));
  ipcMain.handle('rinku:choose-unmark-export', () => chooseFile('Choose Unmark Export JSON', [{ name: 'JSON', extensions: ['json'] }]));
  ipcMain.handle('rinku:create-library', async (_event, libraryRoot) => createLibrary(libraryRoot, { allowExisting: true }));
  ipcMain.handle('rinku:read-settings', async (_event, libraryRoot) => readSettings(libraryRoot));
  ipcMain.handle('rinku:rebuild-index', async (_event, libraryRoot) => rebuildIndex(libraryRoot));
  ipcMain.handle('rinku:list-links', async (_event, libraryRoot, filters) => listLinks(libraryRoot, filters || {}));
  ipcMain.handle('rinku:read-link', async (_event, libraryRoot, ref) => readLink(libraryRoot, ref));
  ipcMain.handle('rinku:create-link', async (_event, libraryRoot, input) => createLink(libraryRoot, input || {}, { learnRule: Boolean(input && input.label) }));
  ipcMain.handle('rinku:update-link', async (_event, libraryRoot, ref, patch) => updateLink(libraryRoot, ref, patch || {}, { learnRule: patch && patch.label != null }));
  ipcMain.handle('rinku:archive-link', async (_event, libraryRoot, ref) => archiveLink(libraryRoot, ref));
  ipcMain.handle('rinku:restore-link', async (_event, libraryRoot, ref) => restoreLink(libraryRoot, ref));
  ipcMain.handle('rinku:import-unmark', async (_event, libraryRoot, filePath) => importUnmarkExport(libraryRoot, filePath));
  ipcMain.handle('rinku:open-external', async (_event, url) => {
    const target = String(url || '').trim();
    if (target) {
      await shell.openExternal(target);
    }
  });

  app.whenReady().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

