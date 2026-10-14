# Rinku

Rinku is a local-first Electron/plain JavaScript app for saving, organizing, and revisiting links. It is designed around user-owned libraries on disk rather than a hosted account or remote database.

## Current Status

This repository is an early working foundation. It includes:

- A Markdown library storage engine.
- An Electron desktop shell.
- A CLI.
- An MCP server using the official SDK and stdio transport.
- A versioned local HTTP API with token authentication and an OpenAPI description.
- An Unmark JSON importer.
- App URL-scheme capture and an optional localhost popup/API capture endpoint.
- Core tests for storage, import, CLI, MCP, API, and capture behavior.

Use Node.js 18 or later for the CLI, API, and MCP server. Install dependencies before launching the desktop app:

```sh
npm install
npm start
```

Run the test suite without Electron dependencies:

```sh
npm test
```

Run the Electron UI coverage with Playwright:

```sh
npm run test:playwright
```

Run both suites:

```sh
npm run test:all
```

## API and MCP

Start a read-only HTTP API for a library:

```sh
npm run api:server -- --library /absolute/path/to/Library
```

Add `--write` to allow changes. The server prints its local URL and bearer token at startup. See [HTTP API setup, routes, and examples](docs/api.md).

Connect an MCP client using `node /absolute/path/to/rinku/bin/rinku.js mcp serve` with `RINKU_MCP_ALLOWED_ROOTS` set to your library path. MCP is read-only by default; set `RINKU_MCP_READ_ONLY=false` to enable writes. See [MCP client configuration and tools](docs/cli-mcp.md#mcp).

## Keyboard Controls

Open **Help > Keyboard Shortcuts** for the categorized in-app reference. Use Command on macOS and Control on Windows/Linux:

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl + N | Add a link and focus its URL field |
| Cmd/Ctrl + F | Search links |
| Cmd/Ctrl + L | Focus the link list |
| Cmd/Ctrl + 1 | Return to all active links and clear search and filters |
| Cmd/Ctrl + Shift + A | Switch between active links and archive |
| Cmd/Ctrl + Shift + L / C / T | Focus label, context, or tag filters |
| Cmd/Ctrl + I | Open the focused link's information panel |
| Enter (in the link list) | Open the focused link in the browser |
| Cmd/Ctrl + Shift + E | Archive or restore the focused link |
| Cmd/Ctrl + , | Library settings |
| Cmd/Ctrl + / | Keyboard shortcut reference |

Click a link row to open it in your browser, the circle on its left to archive or restore it, or its info button to edit its details. In the link list, Up/Down, Home/End, and Page Up/Page Down move focus through the entire library. Enter or O opens the link, I shows information, and E archives or restores it. These shortcuts only apply while the list has focus, so typing in an editor remains normal.

Sidebar controls support arrow keys and Enter/Space. Right expands a switcher; Left or Escape collapses it. F6 and Shift+F6 move between the sidebar, link list, information panel, and search. From search, Down moves into the results; Escape clears the search and returns to the list.

Comma or Enter completes a tag and keeps focus in the tag field. Escape closes the information panel or capture review after saving pending edits. Dialogs contain keyboard focus and return it when closed. macOS supports both Paste and Paste and Match Style, including Command+V remappings.

## Safari Extension

Installed macOS builds include the Rinku Safari extension. No separate extension download or popup server is needed.

1. Install Rinku in Applications and open or create a library.
2. In **Settings > Capture**, click **Enable in Safari**.
3. In **Safari > Settings > Extensions**, enable **Rinku**. Allow website access when Safari asks.
4. Visit a webpage and click **Save with Rinku** in Safari's toolbar, or right-click the page and choose **Save Page to Rinku**.

The extension saves the current page's URL and title to the library open in Rinku, then opens the saved-link editing dialog. It can launch its containing Rinku app if it isn't running. If you haven't selected a library yet, Rinku asks you to select one before saving. It does not inject scripts into webpages. Safari's website-access permissions still apply to reading the page URL and title. Private browsing requires separately allowing the extension in Safari.

If the toolbar button isn't visible, use Safari's **View > Customize Toolbar** to add it. When returning to Capture settings, Rinku checks whether the extension is enabled. **Open Safari Settings** lets you change its permissions later.

The extension is available in packaged macOS apps; `npm start` does not install it in Safari.

## Browser Bookmarklets

Both bookmarklets remain available in **Settings > Capture** for Safari and other browsers:

1. Click **Copy** next to **Save with Rinku**. For **Save with Popup**, click **Start popup capture** first, then its **Copy** button.
2. Create a bookmark in your browser's bookmarks bar, named after the method you chose.
3. Edit the bookmark's URL/address and paste the copied text, preserving the `javascript:` prefix.
4. Visit a webpage and click that bookmark to save it. Do not click the bookmarklet inside Rinku itself.

**Save with Rinku** brings the app forward and opens the saved link for editing. Allow the browser to open Rinku if prompted. **Save with Popup** opens the editing page in a small browser window; Rinku must remain running with popup capture enabled. Enabling popup capture is remembered for the current library and starts again when you reopen that library. If its local port changes, recopy the popup bookmarklet.

## macOS Share Sheet Capture

Rinku can receive links from the macOS Share Sheet through a Shortcut that opens the app URL scheme.

1. Open Rinku with `npm start`.
2. Open or create a Rinku library in the app.
3. Open the macOS Shortcuts app and create a shortcut named `Send to Rinku`.
4. In the shortcut details, enable `Show in Share Sheet`.
5. Set the shortcut to receive `Safari Web Pages` and `URLs` from `Share Sheet`.
6. Add these actions in order:
   - `Get URLs from Shortcut Input`
   - `Get First Item from URLs`
   - `URL Encode Item from List`
   - `Text` with `rinku://capture?url=[URL Encoded Text]`
   - `Open URLs` with the `Text` value
7. In macOS, open `System Settings > General > Login Items & Extensions` and make sure `Shortcuts` is enabled under Extensions.
8. In Safari, use the Share button and choose `Send to Rinku`.

The link is saved immediately. If the Share Sheet does not pass a title, Rinku fetches the page title and then opens the quick-edit modal for labels, contexts, tags, and notes.

## Adding Links on Windows and Linux

Rinku supports the same `rinku://capture` URL scheme on packaged Windows and Linux builds. Any browser, launcher, script, or desktop integration that can open a URL can save a link with:

```text
rinku://capture?url=https%3A%2F%2Fexample.com%2Farticle
```

Recommended options:

- **Browser bookmarklet:** In Rinku, open `Settings > Capture`, copy `Save with Rinku`, and save it as a browser bookmark. This works anywhere the browser allows JavaScript bookmarks.
- **Local popup capture:** In `Settings > Capture`, start the popup server and use `Save with Popup`. This uses `http://127.0.0.1:<port>/capture` and shows the browser-side quick edit page after saving.
- **CLI:** Use `rinku links add <url> --library <path>` from scripts or terminal launchers.
- **Windows shortcuts:** Create a `.url` or browser favorite whose URL is the `rinku://capture?...` link. Browser extensions or PowerShell scripts can also call `Start-Process "rinku://capture?url=..."`.
- **Linux desktop launchers:** Create a `.desktop` action or script that calls `xdg-open "rinku://capture?url=..."`.

The app URL scheme and local popup endpoint both save immediately and then provide a way to edit label, contexts, tags, and notes.

## Distribution Builds

Rinku uses `electron-builder`, with GitHub Releases metadata for updates.

```sh
# macOS universal dmg/zip
npm run dist:mac

# Windows NSIS installer
npm run dist:win

# Linux AppImage/deb for x64 and ARM64
npm run dist:linux

# Build the full public matrix
npm run dist:all

# Verify release assets and updater metadata
npm run release:verify
```

Notes:

- Local build scripts use `--publish never`; publish release artifacts manually or through your release automation.
- Standard public downloads are macOS universal, one Windows installer, and Linux `AppImage`/`deb` builds for `x64` and ARM64.
- GitHub release metadata powers auto-updates through `electron-updater`.
- Copy `.env-sample` to `.env` and fill in signing/notarization credentials for signed macOS builds. An existing Developer ID Application certificate can also sign Rinku. See [macOS signing and notarization](docs/macos-signing.md) for setup and verification.
- Set `RINKU_SKIP_NOTARIZATION=1` for local macOS packaging that should skip notarization.
- macOS packaging builds the Safari extension and native setup bridge automatically before code signing. Install Xcode or Apple's Command Line Tools; the native Objective-C sources are in `safari/`. The extension is embedded in `Rinku.app/Contents/PlugIns`, and uses its own Sandbox entitlements rather than Electron's entitlements. The Node-API bridge runs SafariServices calls inside Rinku's main process so Safari recognizes the extension's containing app. Both are signed with the same identity as Rinku and included in the app's notarization. Windows/Linux builds do not include them.
- `npm run build:safari` builds standalone universal native artifacts under `build/safari/` for inspection. `npm run test:safari` checks the native capture URL encoding, universal binaries, bundle signing, and setup bridge. Distribution through Safari requires a Developer ID-signed and notarized macOS app; an ad-hoc local build is only suitable for development.

## Current Product Decisions

- Rinku supports multiple libraries.
- Each library stores active links under `links/` and archived links under `archive/`.
- Labels are folder-based: `links/<label>/` for active links and `archive/<label>/` for archived links.
- Each link has one label.
- Each link can have multiple contexts.
- Learned label rules are enabled by default and must be configurable.
- Packaged macOS builds include optional Safari capture.
- The `rinku://capture` app URL scheme is the easiest browser capture path.
- The local HTTP capture endpoint is optional, local-only, and controlled from Settings.

## Documentation

- [Product brief](docs/product.md)
- [Storage model](docs/storage-model.md)
- [CLI and MCP](docs/cli-mcp.md)
- [HTTP API](docs/api.md)
- [Unmark migration](docs/unmark-migration.md)
