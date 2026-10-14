const path = require('node:path');

// An AppImage mounts at a new temporary path on every launch. Resolve its
// bundled server inside the new mount, rather than copying the current mount.
const APPIMAGE_BOOTSTRAP = "require(process.env.APPDIR + '/resources/app.asar/lib/mcpServer.js').startMcpServer().catch(error => { console.error(error); process.exit(1); })";

function createMcpClientConfig({ libraryRoot, allowWrites = false, executablePath, appPath, isPackaged, platform = process.platform, appImage = '' }) {
  if (typeof libraryRoot !== 'string' || !libraryRoot.trim()) {
    throw new Error('Open a library before copying its MCP configuration.');
  }
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(libraryRoot)) throw new Error('The library path must be absolute.');
  // The server's allowed-roots variable is path-delimited. Never silently
  // broaden access by turning a single library name into multiple roots.
  if (libraryRoot.includes(paths.delimiter)) {
    throw new Error(`MCP cannot use a library path containing "${paths.delimiter}". Move the library to a path without that character before connecting.`);
  }
  const useAppImage = isPackaged && platform === 'linux' && Boolean(appImage);
  return {
    mcpServers: {
      rinku: {
        command: useAppImage ? appImage : executablePath,
        args: useAppImage
          // AppRun otherwise prepends --no-sandbox where user namespaces are
          // unavailable. Supplying it after Node's -- prevents that injection
          // and leaves it as an unused script argument, not a Node option.
          ? ['-e', APPIMAGE_BOOTSTRAP, '--', '--no-sandbox']
          : [paths.join(appPath, 'bin', 'rinku.js'), 'mcp', 'serve'],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          RINKU_MCP_ALLOWED_ROOTS: libraryRoot,
          RINKU_MCP_READ_ONLY: allowWrites === true ? 'false' : 'true',
        },
      },
    },
  };
}

module.exports = { createMcpClientConfig };
