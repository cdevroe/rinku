const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rinku', {
  chooseLibraryDirectory: () => ipcRenderer.invoke('rinku:choose-library-directory'),
  chooseUnmarkExport: () => ipcRenderer.invoke('rinku:choose-unmark-export'),
  createLibrary: (libraryRoot) => ipcRenderer.invoke('rinku:create-library', libraryRoot),
  readSettings: (libraryRoot) => ipcRenderer.invoke('rinku:read-settings', libraryRoot),
  rebuildIndex: (libraryRoot) => ipcRenderer.invoke('rinku:rebuild-index', libraryRoot),
  listLinks: (libraryRoot, filters) => ipcRenderer.invoke('rinku:list-links', libraryRoot, filters),
  readLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:read-link', libraryRoot, ref),
  createLink: (libraryRoot, input) => ipcRenderer.invoke('rinku:create-link', libraryRoot, input),
  updateLink: (libraryRoot, ref, patch) => ipcRenderer.invoke('rinku:update-link', libraryRoot, ref, patch),
  archiveLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:archive-link', libraryRoot, ref),
  restoreLink: (libraryRoot, ref) => ipcRenderer.invoke('rinku:restore-link', libraryRoot, ref),
  importUnmark: (libraryRoot, filePath) => ipcRenderer.invoke('rinku:import-unmark', libraryRoot, filePath),
  openExternal: (url) => ipcRenderer.invoke('rinku:open-external', url),
});

