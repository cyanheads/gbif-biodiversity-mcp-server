<div align="center">
  <h1>@cyanheads/gbif-mcp-server</h1>
  <p><b>Search GBIF species taxonomy, occurrence records, datasets, and publishers via MCP. STDIO or Streamable HTTP.</b>
  <div>12 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.3-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/gbif-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/gbif-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^6.0.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.0+-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/gbif-mcp-server/releases/latest/download/gbif-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=gbif-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvZ2JpZi1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22gbif-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fgbif-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

---

## Tools

12 tools for working with GBIF species taxonomy, occurrence records, datasets, and publishers:

| Tool | Description |
|:---|:---|
| `gbif_match_species` | Match a species name against the GBIF backbone taxonomy — returns taxonKey, confidence score, and full classification |
| `gbif_get_species` | Fetch a single backbone taxon by key — full classification, authorship, synonymy, vernacular name, descendant count |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy by name fragment, rank, kingdom, family, or genus |
| `gbif_get_species_classification` | Return the complete parent chain for a taxon — root-first ordered array from kingdom to immediate parent |
| `gbif_get_species_children` | List direct children of a backbone taxon — genera within a family, species within a genus |
| `gbif_search_occurrences` | Search 2.4B+ GBIF occurrence records with Darwin Core filters — country, bounding box, WKT geometry, year, month, basis of record |
| `gbif_count_occurrences` | Count occurrences matching a filter without fetching records — fast single-number response |
| `gbif_get_occurrence` | Fetch a single occurrence record by key — full Darwin Core record with GADM geography, media, and quality flags |
| `gbif_occurrence_facets` | Aggregate occurrence counts by a dimension — country, year, basis of record, dataset, kingdom, and more |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, or publishing organization |
| `gbif_get_dataset` | Fetch full dataset metadata by UUID — title, description, citation, contacts, license, DOI, coverage |
| `gbif_search_publishers` | Search GBIF-registered publishing organizations by name fragment or country |

### `gbif_match_species`

Match a scientific or common name against the GBIF backbone taxonomy.

- Fuzzy matching handles minor typos and vernacular names; set `strict: true` for exact-only matching
- Returns `taxonKey` — the backbone key required by `gbif_search_occurrences`, `gbif_count_occurrences`, and `gbif_occurrence_facets`
- Confidence score 0–100; below 80 warrants review
- Full classification hierarchy with keys at each rank: kingdom, phylum, class, order, family, genus, species
- `matchType NONE` indicates no usable match — try removing strict mode or broadening the name
- Resolves synonyms: always returns the accepted backbone key regardless of which name form was queried

---

### `gbif_get_species`

Fetch a complete taxon record by GBIF backbone key.

- Full classification, authorship string, and vernacular (English) name when available
- `taxonomicStatus`: ACCEPTED, SYNONYM, DOUBTFUL — when SYNONYM, `acceptedKey` and `accepted` identify the current name
- `numDescendants` and `numOccurrences` for scope at a glance
- `extinct` field present only when explicitly flagged — not false on unlabeled taxa
- `publishedIn` carries the original description citation when available

---

### `gbif_search_species`

Search or browse the GBIF backbone taxonomy.

- Accepts name fragments matching scientific and vernacular names
- Filter by rank, kingdom, family, or genus to scope browsing
- `isExtinct` filter for extinct vs. extant taxa
- Scope to a specific checklist dataset with `datasetKey` (omit for the GBIF backbone)
- Paginated — limit up to 1000, use offset to walk through large groups

---

### `gbif_get_species_classification`

Return the full parent chain for a taxon as an ordered array.

- Root-first (kingdom → phylum → class → order → family → genus → species → up to parent of queried taxon)
- Each entry: rank, canonical name, scientific name, taxon key
- Useful for building taxonomic trees or placing an unfamiliar taxon in context without manual backbone navigation

---

### `gbif_get_species_children`

List direct children of a backbone taxon.

- Genera within a family, species within a genus, subspecies within a species
- Each child: key, name, rank, taxonomic status, common name, occurrence count, descendant count
- Paginated — limit up to 1000, iterate with offset for large groups like Coleoptera

---

### `gbif_search_occurrences`

Search 2.4B+ GBIF occurrence records with full Darwin Core filtering.

- Use `taxonKey` from `gbif_match_species` for reliable results — resolves synonyms automatically; `scientificName` filter does not
- Geographic filters: `country` (ISO 3166-1 alpha-2), bounding box (`decimalLatitude`/`decimalLongitude` ranges as "min,max"), or WKT polygon (`geometry`)
- Temporal filters: `year` as single year or range, `month` (1–12) for seasonal queries
- `basisOfRecord` enum: `HUMAN_OBSERVATION`, `PRESERVED_SPECIMEN`, `MACHINE_OBSERVATION`, and more
- `hasCoordinate` to require or exclude georeferenced records
- Pagination capped at offset+limit ≈ 100,000 — use `gbif_occurrence_facets` for aggregate analysis beyond this

---

### `gbif_count_occurrences`

Count occurrences matching a filter without fetching any records.

- Backed by the lightweight `/occurrence/count` endpoint — fast single-number response
- Supported filters: `taxonKey`, `country`, `isGeoreferenced`, `datasetKey`, `year`
- Use to assess result set size before deciding whether to paginate a full search

---

### `gbif_get_occurrence`

Fetch a single occurrence record by GBIF occurrence key.

- Complete Darwin Core record — all coordinate fields, GADM administrative geography (continent, country, state/province, locality), dates
- Collections metadata: institution code, collection code, catalog number
- Collector and identifier names, individual count, sex, life stage
- Associated media (images, audio, video) with URLs and license
- GBIF data quality issue flags for provenance assessment

---

### `gbif_occurrence_facets`

Aggregate occurrence counts across a dimension.

- Facets: `COUNTRY`, `YEAR`, `BASIS_OF_RECORD`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `MONTH`
- Scope with `taxonKey`, `country`, `year`, `geometry`, or `basisOfRecord` filters
- Returns top-N values (up to 100) ranked by count — no record payloads
- Core tool for distribution analysis ("which countries have the most records?") and trend queries ("how has observation volume changed since 2010?")

---

### `gbif_search_datasets`

Search GBIF datasets by keyword, type, country, or publishing organization.

- Filters: free-text query, dataset type (`OCCURRENCE`, `CHECKLIST`, `METADATA`, `SAMPLING_EVENT`), publishing country, hosting organization UUID
- Returns title, type, description, license, DOI, and record count
- Use `hostingOrg` from `gbif_search_publishers` to scope to datasets from one organization
- Paginated — limit up to 1000

---

### `gbif_get_dataset`

Fetch full dataset metadata by UUID.

- Full description, citation text (for academic reference), license, DOI
- Contacts with role, name, organization, and email
- `numConstituents` for aggregate datasets (e.g. iNaturalist, eBird)
- Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail

---

### `gbif_search_publishers`

Search organizations registered with GBIF.

- Filter by name fragment or country
- Returns organization key, title, and country — sufficient to chain into `gbif_search_datasets` with `hostingOrg`
- Paginated — limit up to 1000

## Resources

| Type | Name | Description |
|:---|:---|:---|
| Resource | `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name |
| Resource | `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage |

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core):

- Declarative tool definitions — single file per tool, framework handles registration and validation
- Unified error handling across all tools
- Pluggable auth (`none`, `jwt`, `oauth`)
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- Runs locally (stdio/HTTP) or on Cloudflare Workers from the same codebase

GBIF-specific:

- Full GBIF REST API v1 coverage: species taxonomy, occurrences, datasets, and publishers
- `gbif_match_species` as the entry point — resolves synonyms to backbone taxon keys used throughout
- Occurrence pagination cap detection with `paginationNote` — redirects to facet aggregation before hitting the ~100,000 row limit
- WKT polygon geometry support for geographic occurrence queries
- Darwin Core field mapping with explicit provenance on sparse upstream fields

Agent-friendly output:

- `gbif_match_species` is the mandatory first step — all downstream tools document which key they expect
- Graceful sparse-field handling — optional fields absent from the API response are omitted rather than null-filled
- Discriminated error contracts with typed reasons, structured recovery hints, and `when` documentation per tool

## Getting started

### Self-Hosted / Local

Add the following to your MCP client configuration file.

```json
{
  "mcpServers": {
    "gbif": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/gbif-mcp-server@latest"],
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
    "gbif": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/gbif-mcp-server@latest"],
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
    "gbif": {
      "type": "stdio",
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "MCP_TRANSPORT_TYPE=stdio", "ghcr.io/cyanheads/gbif-mcp-server:latest"]
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

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js ≥ 24.0.0).
- Optional: [GBIF API key](https://www.gbif.org/developer/summary) for higher rate limits.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/gbif-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd gbif-mcp-server
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
| `MCP_AUTH_MODE` | Authentication: `none`, `jwt`, or `oauth` | `none` |
| `MCP_LOG_LEVEL` | Log level (`debug`, `info`, `warning`, `error`, etc.) | `info` |
| `MCP_GC_PRESSURE_INTERVAL_MS` | Opt-in Bun-only forced-GC pressure loop (ms). Try `60000` if RSS grows under sustained HTTP load. | `0` (disabled) |
| `LOGS_DIR` | Directory for log files (Node.js only) | `<project-root>/logs` |
| `STORAGE_PROVIDER_TYPE` | Storage backend: `in-memory`, `filesystem`, `supabase`, `cloudflare-kv/r2/d1` | `in-memory` |
| `GBIF_API_KEY` | GBIF API key. Sent as HTTP Basic Auth username for higher rate limits. | none |
| `GBIF_BASE_URL` | GBIF API base URL override | `https://api.gbif.org/v1` |
| `GBIF_REQUEST_TIMEOUT_MS` | HTTP request timeout in milliseconds | `10000` |
| `OTEL_ENABLED` | Enable OpenTelemetry | `false` |

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

## Project structure

| Directory | Purpose |
|:---|:---|
| `src/mcp-server/tools` | Tool definitions (`*.tool.ts`). Twelve tools across species taxonomy, occurrences, datasets, and publishers. |
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

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](./LICENSE) file for details.
