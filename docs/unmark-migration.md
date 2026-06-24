# Unmark Migration

Rinku includes an importer for Unmark JSON exports.

## Migration Goals

- Preserve URLs, titles, notes, timestamps, status, and source metadata where available.
- Import into one selected Rinku library by default.
- Preserve Rinku's one-label storage model.
- Keep the imported library browseable in Finder, Obsidian, and other Markdown tools.

## Verified Export Fixture

The initial importer has been tested against `export-3.json`.

```text
total:       3,735
active:      2,343
archived:    1,392
notes:         133
custom titles:  93
```

Label distribution:

```text
Unlabeled:   1,705
Read:          961
Listen:        303
Watch:         286
Do:            251
Buy:           191
Eat & Drink:    38
```

## Mapping Rules

- Active Unmark items import under `links/<label>/`.
- Archived or completed Unmark items import under `archive/<label>/`.
- Unmark labels map to the equivalent Rinku built-in labels.
- Missing or unusable labels import as `Unlabeled`.
- Unmark notes become the Markdown body.
- Unmark timestamps are preserved where available.
- Original Unmark metadata is preserved under `source.unmark`.
- Import IDs use the source mark id when available, prefixed with `um`.

## Duplicate Handling

The current importer skips exact URL duplicates already present in the target library. It intentionally does not collapse case-only URL differences or URL-encoded case differences, because the verified export includes examples where those records differ in label or archive state.

## Import Report

Each migration should produce a report with:

- Total items read.
- Items imported into active links.
- Items imported into archive.
- Items skipped as duplicates.
- Failed items.

The implemented CLI command is:

```sh
rinku import unmark --file /path/to/export.json --library /path/to/Rinku\ Library
```

Use `--json` for a machine-readable report.
