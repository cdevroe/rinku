const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const electronPath = require('electron');
const {
  archiveLink,
  createLibrary,
  createLink,
  listLinks,
  readSettings,
} = require('../../lib/library');
const { readLinkFile } = require('../../lib/linkFile');

const repoRoot = path.resolve(__dirname, '../..');
const dayMs = 24 * 60 * 60 * 1000;
async function pressShortcut(electronApp, key, shift = false) {
  await electronApp.evaluate(({ BrowserWindow }, { key, shift }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.focus();
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control', ...(shift ? ['shift'] : [])];
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: [] });
  }, { key, shift });
}

function daysAgo(days) {
  return new Date(Date.now() - (days * dayMs)).toISOString();
}

async function makeTempRoot(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function addLink(libraryRoot, input) {
  const result = await createLink(libraryRoot, input, {
    fetchTitle: false,
    learnRule: false,
    rebuildIndex: input.rebuildIndex !== false,
  });
  return result.link;
}

async function seedLibrary() {
  const root = await makeTempRoot('rinku-playwright-library-');
  const libraryRoot = path.join(root, 'Library');
  await createLibrary(libraryRoot);

  const scienceHome = await addLink(libraryRoot, {
    url: 'https://science.example.com/line',
    title: 'Science Home Read',
    label: 'read',
    tags: ['science'],
    contexts: ['@Home'],
    body: 'Initial science notes.',
    createdAt: daysAgo(1),
  });
  const scienceWork = await addLink(libraryRoot, {
    url: 'https://video.example.com/watch',
    title: 'Science Work Watch',
    label: 'watch',
    tags: ['science', 'video'],
    contexts: ['@Work'],
    createdAt: daysAgo(2),
  });
  const cookingHome = await addLink(libraryRoot, {
    url: 'https://recipes.example.com/soup',
    title: 'Cooking Home Read',
    label: 'read',
    tags: ['cooking'],
    contexts: ['@Home'],
    createdAt: daysAgo(3),
  });
  const oldScience = await addLink(libraryRoot, {
    url: 'https://archive.example.com/old',
    title: 'Old Home Science',
    label: 'read',
    tags: ['science'],
    contexts: ['@Home'],
    createdAt: daysAgo(120),
  });
  const archivedScience = await addLink(libraryRoot, {
    url: 'https://archive.example.com/saved',
    title: 'Archived Science Read',
    label: 'read',
    tags: ['science'],
    contexts: ['@Home'],
    createdAt: daysAgo(40),
  });
  await archiveLink(libraryRoot, archivedScience.id);

  return {
    root,
    libraryRoot,
    links: {
      scienceHome,
      scienceWork,
      cookingHome,
      oldScience,
      archivedScience,
    },
  };
}

async function seedIndexedLibrary(total = 10000) {
  const root = await makeTempRoot('rinku-playwright-indexed-library-');
  const libraryRoot = path.join(root, 'Library');
  await createLibrary(libraryRoot);

  const links = Array.from({ length: total }, (_value, index) => ({
    id: `large-${index}`,
    url: `https://large.example.com/${index}`,
    urlHash: `hash-${index}`,
    title: `Large Library Link ${index}`,
    domain: 'large.example.com',
    label: 'unlabeled',
    tags: [index % 2 === 0 ? 'even' : 'odd', `topic-${index % 14}`],
    contexts: index % 3 === 0 ? ['@Home'] : ['@Work'],
    status: 'active',
    createdAt: daysAgo(index % 20),
    updatedAt: daysAgo(index % 20),
    archivedAt: '',
    filePath: path.join(libraryRoot, 'links', 'Unlabeled', `large-${index}.md`),
    fileName: `large-${index}.md`,
  }));

  await fs.mkdir(path.join(libraryRoot, '.rinku'), { recursive: true });
  await fs.writeFile(path.join(libraryRoot, '.rinku', 'index.json'), `${JSON.stringify({
    schemaVersion: 1,
    libraryRoot,
    generatedAt: new Date().toISOString(),
    totals: {
      all: links.length,
      active: links.length,
      archived: 0,
    },
    links,
  }, null, 2)}\n`, 'utf8');

  return { root, libraryRoot };
}

async function launchRinku(options = {}) {
  const userDataDir = await makeTempRoot('rinku-playwright-user-data-');
  const electronApp = await electron.launch({
    executablePath: process.env.RINKU_TEST_EXECUTABLE || electronPath,
    args: process.env.RINKU_TEST_EXECUTABLE ? [] : [repoRoot],
    env: {
      ...process.env,
      RINKU_USER_DATA_DIR: userDataDir,
      RINKU_SKIP_PROTOCOL_REGISTRATION: '1',
    },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  if (options.libraryRoot) {
    await page.evaluate((libraryRoot) => {
      localStorage.setItem('rinku.libraryRoot', libraryRoot);
      window.location.reload();
    }, options.libraryRoot);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#libraryPath')).toHaveText(path.basename(options.libraryRoot));
    await expect(page.locator('#libraryPath')).toHaveAttribute('title', `${options.libraryRoot}\nOpen library settings`);
    await expect(page.locator('#listTitle')).toHaveText('All Links');
  }

  return { electronApp, page, userDataDir };
}

async function cleanup(paths, electronApp) {
  if (electronApp) {
    await electronApp.close().catch(() => {});
  }
  await Promise.all(paths.filter(Boolean).map((targetPath) => (
    fs.rm(targetPath, { recursive: true, force: true })
  )));
}

function filterButton(page, text) {
  return page.locator('.sidebarContent .filterRow').filter({ hasText: text }).first();
}

async function openSidebarChoices(page, key) {
  const disclosure = page.locator(`[data-disclosure="${key}"]`);
  if (!(await disclosure.evaluate((element) => element.open))) {
    await disclosure.locator('summary').click();
  }
}

function rowByTitle(page, title) {
  return page.locator('.linkRow').filter({ hasText: title }).first();
}

async function readCurrentLink(libraryRoot, id) {
  try {
    // A poll can overlap the app moving a file during archive/restore.
    const result = await listLinks(libraryRoot, { rebuild: true });
    const record = result.links.find((link) => link.id === id);
    if (!record) return null;
    return await readLinkFile(record.filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function expectVisibleRows(page, visibleTitles, hiddenTitles = []) {
  for (const title of visibleTitles) {
    await expect(rowByTitle(page, title)).toBeVisible();
  }
  for (const title of hiddenTitles) {
    await expect(rowByTitle(page, title)).toHaveCount(0);
  }
}

test('first run requires a library and settings owns library actions', async () => {
  let app;
  try {
    app = await launchRinku();
    const { page } = app;

    await expect(page.locator('#toolbar')).toHaveClass(/hidden/);
    await expect(page.locator('#listTitle')).toHaveText('Open Rinku');
    await expect(page.getByText('Choose a library to continue')).toBeVisible();
    await expect(page.locator('.firstRunPanel').getByRole('button', { name: /Open/ })).toBeVisible();
    await expect(page.locator('.firstRunPanel').getByRole('button', { name: /Create/ })).toBeVisible();
    await expect(page.locator('.firstRunPanel').getByRole('button', { name: /Import/ })).toBeVisible();

    await page.locator('#settingsButton').click();
    await expect(page.locator('#toolbar')).toHaveClass(/hidden/);
    await expect(page.locator('#listKicker')).toHaveText('Settings');
    await expect(page.locator('#listTitle')).toHaveText('Library');
    await expect(page.getByText('Current Library')).toBeVisible();
    await expect(page.locator('.settingsPage .settingsPathValue')).toHaveText('No library open');
    await expect(page.locator('.settingsPage').getByRole('button', { name: /Open/ })).toBeVisible();
    await expect(page.locator('.settingsPage').getByRole('button', { name: /Create/ })).toBeVisible();
    await expect(page.locator('.settingsPage').getByRole('button', { name: /Import/ })).toBeVisible();

    await filterButton(page, 'MCP').click();
    await expect(page.getByText('Open or create a library to connect your agents to Rinku.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy configuration' })).toHaveCount(0);

    // Appearance is available before opening a library.
    await filterButton(page, 'Appearance').click();
    await expect(page.locator('#listTitle')).toHaveText('Appearance');
    await expect(page.getByRole('radio', { name: 'Auto', exact: true })).toBeChecked();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    await expect(page.locator('.settingsPage')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.getByRole('radio', { name: 'Dark', exact: true }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await expect(page.locator('.settingsPage')).toHaveCSS('background-color', 'rgb(24, 37, 48)');
    await page.screenshot({ path: test.info().outputPath('appearance-dark.png') });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#settingsButton').click();
    await filterButton(page, 'Appearance').click();
    await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();
    await page.getByRole('radio', { name: 'Auto', exact: true }).check();
    await expect.poll(() => app.electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.evaluate(() => localStorage.setItem('rinku.theme', 'invalid-theme'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.locator('#settingsButton').click();
    await filterButton(page, 'Appearance').click();
    await expect(page.getByRole('radio', { name: 'Auto', exact: true })).toBeChecked();
  } finally {
    await cleanup([app && app.userDataDir], app && app.electronApp);
  }
});

test('MCP settings copies a working connection using the app runtime and selected library', async () => {
  const fixture = await seedLibrary();
  let app;
  const clients = [];
  async function connect(config) {
    const client = new Client({ name: 'rinku-settings-test', version: '1.0.0' });
    clients.push(client);
    await client.connect(new StdioClientTransport({
      // AppImage's shell launcher needs standard utilities; the macOS and
      // Windows app binaries can launch with an entirely empty PATH.
      ...config, env: { ...config.env, PATH: process.platform === 'linux' ? '/usr/bin:/bin' : '' }, cwd: fixture.root, stderr: 'pipe',
    }));
    return client;
  }
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page, electronApp } = app;
    await page.locator('#settingsButton').click();
    await filterButton(page, 'MCP').click();
    await expect(page.locator('#listTitle')).toHaveText('MCP');
    const preview = page.getByRole('textbox', { name: 'MCP configuration' });
    const copy = page.getByRole('button', { name: 'Copy configuration', exact: true });
    await expect(copy).toBeEnabled();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copiedMcp = text; } } });
    });
    await copy.click();
    await expect(page.getByText('Configuration copied.', { exact: true })).toBeVisible();
    const copied = await page.evaluate(() => globalThis.__copiedMcp);
    expect(copied).toBe(await preview.inputValue());
    const config = JSON.parse(copied).mcpServers.rinku;
    expect(config.env.RINKU_MCP_ALLOWED_ROOTS).toBe(fixture.libraryRoot);
    expect(config.env.RINKU_MCP_READ_ONLY).toBe('true');
    expect(config.command).toBe(await electronApp.evaluate(() => (
      process.platform === 'linux' && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath
    )));
    const readonly = await connect(config);
    expect((await readonly.listTools()).tools.some(tool => tool.name === 'rinku_list_links')).toBe(true);
    const listed = await readonly.callTool({ name: 'rinku_list_links', arguments: { libraryRoot: fixture.libraryRoot } });
    expect(listed.structuredContent.total).toBe(5);
    const denied = await readonly.callTool({ name: 'rinku_create_link', arguments: { libraryRoot: fixture.libraryRoot, url: 'https://example.com/blocked' } });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain('read-only');
    const outside = await readonly.callTool({ name: 'rinku_list_links', arguments: { libraryRoot: fixture.root } });
    expect(outside.isError).toBe(true);

    await page.getByRole('checkbox', { name: 'Allow agents to save, edit, and archive links' }).check();
    await expect(preview).toHaveValue(/"RINKU_MCP_READ_ONLY": "false"/);
    await copy.click();
    const writable = await connect(JSON.parse(await page.evaluate(() => globalThis.__copiedMcp)).mcpServers.rinku);
    const saved = await writable.callTool({ name: 'rinku_create_link', arguments: { libraryRoot: fixture.libraryRoot, url: 'https://example.com/from-settings', title: 'Saved through MCP' } });
    expect(saved.isError).not.toBe(true);
    expect(saved.structuredContent.title).toBe('Saved through MCP');
    await page.screenshot({ path: test.info().outputPath('mcp-light.png') });
    await page.evaluate(() => window.rinkuTheme.setPreference('dark'));
    await page.screenshot({ path: test.info().outputPath('mcp-dark.png') });

    const otherLibrary = path.join(fixture.root, 'Another Library');
    await createLibrary(otherLibrary);
    await electronApp.evaluate(({ dialog }, libraryRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [libraryRoot] });
    }, otherLibrary);
    await filterButton(page, 'Library').click();
    await page.locator('.settingsPage').getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('#settingsButton').click();
    await filterButton(page, 'MCP').click();
    await expect(preview).toHaveValue(new RegExp('Another Library'));
    const nextConfig = JSON.parse(await preview.inputValue()).mcpServers.rinku;
    expect(nextConfig.env.RINKU_MCP_ALLOWED_ROOTS).toBe(otherLibrary);
    expect(nextConfig.env.RINKU_MCP_READ_ONLY).toBe('true');

    // The copied connection still starts with the desktop app closed.
    await electronApp.close();
    app.electronApp = null;
    const independent = await connect(nextConfig);
    const libraries = await independent.callTool({ name: 'rinku_list_libraries', arguments: {} });
    expect(JSON.stringify(libraries.structuredContent)).toContain(otherLibrary);
  } finally {
    for (const client of clients) await client.close();
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('MCP changes appear automatically and preserve filters and editors', async () => {
  const fixture = await seedLibrary();
  let app;
  const client = new Client({ name: 'rinku-live-library-test', version: '1.0.0' });
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page, electronApp } = app;
    const config = await page.evaluate(() => window.rinku.mcpConfig(true));
    await client.connect(new StdioClientTransport({ ...config.mcpServers.rinku, stderr: 'pipe' }));
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: { libraryRoot: fixture.libraryRoot, ...args } });
      expect(result.isError).not.toBe(true);
      return result.structuredContent;
    };
    await page.locator('#search').fill('science');
    await rowByTitle(page, 'Science Home Read').getByLabel('Info', { exact: true }).click();
    await page.locator('#detailBody').fill('Keep these notes while MCP saves.');
    const added = await call('rinku_create_link', { url: 'https://example.com/live-mcp', title: 'Science from MCP', tags: ['new-tag'] });
    await expect(rowByTitle(page, 'Science from MCP')).toBeVisible();
    await expect(page.locator('#search')).toHaveValue('science');
    await expect(page.locator('#detailTitle')).toHaveText('Science Home Read');
    await expect(page.locator('#detailBody')).toHaveValue('Keep these notes while MCP saves.');
    await expect(rowByTitle(page, 'Cooking Home Read')).toHaveCount(0);
    await expect(page.locator('#captureReviewModal')).toHaveClass(/hidden/);
    await call('rinku_update_link', { ref: added.id, title: 'Science updated by MCP' });
    await expect(rowByTitle(page, 'Science updated by MCP')).toBeVisible();
    await call('rinku_archive_link', { ref: added.id });
    await expect(rowByTitle(page, 'Science updated by MCP')).toHaveCount(0);
    await call('rinku_restore_link', { ref: added.id });
    await expect(rowByTitle(page, 'Science updated by MCP')).toBeVisible();

    // A refresh must not replace unsaved organization settings.
    await page.locator('#settingsButton').click();
    await filterButton(page, 'Organization').click();
    const nameInput = page.locator('[data-label-id="read"] [data-label-name-input="true"]');
    await nameInput.fill('Unsaved label name');
    const whileEditing = await call('rinku_create_link', { url: 'https://example.com/while-editing', title: 'Science while editing settings' });
    await expect.poll(() => page.evaluate(() => state.indexLinks.some(link => link.title === 'Science while editing settings'))).toBe(true);
    await expect(nameInput).toHaveValue('Unsaved label name');

    // Changing libraries detaches the previous watcher and ignores its events.
    const otherLibrary = path.join(fixture.root, 'Other Library');
    await createLibrary(otherLibrary);
    await electronApp.evaluate(({ dialog }, libraryRoot) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [libraryRoot] });
    }, otherLibrary);
    await filterButton(page, 'Library').click();
    await page.locator('.settingsPage').getByRole('button', { name: 'Open', exact: true }).click();
    await page.locator('#allLinksButton').click();
    await expect(page.locator('#listCount')).toHaveText('0');
    await page.locator('#search').fill('');
    await call('rinku_update_link', { ref: whileEditing.id, title: 'Old library update' });
    await addLink(otherLibrary, { url: 'https://example.com/other-library', title: 'New library link' });
    await expect(rowByTitle(page, 'New library link')).toBeVisible();
    await expect(rowByTitle(page, 'Old library update')).toHaveCount(0);
  } finally {
    await client.close();
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('capture settings guides Safari setup and preserves both bookmarklets', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page, electronApp } = app;
    await page.locator('#settingsButton').click();
    await page.getByRole('button', { name: 'Capture', exact: true }).click();
    if (process.env.RINKU_TEST_EXECUTABLE && process.platform === 'darwin') {
      await expect(page.getByRole('button', { name: 'Enable in Safari' })).toBeEnabled();
      expect((await page.evaluate(() => window.rinku.safariExtensionStatus())).bundled).toBe(true);
    } else if (process.platform === 'darwin') {
      await expect(page.getByRole('button', { name: 'Enable in Safari' })).toBeDisabled();
      await expect(page.getByText('Included in installed macOS builds of Rinku.')).toBeVisible();
    } else {
      await expect(page.locator('[data-capture-safari]')).toBeHidden();
    }
    await electronApp.evaluate(({ ipcMain }) => {
      globalThis.__safariSetupCount = 0;
      globalThis.__safariEnabled = false;
      ipcMain.removeHandler('rinku:safari-extension-status');
      ipcMain.handle('rinku:safari-extension-status', () => ({ supported: true, bundled: true, enabled: globalThis.__safariEnabled }));
      ipcMain.removeHandler('rinku:setup-safari-extension');
      ipcMain.handle('rinku:setup-safari-extension', () => {
        globalThis.__safariSetupCount++;
        globalThis.__safariEnabled = true;
        return { ok: true };
      });
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      globalThis.__copiedBookmarklet = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { globalThis.__copiedBookmarklet = text; } } });
    });
    await expect(page.getByRole('button', { name: 'Enable in Safari' })).toBeEnabled();
    await page.getByRole('button', { name: 'Enable in Safari' }).click();
    await expect.poll(() => electronApp.evaluate(() => globalThis.__safariSetupCount)).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: 'Open Safari Settings' })).toBeEnabled();
    await expect(page.getByText('Enabled in Safari', { exact: true })).toBeVisible();
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('rinku:setup-safari-extension');
      ipcMain.handle('rinku:setup-safari-extension', () => ({ ok: false, error: 'Safari setup unavailable.' }));
    });
    await page.getByRole('button', { name: 'Open Safari Settings' }).click();
    await expect(page.getByText('Safari setup unavailable.', { exact: true })).toBeVisible();
    await expect(page.locator('.captureInstructions')).toContainText('keeping the javascript: prefix');
    await page.getByRole('button', { name: 'Copy Save with Rinku bookmarklet', exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__copiedBookmarklet)).toContain('rinku://capture');
    await page.getByRole('link', { name: 'Save with Rinku', exact: true }).click();
    await expect(page.locator('#listTitle')).toHaveText('Capture');
    await expect(page.getByRole('link', { name: 'Save with Popup' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Start popup capture' }).click();
    await expect(page.getByRole('link', { name: 'Save with Popup' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy Save with Popup bookmarklet' }).click();
    await expect.poll(() => page.evaluate(() => globalThis.__copiedBookmarklet)).toContain('http://127.0.0.1:');
    await page.locator('#linksList').evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: test.info().outputPath('capture-settings.png') });
    await page.getByRole('button', { name: 'Stop popup capture' }).click();
    await expect(page.getByRole('link', { name: 'Save with Popup' })).toHaveCount(0);
  } finally { await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp); }
});

test('signed packaged app can check its Safari extension and open its settings', async () => {
  test.skip(process.platform !== 'darwin' || !process.env.RINKU_TEST_EXECUTABLE || !process.env.RINKU_TEST_SAFARI_SETUP,
    'Opt-in signed macOS release check; opens Safari Settings without enabling the extension.');
  let app;
  try {
    app = await launchRinku();
    const status = await app.page.evaluate(() => window.rinku.safariExtensionStatus());
    expect(status.supported).toBe(true);
    expect(status.bundled).toBe(true);
    expect(status.error).toBeFalsy();
    expect(await app.page.evaluate(() => window.rinku.setupSafariExtension())).toEqual({ ok: true });
  } finally { await cleanup([app && app.userDataDir], app && app.electronApp); }
});

test('Safari capture protocol saves the page title and opens review', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const title = 'C++ & cafés / 日本語 #1';
    const address = 'https://example.com/article?q=a+b&other=hello%20world#part';
    const captureURL = `rinku://capture?url=${encodeURIComponent(address)}&title=${encodeURIComponent(title)}`;
    await app.electronApp.evaluate(({ app }, captureURL) => {
      app.emit('open-url', { preventDefault() {} }, captureURL);
    }, captureURL);
    await expect(app.page.locator('#captureReviewModal')).toBeVisible();
    await expect(app.page.locator('#captureReviewTitle')).toHaveValue(title);
    await expect(app.page.locator('#captureReviewUrl')).toContainText(address);
    const result = await listLinks(fixture.libraryRoot, { rebuild: true });
    const link = result.links.find((link) => link.url === address);
    expect(link).toBeTruthy();
    expect(link.title).toBe(title);
    await app.page.locator('#captureReviewBody').fill('Keep these pending notes.');
    await app.electronApp.evaluate(({ app }, captureURL) => {
      app.emit('open-url', { preventDefault() {} }, captureURL);
    }, captureURL);
    await expect(app.page.locator('#captureReviewNotice')).toHaveText('This link is already saved. You can edit it below.');
    await expect(app.page.locator('#captureReviewBody')).toHaveValue('Keep these pending notes.');
    await app.page.locator('#captureReviewDone').click();
    await expect(app.page.locator('#captureReviewModal')).toBeHidden();
    expect((await listLinks(fixture.libraryRoot, { rebuild: true })).links.length).toBe(result.links.length);
    expect((await readCurrentLink(fixture.libraryRoot, link.id)).body).toBe('Keep these pending notes.');
  } finally { await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp); }
});

test('combines status, label, context, tag, and search filters', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;

    await expect(page.locator('#listCount')).toHaveText('4');
    await expectVisibleRows(page, [
      'Science Home Read',
      'Science Work Watch',
      'Cooking Home Read',
      'Old Home Science',
    ], ['Archived Science Read']);

    await expect(page.locator('#sideTitle')).toHaveClass(/hidden/);
    await expect(page.locator('.statusFilter')).toHaveCount(0);
    await openSidebarChoices(page, 'contexts');
    await expect(page.locator('[data-disclosure="contexts"] .filterChoices').getByRole('button', { name: 'All contexts' })).toHaveCount(0);
    await filterButton(page, '@Home').click();
    await expect(page.locator('[data-disclosure="contexts"]')).not.toHaveAttribute('open');
    await expect(page.locator('[data-disclosure="contexts"] summary')).toHaveText('@Home');
    await expect(page.locator('#listTitle')).toHaveText('@Home');
    await expect(page.locator('#listCount')).toHaveText('3');
    await expectVisibleRows(page, ['Science Home Read', 'Cooking Home Read', 'Old Home Science'], ['Science Work Watch']);

    await openSidebarChoices(page, 'contexts');
    const contextChoices = page.locator('[data-disclosure="contexts"] .filterChoices');
    await expect(contextChoices.getByRole('button', { name: /@Home/ })).toHaveCount(0);
    await contextChoices.getByRole('button', { name: 'All contexts' }).click();
    await expect(page.locator('#listCount')).toHaveText('4');
    await expect(page.locator('[data-disclosure="contexts"] summary')).toHaveText('All contexts');
    await openSidebarChoices(page, 'contexts');
    await filterButton(page, '@Home').click();

    await filterButton(page, 'Read').click();
    await expect(page.locator('#listTitle')).toHaveText('Filtered Links');
    await expect(page.locator('#listCount')).toHaveText('3');

    await openSidebarChoices(page, 'tags');
    await expect(filterButton(page, 'science').locator('.filterMain > span')).toHaveText('science');
    await filterButton(page, 'science').click();
    await expect(page.locator('#listCount')).toHaveText('2');
    await expectVisibleRows(page, ['Science Home Read', 'Old Home Science'], ['Cooking Home Read', 'Science Work Watch']);

    await page.locator('#search').fill('Old');
    await expect(page.locator('#listCount')).toHaveText('1');
    await expectVisibleRows(page, ['Old Home Science'], ['Science Home Read']);

    await page.getByRole('button', { name: 'Clear' }).click();
    await page.locator('#search').fill('');
    await openSidebarChoices(page, 'links');
    await expect(page.locator('[data-disclosure="links"] .filterChoices .filterRow')).toHaveCount(1);
    await expect(page.locator('[data-disclosure="links"] .filterChoices')).toContainText('Archive');
    await filterButton(page, 'Archive').click();
    await expect(page.locator('#listTitle')).toHaveText('Archive');
    await expect(page.locator('#listCount')).toHaveText('1');
    await expectVisibleRows(page, ['Archived Science Read'], ['Science Home Read']);
    await expect(page.locator('[data-disclosure="links"] summary')).toContainText('Archive');
    await openSidebarChoices(page, 'links');
    await expect(page.locator('[data-disclosure="links"] .filterChoices .filterRow')).toHaveCount(1);
    await expect(page.locator('[data-disclosure="links"] .filterChoices')).toContainText('Active links');
    await filterButton(page, 'Active links').click();
    await expect(page.locator('#listCount')).toHaveText('4');
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('autosaves detail edits for labels, contexts, tags, and notes', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;
    const row = rowByTitle(page, 'Science Home Read');

    await row.getByLabel('Info', { exact: true }).click();
    await expect(page.locator('#detailPane')).not.toHaveClass(/hidden/);
    await expect(page.locator('#detailTitle')).toHaveText('Science Home Read');

    await page.locator('#detailLabel').getByLabel('Do').click();
    await page.locator('#detailContexts label').filter({ hasText: '@Work' }).locator('input').check();
    await page.locator('#detailTags').getByLabel('Remove science').click();
    await page.locator('#detailTags').getByLabel('Add tag').fill('analysis');
    await page.locator('#detailTags').getByLabel('Add tag').press('Enter');
    await page.locator('#detailBody').fill('Updated notes from Playwright.');

    await expect.poll(async () => {
      const link = await readCurrentLink(fixture.libraryRoot, fixture.links.scienceHome.id);
      if (!link) return null;
      return {
        label: link.label,
        contexts: link.contexts,
        tags: link.tags,
        body: link.body,
      };
    }).toEqual({
      label: 'do',
      contexts: ['@Home', '@Work'],
      tags: ['analysis'],
      body: 'Updated notes from Playwright.',
    });
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('rows open URLs while circle and info controls act independently', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { electronApp, page } = app;

    await electronApp.evaluate(({ shell }) => {
      globalThis.__rinkuOpenedExternal = '';
      globalThis.__rinkuOpenCount = 0;
      shell.openExternal = async (target) => {
        globalThis.__rinkuOpenCount += 1;
        globalThis.__rinkuOpenedExternal = target;
        return true;
      };
    });

    const activeRow = rowByTitle(page, 'Cooking Home Read');
    const archiveToggle = activeRow.getByLabel('Archive', { exact: true });
    await page.mouse.move(0, 0);
    await expect(archiveToggle).toBeVisible();
    await expect(archiveToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(archiveToggle.locator('.icon')).toHaveCSS('opacity', '0');
    await archiveToggle.hover();
    await expect(archiveToggle.locator('.icon')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: test.info().outputPath('archive-circle-hover.png') });
    await expect(activeRow.getByLabel('Open', { exact: true })).toHaveCount(0);
    // Blank space, including the label corner, opens the same URL as the title.
    const bounds = await activeRow.boundingBox();
    await activeRow.click({ position: { x: bounds.width - 5, y: 5 } });
    await expect.poll(() => electronApp.evaluate(() => globalThis.__rinkuOpenCount)).toBe(1);
    await activeRow.locator('.linkRowMain').click();
    await expect.poll(() => electronApp.evaluate(() => globalThis.__rinkuOpenedExternal))
      .toBe('https://recipes.example.com/soup');
    await expect.poll(() => electronApp.evaluate(() => globalThis.__rinkuOpenCount)).toBe(2);
    await expect(page.locator('#detailPane')).toBeHidden();

    await activeRow.getByLabel('Info', { exact: true }).click();
    await expect(page.locator('#detailTitle')).toHaveText('Cooking Home Read');
    await expect(page.locator('#detailPane')).toBeVisible();
    await page.evaluate(() => window.rinkuTheme.setPreference('dark'));
    await expect(activeRow).toHaveCSS('background-color', 'rgb(41, 59, 71)');
    await expect(page.locator('#detailPane')).toHaveCSS('background-color', 'rgb(29, 45, 58)');
    await page.screenshot({ path: test.info().outputPath('links-and-details-dark.png') });
    await expect(page.locator('#detailPane').getByRole('button', { name: /^(Open|Archive|Restore)$/ })).toHaveCount(0);
    expect(await electronApp.evaluate(() => globalThis.__rinkuOpenCount)).toBe(2);
    await page.locator('#detailClose').click();

    await activeRow.hover();
    await activeRow.getByLabel('Archive').click();
    await expect.poll(async () => {
      const link = await readCurrentLink(fixture.libraryRoot, fixture.links.cookingHome.id);
      return link && link.status;
    }).toBe('archived');
    await expect(rowByTitle(page, 'Cooking Home Read')).toHaveCount(0);
    expect(await electronApp.evaluate(() => globalThis.__rinkuOpenCount)).toBe(2);

    await openSidebarChoices(page, 'links');
    await filterButton(page, 'Archive').click();
    const archivedRow = rowByTitle(page, 'Cooking Home Read');
    await expect(archivedRow).toBeVisible();
    await page.mouse.move(0, 0);
    const restoreToggle = archivedRow.getByLabel('Restore', { exact: true });
    await expect(restoreToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(restoreToggle.locator('.icon')).toHaveCSS('opacity', '1');
    await restoreToggle.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => {
      const link = await readCurrentLink(fixture.libraryRoot, fixture.links.cookingHome.id);
      return link && link.status;
    }).toBe('active');
    expect(await electronApp.evaluate(() => globalThis.__rinkuOpenCount)).toBe(2);
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('settings can rename labels, add labels, and edit default contexts', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;

    await page.locator('#libraryPath').click();
    await expect(page.locator('#listTitle')).toHaveText('Library');
    await filterButton(page, 'Organization').click();
    await expect(page.locator('#listTitle')).toHaveText('Organization');

    await page.locator('[data-label-id="read"] [data-label-name-input="true"]').fill('Articles');
    await page.locator('[data-new-label-name="true"]').fill('Queue');
    await page.locator('[data-new-context="true"]').fill('@Studio');
    await page.getByRole('button', { name: /Save settings/ }).click();

    await expect.poll(async () => {
      const settings = await readSettings(fixture.libraryRoot);
      return {
        readName: settings.labels.find((label) => label.id === 'read').name,
        hasQueue: settings.labels.some((label) => label.id === 'queue' && label.name === 'Queue'),
        contexts: settings.contexts,
      };
    }).toEqual({
      readName: 'Articles',
      hasQueue: true,
      contexts: ['@Home', '@Work', '@Studio'],
    });

    await page.locator('#allLinksButton').click();
    await expect(filterButton(page, 'Articles')).toBeVisible();
    await expect(filterButton(page, 'Queue')).toBeVisible();
    await openSidebarChoices(page, 'contexts');
    await expect(filterButton(page, '@Studio')).toBeVisible();
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('quick add saves immediately and opens the capture review modal', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;

    await expect(page.locator('#quickAddUrl')).toBeHidden();
    await expect(page.locator('#quickAddTitle, #quickAddLabel')).toHaveCount(0);
    await page.locator('#quickAddSubmit').click();
    await expect(page.locator('#quickAddUrl')).toBeFocused();
    await page.locator('#quickAddUrl').press('Escape');
    await expect(page.locator('#quickAddUrl')).toBeHidden();
    await page.locator('#quickAddSubmit').click();
    await page.locator('#quickAddUrl').fill('https://quick.example.com/article');
    await page.locator('#quickAddSubmit').click();

    await expect(page.locator('#captureReviewModal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#quickAddUrl')).toBeHidden();
    await page.locator('#captureReviewTitle').fill('Quick Add Review');
    await page.locator('#captureReviewLabel').getByLabel('Watch').click();
    await page.locator('#captureReviewContexts label').filter({ hasText: '@Work' }).locator('input').check();
    await page.locator('#captureReviewTags').getByLabel('Add tag').fill('queued');
    await page.locator('#captureReviewTags').getByLabel('Add tag').press('Enter');
    await page.locator('#captureReviewBody').fill('Review notes from quick add.');
    await page.locator('#captureReviewDone').click();
    await expect(page.locator('#captureReviewModal')).toHaveClass(/hidden/);

    await expect.poll(async () => {
      const result = await listLinks(fixture.libraryRoot, { search: 'Quick Add Review', status: 'active' });
      const link = result.links[0] && await readCurrentLink(fixture.libraryRoot, result.links[0].id);
      return link && {
        title: link.title,
        label: link.label,
        contexts: link.contexts,
        tags: link.tags,
        body: link.body,
      };
    }).toEqual({
      title: 'Quick Add Review',
      label: 'watch',
      contexts: ['@Work'],
      tags: ['queued'],
      body: 'Review notes from quick add.',
    });

    const before = await listLinks(fixture.libraryRoot, { rebuild: true });
    const saved = before.links.find((link) => link.url === 'https://quick.example.com/article');
    await page.locator('#quickAddSubmit').click();
    await page.locator('#quickAddUrl').fill(saved.url);
    await page.locator('#quickAddSubmit').click();
    await expect(page.locator('#captureReviewModal')).toBeVisible();
    await expect(page.locator('#captureReviewNotice')).toHaveText('This link is already saved. You can edit it below.');
    await expect(page.locator('#captureReviewTitle')).toHaveValue('Quick Add Review');
    await expect(page.locator('#captureReviewBody')).toHaveValue('Review notes from quick add.');
    await expect(page.locator('#captureReviewLabel').getByLabel('Watch')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#captureReviewTags')).toContainText('queued');
    await page.locator('#captureReviewBody').fill('Edited the existing link.');
    await page.locator('#captureReviewDone').click();
    await expect.poll(async () => (await readCurrentLink(fixture.libraryRoot, saved.id)).body).toBe('Edited the existing link.');
    expect((await listLinks(fixture.libraryRoot, { rebuild: true })).links.length).toBe(before.links.length);

    await rowByTitle(page, 'Quick Add Review').getByLabel('Archive', { exact: true }).click();
    await expect(rowByTitle(page, 'Quick Add Review')).toHaveCount(0);
    await page.locator('#quickAddSubmit').click();
    await page.locator('#quickAddUrl').fill(saved.url);
    await page.locator('#quickAddSubmit').click();
    await expect(page.locator('#captureReviewNotice')).toHaveText('This link is already in your archive. You can edit it below.');
    await expect(page.locator('#captureReviewBody')).toHaveValue('Edited the existing link.');
    await page.locator('#captureReviewDone').click();
    await expect(page.locator('#captureReviewModal')).toBeHidden();
    expect((await readCurrentLink(fixture.libraryRoot, saved.id)).status).toBe('archived');
    expect((await listLinks(fixture.libraryRoot, { rebuild: true })).links.length).toBe(before.links.length);
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('large libraries virtualize rows and keep view changes responsive', async () => {
  test.setTimeout(90_000);
  const fixture = await seedIndexedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;

    await expect(page.locator('#listCount')).toHaveText('10,000');
    await expect(filterButton(page, 'Unlabeled')).toContainText('10,000');
    await expect(page.locator('[data-disclosure="tags"]')).not.toHaveAttribute('open');
    await page.screenshot({ path: test.info().outputPath('sidebar-collapsed.png') });
    await openSidebarChoices(page, 'tags');
    await expect(page.locator('[data-disclosure="tags"] .filterRow')).toHaveCount(10);
    await expect(page.locator('[data-disclosure="tags"] .filterRow').first()).toContainText('even');
    await openSidebarChoices(page, 'links');
    await page.locator('#quickAddSubmit').click();
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 620));
    await page.screenshot({ path: test.info().outputPath('sidebar-expanded-narrow.png') });
    const overflowing = await page.locator('.toolbar, .filterDisclosure summary, [data-disclosure="links"] .filterName > span').evaluateAll((elements) => (
      elements.filter((element) => element.scrollWidth > element.clientWidth + 1).map((element) => element.textContent)
    ));
    expect(overflowing).toEqual([]);
    await page.locator('#quickAddUrl').press('Escape');
    await page.locator('[data-disclosure="links"] summary').click();
    await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 760));

    const initialRows = await page.locator('.linkRow').count();
    await page.evaluate(() => window.rinkuTheme.setPreference('dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: test.info().outputPath('dark-list.png') });
    expect(initialRows).toBeGreaterThan(0);
    expect(initialRows).toBeLessThan(80);
    await expect(page.locator('.linksVirtualizer')).toHaveAttribute('data-total-rows', '10000');
    const configuredHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--link-row-height')));
    const rowHeight = (await page.locator('.linkRow').first().boundingBox()).height;
    expect(rowHeight).toBe(configuredHeight);
    await expect(page.locator('.linksVirtualizer')).toHaveCSS('height', `${10000 * rowHeight}px`);

    const settingsStartedAt = Date.now();
    await page.locator('#settingsButton').click();
    await expect(page.locator('#listTitle')).toHaveText('Library');
    expect(Date.now() - settingsStartedAt).toBeLessThan(1000);

    const linksStartedAt = Date.now();
    await page.locator('#allLinksButton').click();
    await expect(page.locator('#listTitle')).toHaveText('All Links');
    expect(Date.now() - linksStartedAt).toBeLessThan(1000);

    await page.locator('#linksList').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(rowByTitle(page, 'Large Library Link 9999')).toBeVisible();
    expect(await page.locator('.linkRow').count()).toBeLessThan(80);

    const searchStartedAt = Date.now();
    await page.locator('#search').fill('9999');
    await expect(page.locator('#listCount')).toHaveText('1');
    await expect(page.locator('[data-disclosure="tags"]')).toHaveAttribute('open');
    expect(Date.now() - searchStartedAt).toBeLessThan(1000);
    await expect(rowByTitle(page, 'Large Library Link 9999')).toBeVisible();
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('keyboard shortcuts navigate, filter, edit, and open links', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page, electronApp } = app;
    await electronApp.evaluate(({ shell }) => {
      globalThis.__rinkuOpenedExternal = '';
      shell.openExternal = async (url) => { globalThis.__rinkuOpenedExternal = url; };
    });
    await pressShortcut(app.electronApp, 'N');
    await expect(page.locator('#quickAddUrl')).toBeFocused();
    await page.keyboard.press('Escape');
    await pressShortcut(app.electronApp, 'F');
    await expect(page.locator('#search')).toBeFocused();
    await page.keyboard.type('Science Home Read');
    await expect(page.locator('#listCount')).toHaveText('1');
    await page.keyboard.press('ArrowDown');
    await expect(rowByTitle(page, 'Science Home Read').locator('.linkRowMain')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => electronApp.evaluate(() => globalThis.__rinkuOpenedExternal)).toBe(fixture.links.scienceHome.url);
    await expect(page.locator('#detailPane')).toBeHidden();
    await page.keyboard.press('i');
    await expect(page.locator('#detailClose')).toBeFocused();
    await page.locator('#detailBody').fill('Saved when closing with Escape.');
    await page.keyboard.press('Escape');
    await expect(page.locator('#detailPane')).toHaveClass(/hidden/);
    await expect(rowByTitle(page, 'Science Home Read').locator('.linkRowMain')).toBeFocused();
    expect((await readCurrentLink(fixture.libraryRoot, fixture.links.scienceHome.id)).body).toBe('Saved when closing with Escape.');
    await page.keyboard.press('o');
    await expect.poll(() => electronApp.evaluate(() => globalThis.__rinkuOpenedExternal)).toBe(fixture.links.scienceHome.url);
    await pressShortcut(app.electronApp, '1');
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#listCount')).toHaveText('4');
    await pressShortcut(app.electronApp, 'L', true);
    await expect(filterButton(page, 'Read')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(filterButton(page, 'Watch')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#listCount')).toHaveText('1');
    await expect(filterButton(page, 'Watch')).toBeFocused();
    await expect(filterButton(page, 'Watch')).toHaveAttribute('aria-pressed', 'true');
    await pressShortcut(app.electronApp, '1');
    await pressShortcut(app.electronApp, 'C', true);
    await expect(filterButton(page, '@Home')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#listTitle')).toHaveText('@Work');
    await pressShortcut(app.electronApp, '1');
    await pressShortcut(app.electronApp, 'T', true);
    await expect(filterButton(page, 'science')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#listCount')).toHaveText('3');
    await pressShortcut(app.electronApp, '1');
    await pressShortcut(app.electronApp, 'A', true);
    await expect(page.locator('#listTitle')).toHaveText('Archive');
    await pressShortcut(app.electronApp, 'E', true);
    await expect(page.locator('#listCount')).toHaveText('0');
    await pressShortcut(app.electronApp, '1');
    await expect(page.locator('#listCount')).toHaveText('5');
    await pressShortcut(app.electronApp, 'I');
    await expect(page.locator('#detailClose')).toBeFocused();
    await page.locator('#detailBody').fill('Line one');
    await page.locator('#detailBody').press('Enter');
    await page.keyboard.type('Line two');
    await expect(page.locator('#detailBody')).toHaveValue('Line one\nLine two');
    await pressShortcut(app.electronApp, 'F');
    await page.keyboard.type('oie');
    await expect(page.locator('#search')).toHaveValue('oie');
    await pressShortcut(app.electronApp, '/');
    await expect(page.locator('#shortcutsDialog')).toBeVisible();
    await expect(page.locator('#shortcutsButton')).toHaveCount(0);
    await expect(page.locator('#shortcutsContent h3')).toHaveText(['Navigation', 'Filters and views', 'Link actions', 'Capture and editing', 'General']);
    await expect(page.locator('#shortcutsContent').getByRole('rowheader', { name: 'Close panel or menu' })).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('keyboard-shortcuts.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('#search')).toBeFocused();
    await electronApp.evaluate(({ Menu, BrowserWindow }) => {
      const item = Menu.getApplicationMenu().getMenuItemById('shortcuts');
      item.click(item, BrowserWindow.getAllWindows()[0]);
    });
    await expect(page.locator('#shortcutsDialog')).toBeVisible();
    await page.getByRole('button', { name: 'Close keyboard shortcuts' }).click();
    await pressShortcut(app.electronApp, ',');
    await expect(page.locator('#listTitle')).toHaveText('Library');
    await pressShortcut(app.electronApp, 'L');
    await expect(page.locator('#listTitle')).toHaveText('All Links');
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('tag delimiters retain focus and modal keyboard focus stays contained', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;
    await rowByTitle(page, 'Science Home Read').getByLabel('Info', { exact: true }).click();
    const detailInput = page.locator('#detailTags').getByLabel('Add tag');
    await detailInput.focus();
    await page.keyboard.type('first,second,third');
    await page.keyboard.press('Enter');
    await expect(detailInput).toBeFocused();
    await expect(page.locator('#detailTags .tagPill')).toHaveCount(4);
    await page.keyboard.press('Backspace');
    await expect(detailInput).toBeFocused();
    await expect(page.locator('#detailTags .tagPill')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('#detailPane')).toBeHidden();
    expect((await readCurrentLink(fixture.libraryRoot, fixture.links.scienceHome.id)).tags).toEqual(['science', 'first', 'second']);
    await pressShortcut(app.electronApp, 'N');
    await expect(page.locator('#quickAddUrl')).toBeFocused();
    await page.keyboard.type('https://keyboard.example.com/article');
    await page.keyboard.press('Enter');
    await expect(page.locator('#captureReviewModal')).toBeVisible();
    await expect(page.locator('#captureReviewModal')).toHaveAttribute('open');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#captureReviewDone')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#captureReviewBody')).toBeFocused();
    const reviewInput = page.locator('#captureReviewTags').getByLabel('Add tag');
    await reviewInput.focus();
    await page.keyboard.type('alpha,beta,gamma');
    await page.keyboard.press('Enter');
    await expect(reviewInput).toBeFocused();
    await expect(page.locator('#captureReviewTags .tagPill')).toHaveCount(3);
    await page.keyboard.type('draft');
    await page.keyboard.press('Escape');
    await expect(page.locator('#captureReviewModal')).toBeHidden();
    const result = await listLinks(fixture.libraryRoot);
    const added = result.links.find((link) => link.url === 'https://keyboard.example.com/article');
    expect(added.tags).toEqual(['alpha', 'beta', 'gamma', 'draft']);
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('keyboard navigation crosses virtualized windows without losing focus', async () => {
  const fixture = await seedIndexedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page } = app;
    await pressShortcut(app.electronApp, 'L');
    await expect(rowByTitle(page, 'Large Library Link 0').locator('.linkRowMain')).toBeFocused();
    await page.keyboard.press('End');
    await expect(rowByTitle(page, 'Large Library Link 9999').locator('.linkRowMain')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(rowByTitle(page, 'Large Library Link 9998').locator('.linkRowMain')).toBeFocused();
    await page.keyboard.press('Home');
    await page.keyboard.press('PageDown');
    expect(await page.locator('.linkRowMain:focus').evaluate((element) => Number(element.closest('.linkRow').dataset.id.split('-')[1]))).toBeGreaterThan(0);
    await page.keyboard.press('PageUp');
    await expect(rowByTitle(page, 'Large Library Link 0').locator('.linkRowMain')).toBeFocused();
    await expect(rowByTitle(page, 'Large Library Link 0')).toHaveAttribute('aria-setsize', '10000');
    expect(await page.locator('.linkRow').count()).toBeLessThan(80);
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});

test('native Paste and Match Style menu action reaches the URL field', async () => {
  const fixture = await seedLibrary();
  let app;
  try {
    app = await launchRinku({ libraryRoot: fixture.libraryRoot });
    const { page, electronApp } = app;
    await pressShortcut(app.electronApp, 'N');
    await expect(page.locator('#quickAddUrl')).toBeFocused();
    const role = await electronApp.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.getApplicationMenu();
      const edit = menu.items.find((item) => item.label === 'Edit');
      const paste = edit.submenu.items.find((item) => item.role?.toLowerCase() === 'pasteandmatchstyle');
      const window = BrowserWindow.getAllWindows()[0];
      // Exercise the native role route without replacing the user's clipboard.
      window.webContents.pasteAndMatchStyle = () => window.webContents.insertText('https://paste.example.com/article');
      if (process.platform !== 'darwin') paste.click({}, window, window.webContents);
      return { role: paste.role, label: paste.label };
    });
    expect(role.role.toLowerCase()).toBe('pasteandmatchstyle');
    expect(role.label).toMatch(/Paste and Match Style/i);
    if (process.platform === 'darwin') await pressShortcut(electronApp, 'V');
    await expect(page.locator('#quickAddUrl')).toHaveValue('https://paste.example.com/article');
  } finally {
    await cleanup([fixture.root, app && app.userDataDir], app && app.electronApp);
  }
});
