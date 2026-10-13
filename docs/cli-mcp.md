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

## MCP

Rinku uses the [official MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) to serve tools over newline-delimited JSON-RPC stdio. It runs independently of Electron. Start it directly:

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

`rinku_list_links` accepts `status` (`active`, `archived`, or `all`), `label`, `tag`, `context`, `search`, `olderThanDays`, and `limit`. Omitting status returns both active and archived links. Link operations accept an ID, filename, URL, title, or unambiguous partial reference in `ref`. IDs are recommended. Creation accepts `url`, `title`, `label`, `tags`, `contexts`, and `body`; updates accept the same metadata except `url`. Unknown fields and invalid types are rejected. Automated creation accepts only HTTP/HTTPS URLs and does not fetch remote titles implicitly.

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
