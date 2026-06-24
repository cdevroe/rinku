# Product Brief

Rinku is a local-first link library for people who want durable, inspectable bookmark data without depending on a hosted service. The app should feel fast for daily capture, simple for retrieval, and friendly to automation.

## Core Concepts

- **Library:** A portable folder containing one collection of links, archive records, settings, and learned rules. Rinku supports multiple libraries.
- **Link:** A saved URL with title, notes, timestamps, source information, one label, and zero or more contexts.
- **Label:** The primary organizational bucket for a link. A link has exactly one label, and that label determines its storage folder.
- **Context:** A secondary facet for projects, people, places, clients, or workflows. A link may have multiple contexts.
- **Archive:** A place for links that should be retained but removed from the active collection.
- **Learned label rule:** A configurable rule Rinku learns from user behavior to suggest or apply labels. Learned rules are enabled by default.

## Primary Workflows

- Capture a link from the desktop app, CLI, or optional local HTTP endpoint.
- Review and edit title, notes, label, and contexts.
- Let learned label rules suggest or apply a label, with settings to disable or adjust that behavior.
- Browse or search active links by library, label, context, title, URL, and notes.
- Archive and restore links while preserving their label and metadata.
- Switch between multiple local libraries.

## V1 Boundaries

- Safari capture is not required for v1.
- A hosted sync service is not assumed.
- Multi-label links are not supported. Use one label plus multiple contexts.
- The local HTTP capture endpoint is optional, local-only, and should not be required for normal app use.
