# CLI and MCP

Rinku should expose the same local-first behavior through the desktop app, CLI, and MCP server. The CLI and MCP layers should operate on user-selected libraries and write through the same storage rules as the app.

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

Start the MCP server with:

```sh
npm run mcp:server
```

The server is read-only by default. Enable writes explicitly:

```sh
RINKU_MCP_READ_ONLY=false RINKU_MCP_ALLOWED_ROOTS=/path/to/allowed/root npm run mcp:server
```

Environment variables:

```text
RINKU_MCP_READ_ONLY       Defaults to true. Set false, 0, or no to allow writes.
RINKU_MCP_ALLOWED_ROOTS   Path-delimited list of directories the server may access.
```

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
rinku_import_unmark
rinku_rebuild_index
```

Tool names also accept dotted aliases such as `rinku.list_links`.

## Capture Inputs

- The desktop app is the primary capture path.
- The CLI is the primary automation capture path.
- A local HTTP capture endpoint may be offered as an optional convenience.
- Safari capture is not required for v1.

## Local HTTP Endpoint

The local HTTP capture endpoint is not implemented yet. If added, it should bind to localhost by default, be configurable per library or app profile, and write links through the same validation, label, context, and learned-rule behavior as the app, CLI, and MCP server.
