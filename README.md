<div align="center">
  <h1>@cyanheads/gbif-biodiversity-mcp-server</h1>
  <p><b>Search GBIF species taxonomy, occurrence records, datasets, and publishers via MCP. STDIO or Streamable HTTP.</b>
  <div>13 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.7.4-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/gbif-biodiversity-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.2.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/gbif-biodiversity-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/gbif-biodiversity-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.2-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/gbif-biodiversity-mcp-server/releases/latest/download/gbif-biodiversity-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=gbif-biodiversity-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZ2JpZi1iaW9kaXZlcnNpdHktbWNwLXNlcnZlciJdfQ==) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22gbif-biodiversity-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fgbif-biodiversity-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://gbif-biodiversity.caseyjhand.com/mcp](https://gbif-biodiversity.caseyjhand.com/mcp)

</div>

---

## Overview

Species taxonomy, occurrence records, datasets, and publishers from the Global Biodiversity Information Facility (GBIF). Match names to the backbone taxonomy, search and aggregate 3.9B+ occurrence records with Darwin Core filters, and trace records back to their datasets and publishers. Runs as a stdio process, a local Streamable HTTP server, or the public hosted endpoint above.

### Tools

| Tool | Description |
|:---|:---|
| `gbif_match_species` | Match a scientific name to the GBIF backbone, returning its taxon key, confidence, and classification |
| `gbif_bulk_match_species` | Match up to 50 scientific names in one call, one result per name in input order |
| `gbif_get_species` | Fetch a backbone taxon by key: classification, authorship, synonymy, vernacular name, counts |
| `gbif_search_species` | Search or browse the backbone by name fragment, rank, or a kingdom, family, or genus name |
| `gbif_get_species_classification` | Return a taxon's parent chain, root-first from kingdom to its immediate parent |
| `gbif_get_species_children` | List a taxon's direct children, such as the genera in a family or the species in a genus |
| `gbif_search_occurrences` | Search 3.9B+ occurrence records by taxon, place, date, basis of record, presence/absence, and IUCN category |
| `gbif_count_occurrences` | Count occurrences matching a filter without fetching records |
| `gbif_get_occurrence` | Fetch one full Darwin Core occurrence record by key |
| `gbif_occurrence_facets` | Aggregate occurrence counts by country, year, dataset, taxon, status, and other dimensions |
| `gbif_search_datasets` | Search datasets by keyword, type, publishing country, or publishing or hosting organization |
| `gbif_get_dataset` | Fetch full dataset metadata by UUID: citation, contacts, license, DOI, coverage |
| `gbif_search_publishers` | Search GBIF-registered publishing organizations by name or country |

### Resources

| Resource | Description |
|:---|:---|
| `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone: classification, authorship, synonymy status, vernacular name |
| `gbif://dataset/{datasetKey}` | Dataset metadata: title, description, citation, license, contacts, coverage |

Both resources are also reachable via `gbif_get_species` and `gbif_get_dataset`; many MCP clients are tool-only and never surface resources.

## Capability reference

### `gbif_match_species` <sub>tool</sub>

- One scientific `name` (common names go to `gbif_search_species`), with optional `strict`, a `kingdom` to disambiguate, and an expected `rank`
- Returns `taxonKey`, the accepted taxon to pass to the occurrence tools, plus `matchedTaxonKey` when a synonym was resolved, `matchType` (`EXACT`, `FUZZY`, `HIGHERRANK`), `confidence` 0–100 (review below 80), and the classification with a key at each rank
- `matchType` `NONE` fails as `no_match`; a blank `kingdom` fails as `invalid_filter`

---

### `gbif_bulk_match_species` <sub>tool</sub>

- 1–50 scientific `names` per call, with `strict`; results come back in input order
- Each result carries `name` and `matchType`, and on a match `taxonKey`, `matchedTaxonKey` (synonyms), and `confidence`; an unmatched name is `NONE`, a failed lookup is `ERROR` with `error` and, when classified, `reason`, and neither fails the batch

---

### `gbif_get_species` <sub>tool</sub>

- One backbone `taxonKey`; a key not in the backbone fails as `not_found`, one GBIF cannot parse (a fraction, or past the 32-bit range) as `invalid_filter`
- Returns the classification with rank keys, `authorship`, `vernacularName`, `numDescendants`, `numOccurrences`, `publishedIn`, and `parentKey`; a `taxonomicStatus` of `SYNONYM` comes with `acceptedKey` and `accepted`

---

### `gbif_search_species` <sub>tool</sub>

- `q` name fragment (scientific and vernacular), `rank`, `isExtinct`, and a checklist `datasetKey` (omit for the backbone); up to 1,000 per page with `offset`
- Taxa carry `key`, `rank`, `taxonomicStatus`, classification names, `numOccurrences`, and `numDescendants`; enrichment reports `totalCount`, `endOfRecords`, and the `taxonScope` applied
- `kingdom`, `family`, and `genus` take names, matched exactly as GBIF capitalizes them; the narrowest one scopes, and `kingdom` beside a narrower one disambiguates it. An unknown name fails as `unresolved_taxon_scope`, a genus outside the named family as `conflicting_taxon_scope`, and a scope paired with a non-backbone `datasetKey` matches nothing. A blank filter or a malformed `datasetKey` fails as `invalid_filter`

---

### `gbif_get_species_classification` <sub>tool</sub>

- One `taxonKey`; returns `classification` root-first from kingdom to the immediate parent, each entry with `key`, `rank`, `name`, and `scientificName`
- The queried taxon is not included (use `gbif_get_species`); a root taxon returns an empty chain with a notice, an unknown key fails as `not_found`, and one GBIF cannot parse as `invalid_filter`

---

### `gbif_get_species_children` <sub>tool</sub>

- One `taxonKey`, up to 1,000 children per page with `offset`; no filters. An unknown key fails as `not_found`, one GBIF cannot parse as `invalid_filter`
- Each child carries `key`, `canonicalName`, `rank`, `taxonomicStatus`, `vernacularName`, `numOccurrences`, and `numDescendants`; GBIF reports no total, so `endOfRecords` (with `truncated` while more remain) is the continuation signal

---

### `gbif_search_occurrences` <sub>tool</sub>

- Filters: `taxonKey` (preferred; `scientificName` does not match synonyms), `country`, `publishingCountry`, `stateProvince`, a `decimalLatitude`/`decimalLongitude` box or WKT `geometry`, `year`, `month`, `basisOfRecord`, `hasCoordinate`, `isInCluster`, `coordinateUncertaintyInMeters`, `datasetKey`, `occurrenceStatus`, `iucnRedListCategory`; up to 300 per page
- Records carry `key`, `taxonKey`, `taxonomicStatus`, coordinates, `eventDate` and `eventTime`, `basisOfRecord`, `occurrenceStatus`, `iucnRedListCategory`, `datasetKey`, and `issues`; enrichment reports `totalCount`, `endOfRecords`, and the `occurrenceStatus` applied
- `offset + limit` caps at 100,001 and GBIF has no cursor; a deeper request fails as `pagination_cap_exceeded`, and a larger match is reached by partitioning on a `DATASET_KEY` facet from `gbif_occurrence_facets`. A rejected filter value fails as `invalid_filter`

---

### `gbif_count_occurrences` <sub>tool</sub>

- Filters: `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `isGeoreferenced`, `datasetKey`, `year`, `occurrenceStatus`, `iucnRedListCategory`
- Returns `count`, with the `occurrenceStatus` applied in the enrichment; a count above 100,001 carries a notice naming the partition route, and a rejected filter value fails as `invalid_filter`

---

### `gbif_get_occurrence` <sub>tool</sub>

- One `occurrenceKey` from a search result; an unknown key fails as `not_found`, one GBIF cannot parse as `invalid_filter`
- The full Darwin Core record: `occurrenceStatus` (`ABSENT` is a survey that found nothing, not a sighting), coordinates, GADM levels 0–3 under `gadm`, dates with `eventTime`, `taxonomicStatus`, `iucnRedListCategory`, institution, collection, and catalog codes, `recordedBy` and `identifiedBy`, `media`, `identifiers`, and `issues`

---

### `gbif_occurrence_facets` <sub>tool</sub>

- `facet` is one of `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `MONTH`, `BASIS_OF_RECORD`, `DATASET_KEY`, `PUBLISHING_COUNTRY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`; up to 100 values per page (`facetLimit`, default 10), paged with `facetOffset`
- Scope filters: `taxonKey`, `country`, `publishingCountry`, `stateProvince`, `year`, `geometry`, `basisOfRecord`, `datasetKey`, `occurrenceStatus`, `iucnRedListCategory`. Returns `totalOccurrences` and `counts` ranked by count; a full page sets `truncated` in the enrichment, and a rejected scope value fails as `invalid_filter`
- `DATASET_KEY` buckets sum to the scope's full total, so it is the facet for partitioning a search too large to page; `YEAR`, `MONTH`, `STATE_PROVINCE`, and `SPECIES_KEY` drop records that lack the field. Pass `facet: OCCURRENCE_STATUS` with `occurrenceStatus: ANY` for the presence/absence split

---

### `gbif_search_datasets` <sub>tool</sub>

- Filters: `q`, `type` (`OCCURRENCE`, `CHECKLIST`, `METADATA`, `SAMPLING_EVENT`), `publishingCountry`, `publishingOrg`, `hostingOrg`; up to 1,000 per page
- Returns `key`, `title`, `type`, `license`, `doi`, `recordCount`, and a 300-character `description` preview, with `descriptionTruncated` flagging a cut (`gbif_get_dataset` has the full text)
- `publishingOrg` matches the organization whose data it is and is the usual chain from `gbif_search_publishers`; `hostingOrg` matches the organization whose installation serves it, and the two together intersect. Both take the lowercase UUID form; anything else, like any rejected filter value, fails as `invalid_filter`

---

### `gbif_get_dataset` <sub>tool</sub>

- One `datasetKey` UUID and `contactLimit` (default 10, max 100; `0` drops contact detail but keeps `contactsTotal`); a malformed key fails as `invalid_filter`, an unknown one as `not_found`
- Returns `description`, `citationText`, `license`, `doi`, `recordCount`, `numConstituents`, `contacts` with `contactsTotal` and `contactsReturned`, `temporalCoverages`, and `geographicCoverages`

---

### `gbif_search_publishers` <sub>tool</sub>

- `q` name fragment and `country` (alpha-2 or alpha-3, any case); up to 1,000 per page
- Returns organization `key`, `title`, `country`, and `city`; the key chains into `gbif_search_datasets` as `publishingOrg`
- A blank `q`, an empty `country`, or a country GBIF cannot parse fails as `invalid_filter`

---

### `gbif://species/{taxonKey}` <sub>resource</sub>

- Taxon record as `application/json`: classification names, `authorship`, `vernacularName`, `taxonomicStatus` with `acceptedKey` and `accepted`, `numDescendants`
- `taxonKey` comes from `gbif_match_species` or `gbif_search_species`; an unknown key fails as `not_found`, a non-numeric or unparseable one as `invalid_filter`

---

### `gbif://dataset/{datasetKey}` <sub>resource</sub>

- The `gbif_get_dataset` record as `application/json`, with contacts fixed at 10
- `datasetKey` comes from `gbif_search_datasets` or an occurrence record; an unknown key fails as `not_found`, a malformed one as `invalid_filter`

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

GBIF-specific:

- GBIF API v1 species, occurrence, dataset, and organization endpoints, keyless, with an identifying `User-Agent` on every request
- Synonym-safe keys: `gbif_match_species` resolves a synonym to its accepted taxon, and the occurrence tools filter on that `taxonKey`
- Sightings by default: the search, count, and facet tools default `occurrenceStatus` to `PRESENT`, excluding absence records. Dataset `recordCount` spans every status, so it runs higher than a `gbif_count_occurrences` total for the same key
- Strict country codes: on the occurrence tools and `gbif_search_datasets`, `country` (where a record was observed) and `publishingCountry` (the publisher's country) accept only uppercase ISO 3166-1 alpha-2, because other forms silently match nothing there. `stateProvince` matches verbatim and case-sensitively, so take values from a `STATE_PROVINCE` facet
- Blank filters rejected: GBIF reads an empty parameter as no filter, so an optional filter sent blank or whitespace-only fails as `invalid_filter` instead of widening the query. Omit a field to leave it off

Agent-friendly output:

- Scope echo: enrichment reports `totalCount`, `endOfRecords`, the `occurrenceStatus` applied, and the resolved `taxonScope`, with notices on empty results, over-cap totals, and a `stateProvince` that matched nothing
- Graceful partial failure: `gbif_bulk_match_species` returns a `NONE` or `ERROR` row per name instead of failing the batch
- Typed errors: `invalid_filter`, `not_found`, `no_match`, `unresolved_taxon_scope`, `conflicting_taxon_scope`, and `pagination_cap_exceeded`, each with a recovery hint
- Sparse fields omitted rather than null-filled: `extinct` appears only on taxa GBIF explicitly flags

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

- [Bun v1.4.0](https://bun.sh/) or higher (or Node.js v24+).
- No credentials: the GBIF endpoints this server calls are public.

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

4. **Configure environment:**

```sh
cp .env.example .env
# optionally set GBIF_USER_AGENT to a contact URL or email
```

## Configuration

| Variable | Description | Default |
|:---|:---|:---|
| `GBIF_BASE_URL` | GBIF API base URL. | `https://api.gbif.org/v1` |
| `GBIF_REQUEST_TIMEOUT_MS` | Per-request HTTP timeout, in ms. | `10000` |
| `GBIF_USER_AGENT` | `User-Agent` sent on every GBIF request. GBIF asks integrators to identify themselves with a contact URL or email. | server name, version, and repository URL |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port. | `3010` |
| `MCP_SESSION_MODE` | HTTP session mode: `stateless`, `stateful`, or `auto`. `src/index.ts` declares `stateless`; set this to override it. | `stateless` |
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.). | `info` |
| `LOG_TOOL_FAILURE_PAYLOADS` | Log each failed tool call's arguments and result, redacted by key name and capped at `LOG_TOOL_FAILURE_PAYLOAD_MAX_BYTES` (default `16384`). A secret inside a free-form value is not redacted. | `false` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1`. | `in-memory` |
| `OTEL_ENABLED` | Enable [OpenTelemetry](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

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

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/gbif-biodiversity-mcp-server`. OpenTelemetry peer dependencies are installed by default; build with `--build-arg OTEL_ENABLED=false` to omit them.

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`) and shared tool utilities. Thirteen tools across species taxonomy, occurrences, datasets, and publishers. |
| `src/mcp-server/resources` | Resource definitions. Species and dataset resources. |
| `src/services/gbif` | GBIF API service layer: HTTP client with retry, timeouts, and error mapping, plus raw response types. |
| `src/config` | Server-specific environment variable parsing and validation with Zod. |
| `tests/` | Unit and integration tests, mirroring the `src/` structure. |

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for logging, `ctx.state` for storage
- Register new tools and resources in the `createApp()` arrays in `src/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

## Contributing

Issues are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
