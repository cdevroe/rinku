const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { atomicWriteFile } = require('./atomicFile');

function getConfigDir() {
  if (process.env.RINKU_CONFIG_HOME) {
    return path.resolve(process.env.RINKU_CONFIG_HOME);
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Rinku');
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, 'rinku');
  }

  return path.join(os.homedir(), '.config', 'rinku');
}

function getStatePath() {
  return path.join(getConfigDir(), 'cli-state.json');
}

async function readCliState() {
  try {
    const raw = await fs.readFile(getStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if ((error && error.code === 'ENOENT') || error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

async function writeCliState(state) {
  const statePath = getStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await atomicWriteFile(statePath, `${JSON.stringify(state || {}, null, 2)}\n`, 'utf8');
}

async function getCurrentLibrary() {
  const state = await readCliState();
  return typeof state.currentLibraryRoot === 'string' ? state.currentLibraryRoot : '';
}

async function setCurrentLibrary(libraryRoot) {
  const state = await readCliState();
  const nextState = {
    ...state,
    currentLibraryRoot: path.resolve(String(libraryRoot || '').trim()),
    updatedAt: new Date().toISOString(),
  };
  await writeCliState(nextState);
  return nextState.currentLibraryRoot;
}

module.exports = {
  getCurrentLibrary,
  readCliState,
  setCurrentLibrary,
  writeCliState,
};

