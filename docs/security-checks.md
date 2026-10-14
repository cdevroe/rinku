# Local security checks

## Dependencies

```sh
npm ci
npm audit
npm run test:all
```

Audit the entire dependency tree. `npm audit --omit=dev` excludes Electron and the packaging tools even though Electron ships in the desktop app. On Windows/Linux, use `npm test`, `npm run test:release`, and `npm run test:build-proxy`; the complete suite also requires macOS native Safari tools.

Electron 44 replaces the unsupported Electron 40 line. The lockfile pins the tested dependency versions, including the native image libraries used to generate icons. Keep the app's bundled Electron runtime current along with its JavaScript dependencies.

The scoped override for `@electron/get@3.1.0` selects `global-agent@4.1.3`, removing the old `roarr`/`sprintf-js` logger chain affected by GHSA-hp3w-g68c-fv3c. This affects electron-builder's download tooling. Its `bootstrap()` interface is exercised by `npm run test:build-proxy`, including proxy routing and `NO_PROXY` bypass. Review and remove the override when the pinned builder updates its downloader. Avoid `npm audit fix --force`: its proposed downgrade can undo the reviewed builder/signing configuration.

After dependency updates, rerun local tests, rebuild all installers, and verify the resulting [release assets](releases.md). A clean advisory report describes the current advisory database; it is not proof that no vulnerabilities exist.

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
