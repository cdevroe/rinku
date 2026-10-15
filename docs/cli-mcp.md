# CLI and MCP

Rinku exposes the same local-first behavior through the desktop app, CLI, and MCP server. The CLI, API, and MCP layers operate on user-selected libraries and write through the same storage rules as the app.

## CLI

Implemented command shape:

```text
rinku use <library-root>
rinku libraries create <library-root> [--use] [--allow-existing] [--json]
rinku libraries list [--json]
rinku links add <url> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]
rinku links list [--status active|archived|all] [--label <label>] [--tag <tag>] [--context <context>] [--search <query>] [--older-than <days>] [--limit <n>] [--json]
rinku links read <link-ref> [--json]
rinku links update <link-ref> [--title <title>] [--label <label>] [--tag <tag> ...] [--context <context> ...] [--body <text>] [--json]
rinku links archive <link-ref> [--json]
rinku links restore <link-ref> [--json]
rinku links rebuild-index [--json]
rinku import unmark --file <export.json> [--json]
rinku settings read [--json]
```

Global options:

```text
--library <path>    Use a specific library for the command.
--json              Print machine-readable JSON.
```

The CLI stores the current selected library in the user's local config directory. For tests or portable use, set `RINKU_CONFIG_HOME`.

Adding an existing URL returns its saved record without overwriting metadata or restoring it from the archive. The CLI's JSON output and the MCP `rinku_create_link` result include `duplicate: true` for an existing link and `duplicate: false` for a new one. Use `links update` or `rinku_update_link` to change saved information. Matching follows the [desktop URL rules](../README.md#saving-a-link-again).

## MCP

### Connect from the installed app

1. Open your library in Rinku, then go to **Settings → MCP**.
2. Leave access read-only, or check **Allow agents to save, edit, and archive links**.
3. Click **Copy configuration** and add it to your agent's local MCP server configuration. If the client already has an `mcpServers` object, merge the `rinku` entry into it. For ChatGPT desktop / Codex, use the TOML instructions below.
4. Restart or reconnect the agent. Ask it to list your Rinku libraries or search your saved links.

The configuration includes the current library and app paths. It starts the MCP server with the app's bundled runtime: users do not need a source checkout, npm, or a separate Node.js installation. The desktop window can stay closed. Clients that use a different configuration format should copy the `command`, `args`, and `env` fields into their local stdio server settings.

The access checkbox only changes the generated configuration; it does not change existing agent connections. Replace their configuration and reconnect to change access. Copy again after moving the app or library, or when connecting a different library. Install Rinku in its permanent location first (for example, Applications on macOS rather than running from the DMG).

The installed configuration uses Electron's [Node mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node) so the server can use stdio without launching the UI. Linux AppImages use the persistent AppImage filename and resolve the bundled server from the new mount's `APPDIR` at launch; temporary mount paths are not saved in the configuration. Keep the `runAsNode` Electron fuse enabled when packaging Rinku.

### ChatGPT desktop / Codex on macOS

Local desktop agent connections, Codex CLI, and the Codex IDE extension share MCP settings for the same Codex host. The default user configuration file is `~/.codex/config.toml`. See the [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).

1. Open `~/.codex/config.toml` in a plain-text editor. Create the directory and file if they do not exist. In Finder, **Go → Go to Folder…** accepts `~/.codex`.
2. Add the following TOML tables, preserving your other settings. If a `rinku` server is already configured, update its existing tables instead of adding duplicates.
3. Replace the example library path with `RINKU_MCP_ALLOWED_ROOTS` from **Rinku → Settings → MCP**. Use the exact `command` and `args` values from Rinku's copied configuration if your app is installed somewhere other than `/Applications/Rinku.app`.

```toml
[mcp_servers.rinku]
command = "/Applications/Rinku.app/Contents/MacOS/Rinku"
args = [
  "/Applications/Rinku.app/Contents/Resources/app.asar/bin/rinku.js",
  "mcp",
  "serve"
]

[mcp_servers.rinku.env]
ELECTRON_RUN_AS_NODE = "1"
RINKU_MCP_ALLOWED_ROOTS = "/absolute/path/to/your/Library"
RINKU_MCP_READ_ONLY = "true"
```

4. Save the file and restart the desktop app or reconnect the agent. Ask it to use `rinku_list_libraries`, then search your saved links. If you use Codex CLI, `codex mcp list` lists configured servers and `/mcp` in an interactive session shows active servers.

Codex uses TOML, so do not paste Rinku's JSON directly into this file. The JSON `mcpServers.rinku` object becomes `[mcp_servers.rinku]`, and its `env` object becomes `[mcp_servers.rinku.env]`. Keep environment values quoted as strings, including `"true"` and `"1"`. Spaces in library paths are supported inside the quotes; no shell escaping is needed. Set `RINKU_MCP_READ_ONLY = "false"` to permit edits, then reconnect.

This setup is for local agent connections. ChatGPT on the web uses remote MCP-backed tools and does not launch Rinku's local stdio process through this file.

### Connect from a source checkout

Rinku uses the [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) to serve tools over newline-delimited JSON-RPC stdio. With Node.js and the project's dependencies installed, start it directly:

```sh
node /absolute/path/to/rinku/bin/rinku.js mcp serve
```

`npm run mcp:server` and `node main.js --mcp-server` are also supported. For client configuration, launch Node directly so npm output does not enter the protocol stream. The server reserves stdout for MCP messages; diagnostics use stderr. The SDK handles initialization, protocol negotiation, ping, notifications, and protocol errors.

Use this configuration with an MCP client that supports local stdio servers:

```json
{
  "mcpServers": {
    "rinku": {
      "command": "node",
      "args": ["/absolute/path/to/rinku/bin/rinku.js", "mcp", "serve"],
      "env": {
        "RINKU_MCP_ALLOWED_ROOTS": "/absolute/path/to/Library",
        "RINKU_MCP_READ_ONLY": "true"
      }
    }
  }
}
```

Use an absolute path to Node if your client does not inherit your shell's PATH. Configuration file locations depend on the client.

### Access and tools

The server is read-only by default. Enable writes explicitly:

```sh
RINKU_MCP_READ_ONLY=false RINKU_MCP_ALLOWED_ROOTS=/path/to/Library npm run mcp:server
```

| Variable | Behavior |
| --- | --- |
| `RINKU_MCP_READ_ONLY` | Defaults to `true`. Set `false`, `0`, or `no` to allow writes. |
| `RINKU_MCP_ALLOWED_ROOTS` | Directories the server may access. Path-delimited: `:` on macOS/Linux, `;` on Windows. No configured roots means no library access. |

Each library tool takes an explicit `libraryRoot` within an allowed root. Symlinks are resolved before checking access; symlinks inside managed library storage are rejected. Import source paths must also be within allowed roots. Library creation refuses existing nonempty directories. Read-only calls do not create or rewrite settings or indexes, even when the index is missing. Reads scan current Markdown files; writes follow the shared storage engine's rules.

Implemented tools:

```text
rinku_get_config
rinku_list_libraries
rinku_create_library
rinku_read_settings
rinku_list_links
rinku_read_link
rinku_create_link
rinku_update_link
rinku_archive_link
rinku_restore_link
rinku_import_unmark
rinku_rebuild_index
```

Tool names also accept dotted aliases such as `rinku.list_links`. Tool discovery includes input schemas and read/write annotations. Successful calls return both JSON text and structured content. Execution errors return `isError: true`, allowing clients to report or correct failed operations.

`rinku_list_links` accepts `status` (`active`, `archived`, or `all`), `label`, `tag`, `context`, `search`, `olderThanDays`, and `limit`. Omitting status returns both active and archived links. Link operations accept an ID, filename, URL, title, or unambiguous partial reference in `ref`. IDs are recommended. Creation accepts `url`, `title`, `fetchTitle`, `label`, `tags`, `contexts`, and `body`; updates accept the same metadata except `url` and `fetchTitle`. Unknown fields and invalid types are rejected. Automated creation accepts only HTTP/HTTPS URLs. Set `fetchTitle: true` to fetch the page title when `title` is omitted or blank. The default is false, so agents must explicitly request a network fetch. A supplied title takes priority; duplicates preserve their saved title without fetching. Fetch failures fall back to the URL.

The desktop app automatically reloads the open library's index after MCP, CLI, or API writes, usually within a second. Search, filters, scroll position, and open editors stay in place; these background saves do not open the capture popup. The app watches the shared index and settings files, including atomic replacements in cloud folders. Direct edits to link Markdown files still require rebuilding the index.

Requests are serialized within each MCP process. Use one writer process per library for bulk automation; there is no cross-process synchronization between the desktop app, CLI, HTTP API, and MCP.

Run `npm run test:mcp` to exercise a real SDK client against both entry points, including initialization, tool discovery, writes, archive/restore, read-only errors, and unknown methods.

The HTTP API exposes the same operations with bearer authentication. See [API setup and routes](api.md).

## Capture Inputs

- The desktop app is the primary capture path.
- The `rinku://capture` app URL scheme is the preferred low-friction browser and Shortcuts capture path.
- The CLI is the primary automation capture path.
- A local HTTP capture endpoint is available as an optional convenience for popup editing and scripts.
- Safari capture is not required for v1.

## App URL Scheme

The desktop app registers `rinku://capture` as a URL scheme. It accepts the same capture fields as the local HTTP endpoint:

```text
rinku://capture?url=<url>&title=<title>&label=<label>&tag=<tag>&context=<context>&body=<notes>
```

Deep-link captures save immediately to the current library and then show a quick-edit modal in the app for labels, contexts, tags, title, and notes. If Rinku is launched cold, the capture is queued until the previously opened library is restored.

## Local HTTP Endpoint

The local HTTP capture endpoint binds to `127.0.0.1` and is controlled from the desktop app settings. It defaults to port `47342` and retries the next available port if that one is occupied. The current port is persisted in `rinku-settings.md`.

Implemented routes:

```text
GET /status
GET /capture?url=<url>&title=<title>&label=<label>&tag=<tag>&context=<context>&body=<notes>
POST /capture
POST /capture/update
```

`POST /capture` accepts JSON or `application/x-www-form-urlencoded` bodies using the same fields as the query string. `tag` and `context` may be repeated, and `tags` or `contexts` may be comma-separated. Captures only accept `http` and `https` URLs.

The endpoint writes through the shared library layer, so label validation, context normalization, tag normalization, learned label rules, and Markdown storage behavior match the app, CLI, and MCP server. Browser users can drag the generated `Save with Popup` bookmarklet from Settings to their bookmarks bar. Normal HTML captures show a compact edit page after saving; JSON captures return the created link directly.

Native platform share-sheet capture is a packaging-level follow-up. Electron can register URL schemes from the app, but appearing as a macOS Share target requires native bundle metadata or a share extension.
