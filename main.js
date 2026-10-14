const fs = require('fs').promises;
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
    Menu,
    shell,
  } = electron;

  if (process.env.RINKU_USER_DATA_DIR) {
    app.setPath('userData', process.env.RINKU_USER_DATA_DIR);
  }

  const { autoUpdater } = require('electron-updater');
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
    updateSettings,
  } = require('./lib/library');
  const {
    assertHttpUrl,
    createLocalCaptureServer,
    normalizeCaptureInput,
    paramsToInput,
  } = require('./lib/captureServer');
  const { importUnmarkExport } = require('./lib/importers');
  const safariExtension = require('./lib/safariExtension').createSafariExtension({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });

  const PROTOCOL_SCHEME = 'rinku';
  const GITHUB_OWNER = 'cdevroe';
  const GITHUB_REPO = 'rinku';
  const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const UPDATE_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;
  const UPDATE_PREFS_FILE = 'update-preferences.json';
  let mainWindow = null;
  let currentLibraryRoot = '';
  const pendingProtocolCaptures = [];
  const updateState = {
    activeCheckIsManual: false,
    checkInProgress: false,
    checkIntervalId: null,
    downloadInProgress: false,
    reminderByVersion: {},
  };
  const captureServer = createLocalCaptureServer({
    getLibraryRoot: () => currentLibraryRoot,
    onCapture: (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rinku:capture-created', payload);
      }
    },
  });

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
    // Handle window input before the renderer and native menu can both act on it.
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.isComposing) return;
      // All Rinku editors use plain text. Keep Command+V working even when
      // macOS remaps Paste to Paste and Match Style.
      if (process.platform === 'darwin' && input.meta && !input.control && !input.alt && input.key.toLowerCase() === 'v') {
        event.preventDefault();
        if (!input.isAutoRepeat) mainWindow.webContents.pasteAndMatchStyle();
        return;
      }
      const menu = Menu.getApplicationMenu();
      const command = require('./lib/keyboardCommands').find((candidate) => {
        const item = menu?.getMenuItemById(candidate.id);
        const accelerator = item?.userAccelerator || item?.accelerator || candidate.accelerator;
        if (!accelerator) return false;
        const parts = accelerator.split('+');
        const key = parts.pop().toLowerCase();
        const isMac = process.platform === 'darwin';
        const meta = parts.some((part) => ['Command', 'Cmd', 'Super', 'Meta'].includes(part) || (part === 'CommandOrControl' && isMac));
        const control = parts.some((part) => ['Control', 'Ctrl'].includes(part) || (part === 'CommandOrControl' && !isMac));
        return key === input.key.toLowerCase() && Boolean(input.meta) === meta && Boolean(input.control) === control
          && Boolean(input.shift) === parts.includes('Shift') && Boolean(input.alt) === parts.some((part) => ['Alt', 'Option'].includes(part));
      });
      if (command) {
        event.preventDefault();
        if (!input.isAutoRepeat) mainWindow.webContents.send('rinku:command', command.id);
      }
    });
  }

  function focusMainWindow() {
    if (!app.isReady()) {
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }

  function protocolUrlFromArgs(args) {
    return args.find((arg) => String(arg || '').startsWith(`${PROTOCOL_SCHEME}://`)) || '';
  }

  function inputFromProtocolUrl(value) {
    const requestUrl = new URL(value);
    const isCaptureRoute = requestUrl.protocol === `${PROTOCOL_SCHEME}:`
      && (requestUrl.hostname === 'capture' || requestUrl.pathname === '/capture');
    if (!isCaptureRoute) {
      throw new Error('Unsupported Rinku URL.');
    }

    const input = normalizeCaptureInput(paramsToInput(requestUrl.searchParams));
    input.url = assertHttpUrl(input.url);
    return input;
  }

  function sendCaptureEvent(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('rinku:capture-created', payload);
    }
  }

  function getMainWindow() {
    return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  }

  function updatePrefsPath() {
    return path.join(app.getPath('userData'), UPDATE_PREFS_FILE);
  }

  async function loadUpdatePreferences() {
    try {
      const raw = await fs.readFile(updatePrefsPath(), 'utf8');
      const parsed = JSON.parse(raw);
      updateState.reminderByVersion = parsed && typeof parsed.reminderByVersion === 'object'
        ? parsed.reminderByVersion
        : {};
    } catch (error) {
      if (!error || error.code !== 'ENOENT') {
        console.error('Could not read update preferences.', error);
      }
      updateState.reminderByVersion = {};
    }
  }

  async function saveUpdatePreferences() {
    const payload = {
      reminderByVersion: updateState.reminderByVersion,
    };
    await fs.mkdir(path.dirname(updatePrefsPath()), { recursive: true });
    await fs.writeFile(updatePrefsPath(), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  function isReminderExpired(version) {
    const key = String(version || '').trim();
    if (!key) return true;
    const remindAfter = Date.parse(updateState.reminderByVersion[key] || '');
    return !Number.isFinite(remindAfter) || Date.now() >= remindAfter;
  }

  async function remindLater(version) {
    const key = String(version || '').trim();
    if (!key) return;
    updateState.reminderByVersion[key] = new Date(Date.now() + UPDATE_REMINDER_DELAY_MS).toISOString();
    await saveUpdatePreferences();
  }

  async function clearReminder(version) {
    const key = String(version || '').trim();
    if (!key || !updateState.reminderByVersion[key]) return;
    delete updateState.reminderByVersion[key];
    await saveUpdatePreferences();
  }

  function getReleaseUrl(info) {
    const releaseName = typeof info?.releaseName === 'string' ? info.releaseName.trim() : '';
    if (releaseName && !releaseName.includes(' ')) {
      return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/${encodeURIComponent(releaseName)}`;
    }
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  }

  function extractReleaseNotes(info) {
    const releaseNotes = info?.releaseNotes;
    if (typeof releaseNotes === 'string') {
      return releaseNotes.trim();
    }
    if (Array.isArray(releaseNotes)) {
      return releaseNotes.map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry.note === 'string') return entry.note.trim();
        return '';
      }).filter(Boolean).join('\n\n');
    }
    return '';
  }

  function escapeRegExp(input) {
    return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripReleaseNotesSection(notes, headingText) {
    const source = typeof notes === 'string' ? notes.trim() : '';
    const heading = String(headingText || '').trim();
    if (!source || !heading) return source;
    const sectionPattern = new RegExp(
      `(?:^|\\n)##\\s+${escapeRegExp(heading)}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`,
      'i'
    );
    return source.replace(sectionPattern, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function formatReleaseNotesForDialog(info) {
    const notes = stripReleaseNotesSection(extractReleaseNotes(info), 'Downloads');
    if (!notes) return 'No changelog details were provided in the release metadata.';
    return notes.length <= 1600 ? notes : `${notes.slice(0, 1600).trim()}\n\n...`;
  }

  async function openChangelog(info) {
    await shell.openExternal(getReleaseUrl(info));
  }

  async function showUpdateAvailableDialog(info) {
    const win = getMainWindow();
    if (!win || updateState.downloadInProgress) return;

    const nextVersion = typeof info?.version === 'string' ? info.version : 'latest';
    const detail = [
      `Current version: ${app.getVersion()}`,
      `New version: ${nextVersion}`,
      '',
      formatReleaseNotesForDialog(info),
      '',
      'Choose Install now to download and apply this update.',
    ].join('\n');

    while (true) {
      const choice = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update Available',
        message: `Rinku ${nextVersion} is available.`,
        detail,
        buttons: ['Install now', 'Remind me later', 'View changelog'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (choice.response === 2) {
        await openChangelog(info);
        continue;
      }
      if (choice.response === 1) {
        await remindLater(info?.version);
        return;
      }
      break;
    }

    try {
      updateState.downloadInProgress = true;
      win.setProgressBar(2);
      await autoUpdater.downloadUpdate();
    } catch (error) {
      win.setProgressBar(-1);
      updateState.downloadInProgress = false;
      console.error('Failed to download update.', error);
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Download Failed',
        message: 'Rinku could not download the update.',
        detail: String(error?.message || error || 'Unknown error'),
        buttons: ['OK'],
        noLink: true,
      });
    }
  }

  async function showUpdateReadyDialog(info) {
    const win = getMainWindow();
    if (!win) return;

    while (true) {
      const choice = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Update Ready',
        message: `Rinku ${info?.version || ''} has been downloaded.`,
        detail: 'Choose Install and Relaunch to finish the update now.',
        buttons: ['Install and Relaunch', 'Remind me later', 'View changelog'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (choice.response === 2) {
        await openChangelog(info);
        continue;
      }
      if (choice.response === 1) {
        await remindLater(info?.version);
        return;
      }

      await clearReminder(info?.version);
      autoUpdater.quitAndInstall();
      return;
    }
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (!app.isPackaged) {
      if (manual) {
        const win = getMainWindow();
        if (win) {
          await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Check for Updates',
            message: 'Updates are only available in packaged Rinku builds.',
            buttons: ['OK'],
            noLink: true,
          });
        }
      }
      return { ok: true, checked: false, reason: 'not-packaged' };
    }

    if (updateState.checkInProgress) {
      if (manual) {
        const win = getMainWindow();
        if (win) {
          await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Check for Updates',
            message: 'An update check is already running.',
            buttons: ['OK'],
            noLink: true,
          });
        }
      }
      return { ok: true, checked: false, reason: 'in-progress' };
    }

    updateState.checkInProgress = true;
    updateState.activeCheckIsManual = manual;
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true, checked: true };
    } catch (error) {
      console.error('Update check failed.', error);
      if (manual) {
        const win = getMainWindow();
        if (win) {
          await dialog.showMessageBox(win, {
            type: 'error',
            title: 'Check for Updates',
            message: 'Rinku could not check for updates.',
            detail: String(error?.message || error || 'Unknown error'),
            buttons: ['OK'],
            noLink: true,
          });
        }
      }
      return { ok: false, error: String(error?.message || error || 'Unknown error') };
    } finally {
      updateState.checkInProgress = false;
    }
  }

  function setupAutoUpdater() {
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', async (info) => {
      const manual = updateState.activeCheckIsManual;
      const version = info?.version;
      if (!manual && version && !isReminderExpired(version)) return;
      await showUpdateAvailableDialog(info);
    });

    autoUpdater.on('update-not-available', async () => {
      if (!updateState.activeCheckIsManual) return;
      const win = getMainWindow();
      if (!win) return;
      await dialog.showMessageBox(win, {
        type: 'info',
        title: 'Check for Updates',
        message: 'You are up to date.',
        detail: `Rinku ${app.getVersion()} is the latest version available.`,
        buttons: ['OK'],
        noLink: true,
      });
    });

    autoUpdater.on('download-progress', ({ percent }) => {
      const win = getMainWindow();
      if (win) {
        win.setProgressBar(Math.max(0, Math.min(1, Number(percent || 0) / 100)));
      }
    });

    autoUpdater.on('update-downloaded', async (info) => {
      updateState.downloadInProgress = false;
      const win = getMainWindow();
      if (win) win.setProgressBar(-1);
      await showUpdateReadyDialog(info);
    });

    autoUpdater.on('error', async (error) => {
      updateState.downloadInProgress = false;
      const win = getMainWindow();
      if (win) win.setProgressBar(-1);
      console.error('Updater error.', error);

      if (!updateState.activeCheckIsManual || !win) return;
      await dialog.showMessageBox(win, {
        type: 'error',
        title: 'Updater Error',
        message: 'Rinku encountered an updater error.',
        detail: String(error?.message || error || 'Unknown error'),
        buttons: ['OK'],
        noLink: true,
      });
    });

    setTimeout(() => {
      checkForUpdates({ manual: false });
    }, 10000);
    updateState.checkIntervalId = setInterval(() => {
      checkForUpdates({ manual: false });
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  async function createProtocolCapture(input) {
    if (!currentLibraryRoot) {
      pendingProtocolCaptures.push(input);
      focusMainWindow();
      return null;
    }

    const result = await createLink(currentLibraryRoot, {
      ...input,
      source: {
        capture: {
          capturedAt: new Date().toISOString(),
          method: 'protocol',
        },
      },
    }, { learnRule: Boolean(input.label) });
    sendCaptureEvent({
      libraryRoot: currentLibraryRoot,
      link: result.link,
      review: true,
      source: 'protocol',
    });
    focusMainWindow();
    return result.link;
  }

  async function flushPendingProtocolCaptures() {
    if (!currentLibraryRoot || pendingProtocolCaptures.length === 0) {
      return;
    }

    const captures = pendingProtocolCaptures.splice(0);
    for (const input of captures) {
      await createProtocolCapture(input);
    }
  }

  function handleProtocolUrl(value) {
    try {
      const input = inputFromProtocolUrl(value);
      createProtocolCapture(input).catch((error) => {
        dialog.showErrorBox('Rinku Capture Error', error.message || String(error));
      });
    } catch (error) {
      dialog.showErrorBox('Rinku Capture Error', error.message || String(error));
    }
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
  ipcMain.handle('rinku:update-settings', async (_event, libraryRoot, patch) => updateSettings(libraryRoot, patch || {}));
  ipcMain.handle('rinku:set-current-library', async (_event, libraryRoot) => {
    currentLibraryRoot = String(libraryRoot || '');
    await flushPendingProtocolCaptures();
    return { ok: true, libraryRoot: currentLibraryRoot };
  });
  ipcMain.handle('rinku:rebuild-index', async (_event, libraryRoot) => rebuildIndex(libraryRoot));
  ipcMain.handle('rinku:list-links', async (_event, libraryRoot, filters) => listLinks(libraryRoot, filters || {}));
  ipcMain.handle('rinku:read-link', async (_event, libraryRoot, ref) => readLink(libraryRoot, ref));
  ipcMain.handle('rinku:create-link', async (_event, libraryRoot, input) => createLink(libraryRoot, input || {}, { learnRule: Boolean(input && input.label) }));
  ipcMain.handle('rinku:update-link', async (_event, libraryRoot, ref, patch) => updateLink(libraryRoot, ref, patch || {}, { learnRule: patch && patch.label != null }));
  ipcMain.handle('rinku:archive-link', async (_event, libraryRoot, ref) => archiveLink(libraryRoot, ref));
  ipcMain.handle('rinku:restore-link', async (_event, libraryRoot, ref) => restoreLink(libraryRoot, ref));
  ipcMain.handle('rinku:import-unmark', async (_event, libraryRoot, filePath) => importUnmarkExport(libraryRoot, filePath));
  ipcMain.handle('rinku:capture-status', async () => captureServer.status());
  ipcMain.handle('rinku:start-capture-server', async (_event, libraryRoot, options = {}) => {
    currentLibraryRoot = String(libraryRoot || currentLibraryRoot || '');
    return captureServer.start(options || {});
  });
  ipcMain.handle('rinku:stop-capture-server', async () => captureServer.stop());
  ipcMain.handle('rinku:safari-extension-status', () => safariExtension.status());
  ipcMain.handle('rinku:setup-safari-extension', async () => {
    try { return await safariExtension.openSettings(); }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('rinku:open-external', async (_event, url) => {
    const target = String(url || '').trim();
    if (target) {
      await shell.openExternal(target);
    }
  });
  ipcMain.handle('rinku:check-for-updates', async () => checkForUpdates({ manual: true }));

  function buildApplicationMenu() {
    const isMac = process.platform === 'darwin';
    const commands = require('./lib/keyboardCommands');
    const commandItems = (group) => commands.filter((command) => command.group === group).map((command) => ({
      id: command.id,
      label: command.label,
      accelerator: command.accelerator,
      click: (_item, focusedWindow) => {
        const window = focusedWindow || BrowserWindow.getFocusedWindow() || mainWindow;
        if (window) window.webContents.send('rinku:command', command.id);
      },
    }));
    const checkForUpdatesItem = {
      label: 'Check for Updates...',
      click: () => {
        checkForUpdates({ manual: true });
      },
    };
    const template = [
      ...(isMac ? [{
        label: app.name,
        submenu: [
          { role: 'about' },
          checkForUpdatesItem,
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }] : []),
      {
        label: 'File',
        submenu: [
          ...commandItems('File'),
          { type: 'separator' },
          ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'selectAll' },
        ],
      },
      { label: 'Navigate', submenu: commandItems('Navigate') },
      { label: 'Link', submenu: commandItems('Link') },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
        ],
      },
      {
        label: 'Help',
        submenu: [
          ...commandItems('Help'),
          { type: 'separator' },
          ...(!isMac ? [checkForUpdatesItem, { type: 'separator' }] : []),
          {
            label: 'Rinku Releases',
            click: () => shell.openExternal(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`),
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  if (process.env.RINKU_SKIP_PROTOCOL_REGISTRATION !== '1') {
    if (process.defaultApp) {
      const appEntry = process.argv[1] ? path.resolve(process.argv[1]) : __filename;
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [appEntry]);
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
    }
  }

  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    const launchProtocolUrl = protocolUrlFromArgs(process.argv);
    if (launchProtocolUrl) {
      handleProtocolUrl(launchProtocolUrl);
    }

    app.on('second-instance', (_event, args) => {
      const protocolUrl = protocolUrlFromArgs(args);
      if (protocolUrl) {
        handleProtocolUrl(protocolUrl);
      } else {
        focusMainWindow();
      }
    });

    app.whenReady().then(async () => {
      await loadUpdatePreferences();
      createWindow();
      buildApplicationMenu();
      setupAutoUpdater();
      focusMainWindow();
    });
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

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

  app.on('before-quit', () => {
    if (updateState.checkIntervalId) {
      clearInterval(updateState.checkIntervalId);
      updateState.checkIntervalId = null;
    }
    captureServer.stop().catch(() => {});
  });
}
