const fs = require('fs');
const path = require('path');

const MIN_WIDTH = 920;
const MIN_HEIGHT = 560;

function validBounds(bounds) {
  return bounds && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(bounds[key]))
    && bounds.width > 0 && bounds.height > 0;
}

function overlap(left, right) {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

function resolveWindowState(saved, workAreas, primaryArea) {
  const bounds = validBounds(saved?.bounds) ? saved.bounds : null;
  let area = primaryArea;
  let intersection = 0;
  if (bounds) {
    for (const candidate of workAreas) {
      const size = overlap(bounds, candidate);
      if (size > intersection) { area = candidate; intersection = size; }
    }
  }
  const minWidth = Math.min(MIN_WIDTH, area.width);
  const minHeight = Math.min(MIN_HEIGHT, area.height);
  const width = Math.min(area.width, Math.max(minWidth, bounds?.width ?? Math.min(1440, Math.round(area.width * 0.9))));
  const height = Math.min(area.height, Math.max(minHeight, bounds?.height ?? Math.min(960, Math.round(area.height * 0.9))));
  const centeredX = area.x + Math.round((area.width - width) / 2);
  const centeredY = area.y + Math.round((area.height - height) / 2);
  return {
    bounds: {
      x: bounds && intersection ? Math.min(Math.max(bounds.x, area.x), area.x + area.width - width) : centeredX,
      y: bounds && intersection ? Math.min(Math.max(bounds.y, area.y), area.y + area.height - height) : centeredY,
      width, height,
    },
    minWidth, minHeight,
    maximized: Boolean(bounds && saved.maximized === true),
  };
}

function readWindowState(filePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return validBounds(saved?.bounds) ? saved : null;
  } catch {
    // Missing or damaged device preferences must not prevent opening the app.
    return null;
  }
}

function captureWindowState(window) {
  return { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
}

function saveWindowState(filePath, state) {
  if (!validBounds(state.bounds)) return;
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, 'utf8');
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = { resolveWindowState, readWindowState, captureWindowState, saveWindowState };
