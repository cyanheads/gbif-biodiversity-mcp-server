# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.2.3](changelog/0.2.x/0.2.3.md) — 2026-05-28

Stop sending Basic auth to keyless GBIF API; remove GBIF_API_KEY

## [0.2.2](changelog/0.2.x/0.2.2.md) — 2026-05-28

mcp-ts-core ^0.9.13: HTTP 413 body cap, session-init gate, quieter auth error logging, GET /mcp keywords; ValidationError reclassifications for pagination cap and invalid taxon key

## [0.2.1](changelog/0.2.x/0.2.1.md) — 2026-05-24

Fix facet percentage calculation; add STATE_PROVINCE facet and coordinateUncertaintyInMeters filter; document year range inclusivity, taxonKey descendant matching, and isInCluster limitation.

## [0.2.0](changelog/0.2.x/0.2.0.md) — 2026-05-24 · ⚠️ Breaking

Rename: repo and npm package renamed from gbif-mcp-server to gbif-biodiversity-mcp-server (tool prefix gbif_* unchanged).

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-05-24

Event listener fix on retries, stripHtml dedup, mcp-ts-core ^0.9.7 → ^0.9.9

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-05-24

Field-test fixes: 404 error contracts on lookup tools, existence validation in get_species_classification, pre-flight pagination cap guard in search_occurrences, corrected match_species description.

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-05-23

Adds hosted server endpoint metadata — remotes block in server.json and public URL in README.

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-05-23

Metadata alignment: Dockerfile OCI labels, package.json scripts/files/engines, manifest.json fields, .mcpbignore, README Docker badge and Bun version.

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-05-23

Sync tagline across all metadata surfaces: package.json, server.json, manifest.json, README, and CLAUDE.md.

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-05-23

Bug fixes — correct search_publishers endpoint, scientificName occurrence fallback, remove fabricated totalCount, HTML stripping for dataset descriptions.

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-05-23

First npm publish — agent-facing output improvements, code cleanup, and packaging metadata.

## [0.1.0](changelog/0.1.x/0.1.0.md) — 2026-05-23

Initial release — 12 tools and 2 resources for GBIF species taxonomy, occurrence records, datasets, and publishers.
