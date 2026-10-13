# Storage Model

Rinku stores each library as a user-owned folder on disk. The storage format should be durable, inspectable, and recoverable without a remote service.

## Library Layout

```text
<library>/
  rinku-settings.md
  links/
    Read/
      example.com-example-title-rkabc123.md
    Watch/
    Listen/
    Buy/
    Eat & Drink/
    Do/
    Unlabeled/
  archive/
    Read/
    Watch/
    Listen/
    Buy/
    Eat & Drink/
    Do/
    Unlabeled/
  .rinku/
    index.json
```

## Folder Rules

- Active links live under `links/<label>/`.
- Archived links live under `archive/<label>/`.
- A link has exactly one label, so each link record has exactly one canonical folder location.
- Contexts are stored as fields on the link record, not as folders, because a link can have multiple contexts.
- Renaming a label moves affected records between label folders.
- Archiving a link moves it from `links/<label>/` to `archive/<label>/`.
- Restoring a link moves it from `archive/<label>/` to `links/<label>/`.

## Link Files

Each link is a Markdown file with frontmatter owned by Rinku and body text used as link notes.

```markdown
---
id: rkabc123def456
url: https://example.com/article
urlHash: d1a8f8a5
title: Example Article
domain: example.com
label: read
tags: ["research"]
contexts: ["@Work"]
status: active
createdAt: 2026-06-24T13:00:00.000Z
updatedAt: 2026-06-24T13:00:00.000Z
archivedAt: ""
source: {"cli":{"addedAt":"2026-06-24T13:00:00.000Z"}}
---

Notes about why this link is worth revisiting.
```

File names include the domain, a title slug, and the stable link id:

```text
example.com-example-title-rkabc123def456.md
```

The id remains canonical if the title or URL later changes.

## Library Settings

`rinku-settings.md` stores labels, contexts, learned label rules, and capture settings in frontmatter.

```markdown
---
schemaVersion: 1
labels: [{"id":"read","name":"Read","color":"#f97316"},{"id":"watch","name":"Watch","color":"#2563eb"},{"id":"listen","name":"Listen","color":"#eab308"},{"id":"buy","name":"Buy","color":"#9333ea"},{"id":"eat-drink","name":"Eat & Drink","color":"#16a34a"},{"id":"do","name":"Do","color":"#db2777"},{"id":"unlabeled","name":"Unlabeled","color":"#64748b"}]
contexts: ["@Home","@Work"]
smartLabels: {"learnFromManualChanges":true,"rules":[]}
capture: {"localHttpEnabled":false,"localHttpPort":47342}
---

# Rinku Settings
```

## Index

`.rinku/index.json` is a rebuildable cache used for fast listing and filtering. The library remains reconstructible from `rinku-settings.md` and the Markdown link files.

## Notes

- `label` is singular by design. Do not add a `labels` array for v1.
- Contexts are normalized with an `@` prefix, so `Home` becomes `@Home`.
- Local indexes or caches are allowed, but the library must remain reconstructible from canonical Markdown files and settings.
- File names are readable but should not be treated as the source of truth.
- Importers should preserve original source metadata without changing the canonical one-label storage model.
