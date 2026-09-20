# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.7.4](changelog/0.7.x/0.7.4.md) — 2026-09-20 · ⚠️ Breaking · 🛡️ Security

The Bun engines floor rises to >=1.4.0 with the mcp-ts-core ^0.13.6 upgrade, and a rejected tool call now returns InvalidParams instead of ValidationError. stripHtml decoded &amp; before the references that followed it, so a literally-escaped reference like &amp;lt; lost a level of escaping (CodeQL js/double-escaping, #56).

## [0.7.3](changelog/0.7.x/0.7.3.md) — 2026-08-25

@cyanheads/mcp-ts-core ^0.11.1 → ^0.12.3 (tool inputs now strict; MCP SDK moves to @modelcontextprotocol/server); gbif_get_dataset and gbif_occurrence_facets adopt the framework's standard truncated/shown/cap trailer for their contact-list and facet-page caps.

## [0.7.2](changelog/0.7.x/0.7.2.md) — 2026-08-06

kingdom, family, and genus on gbif_search_species now scope the search — each name is resolved to a GBIF backbone key and the narrowest is forwarded as higherTaxonKey, the parameter /species/search actually implements.

## [0.7.1](changelog/0.7.x/0.7.1.md) — 2026-08-06

gbif_search_datasets gains a publishingOrg filter, so an organization key from gbif_search_publishers reaches the datasets that organization published; every optional filter across the seven filtering tools now rejects a blank value instead of dropping it and answering the unfiltered scope.

## [0.7.0](changelog/0.7.x/0.7.0.md) — 2026-08-06 · ⚠️ Breaking

country on the three occurrence tools and publishingCountry on gbif_search_datasets now reject non-canonical forms instead of silently matching zero records; a whitespace-padded uppercase code, previously tolerated, now fails validation.

## [0.6.1](changelog/0.6.x/0.6.1.md) — 2026-08-06

pagination_cap_exceeded guidance now names a real DATASET_KEY partition technique instead of an aggregate tool; publishingCountry and stateProvince are new filters on all three occurrence tools.

## [0.6.0](changelog/0.6.x/0.6.0.md) — 2026-08-06 · ⚠️ Breaking

Occurrence tools now default occurrenceStatus to PRESENT, excluding absence records that previously counted as sightings; occurrenceStatus and iucnRedListCategory are new fields and filters; taxonomicStatus, eventTime, and GADM level3 are surfaced; dataset recordCount now states its wider scope.

## [0.5.5](changelog/0.5.x/0.5.5.md) — 2026-08-06

gbif_match_species and gbif_bulk_match_species now resolve a synonym to its accepted backbone key via matchedTaxonKey; format() text no longer misstates rendered data on three tools; species-children and classification tools gain pagination and root-taxon guidance; invalid_filter is declared on six surfaces that already threw it.

## [0.5.4](changelog/0.5.x/0.5.4.md) — 2026-08-06

Upstream 400s now carry a reason and recovery hint with GBIF's explanation folded into the message; six tools plus the dataset resource validate UUID-shaped keys before any request; recordCount is populated for OCCURRENCE datasets; the pagination guard matches GBIF's real 100,001 boundary.

## [0.5.3](changelog/0.5.x/0.5.3.md) — 2026-08-06

Every gbif_* tool now declares openWorldHint true, matching its live GBIF API calls. Requests carry an identifying User-Agent (overridable via GBIF_USER_AGENT), and the docs no longer claim GBIF issues an API key. mcp-ts-core bumped to ^0.11.1, typescript to ^7.0.2.

## [0.5.2](changelog/0.5.x/0.5.2.md) — 2026-07-13

gbif_occurrence_facets gains a facetOffset input for paging past the first 100 facet values; gbif_search_datasets flags truncated dataset descriptions in structured output; gbif_get_species_classification's description corrected to match its actual root-to-parent output.

## [0.5.1](changelog/0.5.x/0.5.1.md) — 2026-07-13

gbif_get_occurrence and gbif_get_dataset now return their advertised GADM, coverage, and contact fields; gbif_get_species class-name and key-only classification bugs fixed; mcp-ts-core bumped to ^0.10.14 with Socket install-scanner supply-chain hardening.

## [0.5.0](changelog/0.5.x/0.5.0.md) — 2026-06-30

Adds gbif_bulk_match_species — resolve up to 50 scientific names to GBIF backbone taxon keys in one call with per-name NONE/ERROR isolation. Removes the always-zero totalCount from gbif_get_species_children in favor of honest page-truncation fields, and corrects the gbif_match_species matchType enum to HIGHERRANK.

## [0.4.0](changelog/0.4.x/0.4.0.md) — 2026-06-30 · 🛡️ Security

gbif_search_occurrences and gbif_occurrence_facets gain an optional datasetKey filter for dataset-scoped retrieval and aggregation; hasCoordinate description corrected. Adopts mcp-ts-core ^0.10.10, whose lockfile re-resolve clears a transitive js-yaml DoS advisory.

## [0.3.0](changelog/0.3.x/0.3.0.md) — 2026-06-30

gbif_get_dataset gains a contactLimit control (default 10) with contactsTotal/contactsReturned counts; species and dataset resource reads now return clean not_found errors; HTML stripped from species publishedIn and dataset descriptions.

## [0.2.9](changelog/0.2.x/0.2.9.md) — 2026-06-20

Adopt @cyanheads/mcp-ts-core ^0.10.9: two new devcheck guards (floating dependency specifiers, plugin marketplace manifest correctness), ctx.content collector, Canvas SQL gate invalid_sql classification, DuckdbProvider.describe() filter fix; biome 2.5 + re-synced skills and scripts

## [0.2.8](changelog/0.2.x/0.2.8.md) — 2026-06-15

Server-level instructions sent on initialize; plugin display identity unscoped to the bare package name across the Claude and Codex manifests.

## [0.2.7](changelog/0.2.x/0.2.7.md) — 2026-06-12

Adopt @cyanheads/mcp-ts-core ^0.10.6: server identity name/title, totalCount in species-children enrichment, post-pack bundle cleaner, expanded packaging linter, Docker HEALTHCHECK and version label.

## [0.2.6](changelog/0.2.x/0.2.6.md) — 2026-06-04

gbif_get_species_children: proper not_found on invalid taxonKey (#19); gbif_get_species_classification: guard getSpeciesParents against McpError NotFound (#20)

## [0.2.5](changelog/0.2.x/0.2.5.md) — 2026-06-02

mcp-ts-core 0.9.21 — per-request log context fix, secret-scrubbing in fetch errors, withRetry fail-fast on non-retryable errors

## [0.2.4](changelog/0.2.x/0.2.4.md) — 2026-05-30

Enrichment adoption — search/facet tools surface query echoes, true totals, and empty-result guidance via typed enrichment block

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
