# Build and install a local beta

Use `/Applications/Rinku.app` for daily testing. Version numbers alone cannot
identify local builds: several different revisions can all say `0.1.2`.

Develop a batch of fixes on a `beta/<version>` branch. Run relevant source tests
as work proceeds; do not replace the installed app after each change or commit.
For the current cycle, use `beta/0.1.3`. When the user says the batch is ready,
build and install it for daily testing:

```sh
npm run install:mac
```

To keep all automated desktop testing on Omarchy, use:

```sh
npm run install:mac -- --remote-tests
```

This runs the non-GUI and native compilation/signing checks on the Mac and the
full desktop suite on Omarchy. Both the built and installed Mac bundles must pass
signature, notarization, source fingerprint, and packaged CLI runtime checks.
It opens the installed app for the user after verification, without running
local Playwright or opening Safari Settings. Native Mac UI behavior and the real
Safari setup flow remain manual beta checks in this mode; Linux tests do not
establish those results. Any automated verification failure still rolls back the
installation.

Use that installed beta for a few days, address feedback in the beta branch,
and make another local build when agreed. After the user is satisfied, prepare
the GitHub release using [the release guide](releases.md). Local installation
does not authorize publishing. Set the intended package version and lockfile
together when preparing the beta/release build.

This command runs the full source suite, builds a universal Developer ID-signed
app in a temporary directory, submits it to Apple for notarization, and verifies
the signature, Gatekeeper acceptance, and stapled ticket. It checks that the
source did not change while testing or building. It then gracefully quits the
installed GUI, saves one compressed rollback copy at
`dist/local-install/Rinku.previous.zip`, and replaces `/Applications/Rinku.app`.
Personal libraries and application preferences are not replaced.

The agreed install milestone includes local GUI testing: `install:mac` explicitly
enables the Mac Playwright runs, which take desktop focus. During ordinary
development use focused non-GUI tests and Omarchy UI tests instead; see
[Desktop testing](testing.md). Do not start an install just to validate a small fix.

The installed app must pass the full desktop suite, including the real Safari
setup check. Tests use temporary user data and libraries. The Safari check opens
Safari Settings but does not enable extensions or grant website permissions. If
installed-app validation fails, the previous app is restored. After success,
Rinku opens from Applications and the temporary app bundles are removed and
unregistered from macOS. Background MCP sessions are left running; reconnect
them to use the new runtime.

The command requires macOS, the locked dependencies, Command Line Tools, write
access to `/Applications`, and the signing/notarization setup described in
[macOS signing](macos-signing.md). It always notarizes, even if the shell has a
preview-build environment variable set. It does not publish a release. Apple
account or service failures stop installation and preserve the existing app.

To confirm the installed app matches the current working tree:

```sh
npm run install:check
```

A mismatch is expected while accumulating fixes for the next beta. It reports
what is installed; it does not mean that every source change needs a new build.

Each new macOS build carries a signed `Contents/Resources/rinku-build.json`
record with the Git commit, source fingerprint, Electron version, and build
time. The fingerprint includes uncommitted app, native, dependency, and build
script changes. The check also verifies the bundled Electron version and detects
a GUI running from a different path. An older build without this record needs
one installation through the new workflow.

Do not launch a `dist/**/Rinku.app` copy for daily testing. Use temporary user
data and disable protocol registration when launching source builds for
development. Release archives can remain in `dist/`; don't unpack and register
extra app copies unless a specific test needs them. Documentation-only changes
do not require a rebuild. Keep working on the intended source checkout rather
than creating a new worktree just to build or install.
