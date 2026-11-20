const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWindowState, readWindowState, captureWindowState, saveWindowState } = require('../lib/windowState');

const desktop = { x: 0, y: 25, width: 2560, height: 1375 };
const laptop = { x: 0, y: 25, width: 1440, height: 850 };
const secondary = { x: -1920, y: 25, width: 1920, height: 1055 };
const resolve = (saved, areas = [desktop], primary = areas[0]) => resolveWindowState(saved, areas, primary);
const initial = resolve(null);
assert.deepStrictEqual(initial.bounds, { x: 560, y: 233, width: 1440, height: 960 });
assert.strictEqual(initial.maximized, false);
assert.deepStrictEqual(resolve(null, [laptop]).bounds, { x: 72, y: 68, width: 1296, height: 765 });

const saved = { bounds: { x: -1850, y: 80, width: 1300, height: 850 }, maximized: true };
assert.deepStrictEqual(resolve(saved, [desktop, secondary]).bounds, saved.bounds, 'Keep a window on its available secondary display.');
assert.strictEqual(resolve(saved).maximized, true);
const moved = resolve(saved, [laptop]);
assert.deepStrictEqual(moved.bounds, { x: 70, y: 25, width: 1300, height: 850 }, 'Recenter when the old display is disconnected.');
assert.deepStrictEqual(resolve({ bounds: { x: 1300, y: 700, width: 1800, height: 1200 } }, [laptop]).bounds,
  laptop, 'Clamp size and position when the display becomes smaller.');
const tiny = { x: 0, y: 0, width: 800, height: 500 };
const small = resolve(null, [tiny]);
assert.deepStrictEqual(small.bounds, tiny);
assert.strictEqual(small.minWidth, 800);
assert.strictEqual(small.minHeight, 500);
for (const bounds of [null, {}, { x: 0, y: 0, width: -1, height: 900 }, { x: '0', y: 0, width: 1200, height: 800 }]) {
  assert.deepStrictEqual(resolve({ bounds, maximized: true }), initial);
}

const normal = { x: 100, y: 80, width: 1100, height: 700 };
assert.deepStrictEqual(captureWindowState({ getNormalBounds: () => normal, isMaximized: () => true }),
  { bounds: normal, maximized: true }, 'Save normal bounds rather than the maximized/full-screen rectangle.');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rinku-window-state-'));
try {
  const file = path.join(root, 'profile/window-state.json');
  assert.strictEqual(readWindowState(file), null);
  saveWindowState(file, saved);
  assert.deepStrictEqual(readWindowState(file), saved);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['window-state.json']);
  fs.writeFileSync(file, '{broken');
  assert.strictEqual(readWindowState(file), null);
  fs.writeFileSync(file, JSON.stringify({ bounds: { width: 'bad' } }));
  assert.strictEqual(readWindowState(file), null);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Window size, display fallback, and persistence checks passed.');
