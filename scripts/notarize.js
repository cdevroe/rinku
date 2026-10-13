const { notarize } = require('@electron/notarize');
require('dotenv').config();

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const skipNotarization = ['1', 'true', 'yes'].includes(
    String(process.env.RINKU_SKIP_NOTARIZATION || '').toLowerCase()
  );
  if (skipNotarization) {
    console.warn('Skipping notarization: RINKU_SKIP_NOTARIZATION is enabled.');
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword) {
    console.warn('Skipping notarization: APPLE_ID and/or APPLE_APP_SPECIFIC_PASSWORD not set.');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`Notarizing ${appName} with Apple ID ${appleId}...`);

  await notarize({
    appBundleId: packager.appInfo.appId,
    appPath,
    appleId,
    appleIdPassword,
    teamId,
    tool: 'notarytool',
  });

  console.log(`Notarization complete: ${appName}`);
};
