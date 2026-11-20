# Rinku development

Read `README.md`, `CONTRIBUTING.md`, and the relevant guides in `docs/` before
changing behavior. Keep the existing CommonJS/plain JavaScript style and use
temporary libraries for tests. Never test writes against the personal library.

## Tests without interrupting the Mac

- Run focused non-GUI tests during development (`npm test` for broader core coverage).
- Run relevant UI tests on the Omarchy desktop with `npm run test:remote -- --grep "test name"`.
  The user permits using that desktop; see `docs/testing.md` for SSH and isolation.
- Do not run the whole Playwright suite after every change. Use it at meaningful
  beta/release checkpoints, or when a broad regression warrants it.
- Local Mac Electron tests take keyboard focus. Do not bypass their opt-in guard
  unless the user agrees to a local test session or the local-beta install milestone.
  Never fall back to local GUI tests just because Omarchy is unreachable.
- Linux UI coverage does not replace Mac-specific clipboard, window lifecycle,
  Safari, signing, or installed-app checks. Schedule those at the agreed milestone.

## The app used for daily testing

The user's testing copy is **`/Applications/Rinku.app`**. Work in release-sized
batches on a `beta/<version>` branch. Do not build or replace the installed app
after every fix or commit. When the user says the batch is ready, validate, sign,
notarize, and install a local beta. The user then uses it for a few days before
we prepare a GitHub release. Publishing requires a separate release instruction.

- Inspect the branch, working tree, and worktrees first. Preserve existing work;
  don't switch branches or create extra worktrees just to install the app.
- At the agreed local-beta milestone, run `npm run install:mac` to validate, build, notarize, install, test, and open
  the app. See `docs/local-install.md`. If credentials, signing, notarization,
  or tests fail, keep the previous app and report the blocker. Do not silently
  substitute an unsigned or unnotarized build.
- Run `npm run install:check` to confirm the installed source fingerprint matches
  the current working tree. Check the running GUI's executable path as well;
  checking only the version number is insufficient.
- Do not launch `dist/**/Rinku.app` for the user's daily testing. Build temporary
  apps outside the checkout, remove them after installation, and keep rollback
  copies compressed. Do not delete release artifacts or unrelated worktrees.
- Use `RINKU_USER_DATA_DIR` with a temporary directory and
  `RINKU_SKIP_PROTOCOL_REGISTRATION=1` for source/UI tests. The installed-app test
  suite already does this. Background MCP connections use their existing runtime
  until they reconnect; don't kill other clients' connections during an update.
- During the batch, run the relevant source tests and report changes as pending
  the next beta build. A source/installed fingerprint mismatch is expected during
  this phase; it is not a reason to install automatically. Only report changes as
  installed after the local-beta milestone has actually completed.
