# Contributing to Rinku

Rinku is an early-stage, local-first link library. Bug fixes, documentation improvements, accessibility work, and focused features are welcome. For larger changes, open an issue to discuss the behavior before starting.

## Development setup

Use Node.js 22.12 or later with npm. `.nvmrc` pins the version used by CI; with nvm, run `nvm install` and `nvm use`.

```sh
npm ci
npm start
```

Electron is installed by npm; a separate Playwright browser download is not required for the Electron tests. Desktop development needs a graphical session. On Linux, install the system libraries required by [Electron](https://www.electronjs.org/docs/latest/tutorial/development-environment).

macOS Safari builds and native tests need Xcode or Apple's Command Line Tools (`xcode-select --install`). Signing and notarization credentials are only needed for distribution builds; ordinary development and CI use no signing secrets. `npm ci` applies the repository's documented compatibility patch to the pinned macOS signing dependency.

Use a disposable library when developing storage or migration changes. Libraries, exports, credentials, generated builds, and test artifacts belong outside Git.

## Project layout

- `app/`, `static/`, `index.html`: desktop UI and appearance.
- `main.js`, `preload.js`: Electron integration and the renderer bridge.
- `lib/`: library storage, capture, CLI, HTTP API, and MCP services.
- `safari/`: native Safari extension and setup bridge.
- `scripts/`: builds, release verification, and service tests.
- `tests/playwright/`: Electron interaction and accessibility tests.
- `docs/`: product decisions, storage format, and integration documentation.

## Tests

```sh
npm test                 # Core behavior; runs on macOS, Windows, and Linux
npm run test:build-proxy # Packaging downloader proxy compatibility
npm run test:playwright  # Electron UI; requires a graphical session
npm run test:all         # Full local suite, including native Safari checks on macOS
```

CI runs core tests on all three platforms, plus desktop, Safari, and signing checks on macOS. It uploads UI traces and screenshots when a job fails. The installed, signed-app Safari test is a separate release check and is skipped during normal source tests.

The importer suite uses generated fixtures by default. To additionally test your own Unmark export, set `RINKU_TEST_UNMARK_EXPORT` to its absolute path before running `npm run test:import-unmark`. This imports into temporary libraries and checks that importing it again adds no duplicates. Never commit the export.

Run the checks relevant to your changes. Storage changes should preserve metadata, notes, archive state, and existing library compatibility. UI changes should remain keyboard-accessible and work in Light, Dark, and Auto appearance. Keep the fixed row height in sync with the list virtualizer.

## Pull requests

Keep changes focused, use the existing CommonJS and plain JavaScript style, and avoid unrelated formatting changes. Explain the problem, the resulting behavior, and how you verified it. Add screenshots for visual changes and regression coverage for behavior changes. Update the relevant documentation when behavior or setup changes.

Bug reports should include the Rinku version, operating system, reproduction steps, and expected versus actual behavior. Use small synthetic examples instead of sharing a personal library. Treat other contributors respectfully and keep feedback specific to the work.

Contributions are made under the project's [MIT license](LICENSE). For private vulnerability reports, see [SECURITY.md](SECURITY.md).

## Releases

Release packaging is maintained separately from pull-request CI. See [Preparing a release](docs/releases.md) and the [macOS signing guide](docs/macos-signing.md). The CI workflow tests source changes; it does not publish installers or access release credentials. The manual **Build installers** workflow creates downloadable artifacts without publishing a GitHub release.

Local builds are the standard release workflow; running GitHub Actions is optional. See [Local security checks](docs/security-checks.md) for dependency auditing and Git-history secret scanning.
