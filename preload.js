const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rinku', {
  chooseLibraryDirectory: () => ipcRenderer.invoke('rinku:choose-library-directory'),
  chooseUnmarkExport: () => ipcRenderer.invoke('rinku:choose-unmark-export'),
  createLibrary: (libraryRoot) => ipcRenderer.invoke('rinku:create-library', libraryRoot),
  readSettings: (libraryRoot) => ipcRenderer.invoke('rinku:read-settings', libraryRoot),
  updateSettings: (libraryRoot, patch) => ipcRenderer.invoke('rinku:update-settings', libraryRoot, patch),
  setCurrentLibrary: (libraryRoot) => ipcRenderer.invoke('rinku:set-current-library', libraryRoot),
  rebuildIndex: (libraryRoot) => ipcRenderer.invoke('rinku:rebuild-index', libraryRoot),
  listLinks: (libraryRoot, filters) => ipcRenderer.invoke('rinku:list-links', libraryRoot, filters),
  readLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:read-link', libraryRoot, ref),
  createLink: (libraryRoot, input) => ipcRenderer.invoke('rinku:create-link', libraryRoot, input),
  updateLink: (libraryRoot, ref, patch) => ipcRenderer.invoke('rinku:update-link', libraryRoot, ref, patch),
  archiveLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:archive-link', libraryRoot, ref),
  restoreLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:restore-link', libraryRoot, ref),
  importUnmark: (libraryRoot, filePath) => ipcRenderer.invoke('rinku:import-unmark', libraryRoot, filePath),
  captureStatus: () => ipcRenderer.invoke('rinku:capture-status'),
  startCaptureServer: (libraryRoot, options) => ipcRenderer.invoke('rinku:start-capture-server', libraryRoot, options),
  stopCaptureServer: () => ipcRenderer.invoke('rinku:stop-capture-server'),
  safariExtensionStatus: () => ipcRenderer.invoke('rinku:safari-extension-status'),
  setupSafariExtension: async () => {
    const result = await ipcRenderer.invoke('rinku:setup-safari-extension');
    if (!result.ok) throw new Error(result.error || 'Could not open Safari Settings.');
    return result;
  },
  checkForUpdates: () => ipcRenderer.invoke('rinku:check-for-updates'),
  onCommand: (callback) => {
    const handler = (_event, command) => callback(command);
    ipcRenderer.on('rinku:command', handler);
    return () => ipcRenderer.removeListener('rinku:command', handler);
  },
  onCaptureCreated: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('rinku:capture-created', handler);
    return () => ipcRenderer.removeListener('rinku:capture-created', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('rinku:open-external', url),
});
