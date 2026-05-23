# gbif-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `gbif_match_species` | Match a species name (scientific or common) against the GBIF backbone taxonomy. Returns the best-matching taxon with full classification and a confidence score. The starting point for any workflow involving a species name. | `name`, `strict`, `kingdom`, `rank` | `readOnlyHint: true` |
| `gbif_get_species` | Fetch a taxon record by GBIF taxon key — full classification, authorship, taxonomic status (accepted/synonym/doubtful), vernacular name, and descendant count. Use after `gbif_match_species` to get the full record for a backbone taxon key. | `taxonKey` | `readOnlyHint: true` |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy. Accepts scientific name fragments, rank filters, and higher-taxon constraints. Returns matching species/genera/families with taxonomy, vernacular names, and record counts. | `q`, `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_species_classification` | Return the full parent chain from kingdom down to the given taxon — each rank as a named node with its own taxon key. Useful for building taxonomic trees or understanding placement without navigating the backbone level-by-level. | `taxonKey` | `readOnlyHint: true` |
| `gbif_get_species_children` | List direct children of a taxon in the GBIF backbone (e.g., species within a genus, genera within a family). Paginated. | `taxonKey`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_search_occurrences` | Search GBIF occurrence records. Primary workflow tool for location + taxon queries. Accepts taxon key (from `gbif_match_species`), country, bounding box, date range, basis of record, and other Darwin Core filters. Returns paginated occurrence records with coordinates, date, dataset, and collector. | `taxonKey`, `scientificName`, `country`, `decimalLatitude`, `decimalLongitude`, `geometry`, `year`, `month`, `basisOfRecord`, `hasCoordinate`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_count_occurrences` | Count occurrences matching a taxon + location filter without fetching records. Use for quick totals ("how many Aves records in Sweden?") or before deciding whether to paginate a full search. | `taxonKey`, `country`, `isGeoreferenced` | `readOnlyHint: true` |
| `gbif_get_occurrence` | Fetch a single occurrence record by GBIF occurrence key — full Darwin Core fields, coordinates, date, collector, media, dataset provenance. | `occurrenceKey` | `readOnlyHint: true` |
| `gbif_occurrence_facets` | Aggregate occurrence counts across a dimension (country, year, basis of record, dataset, kingdom). Returns the top-N facet values for a given filter. Core tool for distribution analysis and trend queries ("which countries have the most records for this species?", "how has observation volume changed since 2010?"). | `taxonKey`, `country`, `geometry`, `facet`, `facetLimit`, `year`, `basisOfRecord` | `readOnlyHint: true` |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, or publishing organization. Returns dataset title, description, license, record count, and DOI. | `q`, `type`, `publishingCountry`, `hostingOrg`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_dataset` | Fetch a dataset record by key — full metadata including title, description, citation, contacts, license, temporal/geographic coverage, and record count. | `datasetKey` | `readOnlyHint: true` |
| `gbif_search_publishers` | Search organizations (publishers/institutions) that contribute data to GBIF by name or country. Returns organization name, country, and key for chaining into dataset and occurrence queries. | `q`, `country`, `limit`, `offset` | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name. Stable URI for caching and injection as context. | No |
| `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage. Stable URI for provenance context. | No |

### Prompts

None for v1. The server's data surface is facts-and-records, not templated reasoning tasks. Users and agents reach for species identification and occurrence retrieval via tools.

---

## Overview

gbif-mcp-server exposes the Global Biodiversity Information Facility API (api.gbif.org/v1) as an MCP surface. GBIF aggregates 2.4 billion+ species occurrence records from natural history museums, citizen science platforms (eBird, iNaturalist), and research institutions worldwide. The backbone taxonomy covers all known species with hierarchical classification from kingdom through subspecies.

Primary users are ecologists, conservation biologists, environmental assessors, and researchers who need to query where a species has been observed, how observation volumes vary by geography or time, or what the accepted taxonomy is for a given name.

The server is read-only. All endpoints are public with no auth required for basic access. An optional free GBIF API key raises rate limits for heavier usage.

---

## Requirements

- Search species by scientific name, common name, or name fragment against the GBIF backbone taxonomy
- Match a name (including misspellings or synonyms) to the accepted taxon and return its taxon key for downstream use
- Return full taxonomic classification chain (kingdom → phylum → class → order → family → genus → species)
- Browse taxonomy: children of a taxon, parent chain
- Search occurrences filtered by taxon key, country (ISO 3166-1 alpha-2), bounding box (lat/lon range or WKT polygon), date range, basis of record
- Count occurrences for a filter without returning records
- Fetch a single occurrence record by key with full Darwin Core fields
- Aggregate occurrence counts by facet (country, year, basis of record, dataset, kingdom)
- Search and fetch dataset metadata, including citation and license
- Search publishing organizations by name or country
- Communicate pagination state clearly — GBIF caps offset+limit at ~100,000; deep pagination requires the download API (out of scope)
- Optional: `GBIF_API_KEY` env var for higher rate limits (anonymous access works but is lower-throttle)

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `GbifService` | GBIF API v1 (`api.gbif.org/v1`) | All tools and resources |

One service handles all API communication. The GBIF REST API is a single base URL with clearly separated resource paths (`/species`, `/occurrence`, `/dataset`, `/organization`). No separate service per resource type.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `GBIF_API_KEY` | No | Free GBIF API key for higher rate limits. Sent as HTTP Basic Auth username (empty password). Anonymous access is permitted but may be throttled under heavy load. Get one at gbif.org/user/profile. |
| `GBIF_BASE_URL` | No | Override the GBIF API base URL. Defaults to `https://api.gbif.org/v1`. |
| `GBIF_REQUEST_TIMEOUT_MS` | No | HTTP request timeout in milliseconds. Defaults to `10000`. |

---

## Implementation Order

1. Config — `src/config/server-config.ts` with optional `GBIF_API_KEY` and base URL
2. `GbifService` — base HTTP client, retry/backoff, response parsing, shared fetch utility
3. Taxonomy tools: `gbif_match_species`, `gbif_get_species`, `gbif_search_species`, `gbif_get_species_classification`, `gbif_get_species_children`
4. Occurrence tools: `gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_get_occurrence`, `gbif_occurrence_facets`
5. Dataset + publisher tools: `gbif_search_datasets`, `gbif_get_dataset`, `gbif_search_publishers`
6. Resources: `gbif://species/{taxonKey}`, `gbif://dataset/{datasetKey}`

Each step is independently testable. Taxonomy tools (Step 3) have no dependency on occurrence tools; they can be developed and field-tested before moving to Step 4.

---

## Domain Mapping

Nouns and the operations the API exposes, mapped to tools:

| Noun | Operations | Tools |
|:-----|:-----------|:------|
| Species (backbone taxon) | match by name, get by key, search/browse, list children, get parent chain | `gbif_match_species`, `gbif_get_species`, `gbif_search_species`, `gbif_get_species_children`, `gbif_get_species_classification` |
| Occurrence record | search (by taxon/location/date), count, get by key, aggregate by facet | `gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_get_occurrence`, `gbif_occurrence_facets` |
| Dataset | search, get by key | `gbif_search_datasets`, `gbif_get_dataset` |
| Publisher (organization) | search | `gbif_search_publishers` |
| Vernacular names | list for taxon | included in `gbif_get_species` and `gbif_search_species` output |
| Synonyms | check status for taxon | included in `gbif_get_species` output (`taxonomicStatus` + `acceptedKey`/`accepted` when synonym) |

Operations left out:

- Species distribution maps (image tiles, not useful to LLMs)
- Occurrence downloads (asynchronous job-based download API — heavyweight, requires auth, returns DwC archives)
- Literature/references per taxon (sparse data, low agent utility)
- GBIF node (country participant node) browsing (no agent use case)
- Name parser (`/parser/name`) — name matching via `gbif_match_species` covers the practical use case

---

## Tool Detail

### `gbif_match_species`

The entry point for any species workflow. Resolves a name string (scientific or vernacular) against the GBIF taxonomic backbone and returns the best-matching accepted taxon. Critically, it returns the backbone `usageKey` (exposed by the handler as `taxonKey`) that other tools (`gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_occurrence_facets`) accept directly.

**Input schema:**

```ts
z.object({
  name: z.string()
    .describe('Scientific or common name to match. Examples: "Parus major", "Great Tit", "Homo sapiens". Fuzzy matching handles minor typos.'),
  strict: z.boolean().default(false)
    .describe('When true, only return an exact match. When false (default), GBIF applies fuzzy matching — useful for misspellings and vernacular names. Set to true when you need a confirmed scientific name match.'),
  kingdom: z.string().optional()
    .describe('Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms.'),
  rank: z.enum(['KINGDOM','PHYLUM','CLASS','ORDER','FAMILY','GENUS','SPECIES','SUBSPECIES']).optional()
    .describe('Expected taxonomic rank. Use to avoid matching a genus when you expect a species.'),
})
```

**Output:**

- `usageKey` (number | null) — the raw field from the API; handler should alias this as `taxonKey` for consistency with downstream tools. Null when no match.
- `scientificName` — full name with authority
- `canonicalName` — name without authority
- `rank`, `status` (ACCEPTED | SYNONYM | DOUBTFUL)
- `confidence` (0–100) — GBIF's match confidence; below 80 warrants user review
- `matchType` (EXACT | FUZZY | HIGHERORDER | NONE)
- Classification fields are returned **flat at the top level** (not nested): `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species` and corresponding `kingdomKey`, `phylumKey`, `classKey`, `orderKey`, `familyKey`, `genusKey`, `speciesKey` fields. There is no nested `classification` object.
- Note: `alternatives` is **not returned** by the `/species/match` endpoint — it is absent from real API responses regardless of match quality.

**Errors:**

- `no_match` — `matchType === 'NONE'`, no candidate met threshold. Recovery: try a broader name or remove the `strict` flag.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_species`

Fetch a single backbone taxon by key. Companion to `gbif_match_species` — call this when you need the full record (authorship, descendant count, synonymy status, vernacular name, publication reference) rather than just the classification summary that `gbif_match_species` returns.

**Input:** `taxonKey: z.number()`

**Output:**

- Full species record: `key`, `scientificName`, `canonicalName`, `authorship`, `rank`, `taxonomicStatus`, `kingdom`/`phylum`/`class`/`order`/`family`/`genus`/`species` + `*Key` fields
- `vernacularName` — English common name if present (may be absent)
- `numDescendants` — count of child taxa in backbone
- `taxonomicStatus` — `ACCEPTED`, `SYNONYM`, `DOUBTFUL`, etc. When `SYNONYM`, `acceptedKey` (number) and `accepted` (accepted name string) are also present. Note: there is no `synonym: boolean` field — use `taxonomicStatus === 'SYNONYM'` instead.
- `publishedIn` — original description citation if populated (may be absent)
- `extinct: boolean` — present only on taxa explicitly flagged as extinct; absent (not false) on most records

**Errors:** `not_found` when the taxonKey doesn't exist in the backbone.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_species`

Browses or searches the backbone taxonomy. The primary tool for exploring what species exist under a higher taxon — e.g., "list all families of Coleoptera" or "find all Quercus species in the backbone". Also handles simple name-fragment searches when `gbif_match_species` returns too narrow a result.

**Key inputs:** `q` (name fragment), `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `datasetKey` (to scope to a specific checklist), `limit` (default 20, max 1000), `offset`

**Output:** paginated list of taxon records, each with classification, vernacular name, `numOccurrences` count, and backbone key.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_species_classification`

Returns the complete parent chain for a taxon — from kingdom (or domain) down to the taxon itself — as an ordered array. Each entry has its rank, canonical name, and taxon key. Avoids requiring callers to navigate the hierarchy one level at a time.

The GBIF API exposes `/species/{taxonKey}/parents` which returns the full ancestor array. The result is already ordered root-first (kingdom → phylum → class → … → parent of the given taxon). No reversal is needed — the handler returns the array as-is.

**Input:** `taxonKey: z.number()`

**Output:** `classification: Array<{ rank, name, key }>` ordered root → leaf

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_species_children`

Lists direct children of a backbone taxon — genera within a family, species within a genus, subspecies within a species. Paginated.

**Key inputs:** `taxonKey`, `limit` (default 20), `offset`

**Output:** paginated list of child taxon records with rank, canonical name, key, and synonym status.

**Annotations:** `readOnlyHint: true`

---

### `gbif_search_occurrences`

The core data retrieval tool. Searches 2.4B+ occurrence records with Darwin Core filters. Supports taxon key, country (ISO 3166-1 alpha-2 code), bounding box (decimalLatitude/decimalLongitude range or WKT polygon via `geometry`), year range, month, basis of record, and georeference filter.

**Important nuances:**
- `taxonKey` is the backbone key from `gbif_match_species`. Passing a raw name as `scientificName` also works but may miss synonyms — the backbone key is preferred.
- The occurrence search endpoint does NOT support free-text search against collectors or locality descriptions — use Darwin Core filter params.
- Pagination is capped: GBIF limits offset+limit to approximately 100,000. For deeper enumeration, GBIF's asynchronous download API is required (out of scope for this server).
- WKT geometry accepts POLYGON and MULTIPOLYGON with coordinates as `lon lat` pairs.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().optional()
    .describe('GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — matches all synonyms automatically.'),
  scientificName: z.string().optional()
    .describe('Scientific name filter. Less precise than taxonKey — does not match synonyms. Use taxonKey from gbif_match_species for reliable results.'),
  country: z.string().optional()
    .describe('ISO 3166-1 alpha-2 country code (e.g., "GB", "US", "DE", "SE"). Filters to records from that country.'),
  decimalLatitude: z.string().optional()
    .describe('Latitude range as "min,max" (e.g., "47.0,48.5"). Decimal degrees, WGS84. Combine with decimalLongitude for a bounding box.'),
  decimalLongitude: z.string().optional()
    .describe('Longitude range as "min,max" (e.g., "8.0,9.5"). Decimal degrees, WGS84. Combine with decimalLatitude for a bounding box.'),
  geometry: z.string().optional()
    .describe('WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Takes precedence over decimalLatitude/decimalLongitude when both are supplied.'),
  year: z.string().optional()
    .describe('Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year.'),
  month: z.number().min(1).max(12).optional()
    .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
  basisOfRecord: z.enum(['HUMAN_OBSERVATION','MACHINE_OBSERVATION','PRESERVED_SPECIMEN','LIVING_SPECIMEN','MATERIAL_SAMPLE','MATERIAL_CITATION','OCCURRENCE','LITERATURE']).optional()
    .describe('Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science (eBird, iNaturalist). PRESERVED_SPECIMEN covers natural history collections.'),
  hasCoordinate: z.boolean().optional()
    .describe('When true, return only georeferenced records. When false, include records without coordinates. Defaults to unfiltered (both).'),
  isInCluster: z.boolean().optional()
    .describe('Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all.'),
  limit: z.number().min(1).max(300).default(20)
    .describe('Number of records to return (default 20, max 300).'),
  offset: z.number().min(0).default(0)
    .describe('Pagination offset. GBIF caps offset+limit at approximately 100,000 — for deeper enumeration use gbif_occurrence_facets or refine filters.'),
})
```

**Output per record (normalized):**

- `key` — occurrence key for `gbif_get_occurrence` chaining
- `taxonKey`, `scientificName`, `canonicalName`, `rank`
- `decimalLatitude`, `decimalLongitude`, `coordinateUncertaintyInMeters` (may be absent)
- `country`, `countryCode`, `stateProvince`, `locality` (may be absent)
- `eventDate`, `year`, `month`, `day`
- `basisOfRecord`, `individualCount`
- `datasetKey`, `datasetName`, `publishingCountry`
- `recordedBy` (may be absent)
- `issues` — array of GBIF quality flags

**Pagination output:** `count` (total matches), `endOfRecords`, `offset`, `limit`, `paginationNote` if the cap is near.

**Errors:** `upstream_error` on API failures, `validation_error` on malformed geometry.

**Annotations:** `readOnlyHint: true`

---

### `gbif_count_occurrences`

Returns a single integer count. Backed by `/occurrence/count` which is lightweight and doesn't paginate. Use before `gbif_search_occurrences` when you only need the total, or to get counts for multiple filters in parallel.

**Key inputs:** `taxonKey`, `country`, `isGeoreferenced`, `datasetKey`, `year`

**Output:** `count: number`

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_get_occurrence`

Fetches a full occurrence record by its GBIF key. Returns the complete Darwin Core record — all coordinates, administrative geography (GADM), dates, collections metadata, collector identifiers, media links, and quality issue flags.

**Input:** `occurrenceKey: z.number()`

**Output:** Full record with normalized key fields plus raw `gadm` (GADM administrative divisions), `media` array, and `issues` array.

**Errors:** `not_found` when the key doesn't exist.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_occurrence_facets`

Returns aggregated occurrence counts for a given facet dimension. Backed by the occurrence search endpoint with `limit=0` and `facet=<field>`, so it returns only the facet counts with no record payload — efficient for distribution analysis.

Available facet dimensions: `BASIS_OF_RECORD`, `COUNTRY`, `YEAR`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `PROTOCOL`, `MONTH`.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().optional().describe('Backbone taxon key to scope the aggregation.'),
  country: z.string().optional().describe('ISO country code to scope to one country.'),
  year: z.string().optional().describe('Year or year range (e.g., "2020,2024").'),
  basisOfRecord: z.enum([...]).optional().describe('Scope to a specific basis of record.'),
  geometry: z.string().optional().describe('WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Same format as gbif_search_occurrences.'),
  facet: z.enum(['BASIS_OF_RECORD','COUNTRY','YEAR','DATASET_KEY','KINGDOM_KEY','PHYLUM_KEY','CLASS_KEY','ORDER_KEY','FAMILY_KEY','GENUS_KEY','SPECIES_KEY','PUBLISHING_COUNTRY','MONTH']).describe('Dimension to aggregate by.'),
  facetLimit: z.number().min(1).max(100).default(10).describe('Maximum number of facet values to return (default 10, max 100).'),
})
```

**Output:**

```ts
z.object({
  facet: z.string().describe('The facet dimension aggregated.'),
  totalOccurrences: z.number().describe('Total matching occurrences across all facet values.'),
  counts: z.array(z.object({
    name: z.string().describe('Facet value (e.g., country code, year, basisOfRecord). Note: the API returns this field as "name", not "value".'),
    count: z.number().describe('Occurrence count for this value.'),
  })).describe('Facet values ranked by count descending.'),
})
```

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_datasets`

Searches GBIF datasets. Useful for locating the specific dataset behind a set of records, or understanding what data collections are available for a country or taxonomic group.

**Key inputs:** `q` (free text), `type` (OCCURRENCE | CHECKLIST | METADATA | SAMPLING_EVENT), `publishingCountry`, `hostingOrg` (organization UUID), `limit` (default 20), `offset`

**Output per dataset:** `key`, `title`, `type`, `recordCount`, `publishingCountry`, `license`, `doi`, brief `description`.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_dataset`

Full dataset metadata including title, description, citation text, contacts, license, DOI, `numConstituents`, and temporal coverage. Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail.

**Input:** `datasetKey: z.string().uuid()`

**Output:** Full dataset record. `citation.text` is the citable reference.

**Errors:** `not_found` when the UUID doesn't match any dataset.

**Annotations:** `readOnlyHint: true`, `openWorldHint: false`

---

### `gbif_search_publishers`

Searches organizations registered with GBIF by name fragment or country. Returns organization key, title, and country — sufficient to chain into `gbif_search_datasets` with `hostingOrg` or to understand who publishes data for a region.

**Key inputs:** `q`, `country`, `limit`, `offset`

**Output:** paginated list of `{ key, title, country, city }` per organization.

**Annotations:** `readOnlyHint: true`

---

## Workflow Analysis

### Workflow 1: Species distribution query

Typical agent task: "Where has *Dactylorhiza majalis* (marsh orchid) been observed in the British Isles?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Dactylorhiza majalis" }` → `taxonKey: 2839086` |
| 2 | `gbif_count_occurrences` | `{ taxonKey: 2839086, country: "GB" }` → total count for framing |
| 3 | `gbif_search_occurrences` | `{ taxonKey: 2839086, country: "GB", hasCoordinate: true, limit: 50 }` → paginated records |

Steps 2 and 3 are independent and can be called in parallel after step 1.

---

### Workflow 2: Taxonomic tree navigation

Typical agent task: "What families are in the order Coleoptera (beetles)?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Coleoptera", rank: "ORDER" }` → `taxonKey: 809` |
| 2 | `gbif_get_species_children` | `{ taxonKey: 809, limit: 100 }` → families |

For large orders with hundreds of families, iterate with offset.

---

### Workflow 3: Dataset provenance

Typical agent task: "This occurrence came from dataset `4fa7b334-...` — what's the citation?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_get_dataset` | `{ datasetKey: "4fa7b334-ce0d-4e88-aaae-2e0c138d049e" }` → full metadata with `citation.text` |

---

### Workflow 4: Temporal trend analysis

Typical agent task: "How has the number of *Parus major* observation records changed over the past 10 years?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_match_species` | `{ name: "Parus major" }` → `taxonKey: 9705453` |
| 2 | `gbif_occurrence_facets` | `{ taxonKey: 9705453, facet: "YEAR", facetLimit: 15, year: "2015,2025" }` → year × count breakdown |

---

### Workflow 5: Environmental impact assessment — species list for a site

Typical agent task: "What vertebrate species have been recorded in a 50km radius of a proposed development site at 51.5°N, -2.1°E?"

| # | Tool | Call |
|:--|:-----|:-----|
| 1 | `gbif_search_occurrences` | `{ geometry: "POLYGON(...)", basisOfRecord: "HUMAN_OBSERVATION", hasCoordinate: true, limit: 300 }` → records in area |
| 2 | `gbif_occurrence_facets` | `{ geometry: "...", facet: "SPECIES_KEY", facetLimit: 100 }` → species richness summary |

---

## Design Decisions

**1. `gbif_match_species` as the mandatory first step for species workflows.** The backbone taxon key is the stable identifier across GBIF's APIs — it handles synonymy, aggregates records across checklist sources, and is the primary parameter for occurrence search. Designing `gbif_match_species` as the explicit first step (rather than accepting scientific name strings everywhere) makes the two-step pattern visible and encourages correct use. The `scientificName` convenience parameter on `gbif_search_occurrences` exists for cases where the user knows they have an accepted name, but its limitations are documented.

**2. `gbif_occurrence_facets` as a separate tool, not folded into `gbif_search_occurrences`.** Facet-only queries (`limit=0`) are a fundamentally different use pattern — no records returned, just aggregate counts. Exposing them as a separate tool makes the intent clear and avoids the cognitive overhead of understanding `limit=0` as a special mode. The tool names the facet dimensions explicitly via an enum, which is more discoverable than a free string parameter.

**3. No occurrence download tool.** GBIF's asynchronous download API requires an account, creates a background job, polls for completion, and returns a DwC archive ZIP. The UX does not fit the synchronous request/response model of MCP tools. The search endpoint (capped at ~100,000 offset) is sufficient for agent workflows; for bulk downloads, users should use gbif.org directly.

**4. Occurrence record output normalization.** GBIF's occurrence search response is verbose (the `classifications` object includes entries for both the Catalogue of Life backbone and the legacy GBIF backbone, with deeply nested structure). The handler extracts the simpler top-level Darwin Core fields (`taxonKey`, `scientificName`, `kingdom`, etc.) and discards the `classifications` nested object to reduce response size. The full record is available via `gbif_get_occurrence` when needed.

**5. WKT geometry vs. lat/lon bounding box.** GBIF's occurrence search supports both. The design exposes both — `decimalLatitude`/`decimalLongitude` ranges for simple bounding boxes, `geometry` for WKT polygons. The `geometry` parameter is more powerful (supports non-rectangular areas, e.g., watershed boundaries) but harder to construct. Both are documented; the simpler lat/lon form is named first.

**6. No `gbif_get_species_synonyms` tool.** The synonyms endpoint (`/species/{key}/synonyms`) returns a paginated list of species records that are synonyms of the given accepted taxon. This is niche — most workflows need only to know whether a taxon *is* a synonym (surfaced in `gbif_get_species`), not to enumerate all synonyms of an accepted name. Deferred to a future iteration if demand warrants.

**7. Two resources, not more.** Species and dataset records are the two stable, addressable, reference objects with real utility as injectable context. Occurrence records are too numerous (2.4B+) and too transient to be useful as resources. Publisher/organization records are rarely needed as injectable context. The resource surface is intentionally minimal.

**8. Pagination cap surfaced in output.** GBIF's search API silently returns no more data once offset+limit approaches 100,000. Rather than failing silently, the handler detects when the request is near the cap and populates a `paginationNote` field in the output advising the agent to refine filters or use facets for aggregate counts.

---

## Known Limitations

- **Pagination hard cap at ~100,000 records.** GBIF's search API does not support deep pagination. Workflows needing millions of records require GBIF's asynchronous download API, which is out of scope.
- **Occurrence search is not full-text.** The search endpoint filters on Darwin Core structured fields only. There is no free-text search across collector notes, locality descriptions, or identification remarks.
- **Backbone vs. checklist taxon keys.** GBIF has a single backbone taxonomy (`d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`) and many secondary checklists. Occurrence search works only with backbone keys (the `nubKey`). The `gbif_match_species` tool always returns backbone keys.
- **Name matching confidence.** Below confidence ~80, matches should be treated with caution. The `confidence` field is surfaced in the output. The `/species/match` endpoint does not return an `alternatives` array — callers with low-confidence matches should retry with broader or different input (e.g., remove `strict`, try a higher-rank name).
- **Occurrence record sparsity.** Many fields in Darwin Core are optional. Coordinates, collector name, collection code, and locality may be absent, especially in older or museum-digitized records. Output schemas reflect this — most fields are optional.
- **GBIF API key is optional but beneficial.** Without a key, requests are anonymized and may be throttled under sustained load. The server communicates this at startup if no key is configured.
- **WKT geometry coordinate order.** GBIF expects `longitude latitude` order in WKT (matching GeoJSON convention, not GML). This is noted in the `geometry` parameter description.

---

## API Reference

### Base URL

`https://api.gbif.org/v1`

### Key endpoints

| Resource | Endpoint | Notes |
|:---------|:---------|:------|
| Species match | `GET /species/match` | `name`, `strict`, `kingdom`, `rank` |
| Species get | `GET /species/{key}` | backbone taxon key |
| Species search | `GET /species/search` | `q`, `rank`, `kingdom`, `datasetKey`, `limit`, `offset` |
| Species children | `GET /species/{key}/children` | paginated |
| Species parents | `GET /species/{key}/parents` | returns array root→leaf |
| Occurrence search | `GET /occurrence/search` | Darwin Core filters + facets |
| Occurrence count | `GET /occurrence/count` | taxonKey, country, isGeoreferenced |
| Occurrence get | `GET /occurrence/{key}` | full DwC record |
| Dataset search | `GET /dataset/search` | q, type, publishingCountry |
| Dataset get | `GET /dataset/{uuid}` | |
| Publisher search | `GET /organization/search` | q, country |

### Pagination pattern

All list endpoints return: `{ offset, limit, endOfRecords, count, results[] }`. Page with `offset` + `limit`. Occurrence search: capped at approximately `offset + limit ≤ 100,000`.

### Facet query pattern

Add `facet=FIELD_NAME` to occurrence search, set `limit=0` to skip record fetching. Add `facetLimit=N` (default 10, max 100) and `facetMincount=N` to filter low-count values. Multiple `facet=` parameters are allowed in a single request.

### Name matching confidence

| Confidence | Interpretation |
|:-----------|:---------------|
| 90–100 | High confidence — exact or near-exact match |
| 80–89 | Good match — minor differences (author, formatting) |
| 60–79 | Fuzzy match — verify before use |
| <60 | Low confidence — likely a different species |

### Auth

No auth required for read access. To raise rate limits, supply the GBIF API key as HTTP Basic Auth with the key as the username and an empty password (`user:` format). Query-parameter auth is not supported on read endpoints. The API doesn't enforce strict limits without a key but may throttle under sustained anonymous load.

### Error shapes

```json
// 404
{ "timestamp": "...", "status": 404, "error": "", "message": "Entity not found for uri: /species/999" }

// Name match returning no match
{ "confidence": 0, "matchType": "NONE", "synonym": false }
```

---

## Decisions Log

| Date | Decision | Rationale |
|:-----|:---------|:----------|
| 2026-05-23 | `gbif_match_species` as mandatory first step — returns backbone `taxonKey` required by downstream tools | Backbone key is the stable cross-API identifier; synonym resolution happens here so occurrence tools don't need to duplicate it |
| 2026-05-23 | `gbif_occurrence_facets` as a standalone tool, not a mode on `gbif_search_occurrences` | Facet-only queries (limit=0) are semantically different from record fetches — naming them separately makes intent clearer and avoids teaching agents the `limit=0` idiom |
| 2026-05-23 | No occurrence download tool | Asynchronous job-based DwC download doesn't fit synchronous MCP request/response; search cap of ~100K is sufficient for agent workflows |
| 2026-05-23 | Normalized occurrence output (drop nested `classifications` object) | GBIF includes both CoL and legacy backbone entries per occurrence, creating deep nesting. Top-level Darwin Core fields cover 100% of agent use cases; full detail available via `gbif_get_occurrence` |
| 2026-05-23 | No `gbif_get_species_synonyms` tool in v1 | Niche use case; synonym status already surfaced in `gbif_get_species` — enumerate-all-synonyms workflow can be added later if needed |
| 2026-05-23 | Two resources only (species + dataset) | These are the only stable reference objects with real utility as injectable context; occurrence records are too numerous and publishers too rarely needed |
| 2026-05-23 | Pagination cap surfaced in `paginationNote` field | GBIF silently returns no more data past the cap; explicit warning prevents silent truncation in agent workflows |
| 2026-05-23 | Both WKT geometry and lat/lon ranges exposed as occurrence search params | WKT supports complex polygons (watersheds, protected area boundaries); lat/lon ranges are simpler for rectangular queries — both have clear agent use cases |
