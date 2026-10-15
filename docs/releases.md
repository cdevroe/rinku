# Preparing a release

The standard download set is a universal macOS DMG and ZIP, a Windows NSIS installer containing x64 and ARM64 builds, and Linux AppImage and deb packages for each architecture. The ZIP is required for macOS automatic updates. Keep updater YAML and blockmap files alongside their corresponding installers.

Release installers are built locally on the maintainer's computer. GitHub hosts the source, runs source tests, and stores the uploaded release downloads; it does not build installers.

## Local builds

Run `npm ci` and `npm run test:all` on macOS before a release. On Windows/Linux, run `npm test`, `npm run test:release`, and `npm run test:build-proxy`. Build on each platform with:

```sh
npm run dist:mac    # macOS: signed, notarized universal DMG/ZIP
npm run dist:win    # Windows: one NSIS installer with x64 and ARM64
npm run dist:linux  # Linux: x64 and ARM64 AppImage/deb
```

All packaging commands use `--publish never`. Build from the same commit and lockfile, then collect each platform's top-level output files into one clean directory. Avoid mixing artifacts from older builds. `npm run dist:all` runs the three commands sequentially on one machine, but requires the host's cross-platform packaging tools. A local Linux Docker container can provide Linux packaging tools when cross-building AppImages directly on macOS is unsupported. Use a clean source snapshot and install its locked dependencies inside the container; do not share macOS `node_modules` with Linux.

The NSIS toolset is pinned to `1.2.1` in `electron-builder.json`, providing a native installer compiler on Apple Silicon as well as Windows and Linux. This avoids the legacy compiler's Intel-only macOS binary. Windows packages built here remain unsigned until a Windows signing identity is configured.

Verify the combined directory and generate download checksums:

```sh
node scripts/verify-release-assets.js --dir /path/to/release --write-checksums
```

For the default `dist/`, use `npm run release:checksums`. Verification requires all seven installers/archives, their blockmaps, and four updater YAML files. It checks versions, file references, sizes, and SHA-512 hashes from updater metadata. `--allow-partial` permits missing platforms for local work, but still rejects corrupt files or stale metadata. A partial check does not certify a complete release. The checksum manifest contains only the expected release files, excluding unpacked applications, debug files, and old versions.

## Prepare the GitHub draft

1. Update `package.json` and `package-lock.json` together for a new release version. Use a stable version for the current `latest` updater channel. Never replace the assets of an already published version.
2. Commit the release changes and push them. Build locally from that source and lockfile. Keep Apple signing and notarization credentials on the local Mac; see [macOS signing](macos-signing.md).
3. Collect the complete download set into a clean directory and run the verification command above with `--write-checksums`.
4. Create a draft GitHub release for `v<version>`, targeting the exact source commit. Upload each installer, ZIP, `.blockmap`, updater YAML file, and `SHA256SUMS` individually. Include direct installer links and platform notes in the release description.
5. Review and test the packaged apps before publishing the draft. Draft downloads are not publicly available until the release is published.

GitHub Actions runs source tests only and has no installer-build workflow or signing credentials. Windows installers are currently unsigned; Windows publisher signing needs a separately configured Windows certificate or signing service before claiming a verified publisher.

The updater currently points to `cdevroe/rinku` in `electron-builder.json`. Confirm the destination before publishing; forks should change it before building.

## Before publishing

Try the actual packaged apps on macOS, Windows, and Linux, including both architectures when available:

- Install, launch, create/open a temporary library, and save a link.
- Add the same URL again; confirm the existing link opens for editing without creating a duplicate.
- Check row opening, archive/restore, search, keyboard shortcuts, and Light/Dark/Auto appearance after restart.
- Open a `rinku://capture` URL through the operating system.
- On macOS, verify Gatekeeper, stapling, and Safari capture as described in the signing guide. On Windows, test the NSIS installer and uninstaller. On Linux, try both the AppImage and deb package, including the desktop launcher.
- Once a previous public version exists, test updating from it through a controlled test release/channel before promoting the new download. The app's updater needs accessible release metadata; an unpublished draft alone does not exercise updates, and packaging alone does not prove an end-to-end update.

Packaging and source tests do not substitute for installing and exercising the app on its target operating system.
