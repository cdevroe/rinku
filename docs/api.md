# Local HTTP API

Rinku exposes a versioned JSON API for scripts and local integrations. It runs independently of Electron, reads and writes the same Markdown libraries as the desktop app, and binds only to `127.0.0.1`. The API is separate from the desktop popup capture server.

## Start the server

From a source checkout with dependencies installed:

```sh
npm run api:server -- --library /absolute/path/to/Library
```

This selects a default library and restricts access to it. Reads do not modify settings, links, or the index. To enable writes:

```sh
npm run api:server -- --library /absolute/path/to/Library --write
```

The default port is `47343`. Use `--port 47344` to choose another, or `--port 0` to choose an available port. An occupied explicit port fails instead of silently changing the endpoint. Stop with Ctrl+C.

The server prints its URL and bearer token to stderr at startup. A fresh token is generated for each launch unless `RINKU_API_TOKEN` is supplied. Keep that token private; it grants the configured access to your libraries. Use a stable token for integrations that reconnect after restarts:

```sh
export RINKU_API_TOKEN="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("base64url"))')"
npm run api:server -- --library /absolute/path/to/Library --write
```

An installed CLI also supports `rinku api serve --library <path> --write`.

## Configuration

| Variable | Behavior |
| --- | --- |
| `RINKU_API_LIBRARY` | Default library when `--library` is absent. |
| `RINKU_API_ALLOWED_ROOTS` | Path-delimited directories the server may access. If omitted, the default library is the sole allowed root. On macOS/Linux separate paths with `:`; on Windows use `;`. |
| `RINKU_API_READ_ONLY` | Defaults to `true`. `false`, `0`, or `no` enables writes. `--write` also enables writes. |
| `RINKU_API_PORT` | Defaults to `47343`; overridden by `--port`. |
| `RINKU_API_TOKEN` | Optional stable bearer token. Otherwise a random token is generated. |

For multiple libraries, configure their parent directory as an allowed root and pass `?libraryRoot=<URL-encoded-absolute-path>` per request. This also works without a default library. Import source files must be within an allowed root.

Paths are resolved through symlinks before checking allowed roots. Symlinks inside managed library storage (`links`, `archive`, `.rinku`, and the settings file) are rejected. Library creation refuses existing nonempty directories, so a request cannot reset an existing library's settings.

## Requests and responses

Every endpoint, including the OpenAPI document, requires:

```text
Authorization: Bearer <token>
```

Send JSON bodies with `Content-Type: application/json`. Bodies are limited to 1 MiB. Unknown fields, repeated query parameters, unsupported URL schemes, and invalid filter values are rejected. Browser cross-origin requests are rejected; this API is intended for local scripts and native integrations.

Successful responses use `{ "ok": true, "data": ... }`. Errors use `{ "ok": false, "error": { "code": "...", "message": "..." } }`. The OpenAPI endpoint returns the OpenAPI document directly.

| Method | Path under `/api/v1` | Result |
| --- | --- | --- |
| GET | `/config` | Access mode and allowed roots; never the token. |
| GET | `/libraries` | Libraries at allowed roots or their immediate children. |
| POST | `/libraries` | Create a library; JSON requires `libraryRoot`. Returns 201. |
| GET | `/settings` | Library settings. |
| GET | `/links` | Filtered links, `total` before limit, and library totals. |
| POST | `/links` | Save a link. Returns 201 for a new link, or 200 for an existing URL. `data.duplicate` indicates whether the record already existed. |
| GET | `/links/{ref}` | Full link including Markdown notes (`body`). |
| PATCH | `/links/{ref}` | Update supplied fields. |
| POST | `/links/{ref}/archive` | Archive the link. |
| POST | `/links/{ref}/restore` | Restore the link. |
| POST | `/imports/unmark` | Import an export; JSON requires `sourcePath`. |
| POST | `/index/rebuild` | Rebuild the disk index. |
| GET | `/openapi.json` | OpenAPI 3.1 description generated from the shared operation schemas. |

Library-scoped routes accept `libraryRoot` as a query parameter or use the server's default library. Use a link's ID as `{ref}` for stable references. Exact URL, title, filename, and unambiguous partial references also work; URL-encode the entire reference. Ambiguous references return 409; missing links return 404.

`GET /links` accepts `status` (`active`, `archived`, or `all`), `label`, `tag`, `context`, `search`, `olderThanDays` (nonnegative number), and `limit` (positive integer). Without `status`, both active and archived links are returned. Search matches metadata, including titles, URLs, tags, and contexts.

`POST /links` requires an HTTP or HTTPS `url`. Optional fields are `title`, `fetchTitle` (boolean, default false), `label`, `tags` (string array), `contexts` (string array), and `body`. Set `fetchTitle: true` to fetch the remote title when no title is supplied. A supplied title takes priority, and duplicates are returned without fetching or changing their metadata. Without an explicit fetch, or if fetching fails, the title falls back to the URL. The desktop app automatically refreshes the open library after API writes. `PATCH /links/{ref}` accepts `title`, `label`, `tags`, `contexts`, and `body`; omitted fields are preserved. Empty arrays or an empty body clear those fields. Archive and restore requests accept an empty body or `{}`. There is no permanent-delete endpoint.

Saving an existing URL returns its saved metadata without overwriting any fields or restoring archived links. Use `PATCH /links/{ref}` to make changes. URL matching follows the [same rules as desktop capture](../README.md#saving-a-link-again).

Writes use the existing storage engine, including label rules and tag/context normalization. Reads scan current Markdown files rather than trusting cached index paths. Requests are serialized within each server process. Use one writer process per library when automating bulk changes; synchronization across independent app, CLI, API, and MCP processes is not provided.

## Examples

Copy the startup token into `RINKU_TOKEN`:

```sh
export RINKU_TOKEN='token-from-server-output'

# Search
curl -H "Authorization: Bearer $RINKU_TOKEN" \
  'http://127.0.0.1:47343/api/v1/links?status=active&search=javascript&limit=20'

# Save (requires write mode)
curl -X POST -H "Authorization: Bearer $RINKU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/article","title":"An article","label":"Read","tags":["research"],"contexts":["Work"],"body":"Read this later."}' \
  http://127.0.0.1:47343/api/v1/links

# Update notes using the ID returned by the save
curl -X PATCH -H "Authorization: Bearer $RINKU_TOKEN" \
  -H 'Content-Type: application/json' -d '{"body":"Finished reading."}' \
  http://127.0.0.1:47343/api/v1/links/LINK_ID

# Archive
curl -X POST -H "Authorization: Bearer $RINKU_TOKEN" \
  http://127.0.0.1:47343/api/v1/links/LINK_ID/archive

# Get the machine-readable API description
curl -H "Authorization: Bearer $RINKU_TOKEN" \
  http://127.0.0.1:47343/api/v1/openapi.json
```

Common HTTP statuses: 400 invalid input, 401 missing/invalid token, 403 read-only or access restriction, 404 missing resource, 405 unsupported method, 409 ambiguous reference/existing library, 413 oversized body, and 415 unsupported content type.
