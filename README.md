# Rinku

Rinku is a local-first Electron/plain JavaScript app for saving, organizing, and revisiting links. It is designed around user-owned libraries on disk rather than a hosted account or remote database.

## Current Status

This repository is an early working foundation. It includes:

- A Markdown library storage engine.
- An Electron desktop shell.
- A CLI.
- An MCP server skeleton.
- An Unmark JSON importer.
- Core tests for storage, import, CLI, and MCP behavior.

Install dependencies before launching the desktop app:

```sh
npm install
npm start
```

Run the test suite without Electron dependencies:

```sh
npm test
```

## Current Product Decisions

- Rinku supports multiple libraries.
- Each library stores active links under `links/` and archived links under `archive/`.
- Labels are folder-based: `links/<label>/` for active links and `archive/<label>/` for archived links.
- Each link has one label.
- Each link can have multiple contexts.
- Learned label rules are enabled by default and must be configurable.
- Safari capture is not required for v1.
- A local HTTP capture endpoint is optional.

## Documentation

- [Product brief](docs/product.md)
- [Storage model](docs/storage-model.md)
- [CLI and MCP](docs/cli-mcp.md)
- [Unmark migration](docs/unmark-migration.md)
