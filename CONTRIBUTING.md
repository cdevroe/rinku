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

Batch fixes on a `beta/<version>` branch. When the batch is ready for daily
testing on the maintainer's Mac, run `npm run install:mac`; do not install after
every fix or commit. It validates, signs, notarizes, installs, tests, and opens
`/Applications/Rinku.app`, then removes its temporary build copies. Use
`npm run install:check` to verify that the installed source matches the current
working tree. Use the local beta for a few days before preparing a GitHub
release. See [the local install workflow](docs/local-install.md).

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
npm run test:build-matching # Packaging file filters and universal archive merging
npm run test:remote -- --grep "show file" # Focused UI test on Omarchy (maintainer)
npm run test:playwright  # Electron UI; graphical session, explicit opt-in on macOS
npm run test:all         # Full suite at beta/release checkpoints
```

CI runs core tests on all three platforms, plus desktop, Safari, and signing checks on macOS. It uploads UI traces and screenshots when a job fails. The installed, signed-app Safari test is a separate release check and is skipped during normal source tests.

Use focused checks during normal development; reserve full UI runs for meaningful
beta/release checkpoints or broad regressions. The maintainer's routine UI target
is the Omarchy desktop, so tests do not interrupt work on the Mac. Local macOS
Playwright runs require `RINKU_ALLOW_GUI_TESTS=1` and an agreed test session;
`install:mac` opts in at the agreed beta-install milestone. CI remains automatic.
See [Desktop testing](docs/testing.md) for commands and platform coverage.

The importer suite uses generated fixtures by default. To additionally test your own Unmark export, set `RINKU_TEST_UNMARK_EXPORT` to its absolute path before running `npm run test:import-unmark`. This imports into temporary libraries and checks that importing it again adds no duplicates. Never commit the export.

Run the checks relevant to your changes. Storage changes should preserve metadata, notes, archive state, and existing library compatibility. UI changes should remain keyboard-accessible and work in Light, Dark, and Auto appearance. Keep the fixed row height in sync with the list virtualizer.

## Pull requests

Keep changes focused, use the existing CommonJS and plain JavaScript style, and avoid unrelated formatting changes. Explain the problem, the resulting behavior, and how you verified it. Add screenshots for visual changes and regression coverage for behavior changes. Update the relevant documentation when behavior or setup changes.

Bug reports should include the Rinku version, operating system, reproduction steps, and expected versus actual behavior. Use small synthetic examples instead of sharing a personal library. Treat other contributors respectfully and keep feedback specific to the work.

Contributions are made under the project's [MIT license](LICENSE). For private vulnerability reports, see [SECURITY.md](SECURITY.md).

## Releases

Release packaging is maintained separately from pull-request CI. See [Preparing a release](docs/releases.md) and the [macOS signing guide](docs/macos-signing.md). The CI workflow tests source changes; it does not build installers, publish downloads, or access release credentials.

Release installers are built on the maintainer's computer and uploaded to a draft GitHub release. See [Local security checks](docs/security-checks.md) for dependency auditing and Git-history secret scanning.
