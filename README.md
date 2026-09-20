<div align="center">
  <h1>@cyanheads/gbif-biodiversity-mcp-server</h1>
  <p><b>Search GBIF species taxonomy, occurrence records, datasets, and publishers via MCP. STDIO or Streamable HTTP.</b>
  <div>13 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.7.4-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/gbif-biodiversity-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.0.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/gbif-biodiversity-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/gbif-biodiversity-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.0-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/gbif-biodiversity-mcp-server/releases/latest/download/gbif-biodiversity-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=gbif-biodiversity-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZ2JpZi1iaW9kaXZlcnNpdHktbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22gbif-biodiversity-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fgbif-biodiversity-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

**Public Hosted Server:** [https://gbif-biodiversity.caseyjhand.com/mcp](https://gbif-biodiversity.caseyjhand.com/mcp)

</div>

---

## Overview

GBIF species taxonomy, occurrence records, datasets, and publishers. Match names to the backbone taxonomy, search 3.9B+ occurrence records with Darwin Core filters, and browse dataset and publisher metadata from any MCP client. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `gbif_match_species` | Match a species name against the GBIF backbone taxonomy — returns taxonKey, confidence score, and full classification |
| `gbif_bulk_match_species` | Match up to 50 scientific names to backbone taxon keys in one call — results in input order, per-name NONE/ERROR isolation |
| `gbif_get_species` | Fetch a single backbone taxon by key — full classification, authorship, synonymy, vernacular name, descendant count |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy by name fragment, rank, or a kingdom, family, or genus name resolved to its backbone key |
| `gbif_get_species_classification` | Return the root-to-parent classification chain for a taxon — root-first ordered array from kingdom to the queried taxon's immediate parent (the taxon itself is not included) |
| `gbif_get_species_children` | List direct children of a backbone taxon — genera within a family, species within a genus |
| `gbif_search_occurrences` | Search 3.9B+ GBIF occurrence records with Darwin Core filters — country, publishing country, state/province, bounding box, WKT geometry, year, month, basis of record, presence/absence, IUCN Red List category |
| `gbif_count_occurrences` | Count occurrences matching a filter without fetching records — fast single-number response, filtered to sightings by default |
| `gbif_get_occurrence` | Fetch a single occurrence record by key — full Darwin Core record with GADM geography, presence/absence status, conservation status, media, and quality flags |
| `gbif_occurrence_facets` | Aggregate occurrence counts by a dimension — country, year, basis of record, dataset, kingdom, presence/absence, IUCN Red List category |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, publishing organization, or hosting organization |
| `gbif_get_dataset` | Fetch full dataset metadata by UUID — title, description, citation, contacts, license, DOI, coverage |
| `gbif_search_publishers` | Search GBIF-registered publishing organizations by name fragment or country |

### Resources

| Resource | Description |
|:---|:---|
| `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name |
| `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage |

Both resources are also reachable via `gbif_get_species` and `gbif_get_dataset`; many MCP clients are tool-only and never surface resources.

## Capability reference

### `gbif_match_species` <sub>tool</sub>

- Fuzzy matching handles minor typos and vernacular names; set `strict: true` for exact-only matching
- Returns `taxonKey` — the backbone key required by `gbif_search_occurrences`, `gbif_count_occurrences`, and `gbif_occurrence_facets`
- Confidence score 0–100; below 80 warrants review
- Full classification hierarchy with keys at each rank: kingdom, phylum, class, order, family, genus, species
- `matchType NONE` indicates no usable match — try removing strict mode or broadening the name
- Resolves synonyms: always returns the accepted backbone key regardless of which name form was queried; `matchedTaxonKey` carries the synonym's own key when the two differ
- `kingdom` disambiguates a name that appears in more than one kingdom, and is rejected when supplied blank: GBIF drops a blank one and matches against the whole backbone — `Parus major` resolves to taxon 9705453 with `kingdom=` exactly as it does with no `kingdom` at all, where `Plantae` resolves to 9711704 — so the undisambiguated answer would come back looking like a disambiguated one. Omit the field to match against the whole backbone

---

### `gbif_bulk_match_species` <sub>tool</sub>

- The batch counterpart to `gbif_match_species` — built for checklist, inventory, and species-list workflows that would otherwise need one round trip per name
- Returns one result per input name, in input order; each carries `taxonKey`, `matchType`, and confidence
- Per-name isolation: an unmatched name yields `matchType NONE` and a per-name lookup failure yields `matchType ERROR` with the message and, when the failure was classified, a `reason` — neither sinks the rest of the batch
- Same synonym resolution as `gbif_match_species`: `taxonKey` is the accepted taxon, `matchedTaxonKey` the synonym it was queried under
- `strict: true` requires an exact match for every name; common names are not supported (use `gbif_search_species`)

---

### `gbif_get_species` <sub>tool</sub>

- Full classification, authorship string, and vernacular (English) name when available
- `taxonomicStatus`: ACCEPTED, SYNONYM, DOUBTFUL — when SYNONYM, `acceptedKey` and `accepted` identify the current name
- `numDescendants` and `numOccurrences` for scope at a glance
- `extinct` field present only when explicitly flagged — not false on unlabeled taxa
- `publishedIn` carries the original description citation when available

---

### `gbif_search_species` <sub>tool</sub>

- Accepts name fragments matching scientific and vernacular names
- Filter by rank, kingdom, family, or genus to scope browsing
- `kingdom`, `family`, and `genus` are given as names and resolved to a backbone key before the search runs, since `/species/search` scopes by key alone. The narrowest one supplied is what scopes — the three nest, and GBIF combines two keys with OR rather than AND. `kingdom` supplied beside `family` or `genus` disambiguates that name instead of scoping on its own: `Prunella` names both a bird genus and a plant genus and resolves to neither without it
- Names are matched exactly and capitalized as GBIF writes them, so `paridae` and `Paridaee` fail as `unresolved_taxon_scope` rather than being ignored. An alternative family name lands on the taxon it is a synonym of — `Compositae` scopes to Asteraceae. A `family` and `genus` in different lineages fail as `conflicting_taxon_scope`. The scope actually applied comes back in the enrichment
- `isExtinct` filter for extinct vs. extant taxa
- Scope to a specific checklist dataset with `datasetKey` — omit the field for the GBIF backbone. GBIF reads a higher-taxon key inside the checklist that key belongs to, so pairing `datasetKey` with a kingdom, family, or genus matches nothing unless the checklist is the backbone; the empty-result notice says so
- `q`, `kingdom`, `family`, `genus`, and `datasetKey` are rejected when supplied blank rather than dropped: a blank `datasetKey` returns the unfiltered backbone result, and `q=` returns the whole 46,623,754-name index where `q=` with a space returns nothing. Omit a filter to leave it off
- Paginated — limit up to 1000, use offset to walk through large groups

---

### `gbif_get_species_classification` <sub>tool</sub>

- Root-first from kingdom down to the immediate parent of the queried taxon (kingdom → phylum → class → … → parent)
- The queried taxon itself is not included — use `gbif_get_species` for its own record
- Each entry: rank, canonical name, scientific name, taxon key
- Useful for building taxonomic trees or placing an unfamiliar taxon in context without manual backbone navigation

---

### `gbif_get_species_children` <sub>tool</sub>

- Genera within a family, species within a genus, subspecies within a species
- Each child: key, name, rank, taxonomic status, common name, occurrence count, descendant count
- Paginated — limit up to 1000, iterate with offset for large groups like Coleoptera

---

### `gbif_search_occurrences` <sub>tool</sub>

- Use `taxonKey` from `gbif_match_species` for reliable results — resolves synonyms automatically; `scientificName` filter does not
- Geographic filters: `country` (ISO 3166-1 alpha-2, uppercase), `stateProvince`, bounding box (`decimalLatitude`/`decimalLongitude` ranges as "min,max"), or WKT polygon (`geometry`)
- `publishingCountry` (ISO 3166-1 alpha-2, uppercase) is the country of the *publishing organization*, not of the observation — a different question from `country`, and the two disagree on most records: of 60,290,950 records observed in GB, 1,548,928 were published by US organizations
- Both country filters take the uppercase two-letter form only. GBIF parses a lowercase or alpha-3 code and then matches the verbatim string, so `gb` and `USA` return zero records instead of an error; the schema pattern turns that silent wrong answer into a validation error naming the accepted form. A two-letter code GBIF does not assign (`XX`) is rejected upstream by name and surfaces as `invalid_filter`
- `stateProvince` is matched verbatim — exact and case-sensitive, with no controlled vocabulary behind it. Take a value from a `STATE_PROVINCE` facet rather than guessing; an unmatched value returns zero records instead of an error, and the enrichment notice says so when it happens
- Every filter is checked whenever it is supplied, not only when it holds a value. GBIF ignores a parameter it is given with no value and answers 200 with the unfiltered scope, so a blank filter used to widen the query silently: `stateProvince: ""` returns all 60,290,950 records of a `taxonKey=212` + `country=GB` scope where `England` returns 47,672,439 — the same total, and the same first record, as a call that sends no `stateProvince` at all. A blank or whitespace-only value now fails as `invalid_filter` instead. Omit a field to leave that filter off
- Temporal filters: `year` as single year or range, `month` (1–12) for seasonal queries
- `basisOfRecord` enum: `HUMAN_OBSERVATION`, `PRESERVED_SPECIMEN`, `MACHINE_OBSERVATION`, and more
- `hasCoordinate` to require or exclude georeferenced records
- `occurrenceStatus` — `PRESENT` (default), `ABSENT`, or `ANY`. GBIF indexes absence records (a survey that looked for the taxon and did not find it) alongside sightings; the default excludes them and the enrichment says so on every call
- `iucnRedListCategory` — `CR`, `EN`, `VU`, `NT`, `LC`, `DD`, `EX`, `EW`, `CD`
- Output per record adds `taxonomicStatus`, `eventTime` (with UTC offset), `occurrenceStatus`, and `iucnRedListCategory`
- Pagination capped at offset+limit = 100,001, the deepest page GBIF serves. The API has no cursor or scroll, so a larger result set is covered by partitioning it — facet by `DATASET_KEY` with `gbif_occurrence_facets`, then search each `datasetKey` on its own. Retrieving a set in one piece is not something this server can do: that needs GBIF's Download API with a GBIF.org account, or GBIF's monthly snapshot on AWS Open Data

---

### `gbif_count_occurrences` <sub>tool</sub>

- Backed by `/occurrence/search` at `limit=0` — no record payload, and the same endpoint `gbif_search_occurrences` queries, so the two agree on the same question. GBIF's dedicated `/occurrence/count` endpoint takes a closed parameter set that rejects `occurrenceStatus` and `iucnRedListCategory` outright
- Supported filters: `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `isGeoreferenced`, `datasetKey`, `year`, `occurrenceStatus`, `iucnRedListCategory`. `country` and `publishingCountry` take the uppercase alpha-2 form only, and a blank filter is rejected rather than dropped, both for the reasons given under `gbif_search_occurrences`
- Counts sightings only by default, matching `gbif_search_occurrences`. For absence-heavy taxa the unfiltered figure is a different question entirely — *Radicipes gracilis* has 2,351,582 indexed records of which 79 are presences
- Use to assess result set size before deciding whether to paginate a full search. A count above 100,001 means paging cannot reach the end of it, and the enrichment notice says so and names the partition route

---

### `gbif_get_occurrence` <sub>tool</sub>

- Complete Darwin Core record — all coordinate fields, administrative geography (continent, country, state/province, locality), dates
- `occurrenceID`, full classification (`class`/`classKey`), GADM administrative units (levels 0–3, each with a stable GID and name), and source `identifiers`
- `occurrenceStatus` — check it before reading the record as a sighting; `ABSENT` means a survey looked and found nothing, and the record still carries coordinates, a date, and a recorder
- `taxonomicStatus`, `eventTime` (with UTC offset), and `iucnRedListCategory`
- Collections metadata: institution code, collection code, catalog number
- Collector and identifier names, individual count, sex, life stage
- Associated media (images, audio, video) with URLs and license
- GBIF data quality issue flags for provenance assessment

---

### `gbif_occurrence_facets` <sub>tool</sub>

- Facets: `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `BASIS_OF_RECORD`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `MONTH`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`
- Scope with `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `year`, `geometry`, `basisOfRecord`, `datasetKey`, `occurrenceStatus`, or `iucnRedListCategory` filters — so a `COUNTRY`, `PUBLISHING_COUNTRY`, or `STATE_PROVINCE` bucket can be passed straight back to drill into it. `country` and `publishingCountry` take the uppercase alpha-2 form only, and a blank filter is rejected rather than dropped, both for the reasons given under `gbif_search_occurrences`
- Aggregates sightings only by default, matching the search and count tools. To measure the presence/absence split itself, pass `facet: OCCURRENCE_STATUS` with `occurrenceStatus: ANY`
- Returns one page of values ranked by count descending — up to `facetLimit` (max 100), the top ones only while `facetOffset` is 0 — with no record payloads
- `DATASET_KEY` is the basis for splitting a result set too large for `gbif_search_occurrences` to page: every occurrence carries exactly one `datasetKey`, so its buckets sum to the scope's full total, and it has the cardinality to cut a large scope into pageable pieces. `BASIS_OF_RECORD` and `PUBLISHING_COUNTRY` are gap-free too and both have a matching filter on the occurrence tools, so either can drive a further split of a bucket still over the cap — but on that scope they return 9 and 41 buckets against `DATASET_KEY`'s 550, too coarse for the first cut. A dimension a record can lack drops that record: a 60,290,950-record scope faceted by `YEAR` sums to 59,407,400, leaving 883,550 undated records out, and `MONTH`, `STATE_PROVINCE`, and `SPECIES_KEY` behave the same way — `STATE_PROVINCE` included, even though the occurrence tools can filter on it
- The scope filters here are narrower than `gbif_search_occurrences` accepts — no `scientificName`, `month`, bounding box, `hasCoordinate`, `isInCluster`, or `coordinateUncertaintyInMeters`. Buckets sum to a search's total only when both calls carry the same filters; re-apply the rest on each per-`datasetKey` search
- Page past the first `facetLimit` with `facetOffset` (advance by `facetLimit` per page) to walk high-cardinality facets like `DATASET_KEY`; enrichment echoes the applied `facetOffset` and sets `moreValuesLikely` when a full page suggests more values remain
- Core tool for distribution analysis ("which countries have the most records?") and trend queries ("how has observation volume changed since 2010?")

---

### `gbif_search_datasets` <sub>tool</sub>

- Filters: free-text query, dataset type (`OCCURRENCE`, `CHECKLIST`, `METADATA`, `SAMPLING_EVENT`), `publishingCountry` (ISO 3166-1 alpha-2, uppercase), publishing and hosting organization UUIDs (lowercase)
- `publishingCountry` takes the uppercase two-letter form only, for the same reason the occurrence filters do: `/dataset/search` matches the verbatim stored code, so `gb` and `GBR` return zero datasets where `GB` returns 2,416. A two-letter code GBIF does not assign (`XX`) is rejected upstream by name and surfaces as `invalid_filter`
- Returns title, type, description, license, DOI, and record count. `recordCount` spans every `occurrenceStatus`, absences included — `gbif_count_occurrences` with the same key counts sightings only by default, so the two figures differ by design
- The `description` is a 300-character preview — `descriptionTruncated` flags when it was shortened, and `gbif_get_dataset` returns the full text
- An organization key from `gbif_search_publishers` chains in two ways, and they answer different questions. `publishingOrg` matches the organization whose data it is; `hostingOrg` matches the organization whose installation serves it. `publishingOrg` is almost always the one meant — Butterfly Conservation (`0d72dd7f-6f05-46af-85c2-8b6e77ce5534`) publishes 3 datasets and hosts none, while the National Biodiversity Network (`07f617d0-c688-11d8-bf62-b8a03c50a862`) hosts 984, those 3 among them, and publishes 1
- Supplying both organization filters intersects them rather than combining them, so the same key in both fields returns only what that organization published *and* serves. An empty result under both is called out by name in the response notice
- Both take the lowercase 8-4-4-4-12 hex UUID form and are checked before the request goes out, because GBIF answers the two silent ways of getting them wrong with a wrong result rather than an error: an empty organization value returns the whole 123,527-dataset index, and these two filters are matched case-sensitively, so an upper-cased key returns 0 where the same key lowercased matches. Both fail locally as `invalid_filter`, as a malformed value does
- The free-text `q` is rejected blank on the same ground, and the route makes the case plainly: `q=` returns all 123,527 datasets while `q=` with a single space returns none. One character between the whole index and an empty page is not a distinction to leave to chance — omit the field to browse without a term
- Paginated — limit up to 1000

---

### `gbif_get_dataset` <sub>tool</sub>

- Full description, citation text (for academic reference), license, DOI
- Contacts with role, name, organization, and email — capped by `contactLimit` (default 10, max 100); `contactsTotal`/`contactsReturned` report the full count
- Temporal and geographic coverage ranges when the publisher declares them
- `recordCount` — the indexed occurrence total, matching what `gbif_search_datasets` reports, for every dataset type (a `CHECKLIST` reports 0). It spans every `occurrenceStatus`, absences included; `gbif_count_occurrences` with the same key counts sightings only by default, so the two figures differ by design
- `numConstituents` for aggregate datasets (e.g. iNaturalist, eBird)
- Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail

---

### `gbif_search_publishers` <sub>tool</sub>

- Filter by name fragment or country
- `country` here is unconstrained on purpose: the registry endpoint matches the *parsed* country rather than the verbatim string, so `gb`, `GBR`, and `GB` all return the same 223 organizations. The uppercase-only rule the occurrence tools and `gbif_search_datasets` carry exists to close a silent zero that does not occur on this route. One value is rejected — an empty `country`, which the registry answers with all 3,561 registered organizations rather than an error; omit the field to search every country. Whitespace alone is left to the registry, which answers it with `400 Cannot parse … into a known Country`, an error naming the value
- `q` is rejected blank in both forms, because the registry drops either one and answers with all 3,561 organizations against 460 for `museum`; omit the field to browse without a name term
- Returns organization key, title, and country. The key chains into `gbif_search_datasets` as `publishingOrg` for the datasets the organization published, or as `hostingOrg` for the ones its own installation serves. `publishingOrg` is the usual chain: of the first 25 GB organizations the registry lists, all 25 host no datasets while 13 publish one or two
- Paginated — limit up to 1000

---

### `gbif://species/{taxonKey}` <sub>resource</sub>

- Taxon record as `application/json` — classification, authorship, synonymy status, vernacular name, descendant count
- `taxonKey` comes from `gbif_match_species` or `gbif_search_species`
- `extinct` present only when explicitly flagged, absent otherwise, matching `gbif_get_species`
- A key that resolves to no backbone taxon fails as `not_found`; a non-numeric key segment is rejected locally as a validation error, and a numeric one GBIF cannot parse comes back as `invalid_filter`

---

### `gbif://dataset/{datasetKey}` <sub>resource</sub>

- Dataset record as `application/json` — title, description, citation, license, DOI, temporal and geographic coverage
- Contacts fixed at 10 (no configurable limit, unlike `gbif_get_dataset`'s `contactLimit`); `contactsTotal`/`contactsReturned` report the full count
- `recordCount` spans every `occurrenceStatus`, absences included
- `datasetKey` comes from `gbif_search_datasets` or an occurrence record's `datasetKey` field; a key that resolves to no dataset fails as `not_found`

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

GBIF-specific:

- Full GBIF REST API v1 coverage: species taxonomy, occurrences, datasets, and publishers
- `gbif_match_species` as the entry point — resolves synonyms to backbone taxon keys used throughout
- Occurrence pagination guarded at GBIF's own offset+limit = 100,001 boundary — an over-cap request fails locally with a recovery hint naming the `DATASET_KEY` partition technique, instead of spending the retry budget on a deterministic upstream rejection, and a match larger than the cap says so on the first page rather than after hundreds of them
- WKT polygon geometry support for geographic occurrence queries
- Darwin Core field mapping with explicit provenance on sparse upstream fields

Agent-friendly output:

- `gbif_match_species` is the mandatory first step — all downstream tools document which key they expect
- Graceful sparse-field handling — optional fields absent from the API response are omitted rather than null-filled
- Discriminated error contracts with typed reasons, structured recovery hints, and `when` documentation per tool

## Getting started

### Public Hosted Instance

A public instance is available at `https://gbif-biodiversity.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "streamable-http",
      "url": "https://gbif-biodiversity.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/gbif-biodiversity-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/gbif-biodiversity-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "gbif-biodiversity-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/gbif-biodiversity-mcp-server:latest"]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.4.0](https://bun.sh/) or higher.
- No credentials — the GBIF endpoints this server calls are public.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/gbif-biodiversity-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd gbif-biodiversity-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

## Configuration

All configuration is validated at startup via Zod schemas in `src/config/server-config.ts`. Key environment variables:

| Variable | Description | Default |
|:---|:---|:---|
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http` | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `3010` |
| `MCP_HTTP_ENDPOINT_PATH` | HTTP endpoint path where the MCP server is mounted | `/mcp` |
| `MCP_PUBLIC_URL` | Public origin override for TLS-terminating reverse-proxy deployments | none |
| `MCP_SESSION_MODE` | HTTP session mode: `stateful`, `stateless`, or `auto` (the schema default, which resolves to `stateful`). `src/index.ts` declares `stateless`, so set this only to override that. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if RSS grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `GBIF_BASE_URL` | GBIF API base URL override | `https://api.gbif.org/v1` |
| `GBIF_REQUEST_TIMEOUT_MS` | HTTP request timeout in milliseconds | `10000` |
| `GBIF_USER_AGENT` | `User-Agent` sent on every GBIF request. GBIF asks integrators to identify themselves with a contact URL or email. | server name, version, and repository URL |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

## Running the server

### Local development

- **Build and run the production version**:

  ```sh
  # One-time build
  bun run rebuild

  # Run the built server
  bun run start:http
  # or
  bun run start:stdio
  ```

- **Run checks and tests**:
  ```sh
  bun run devcheck  # Lints, formats, type-checks, and more
  bun run test      # Runs the test suite
  ```

### Docker

```sh
docker build -t gbif-biodiversity-mcp-server .
docker run --rm -p 3010:3010 gbif-biodiversity-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/gbif-biodiversity-mcp-server`. OpenTelemetry peer dependencies are installed by default — build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Thirteen tools across species taxonomy, occurrences, datasets, and publishers. |
| `src/mcp-server/resources` | Resource definitions. Species and dataset stable-URI resources. |
| `src/services/gbif` | GBIF REST API service layer — client, request handling, type definitions. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
