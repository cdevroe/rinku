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
rinku links delete <exact-id> [--json]
rinku links delete --file <batch.json> [--json]
rinku links update-batch --file <batch.json> [--json]
rinku links duplicates --policy exact|trailing-slash [--json]
rinku links merge --file <batch.json> [--json]
rinku recovery list [--json]
rinku recovery restore <batch-id> <item-id> [--json]
rinku --version [--json]
rinku build-info [--json]
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

Cleanup and batch commands call the same guarded service as MCP. The explicitly
selected CLI library is the allowed root for that invocation; MCP's environment
permissions do not override direct CLI commands. Library storage and recovery
symlinks are still rejected. No extra confirmation flag is required. There is no
`--permanent`, `--force`, or `--dry-run` shortcut: unsupported options on these
commands fail instead of being silently ignored. `links duplicates` is the
read-only preview operation.

`--file` reads a JSON object with the same operation fields as MCP, **excluding
`libraryRoot`**. Choose the library via `--library` or `rinku use`; an input file
cannot redirect the operation. A deletion file contains `records`, a merge file
contains `policy` and `groups`, and an update file contains `records` with patches.
For example, save the following as `updates.json`:

```json
{
  "records": [
    { "id": "bookmark-one", "patch": { "tags": ["research", "reading"] } },
    { "id": "bookmark-two", "patch": { "contexts": ["@Work"], "body": "Updated notes" } }
  ]
}
```

```sh
rinku links update-batch --library /path/to/Library --file updates.json --json
rinku links duplicates --library /path/to/Library --policy trailing-slash --json
rinku links merge --library /path/to/Library --file reviewed-merges.json --json
```

Convert only the authorized groups from the duplicate preview into a merge input;
the preview itself is not automatically an executable plan. Copy each selected
record's `id` and `revision` into `groups[].records` and retain the chosen policy.
Successful cleanup commands print their structured results and recovery receipts
even without `--json`.

Adding an existing URL returns its saved record without overwriting metadata or restoring it from the archive. The CLI's JSON output and the MCP `rinku_create_link` result include `duplicate: true` for an existing link and `duplicate: false` for a new one. Use `links update` or `rinku_update_link` to change saved information. Matching follows the [desktop URL rules](../README.md#saving-a-link-again).

## MCP

### Connect from the installed app

1. Open your library in Rinku, then go to **Settings → MCP**.
2. Leave access read-only, or check **Allow agents to save, edit, archive, delete, and merge links**.
3. Click **Copy configuration** and add it to your agent's local MCP server configuration. If the client already has an `mcpServers` object, merge the `rinku` entry into it. For ChatGPT desktop / Codex, use the TOML instructions below.
4. Restart or reconnect the agent. Ask it to list your Rinku libraries or search your saved links.

The configuration includes the current library and app paths. It starts the MCP server with the app's bundled runtime: users do not need a source checkout, npm, or a separate Node.js installation. The desktop window can stay closed. Clients that use a different configuration format should copy the `command`, `args`, and `env` fields into their local stdio server settings.

The access checkbox only changes the generated configuration; it does not change existing agent connections. Replace their configuration and reconnect to change access. Copy again after moving the app or library, or when connecting a different library. Install Rinku in its permanent location first (for example, Applications on macOS rather than running from the DMG).

The installed configuration uses Electron's [Node mode](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node) so the server can use stdio without launching the UI. On macOS, the command uses the signed background helper inside Rinku.app. To migrate an existing connection, update its command to the helper path below and reconnect the client. Linux AppImages use the persistent AppImage filename and resolve the bundled server from the new mount's `APPDIR` at launch; temporary mount paths are not saved in the configuration. Keep the `runAsNode` Electron fuse enabled when packaging Rinku.

### ChatGPT desktop / Codex on macOS

Local desktop agent connections, Codex CLI, and the Codex IDE extension share MCP settings for the same Codex host. The default user configuration file is `~/.codex/config.toml`. See the [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).

1. Open `~/.codex/config.toml` in a plain-text editor. Create the directory and file if they do not exist. In Finder, **Go → Go to Folder…** accepts `~/.codex`.
2. Add the following TOML tables, preserving your other settings. If a `rinku` server is already configured, update its existing tables instead of adding duplicates.
3. Replace the example library path with `RINKU_MCP_ALLOWED_ROOTS` from **Rinku → Settings → MCP**. Use the exact `command` and `args` values from Rinku's copied configuration if your app is installed somewhere other than `/Applications/Rinku.app`.

```toml
[mcp_servers.rinku]
command = "/Applications/Rinku.app/Contents/Frameworks/Rinku Helper.app/Contents/MacOS/Rinku Helper"
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
rinku_update_links
rinku_archive_link
rinku_restore_link
rinku_delete_links
rinku_preview_duplicates
rinku_merge_links
rinku_list_recovery
rinku_recover_deleted_link
rinku_import_unmark
rinku_rebuild_index
```

Tool names also accept dotted aliases such as `rinku.list_links`. Tool discovery includes input schemas and read/write annotations. Calls return both JSON text and structured content. Known-tool execution errors return `isError: true` and `{ "ok": false, "error": { "code": "…", "message": "…" } }`. Batch failures also set `isError: true` while preserving all per-record outcomes, recovery receipts, and index/journal errors. Unknown methods/tools remain MCP protocol errors.

`rinku_list_links` accepts `status` (`active`, `archived`, or `all`), `label`, `tag`, `context`, `search`, `olderThanDays`, and `limit`. Omitting status returns both active and archived links. The original read/update/archive/restore operations accept an ID, filename, URL, title, or unambiguous partial reference in `ref`. IDs are recommended. The deletion and merge tools require **exact, case-sensitive stable IDs** and reject duplicate-ID ambiguity. Creation accepts `url`, `title`, `fetchTitle`, `label`, `tags`, `contexts`, and `body`; updates accept the same metadata except `url` and `fetchTitle`. Unknown fields and invalid types are rejected. Automated creation accepts only HTTP/HTTPS URLs. Set `fetchTitle: true` to fetch the page title when `title` is omitted or blank. The default is false, so agents must explicitly request a network fetch. A supplied title takes priority; duplicates preserve their saved title without fetching. Fetch failures fall back to the URL.

The desktop app automatically reloads the open library's index after MCP, CLI, or API writes, usually within a second. Search, filters, scroll position, and open editors stay in place; these background saves do not open the capture popup. The app watches the shared index and settings files, including atomic replacements in cloud folders. Direct edits to link Markdown files still require rebuilding the index.

Requests are serialized within each MCP process. Use one writer process per library for bulk automation; there is no cross-process synchronization between the desktop app, CLI, HTTP API, and MCP.

Run `npm run test:mcp` to exercise a real SDK client against both entry points, including initialization, discovery, writes, duplicate merging, deletion/recovery, read-only errors, and unknown methods. `npm run test:cleanup` covers permissions, stale previews, metadata preservation, failure recovery, batched indexing, and app watcher notifications with disposable libraries.
`npm run test:automation` verifies a 221-record metadata batch, CLI cleanup and
exit statuses, and source/packaged runtime identity using temporary libraries.

The HTTP API exposes its documented subset of the shared service with bearer authentication. Cleanup and bulk updates are available through MCP and CLI; HTTP routes have not been added for them. See [API setup and routes](api.md).

### Running version and build identity

`rinku --version` prints the app version. `rinku --version --json` and
`rinku build-info` return the full runtime identity. MCP exposes that same identity
under `rinku_get_config.runtime`, even in read-only mode with no library access.

It includes `version`, `mode` (`source` or `packaged`), `commit`, `sourceSha256`,
`builtAt`, `configuredElectron`, actual running `electron`/`node`, `executablePath`,
`appPath`, `pid`, and `startedAt`. Plain Node CLI runs report `electron: null`;
the pinned dependency is not presented as a running Electron runtime.

Source fingerprints are captured at process startup. Packaged builds read
`resources/rinku-build.json` (`Contents/Resources/` on macOS), generated before
signing for all three platforms. Missing/invalid metadata leaves identity fields
unknown and supplies `identityError`; it never substitutes the current checkout's
fingerprint. A transferred source snapshot without Git may have `commit: null`.

Long-lived MCP processes keep their startup identity when an app or checkout is
updated. Reconnect after installing the beta, then check the executable path and
fingerprint; a matching version number alone does not prove it is the latest build.

### Bulk metadata updates

`rinku_update_links` takes `libraryRoot` and 1–500 `records`, each containing an
exact stable `id`, a `patch`, and an optional `revision`. `rinku_read_link` now
returns a revision; duplicate preview revisions work too. Patches accept `title`,
`label`, `tags`, `contexts`, and `body`. Omitted fields are preserved. Arrays
replace existing arrays; `[]` clears tags/contexts and `body: ""` clears notes.
Blank titles follow normal Rinku behavior and fall back to the URL.

The batch preserves creation dates, archive state, source and merge history,
updates `updatedAt`, and moves files when labels change. Labels must already exist
(ID or name); unknown labels are conflicts. Bulk operations do not train
smart-label rules. There is one fresh snapshot and one final index rebuild for
the batch, including partial completion. Prior Markdown files are backed up in
the recovery area. Label moves retain the old file there as `retiredFiles`;
these are prior paths, not deleted bookmarks. Recovery will not restore them
over the current ID. Whole-edit/whole-merge undo remains a separate workflow.

### Automation errors and exit status

Common codes are `invalid_arguments`, `read_only`, `forbidden`, `not_found`,
`conflict`, `operation_failed`, `partial_failure`, and `internal_error`. Per-item
I/O failures can also include the original filesystem error code. These are
machine-readable codes, not strings that callers must infer from prose.

With `--json`, CLI success **and failure** results are JSON on stdout; normal
failures do not mix diagnostic prose into that stream. Without `--json`, failure
details and receipts go to stderr. Exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | Completed successfully. |
| `1` | Validation, permissions, missing records, conflict, or another failure before confirmed batch changes. |
| `2` | Partial execution or index/journal failure; inspect the complete receipts before retrying. |

A batch can complete some records and reject others. Neither MCP's error flag
nor a nonzero CLI exit code means “nothing changed.” Retain the entire response,
inspect `results`, `unprocessed`, and recovery receipts, and re-read/re-preview
before retrying. Existing single-record CLI commands also emit structured errors
when `--json` is requested.

### Deletion and recovery

`rinku_delete_links` genuinely removes bookmarks from active/archive storage and
the index. It does not archive them. For one or up to 500 bookmarks:

```json
{
  "libraryRoot": "/absolute/path/to/Library",
  "records": [{ "id": "bookmark-id" }, { "id": "archived-bookmark-id" }]
}
```

Each record may include a `revision` from duplicate preview to reject stale edits.
Results have per-item `status` (`deleted`, `not_found`, `conflict`, `failed`, or
`partial`) and a `deleted` array identifying the exact IDs, URLs, titles, original
paths, archive states, creation dates, and recovery receipts. Missing IDs return
`not_found` without guessing at a title, URL, filename, or partial ID. Repeated
IDs in a batch are conflicts after the first occurrence; inspect every outcome.
Each completed move is reported even if its subsequent verification fails;
`verified: false` means inspect recovery before assuming its bytes match preview.

Deletion is **recoverable, not permanent**. Originals and receipts are retained in
`<library>/.rinku/recovery/<batchId>/`, outside the indexed `links/` and `archive/`
trees. This is Rinku's own recovery area, not the operating system Trash. It stays
inside the allowed root, inherits the existing symlink protections, and is never
indexed as bookmarks. Recovery files are not automatically purged. Keep them in
library backups. There is no permanent-delete flag or tool.

`rinku_list_recovery` takes `libraryRoot` and reads receipts, including interrupted
batches. An item's `recoverable` flag checks for the actual removed file rather
than relying solely on a journal entry. Restore an item with:

```json
{
  "libraryRoot": "/absolute/path/to/Library",
  "batchId": "the-batch-uuid-from-the-result",
  "itemId": "0"
}
```

Pass that object to `rinku_recover_deleted_link`. Recovery refuses an existing ID
or destination file, preserves its recovery copy, and rebuilds the index. It also
restores a redundant record removed by a merge, but does not undo changes to the
survivor. The survivor's original Markdown backup remains in the same batch.

All mutations require write mode. Explicit authorization to delete or clean up
duplicates is sufficient; these tools do not require a second confirmation call.
A preview by itself is not permission to mutate a library.

### Duplicate cleanup entirely through MCP

1. Call `rinku_preview_duplicates` with `libraryRoot` and an explicit `policy`.
   This read-only scan includes active and archived bookmarks without writing an
   index. Each candidate group contains full records with IDs, URLs, dates, state,
   tags, contexts, notes (`body`), source/import history, content revisions, the
   proposed survivor, and a `differences` list. Records with ambiguous IDs or
   invalid creation dates are marked unmergeable.
2. Choose the records authorized for merging and call `rinku_merge_links`:

```json
{
  "libraryRoot": "/absolute/path/to/Library",
  "policy": "trailing-slash",
  "groups": [
    { "records": [
      { "id": "old-id", "revision": "64-character-sha256-from-preview" },
      { "id": "new-id", "revision": "64-character-sha256-from-preview" }
    ] }
  ]
}
```

Use the actual 64-character revision strings returned by preview. There may be
up to 250 groups, each with 2–500 selected records. A record may occur only once
in a batch. A selected subset is allowed: “oldest” means oldest **among the
specified records**, not every matching bookmark elsewhere in the library.

| Policy | Equivalence |
| --- | --- |
| `exact` | Literal stored URL equality. |
| `trailing-slash` | Remove one final pathname slash from HTTP/HTTPS URLs for comparison only. `/110` and `/110/` match; `/110//` stays distinct. |

Neither policy rewrites the survivor URL, drops query parameters/fragments,
reorders queries, decodes escapes, folds path/host case, follows redirects, or
equates HTTP with HTTPS. Query strings, fragments, and even empty `?`/`#`
delimiters remain significant. These cleanup policies do not change normal
save-time URL matching.

The survivor is the earliest valid `createdAt`; equal instants use ascending,
case-sensitive ID order, independent of request order. It retains its ID, URL,
creation date, title, label, **active/archive state**, and archive timestamp.
`updatedAt` advances. If the user wants a different state, explicitly call
`rinku_restore_link` or `rinku_archive_link` on the survivor afterward.

Tags and contexts are unioned in oldest-first order using normal Rinku
normalization. Distinct nonempty note bodies are kept verbatim, separated by a
Markdown horizontal rule; only identical full bodies are deduplicated. Conflicting
titles, labels, sources, note boundaries, and all original file contents are saved
in the survivor's `mergeHistory` array, accessible with `rinku_read_link`.
Each history entry contains its batch ID, policy, merge time, original records,
and their `rawMarkdown`. The survivor's own `source` remains intact. Ordinary
subsequent edits retain `mergeHistory`. Raw backups also preserve unfamiliar
frontmatter and exact original formatting.

### Conflicts, partial execution, and performance

Revisions cover original bytes, file location, and effective label/state. A changed,
moved, or missing selected record prevents that group from merging. New matching
records outside the explicit selection are not implicitly added. Re-preview after
a conflict; do not blindly retry old revisions. Date or ID problems require
repair rather than guessing which bookmark is oldest.

Each batch validates storage once, takes one fresh snapshot, and replaces the
index once after its mutations, including partial execution. It does not call
the single-record updater or rescan the entire library for each bookmark. Normal
individual `rinku_update_link` calls still rebuild individually; this batch
optimization applies to `rinku_update_links`, deletion, and duplicate merging.

Backups and a recovery manifest are written before any changes. The merged file
is read back and compared byte-for-byte before removing redundant records, and
rechecked before each removal. Selected files are checked again immediately
before mutation. A removal failure leaves the verified survivor and reports the
completed subset; remaining originals are retained. `ok: false`, per-group
`partial`, `indexError`, `journalError`, and `unprocessed` must be inspected even
when there is no MCP protocol error (the tool response sets `isError: true`). If indexing fails, changes and
recovery files remain; call `rinku_rebuild_index` after resolving the failure.

The batch is **not an all-or-nothing transaction** and does not lock out other
writer processes. Optimistic checks detect observed edits, but cannot guarantee
isolation from a simultaneous filesystem/cloud writer between a check and a
rename. A raced moved file is retained in recovery and reported as partial.
Use one writer per library during cleanup. After a crash, inspect
`rinku_list_recovery`, rebuild the index, and re-preview before continuing.
Recovery refuses overwrites; it is not automatic whole-merge rollback.

The normal index watcher refreshes the open app after a successful rebuild.
No app launch, popup, personal-library scan, installation, or release is required
to run the tools against a selected disposable/test library.

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
