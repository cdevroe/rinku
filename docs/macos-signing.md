# macOS signing and notarization

Rinku's macOS release contains the Electron app, the native Safari app extension, and a Node-API setup bridge. They use the same Developer ID Application identity. The bridge calls SafariServices from Rinku's main process; Safari validates the containing app's identity, so these calls cannot come from a separate helper executable. An existing certificate used for another app, such as Signboard, can also sign Rinku; a new certificate per app is unnecessary.

Rinku has its own bundle ID, `com.cdevroe.rinku`, and the extension has its own ID, `com.cdevroe.rinku.SafariExtension`. These must remain stable for updates and Safari settings. The current extension only uses App Sandbox, without restricted capabilities or an App Group.

## Set up this Mac

1. Install Node.js and Xcode or Apple's Command Line Tools. If full Xcode requires license acceptance but the Command Line Tools are ready, the release script uses the Command Line Tools automatically.
2. Run `npm ci`.
3. Copy `.env-sample` to `.env`. Set `CSC_LINK` to the existing exported Developer ID Application `.p12` file and `CSC_KEY_PASSWORD` to its export password. An absolute path avoids ambiguity. Alternatively, install the certificate and private key in Keychain Access and omit these two variables.
4. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for the same Apple developer team. The Apple ID must be authorized to submit notarization requests. The password is an Apple account app-specific password, separate from the certificate password.
5. Keep `.env` and the private key archive outside version control. `.env` and certificate/key files are ignored. Use `chmod 600 .env` on a shared Mac. They are excluded from the packaged app.

The build imports an exported certificate into a temporary signing keychain; it does not require installing another permanent identity. Keep release signing credentials on this Mac. GitHub Actions runs source tests and does not build or sign installers.

## Build a release

```sh
npm run test:all
npm run dist:mac
```

The second command builds universal Intel/Apple Silicon DMG and ZIP files under `dist/`, signs all bundled code, submits the app to Apple's notary service, and staples the returned ticket to the app before packaging. It uses `--publish never`; it does not create or publish a GitHub release. A missing signing identity or notarization credential causes the release build to fail.

`electron-builder` is pinned to 26.15.3. The guarded postinstall patch fixes its temporary-keychain password handling, as in Signboard. The patch has a regression test and refuses an unexpected version/source. Review it when upgrading the builder. The custom `afterSign` hook handles notarization; built-in notarization is disabled to avoid duplicate submissions.

For an ad-hoc development build that deliberately skips Apple notarization:

```sh
npm run dist:mac:arm64:no-notarize
```

This preview is unsuitable for public distribution or testing Safari's normal signed-extension setup.

## Verify and try the release

```sh
codesign --verify --deep --strict --verbose=2 dist/mac-universal/Rinku.app
spctl --assess --type execute --verbose=2 dist/mac-universal/Rinku.app
xcrun stapler validate dist/mac-universal/Rinku.app
```

Gatekeeper should report `accepted` with `source=Notarized Developer ID`, and stapler should report that validation worked. If full Xcode is not ready, prefix the stapler command with `DEVELOPER_DIR=/Library/Developer/CommandLineTools`.

Install Rinku from the DMG into Applications and launch it. Open **Settings > Capture > Enable in Safari**, then enable **Rinku** in **Safari > Settings > Extensions**. macOS requires the user to approve enabling the extension. Visit a page and use **Save with Rinku** or **Save Page to Rinku**. The bookmarklets remain available for other browsers.

Check the actual SafariServices calls from the signed, installed app with:

```sh
RINKU_TEST_EXECUTABLE=/Applications/Rinku.app/Contents/MacOS/Rinku RINKU_TEST_SAFARI_SETUP=1 npm run test:playwright -- --grep 'signed packaged app'
```

This opt-in check uses temporary Rinku user data and opens Safari's extension settings without enabling the extension or granting website access. Testing a build-directory copy alongside the installed copy can register two extensions with the same ID and cause Safari's ownership check to fail. Remove only your test copy's registration with `pluginkit -r /absolute/path/to/test/Rinku.app/Contents/PlugIns/RinkuSafariExtension.appex` after testing; preserve the installed copy. Signing/notarization checks alone do not validate the setup flow.

After checking the release, upload the desired assets and updater metadata to the project's GitHub release separately. Do not change the bundle IDs or signing team between updates.

Apple references: [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/), [distribution-signed Mac code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/), and [Safari app extensions](https://developer.apple.com/documentation/safariservices/building-a-safari-app-extension).
