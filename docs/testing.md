# Desktop testing

During development run the tests relevant to the change. `npm test` exercises
core behavior without opening Electron. For routine UI changes, use focused
Playwright tests on the maintainer's Omarchy computer, Babu:

```sh
npm run test:remote -- --grep "show file"
```

The user permits tests on its normal desktop. It must be powered on, connected to
the LAN, and logged into its graphical session. The runner uses the existing SSH
key and strict host-key verification for `cdevroe@babu.local`, trying the known
Bonjour conflict name `babu-2.local` against the saved `babu.local` key if needed.
It does not change hostnames, monitors, desktop configuration, or SSH settings.
For another explicitly configured Linux desktop, set `RINKU_TEST_HOST=user@host`;
that host must already have a trusted SSH host key, Node/npm, tar, flock, timeout,
and a graphical session exposed through `systemctl --user show-environment`.

The runner transfers an allowlisted source snapshot, including unfinished code,
and verifies its SHA-256 manifest remotely. It excludes local libraries, profiles,
`.env`, signing keys, builds, Git data, and Mac `node_modules`. Linux dependencies
come from the matching lockfile and are cached under `~/.cache/rinku-tests/`.
Tests use synthetic temporary libraries and profiles and disable URL-handler
registration. Only one Rinku remote test run can use the desktop at a time; a run
has a 20-minute limit. Test windows can take focus on **Babu**, not the Mac.

Reports, traces, failure screenshots, source identity, and runtime details are
copied back to `test-results/omarchy/<run>/`. Remote snapshots and dependency
caches live under `~/.cache/rinku-tests/`; they do not install Rinku or add desktop
launchers. These are disposable test caches and can be removed when no run is
active. Never use a snapshot as a daily app or point it at a personal library.
If remote tests fail or Babu is unavailable, report that limitation; do not
automatically launch UI tests on the Mac.

Run the full UI suite at a beta/release checkpoint or for a broad regression:

```sh
npm run test:remote -- --full
```

Linux coverage does not establish correctness of Mac-specific paste shortcuts,
window lifecycle, Safari integration, signing, or the installed app. A tiling
window manager may also control geometry differently from macOS or Windows.
The geometry round-trip test explicitly skips Hyprland because it overrides
app-requested window bounds. The Command+V/native-menu regression test and signed
Safari Settings check are macOS-only. These skips must remain visible in beta
validation reports; non-GUI window-state tests still run on every platform.
Keep the native Mac checks at an agreed beta/release session. Local Mac runs are
guarded because Electron opens foreground windows:

```sh
RINKU_ALLOW_GUI_TESTS=1 npm run test:playwright -- --grep "native Paste"
RINKU_ALLOW_GUI_TESTS=1 npm run test:all
```

`npm run install:mac` opts in to the full source and installed-app runs as part
of the agreed local-beta milestone. CI continues running its automated platform
checks. Other contributors can run `npm run test:playwright` directly in a Linux
or Windows graphical session; they do not need access to Babu.
