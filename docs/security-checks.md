# Local security checks

## Dependencies

```sh
npm ci
npm audit
npm test
npm run test:build-proxy
npm run test:build-matching
npm run test:remote -- --grep "MCP settings|MCP changes|show file"
```

Audit the entire dependency tree. `npm audit --omit=dev` excludes Electron and the packaging tools even though Electron ships in the desktop app. Keep desktop tests on Omarchy during development; see [testing](testing.md). Run `RINKU_ALLOW_GUI_TESTS=1 npm run test:all` only at an agreed Mac beta/release test session. The complete suite also requires macOS native Safari tools.

Electron is pinned to **45.3.2**, verified against the [stable Electron releases](https://releases.electronjs.org/?channel=stable) and npm's `latest` tag on November 13, 2026. It bundles Chromium 156.0.8078.100 and Node 24.22.2. The lockfile pins the tested dependency versions, including the native image libraries used to generate icons. Keep the app's bundled Electron runtime current along with its JavaScript dependencies. Updating this dependency does not replace the installed Rinku app until the agreed beta-install milestone.

The November 13, 2026 dependency review resolved the pre-beta audit's 12 affected
packages (10 moderate, 2 high). The full audit now reports zero findings. The
lockfile updates `body-parser` to 2.4.0, `@hono/node-server` to 2.1.8, `hono` to
4.13.18, `fast-uri` to 3.1.9, `qs` to 6.17.1, and both `undici` branches to
6.29.1 / 7.30.2. Regenerate the local report with
`npm audit --json > test-results/dependency-audit-after.json` when reviewing fixes.

Scoped, version-qualified overrides select `minimatch@11.0.7` for
`app-builder-lib@26.15.3`'s 10.x requirement and `@electron/universal@2.0.3`'s
9.x requirement. This fixes [globparts amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249)
and includes the later fixes in the [11.0.7 release](https://github.com/isaacs/minimatch/releases/tag/v11.0.7).
Older 3.x/5.x consumers retain their callable API; do not replace every nested
matcher with 11.x. `npm run test:build-matching` exercises the actual builder's
file allowlist, exclusions, directory traversal, and universal packager's ASAR
merge acceptance/rejection with disposable archives. CI checks the file filters
and matcher on all three platforms; the macOS universal merger assumes POSIX
archive paths, so its archive checks run on macOS and Linux only. Remove or revise these overrides when upgrading the pinned
builder to a version whose own dependency tree includes the fixes. The builder
and its guarded macOS signing patch remain at the reviewed version 26.15.3.

The scoped override for `@electron/get@3.1.0` selects `global-agent@4.1.3`, removing the old `roarr`/`sprintf-js` logger chain affected by GHSA-hp3w-g68c-fv3c. This affects electron-builder's download tooling. Its `bootstrap()` interface is exercised by `npm run test:build-proxy`, including proxy routing and `NO_PROXY` bypass. Review and remove the override when the pinned builder updates its downloader. Avoid `npm audit fix --force`: its proposed downgrade can undo the reviewed builder/signing configuration.

After dependency updates, verify a clean `npm ci`, rerun the relevant tests, and
keep installer rebuilds and [release asset verification](releases.md) at the
agreed beta/release milestone. Dependency validation does not authorize an
installation or publication. A clean advisory report describes the current
advisory database; it is not proof that no vulnerabilities exist.

## Git-history secrets

With Gitleaks installed locally, run from the repository root:

```sh
gitleaks git --log-opts="--all --full-history --reflog" \
  --config=.gitleaks.toml --redact=100 --ignore-gitleaks-allow \
  --max-archive-depth=3
```

The repository configuration extends the default rules and permits one exact match: `CSC_KEY_PASSWORD= RINKU_SKIP_NOTARIZATION=1 `. In the unsigned macOS build command, the shell assigns an empty password and a separate notarization flag. Gitleaks otherwise mistakes that flag for a password. No file, commit, or general credential pattern is excluded.

Inspect findings before adding any exception. Keep reports redacted and outside tracked source files. Scan all refs in a full clone, not just the current checkout or a shallow clone. Before the initial public push, also review unreachable blobs reported by `git fsck --full --no-reflogs --unreachable`, plus the current files that will be committed. Keep `.env`, private keys, libraries, and exports out of the publication snapshot.

Secret scanning runs locally. Do not upload repository contents or credentials to a third-party scanner. A clean scan reduces risk but cannot guarantee detection of every kind of secret.
