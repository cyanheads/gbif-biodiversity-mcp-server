# gbif-biodiversity-mcp-server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations |
|:-----|:------------|:-----------|:------------|
| `gbif_match_species` | Match a scientific name against the GBIF backbone taxonomy, or with `checklistKey` the Catalogue of Life eXtended Release (common names go to `gbif_search_species`). Returns the best-matching taxon with full classification and a confidence score. The starting point for any workflow involving a species name. | `name`, `strict`, `kingdom`, `rank`, `checklistKey` | `readOnlyHint: true` |
| `gbif_bulk_match_species` | Match up to 50 scientific names, each a string or `{ name, kingdom }`, to backbone keys (or Catalogue of Life keys with `checklistKey`), preserving input order and isolating per-name failures. | `names`, `strict`, `checklistKey` | `readOnlyHint: true` |
| `gbif_get_species` | Fetch a taxon record by GBIF taxon key (0 is the kingdom *incertae sedis*) — full classification, authorship, taxonomic status (accepted/synonym/doubtful), vernacular name, and descendant count. Use after `gbif_match_species` to get the full record for a backbone taxon key. | `taxonKey` | `readOnlyHint: true` |
| `gbif_search_species` | Search or browse the GBIF backbone taxonomy, or an explicitly selected checklist. Accepts scientific name fragments, rank filters, and higher-taxon constraints. Returns matching species/genera/families with taxonomy, common names, and descendant counts. | `q`, `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `datasetKey`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_species_classification` | Return the parent chain from kingdom down to the immediate parent of the given taxon (the taxon itself is excluded) — each rank as a named node with its own taxon key. Useful for building taxonomic trees or understanding placement without navigating the backbone level-by-level. | `taxonKey` | `readOnlyHint: true` |
| `gbif_get_species_children` | List direct children of a taxon in the GBIF backbone (e.g., species within a genus, genera within a family). Paginated. | `taxonKey`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_search_occurrences` | Search GBIF occurrence records. Primary workflow tool for location + taxon queries. Accepts taxon key (from `gbif_match_species`; a Catalogue of Life key goes in `checklistTaxonKey` with `checklistKey`), country, GADM area, bounding box, date range, basis of record, collection and collector filters, and other Darwin Core filters. Returns paginated occurrence records with coordinates, date, dataset, and collector. Filters to presences by default. | `taxonKey`, `checklistKey`, `checklistTaxonKey`, `scientificName`, `country`, `publishingCountry`, `stateProvince`, `decimalLatitude`, `decimalLongitude`, `geometry`, `year`, `month`, `basisOfRecord`, `hasCoordinate`, `hasGeospatialIssue`, `isInCluster`, `coordinateUncertaintyInMeters`, `datasetKey`, `publishingOrg`, `occurrenceStatus`, `iucnRedListCategory`, `gadmGid`, `catalogNumber`, `institutionCode`, `recordedBy`, `mediaType`, `typeStatus`, `establishmentMeans`, `license`, `includeMedia`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_count_occurrences` | Count occurrences matching a taxon + location filter without fetching records. Use for quick totals ("how many Aves records in Sweden?") or before deciding whether to paginate a full search. Applies the same presence/absence default as `gbif_search_occurrences`. | Every biological filter on `gbif_search_occurrences`, plus `isGeoreferenced` as an alias for `hasCoordinate` | `readOnlyHint: true` |
| `gbif_get_occurrence` | Fetch a single occurrence record by GBIF occurrence key — full Darwin Core fields, coordinates, elevation and depth, date, collector, accepted taxon, type status and establishment means, license and rights holder, media, dataset and publishing organization provenance. | `occurrenceKey` | `readOnlyHint: true` |
| `gbif_occurrence_facets` | Aggregate occurrence counts across a dimension (country, year, basis of record, dataset, kingdom, GADM level, institution, media type, collector, publishing organization, type status, establishment means, license). Returns one page of facet values ranked by count for a given filter — `facetLimit` entries starting at `facetOffset`; `includeLabels` names taxon, dataset, publishing organization, and GADM area buckets. Core tool for distribution analysis and trend queries ("which countries have the most records for this species?", "how has observation volume changed since 2010?"). | Every biological filter on `gbif_search_occurrences`, plus `facet`, `facetLimit`, `facetOffset`, `includeLabels` | `readOnlyHint: true` |
| `gbif_search_datasets` | Search GBIF datasets by keyword, type, country, publishing organization, or hosting organization. Returns dataset title, description, license, record count, DOI, and the publishing organization's key and name. | `q`, `type`, `publishingCountry`, `publishingOrg`, `hostingOrg`, `limit`, `offset` | `readOnlyHint: true` |
| `gbif_get_dataset` | Fetch a dataset record by key — full metadata including title, description, citation, contacts, license, temporal/geographic coverage, record count, and the publishing organization key. | `datasetKey`, `contactLimit` | `readOnlyHint: true` |
| `gbif_search_publishers` | Search organizations (publishers/institutions) that contribute data to GBIF by name or country. Returns organization name, country, and key for chaining into `gbif_search_datasets` (`publishingOrg` or `hostingOrg`). | `q`, `country`, `limit`, `offset` | `readOnlyHint: true` |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `gbif://species/{taxonKey}` | Taxon record from the GBIF backbone — classification, authorship, synonymy status, vernacular name. Stable URI for caching and injection as context. | No |
| `gbif://dataset/{datasetKey}` | Dataset metadata — title, description, citation, license, contacts, coverage, and the publishing organization key. Stable URI for provenance context. | No |

### Skills

| Name | Description |
|:-----|:------------|
| `gbif-biodiversity-guide` | Agent guide: where each key comes from, which region filter selects which records, and the checks before quoting a count, a trend, or an absence. Installed with the Claude Code and Codex plugins and the `.mcpb`, and served over MCP at `skill://gbif-biodiversity-guide/SKILL.md`. |

### Prompts

None for v1. The server's data surface is facts-and-records, not templated reasoning tasks. Users and agents reach for species identification and occurrence retrieval via tools.

---

## Overview

gbif-biodiversity-mcp-server exposes the Global Biodiversity Information Facility API (api.gbif.org/v1) as an MCP surface. GBIF aggregates 3.9 billion+ species occurrence records from natural history museums, citizen science platforms (eBird, iNaturalist), and research institutions worldwide. The backbone taxonomy covers all known species with hierarchical classification from kingdom through subspecies.

Primary users are ecologists, conservation biologists, environmental assessors, and researchers who need to query where a species has been observed, how observation volumes vary by geography or time, or what the accepted taxonomy is for a given name.

The server is read-only. Every endpoint it calls is public and takes no credentials — GBIF issues no API key.

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
- Communicate pagination state clearly — GBIF serves occurrence offset+limit up to 100,001 (species search 100,000, dataset search 125,000) with no cursor or scroll; covering a larger result set means partitioning it by `datasetKey`, and retrieving one whole requires GBIF's account-only download API (out of scope)

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `GbifService` | GBIF API v1 (`api.gbif.org/v1`), plus `/v2/species/match` for the Catalogue of Life | All tools and resources |

One service handles all API communication. The GBIF REST API is a single base URL with clearly separated resource paths (`/species`, `/occurrence`, `/dataset`, `/organization`, `/geocode`); the one `/v2` route, Catalogue of Life matching, is derived from that base URL. No separate service per resource type.

---

## Config

| Env Var | Required | Description |
|:--------|:---------|:------------|
| `GBIF_BASE_URL` | No | Override the GBIF API base URL. Defaults to `https://api.gbif.org/v1`. Keep the trailing `/v1`: `checklistKey` on the match tools, and `includeLabels` on a `gbif_occurrence_facets` taxon bucket under the Catalogue of Life `checklistKey`, call `/v2/species/match` at the base URL with that segment replaced by `/v2`, and a base URL not ending in `/v1` fails those calls as a `ConfigurationError`. |
| `GBIF_REQUEST_TIMEOUT_MS` | No | HTTP request timeout in milliseconds. Defaults to `10000`. |
| `GBIF_USER_AGENT` | No | `User-Agent` sent on every GBIF request. GBIF asks integrators to identify themselves with a contact URL or email. Defaults to the server name, version, and repository URL. |
| `GBIF_CLAMP_READ_LIMITS` | No | Defaults to `true`: oversized whole-number read limits clamp to the existing workload caps, with requested/applied notices, logs, and a counter. Bulk matching processes the first 50 names and returns the ordered remainder in `unprocessedNames`. `false` restores advertised and enforced rejecting maxima. Parsed with `z.stringbool()`; malformed values fail startup. |

---

## Implementation Order

1. Config — `src/config/server-config.ts` with base URL and request timeout
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
- Occurrence downloads (asynchronous job-based download API — requires a GBIF.org account, returns DwC archives; see decision 3)
- Literature/references per taxon (sparse data, low agent utility)
- GBIF node (country participant node) browsing (no agent use case)
- Name parser (`/parser/name`) — name matching via `gbif_match_species` covers the practical use case

---

## Tool Detail

### `gbif_match_species`

The entry point for any species workflow. Resolves a scientific name string against the GBIF taxonomic backbone and returns the best-matching accepted taxon. Critically, it returns the backbone `usageKey` (exposed by the handler as `taxonKey`) that other tools (`gbif_search_occurrences`, `gbif_count_occurrences`, `gbif_occurrence_facets`) accept directly.

**Input schema:**

```ts
z.object({
  name: z.string()
    .describe('Scientific name to match. Examples: "Parus major", "Agaricus bisporus", "Homo sapiens". Fuzzy matching handles minor typos. Common names are not supported — use gbif_search_species.'),
  strict: z.boolean().default(false)
    .describe('When true, only return an exact match. When false (default), GBIF applies fuzzy matching — useful for minor spelling variations and abbreviated names. Set to true when you need a confirmed scientific name match.'),
  kingdom: z.string().optional()
    .describe('Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms.'),
  rank: z.enum(['KINGDOM','PHYLUM','CLASS','ORDER','FAMILY','GENUS','SPECIES','SUBSPECIES']).optional()
    .describe('Expected taxonomic rank. Use to avoid matching a genus when you expect a species.'),
  checklistKey: z.enum(CHECKLIST_KEY_VALUES).optional()
    .describe('Taxonomy to match against. Omitted, or the Backbone key d7dddbf4-2cf0-4f39-9b2a-bb099caae36c, is the GBIF Backbone. 7ddf754f-d193-4cc9-b351-99906754a03b is the Catalogue of Life eXtended Release.'),
})
```

**Output:**

- `usageKey` (number | null) — the raw field from the API: the key of the name that matched, which for a synonym is the synonym's own key. Null when no match.
- `acceptedUsageKey` (number) — present only on a synonym match. The endpoint carries no accepted-*name* field, so the key alone identifies the accepted taxon; the handler reads its name from the match itself (below).
- The handler emits `taxonKey` = `acceptedUsageKey ?? usageKey`, plus `matchedTaxonKey` = `usageKey` when the two differ, so the key handed downstream is always the one the occurrence tools should filter on.
- `acceptedName` — the accepted taxon's canonical name (no authorship) on a synonym match, derived from the match response with no extra request: the classification field whose key equals `acceptedUsageKey` names it, so it is absent when the accepted taxon is infraspecific and no rank field holds its key (*Chrysanthemum leucanthemum*, whose accepted taxon is a subspecies); `gbif_get_species` with `taxonKey` then names it. See decision 24.
- `checklistKey` `7ddf754f-d193-4cc9-b351-99906754a03b` sends the match to `/v2/species/match` instead, with `scientificName` and `taxonRank` as the v2 names for `name` and `rank`. The answer is read from `usage`, `acceptedUsage`, and `diagnostics`, and its keys are strings: `checklistTaxonKey` (the accepted taxon's) and `checklistMatchedTaxonKey` (the synonym's), with `taxonKey`, `matchedTaxonKey`, and the rank keys absent. The occurrence tools take `checklistTaxonKey` as an input of the same name, with the same `checklistKey`; the species tools, keyed by Backbone integer, do not. `status` may then be `PROVISIONALLY_ACCEPTED` and `matchType` `VARIANT`, and every synonym carries `acceptedName` from `acceptedUsage.canonicalName`. See decisions 24 and 26.
- `scientificName` — full name with authority
- `canonicalName` — name without authority
- `rank`, `status` (ACCEPTED | SYNONYM | DOUBTFUL; PROVISIONALLY_ACCEPTED too under the Catalogue of Life)
- `confidence` (0–100) — GBIF's match confidence; below 80 warrants user review. A `HIGHERRANK` fallback can score above 90 (a misspelled species falling back to its kingdom scored 92), so `matchType` is read first.
- `matchType` (EXACT | FUZZY | HIGHERRANK | NONE; VARIANT in place of FUZZY under the Catalogue of Life) — `HIGHERRANK` is disclosed in a `notice` naming the taxon and rank, and `taxonKey` covers that whole taxon — or, when that taxon is a synonym, its accepted taxon, named when the classification carries it under the same key (*Nyctea xyzzyqq* → genus *Nyctea*, accepted *Bubo* 5959091); the notice and the synonym disclosure compose into one. It is never rejected; see decision 18.
- Classification fields are returned **flat at the top level** (not nested): `kingdom`, `phylum`, `class`, `order`, `family`, `genus`, `species` and corresponding `kingdomKey`, `phylumKey`, `classKey`, `orderKey`, `familyKey`, `genusKey`, `speciesKey` fields (the keys are Backbone keys and absent under the Catalogue of Life). There is no nested `classification` object.
- Note: `alternatives` is **not returned** by the `/species/match` endpoint — it is absent from real API responses regardless of match quality.

**Errors:**

- `no_match` — `matchType === 'NONE'`: no candidate met threshold, or several equal candidates tied, in which case the message carries GBIF's note ("Multiple equal matches for Oenanthe") and, while `kingdom` is unset, a retry with `kingdom`. Recovery: broaden the name, remove `strict`, set `kingdom`, or use `gbif_search_species`.
- `invalid_filter` — `kingdom` supplied blank or whitespace-only. `/species/match` drops one and matches against the whole backbone, so the answer comes back looking disambiguated when it is not; see decision 16. Nothing upstream raises this reason — `/species/match` answers HTTP 200 for every input this schema can produce.
- A `ConfigurationError`, outside the declared contract, when `checklistKey` selects the Catalogue of Life and `GBIF_BASE_URL` does not end in `/v1`; `gbif_occurrence_facets` raises it the same way for `includeLabels` on a taxon bucket under that `checklistKey`. On `gbif_bulk_match_species` it fails the call instead of filling every row with the same `ERROR`.

**Bulk variant.** `gbif_bulk_match_species` takes each `names` entry as a string or `{ name, kingdom }`; an entry's `kingdom` goes to GBIF as `gbif_match_species` sends its own, for that name alone. Every entry's `kingdom`, the unprocessed tail included, is checked before the first request, and a blank one fails the call as `invalid_filter` — the tool's only declared `errors[]` entry; a per-name lookup failure is still an `ERROR` row. `unprocessedNames` returns the remaining entries exactly as submitted, in order and with duplicates. A `NONE` row for a tie across kingdoms points at resubmitting the entry with `kingdom` while it has none. `strict` and `checklistKey` apply to the whole batch. See decisions 18 and 24.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_get_species`

Fetch a single backbone taxon by key. Companion to `gbif_match_species` — call this when you need the full record (authorship, descendant count, synonymy status, vernacular name, publication reference) rather than just the classification summary that `gbif_match_species` returns.

**Input:** `taxonKey: z.number().int().nonnegative()` (0 is the backbone kingdom *incertae sedis*)

**Output:**

- Full species record: `key`, `scientificName`, `canonicalName`, `authorship`, `rank`, `taxonomicStatus`, `kingdom`/`phylum`/`class`/`order`/`family`/`genus`/`species` + `*Key` fields
- `vernacularName` — English common name if present (may be absent)
- `numDescendants` — count of child taxa in backbone
- `numOccurrences` — normally absent: GBIF's taxon record carries no occurrence count, so a count comes from `gbif_count_occurrences`
- `taxonomicStatus` — `ACCEPTED`, `SYNONYM`, `DOUBTFUL`, etc. When `SYNONYM`, `acceptedKey` (number) and `accepted` (accepted name string) are also present. Note: there is no `synonym: boolean` field — use `taxonomicStatus === 'SYNONYM'` instead.
- `publishedIn` — original description citation if populated (may be absent)
- `extinct: boolean` — present only on taxa explicitly flagged as extinct; absent (not false) on most records

**Errors:** `not_found` when the taxonKey doesn't exist in the backbone; `invalid_filter` for a key past the 32-bit range. A fraction or negative key fails at the schema.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_search_species`

Browses or searches the backbone taxonomy. The primary tool for exploring what species exist under a higher taxon — e.g., "list all families of Coleoptera" or "find all Quercus species in the backbone". Also handles simple name-fragment searches when `gbif_match_species` returns too narrow a result.

**Key inputs:** `q` (name fragment) and `datasetKey` (to scope to a specific checklist), both validated whenever present since `/species/search` answers a blank one with the unfiltered backbone result; `rank`, `kingdom`, `family`, `genus`, `isExtinct`, `limit` (integer, default 20, max 1000), `offset` (integer). Every one of the five string filters is rejected blank, per decision 16. `offset + limit` may not exceed 100,000, the deepest page `/species/search` serves; see decision 8. Whenever `totalCount` exceeds it, a notice on every page names the ceiling and the narrowing routes (`kingdom`, `family`, `genus`, `rank`, `isExtinct`, `q`, or `gbif_get_species_children`, which has no ceiling), while `endOfRecords` stays GBIF's value.

`kingdom`, `family`, and `genus` are name filters over an endpoint that scopes by key alone. Each is resolved through `/species/match` and the narrowest one is forwarded as `higherTaxonKey`; the resolved scope is reported in the enrichment. See decision 17.

**Output:** paginated list of taxon usages, each with classification, a common name (GBIF's own `vernacularName`, else the first English `vernacularNames[]` entry containing `q` when `q` does not occur in the row's `canonicalName` or `scientificName`, else the first English one — GBIF tags some scientific names as English, so a scientific-name query would otherwise pick one, as "Lynx pardinus" picked "Lynx pardinus pardinus"), `numDescendants`, checklist usage `key`, and optional raw `datasetKey` and mapped backbone `nubKey`. `numOccurrences` appears only when GBIF supplies a positive value, since `/species/search` sends a 0 placeholder on every row. The effective checklist defaults to GBIF Backbone Taxonomy `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`; an explicit checklist is preserved. This makes the advertised backbone default explicit while retaining checklist provenance. Occurrence queries chain from `nubKey` when supplied, otherwise resolve the name with `gbif_match_species`; missing mapping is never inferred from the usage key. Empty-scope checklist incompatibility guidance applies only to a foreign checklist, with UUID case ignored for backbone equivalence.

**Errors:** `pagination_cap_exceeded` when `offset + limit` on the applied `limit` passes 100,000, checked before any request, the scope lookups included; `invalid_filter` when any string filter is supplied blank or `datasetKey` is not a UUID; `unresolved_taxon_scope` when a `kingdom`, `family`, or `genus` name matches no backbone taxon at that rank; `conflicting_taxon_scope` when the supplied `family` and `genus` resolve into different lineages.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_species_classification`

Returns the parent chain for a taxon — from kingdom (or domain) down to its immediate parent, excluding the taxon itself — as an ordered array. Each entry has its rank, canonical name, and taxon key. Avoids requiring callers to navigate the hierarchy one level at a time.

The GBIF API exposes `/species/{taxonKey}/parents` which returns the full ancestor array. The result is already ordered root-first (kingdom → phylum → class → … → parent of the given taxon). No reversal is needed — the handler returns the array as-is.

**Input:** `taxonKey: z.number().int().nonnegative()` (0 is *incertae sedis*)

**Output:** `classification: Array<{ key, rank, name, scientificName }>` ordered root-first, ending at the immediate parent of the queried taxon. A taxon at the root of the backbone returns an empty array with a `notice`.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_get_species_children`

Lists direct children of a backbone taxon — genera within a family, species within a genus, subspecies within a species. Paginated.

**Key inputs:** `taxonKey` (non-negative integer), `limit` (integer, default 20), `offset` (integer)

**Output:** paginated list of child taxon records with rank, canonical name, key, and synonym status. No occurrence count: `/species/{key}/children` sends none.

**Annotations:** `readOnlyHint: true`

---

### `gbif_search_occurrences`

The core data retrieval tool. Searches 3.9B+ occurrence records with Darwin Core filters. Supports taxon key, country (ISO 3166-1 alpha-2 code), publishing country, state/province, GADM area (`gadmGid`), bounding box (decimalLatitude/decimalLongitude range or WKT polygon via `geometry`), year range, month, basis of record, georeference filter, `hasGeospatialIssue`, the collection filters `catalogNumber`, `institutionCode`, `recordedBy`, and `mediaType`, the publishing organization (`publishingOrg`), and the record-level filters `typeStatus`, `establishmentMeans`, and `license`. `checklistKey` with `checklistTaxonKey` scopes by a Catalogue of Life key, and `includeMedia` adds each row's media.

**Important nuances:**
- `taxonKey` is the backbone key from `gbif_match_species`. Passing a raw name as `scientificName` also works and resolves a synonym to its accepted taxon (*Felis concolor* counts the same records as `taxonKey` 2435099, 32,150 `PRESENT` as of 2026-11-12), but a name shared across kingdoms matches nothing (`Oenanthe` counts 0) where a key names exactly one taxon — the backbone key is preferred. GBIF ORs the two rather than intersecting them, so passing both widens the result set instead of narrowing it (`taxonKey=212` alone and `taxonKey=212&scientificName=Puma concolor` differ by exactly the *Puma concolor* total).
- The occurrence search endpoint does NOT support free-text search against collectors or locality descriptions — use Darwin Core filter params.
- Pagination is capped: GBIF serves offset+limit up to 100,001 and answers `Max offset of 100001 exceeded` past it. There is no cursor, scroll, or search-after to continue from — and the endpoint ignores unrecognized parameter names with a 200, so probing for one returns the unchanged first page rather than an error. A result set larger than the cap is covered by partitioning on `datasetKey` (see decision 3), not by paging.
- WKT geometry accepts POLYGON and MULTIPOLYGON with coordinates as `lon lat` pairs.
- GBIF returns absence records by default. `occurrenceStatus` defaults to `PRESENT` here instead; `ANY` restores GBIF's behavior, and the applied value is reported in the enrichment either way. Records, rows, and `OCCURRENCE_STATUS` facet buckets read `DETECTED` or `NOT_DETECTED`, so the filter also takes those two, which select the same records as `PRESENT` and `ABSENT` and are sent and echoed as given; a bucket passes back unchanged.
- `/occurrence/search` silently ignores parameter names it does not recognize, answering 200 with the unfiltered total. A misspelled filter is a wrong answer, not an error.
- `country` and `publishingCountry` are different questions — where the record was observed versus the country of the organization that published it — and they disagree on most records (of 60,290,950 records observed in GB, 1,548,928 were published by US organizations). Both descriptions name the other, and the server `instructions` do too; see decision 13.
- `stateProvince` is verbatim, exact, and case-sensitive, with no controlled vocabulary — `England` matches 47,672,439 records on one scope while `england` and `ENGLAND` each match none, and an unmatched value answers 200 with zero records rather than an error. Constrained where it can be (`country` and `publishingCountry` each carry a `^[A-Z]{2}$` pattern) and announced where it cannot (an empty result under a `stateProvince` filter carries a notice naming the semantics); see decisions 13 and 14.
- `gadmGid` is a GADM GID at any level (`ESP`, `ESP.1_1`, `ESP.1.5_1`) that GBIF derives from each record's coordinates, so records without coordinates match none, and the unit can differ from the verbatim `stateProvince` a record carries. It is matched exactly and case-sensitively; the handler checks the GID alphabet (`[A-Z0-9._]`) before the request and fails any other character as `invalid_filter`, and a well-formed GID GBIF does not hold answers zero. See decision 20.
- `catalogNumber` and `institutionCode` match the whole value case-insensitively; `recordedBy` matches each name in a record's `|`-separated list exactly and case-sensitively, so one person written two ways is two values; `mediaType` is a closed enum (`StillImage`, `MovingImage`, `Sound`, `InteractiveResource`).
- `decimalLatitude`, `decimalLongitude`, and `coordinateUncertaintyInMeters` are ranges only when the value holds a comma (`"min,max"`, both ends inclusive); a comma-less value is an exact match, so `decimalLatitude: "38"` matches 0 records where `"38,39"` matches 504, and `coordinateUncertaintyInMeters: "1000"` matches 1 where `"0,1000"` matches 615 (one measured scope). The value is still forwarded unchanged, since an exact match is a filter GBIF answers and a caller can mean it, and a notice on every result names each comma-less field. Uncertainty also takes `*` for one open end (`"*,1000"`); a bare `*`, padded or not, fails as `invalid_filter`, because GBIF answers it with an empty-bodied 404 that would reach the caller as a not-found with no reason. The three fields are declared once, in `sharedOccurrenceFilterFields`, so search, count, and facets describe and guard them identically.
- `publishingOrg` is the UUID of the organization that published the records, across all its datasets, and is checked like `datasetKey`. It is the occurrence-side counterpart of the `publishingOrg` filter on `gbif_search_datasets` and goes in from `gbif_search_publishers`, a dataset's `publishingOrganizationKey`, or a `PUBLISHING_ORG` facet bucket.
- `checklistKey` says which taxonomy a taxon key is read in, on search, count, and facets alike (enum: the Backbone `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`, the default, or the Catalogue of Life eXtended Release `7ddf754f-d193-4cc9-b351-99906754a03b`). `checklistTaxonKey` is a Catalogue of Life key (`3WSJV`, *Lynx pardinus*): uppercase letters and digits, matched case-sensitively, and sent to GBIF as `taxonKey` with `checklistKey`, never under its own name, since GBIF ignores an unknown parameter and answers the whole 3,876,944,011-record index. It matches the taxon and every descendant, and counts as the Backbone key does (`3WSJV` and `taxonKey` 2435261 each count 2,657 records under `occurrenceStatus` ANY, 2,268 under `PRESENT`). `taxonKey` under the Catalogue of Life, and `checklistTaxonKey` without it, fail as `invalid_filter` before any request, because GBIF cannot tell them from an empty result: a Backbone key under the Catalogue of Life, a Catalogue of Life key under the Backbone, and an invented key each answer 200 with zero records, and a digit-only key such as `8288` is the genus *Tringa* in one taxonomy and the family Lagenismataceae in the other. Rows keep their Backbone `taxonKey`. See decision 26.
- `typeStatus` and `establishmentMeans` are matched case-insensitively and with surrounding whitespace ignored against GBIF's TypeStatus (51 concepts) and EstablishmentMeans (7) vocabularies in the handler, then sent and echoed in the concept's own spelling. GBIF matches them exactly and case-sensitively, and a value matching a concept matches every narrower one: `Type` covers every type, `Lectotype` covers `Isolectotype`, `native` covers `nativeEndemic` and `nativeReintroduced`, `introduced` covers `introducedAssistedColonisation`. A value naming no concept fails as `invalid_filter` listing the concepts; see decision 25.
- `license` is the enum `CC0_1_0`, `CC_BY_4_0`, `CC_BY_NC_4_0`, the three codes every record carries. A blank or other value fails at the schema as `-32602 invalid_arguments`, not `invalid_filter`.
- `hasGeospatialIssue` true keeps records GBIF flagged with a spatial issue while interpreting them; false keeps unflagged ones. GBIF often drops the coordinates of a flagged record, and a record without coordinates can carry either value, so records to map take `false` with `hasCoordinate: true`.
- Every string filter is validated whenever it is present, not only when it is non-blank. The endpoint ignores a parameter given with no value, so a blank one used to drop the filter and hand back the whole scope under the caller's own belief that it was narrowed — `stateProvince: ""` returns the 60,290,950-record `country=GB` scope where `England` returns 47,672,439. A blank or whitespace-only value now fails as `invalid_filter`; a blank `country` or `publishingCountry` fails earlier, at its uppercase pattern, and a blank or unknown `license` at its enum, each as `-32602 invalid_arguments`. See decision 16.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().int().nonnegative().optional()
    .describe('GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — a key names exactly one taxon. Rejected under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b; pass a Catalogue of Life key as checklistTaxonKey there.'),
  scientificName: z.string().optional()
    .describe('Scientific name filter. Resolves a synonym to its accepted taxon, but a name shared across kingdoms matches nothing. Use taxonKey from gbif_match_species for reliable results.'),
  country: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded (e.g., "GB", "US", "DE", "SE"). Not the publisher\'s country — that is publishingCountry. Lowercase and alpha-3 forms match nothing upstream, hence the pattern.'),
  publishingCountry: z.string().regex(/^[A-Z]{2}$/).optional()
    .describe('ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — not where it was observed. Lowercase and alpha-3 forms match nothing upstream, hence the pattern.'),
  stateProvince: z.string().optional()
    .describe('State, province, or first-level administrative division, matched verbatim — exact and case-sensitive. Take a value from a STATE_PROVINCE facet; an unmatched value returns zero records rather than an error.'),
  geometry: z.string().optional()
    .describe('WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. All supplied spatial filters intersect; latitude and longitude ranges remain active alongside geometry.'),
  year: z.string().optional()
    .describe('Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year.'),
  month: z.number().int().min(1).max(12).optional()
    .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
  basisOfRecord: z.enum(BASIS_OF_RECORD_VALUES).optional()
    .describe('Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science (eBird, iNaturalist). PRESERVED_SPECIMEN covers natural history collections.'),
  hasCoordinate: z.boolean().optional()
    .describe('When true, return only georeferenced records (those with coordinates). When false, return ONLY records without coordinates. Omit the parameter entirely to include all records regardless of coordinate presence.'),
  isInCluster: z.boolean().optional()
    .describe('Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all.'),
  datasetKey: z.string().optional()
    .describe('Restrict results to a single dataset by its GBIF dataset UUID.'),
  ...sharedOccurrenceFilterFields(), // checklistKey, checklistTaxonKey, decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters, gadmGid, catalogNumber, institutionCode, recordedBy, mediaType, publishingOrg, hasGeospatialIssue, typeStatus, establishmentMeans, license
  includeMedia: z.boolean().default(false)
    .describe('Add each record\'s media items to its row as media — type, identifier URL, license, and rightsHolder, in the record\'s own order. Every item on a matched record is returned, whatever mediaType selected: that filter picks records carrying the type, not items. Off by default because each item adds to both response surfaces.'),
  limit: readLimitSchema(z.number().int().min(1), 300).default(20)
    .describe('Number of records to return (default 20, max 300).'),
  offset: z.number().int().min(0).default(0)
    .describe('Pagination offset. GBIF serves offset+limit up to 100,001 and rejects anything past it, with no cursor or scroll to continue from — to reach a larger result set, split it into per-datasetKey searches using a DATASET_KEY facet from gbif_occurrence_facets.'),
})
```

**Output per record (normalized):**

- `key` — occurrence key for `gbif_get_occurrence` chaining
- `taxonKey`, `scientificName`, `canonicalName`, `rank` — `taxonKey` stays a Backbone key under `checklistKey`
- `acceptedTaxonKey`, `acceptedScientificName` (may be absent) — the accepted taxon behind a record filed under a synonym; equal to `taxonKey` otherwise. `acceptedScientificName` carries authorship, unlike the canonical `acceptedName` on the match tools
- `decimalLatitude`, `decimalLongitude`, `coordinateUncertaintyInMeters` (may be absent)
- `elevation`, `depth` in meters (may be absent)
- `country`, `countryCode`, `stateProvince`, `locality` (may be absent)
- `taxonomicStatus` — whether the record was filed under an accepted name or a synonym
- `eventDate`, `eventTime` (time of day with UTC offset), `year`, `month`, `day`
- `basisOfRecord`, `occurrenceStatus` (`DETECTED` or `NOT_DETECTED`, as GBIF serves it), `iucnRedListCategory`, `individualCount`
- `typeStatus`, `establishmentMeans` (may be absent) — the concept names the filters of the same name take unchanged
- `datasetKey`, `datasetName`, `publishingCountry`, `publishingOrganizationKey` (GBIF's `publishingOrgKey`, under the name the dataset tools give the same key; goes into `publishingOrg`)
- `license` — the Creative Commons URL GBIF stores, passed through; the `license` filter takes the code form (`CC_BY_NC_4_0`), so each description names the other. `rightsHolder` (may be absent)
- `institutionCode`, `catalogNumber`, `recordNumber` (the collector's number; may be absent)
- `recordedBy` (may be absent)
- `media` — only with `includeMedia`: every media item of the record as `{ type, identifier, license, rightsHolder }`, in source order
- `issues` — array of GBIF quality flags

**Pagination output:** `totalCount` (total matches), `endOfRecords`, `offset`, `limit`, the applied `occurrenceStatus` and `scope`, and an enrichment `notice` when the result set is empty, the offset overshot the total, or a presence/absence filter narrowed the result.

**Errors:** `pagination_cap_exceeded` when offset+limit passes 100,001, `invalid_filter` when a string filter other than `country` and `publishingCountry` is supplied blank or whitespace-only (those two fail earlier, at their uppercase pattern, as does a blank or unknown `license` at its enum, each as `-32602 invalid_arguments`), when a bare `*` is given as `decimalLatitude`, `decimalLongitude`, or `coordinateUncertaintyInMeters`, when a `datasetKey` or `publishingOrg` is not a UUID, when a `gadmGid` holds a character outside the GID alphabet, when `checklistTaxonKey` holds a character other than an uppercase letter or digit, when `taxonKey` is given under the Catalogue of Life `checklistKey` or `checklistTaxonKey` without it, when `typeStatus` or `establishmentMeans` names no concept in its vocabulary, or when GBIF rejects the geometry or a range.

**Annotations:** `readOnlyHint: true`

---

### `gbif_count_occurrences`

Returns a single integer count, read from `/occurrence/search` at `limit=0` — no record payload, and the same filter set the search tool accepts. Use before `gbif_search_occurrences` when you only need the total, or to get counts for multiple filters in parallel.

**Key inputs:** every biological filter on `gbif_search_occurrences`, with the same types and constraints. `isGeoreferenced` is retained as an alias for `hasCoordinate`: either alone or both equal is accepted; conflicts fail as `invalid_filter`. Blank string filters fail rather than widening the population; see decision 16.

**Output:** `count: number`, plus enrichment carrying `scope`, the applied `occurrenceStatus` and a `notice` when it narrowed the count, when the count is past what paging can reach, when a verbatim `stateProvince`, `gadmGid`, or `recordedBy` filter or a `scientificName` matched nothing, or when a comma-less `decimalLatitude`, `decimalLongitude`, or `coordinateUncertaintyInMeters` matched only that exact value.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_get_occurrence`

Fetches a full occurrence record by its GBIF key. Returns the complete Darwin Core record — all coordinates with elevation and depth, administrative geography (GADM), dates, collections metadata, collector identifiers and record number, type status and establishment means, the accepted taxon behind a synonym, license, rights holder, publishing organization, media links with their rights holders, and quality issue flags.

**Input:** `occurrenceKey: z.number().int().positive()`

**Output:** Full record with normalized key fields plus `gadm` (GADM administrative divisions, levels 0–3, each `gid` a value for the `gadmGid` filter), `taxonomicStatus`, `eventTime`, `occurrenceStatus` (`DETECTED` or `NOT_DETECTED`; a `NOT_DETECTED` record documents a survey that found nothing and still carries coordinates, a date, and a recorder), `iucnRedListCategory`, the fields the search rows gain (`acceptedTaxonKey`, `acceptedScientificName`, `publishingOrganizationKey`, `license`, `rightsHolder`, `recordNumber`, `elevation`, `depth`, `typeStatus`, `establishmentMeans`, each optional on both surfaces, and a record carrying none renders none and no placeholder), a `media` array whose items now carry `rightsHolder`, and an `issues` array.

**Errors:** `not_found` when the key doesn't exist. There is no `invalid_filter`: the schema rejects a non-positive or fractional key, and every positive safe-integer key answers 200 or 404.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_occurrence_facets`

Fetch one lookahead bucket (`facetLimit + 1`, including 101 at the public limit of 100) and expose at most `facetLimit`. Only an extra bucket sets `truncated`, `shown`, and `cap`; advance `facetOffset` by the exposed page size so the lookahead becomes the next page's first value. An exactly full final page has no continuation metadata. Empty later facet or child pages give offset-reset guidance instead of asserting missing biological data. At offset zero, empty facets distinguish zero occurrences from missing dimension data; empty children mean no direct children only after the existing taxon check succeeds.

Accepts every biological filter on `gbif_search_occurrences`, with the same types, blank rejection and byte-preserving forwarding. Search, count and facets echo identical `scope` enrichment: supplied biological filters only, with `occurrenceStatus` always included, `ANY` omitted upstream, the count alias resolved to `hasCoordinate`, and pagination/facet controls excluded. All 11 official `BASIS_OF_RECORD_VALUES` are shared across these tools, including `FOSSIL_SPECIMEN`, `OBSERVATION` and `UNKNOWN`.

Returns aggregated occurrence counts for a given facet dimension. Backed by the occurrence search endpoint with `limit=0` and `facet=<field>`, so it returns only the facet counts with no record payload — efficient for distribution analysis.

Available facet dimensions: `BASIS_OF_RECORD`, `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `DATASET_KEY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `PUBLISHING_COUNTRY`, `MONTH`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`, `GADM_LEVEL_0_GID`, `GADM_LEVEL_1_GID`, `GADM_LEVEL_2_GID`, `GADM_LEVEL_3_GID`, `INSTITUTION_CODE`, `MEDIA_TYPE`, `RECORDED_BY`, `PUBLISHING_ORG`, `TYPE_STATUS`, `ESTABLISHMENT_MEANS`, `LICENSE`.

Dimensions a record can lack drop that record from every bucket: `YEAR`, `MONTH`, `STATE_PROVINCE`, `SPECIES_KEY`, `INSTITUTION_CODE`, `MEDIA_TYPE`, `RECORDED_BY`, `TYPE_STATUS`, and `ESTABLISHMENT_MEANS`, and the GADM levels (records without coordinates or outside every GADM unit at that level). `MEDIA_TYPE` and `RECORDED_BY` buckets also overlap, since a record with two media types or two collectors counts in each. `TYPE_STATUS` and `ESTABLISHMENT_MEANS` buckets overlap through the vocabulary: a record counts under its concept and every broader one (an `Isolectotype` also under `Lectotype` and `Type`, a `nativeReintroduced` record also under `native`), so their sums can pass `totalOccurrences`. `INSTITUTION_CODE` buckets come back lowercased, and `institutionCode` takes them unchanged. `GADM_LEVEL_*_GID` buckets are GIDs to pass back as `gadmGid`; `PUBLISHING_ORG`, `TYPE_STATUS`, `ESTABLISHMENT_MEANS`, and `LICENSE` buckets pass back unchanged as `publishingOrg`, `typeStatus`, `establishmentMeans`, and `license`; `OCCURRENCE_STATUS` buckets read `DETECTED` and `NOT_DETECTED` and pass back unchanged as `occurrenceStatus`. `KINGDOM_KEY`…`SPECIES_KEY` buckets are Backbone keys to pass back as `taxonKey`, or, when `checklistKey` is the Catalogue of Life, Catalogue of Life keys to pass back as `checklistTaxonKey`, some all digits (`8288` is the genus *Tringa*) yet never Backbone keys.

With `includeLabels`, a `KINGDOM_KEY`…`SPECIES_KEY` page reads each bucket's `canonicalName` from `/species/{key}` (or, under the Catalogue of Life `checklistKey`, from `/v2/species/match?checklistKey=<Catalogue of Life>&usageKey=<key>`, `usage.canonicalName`, where a `matchType` of `NONE` leaves the bucket unlabeled), a `DATASET_KEY` page each `title` from `/dataset/{key}`, a `PUBLISHING_ORG` page each `title` from `/organization/{key}`, and a `GADM_LEVEL_0_GID`…`GADM_LEVEL_3_GID` page each `name` from `/geocode/gadm/{gid}`, into `counts[].label`. The facet response carries only `name` and `count` and GBIF has no multi-key lookup, so this is one request per exposed bucket (never the lookahead), through a service-wide pacer (8 in flight), one attempt each, under one 10 s deadline per page, queue time included. A bucket name becomes a path or parameter only in its dimension's key shape (digits for a Backbone taxon; uppercase letters and digits for a Catalogue of Life taxon; a UUID for dataset and organization; a letter-first GID alphabet for GADM, so no segment resolves to `.` or `..`). A taxon page chooses its lookup by `checklistKey`, never by the shape of a key. A lookup that fails (404, 5xx, 429, transport, timeout), finds no name, or misses the deadline leaves the bucket without `label` and is counted in `notice`; for a GADM bucket the notice points at `gadmGid` on `gbif_search_occurrences` and the `gadm` field of `gbif_get_occurrence`. GADM answers a GID it does not hold with HTTP 200 and an empty body, not a 404, and that leaves the bucket unlabeled, while a non-empty body that is not JSON fails the call as on the other kinds. Caller cancellation ends the call cancelled. The other dimensions are codes or values that read as they are, and look nothing up. See decision 22.

`scientificName`, `stateProvince`, `decimalLatitude`, `decimalLongitude`, `geometry`, `year`, `coordinateUncertaintyInMeters`, `datasetKey`, `publishingOrg`, `gadmGid`, `checklistTaxonKey`, `catalogNumber`, `institutionCode`, `recordedBy`, `typeStatus`, and `establishmentMeans` are validated whenever present and fail as `invalid_filter` when blank, on the same ground as the search tool's filters — a dropped scope filter here partitions a wider scope than the caller asked about, and the buckets say nothing about which scope they cover. See decision 16.

**Key inputs:**

```ts
z.object({
  taxonKey: z.number().int().nonnegative().optional().describe('Backbone taxon key to scope the aggregation. Rejected under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b; scope by a Catalogue of Life key with checklistTaxonKey there.'),
  scientificName: z.string().optional().describe('Scientific name; combines with taxonKey by union (OR), not intersection.'),
  month: z.number().int().min(1).max(12).optional().describe('Calendar month (1–12).'),
  hasCoordinate: z.boolean().optional().describe('True for coordinates, false for no coordinates; omit for both.'),
  isInCluster: z.boolean().optional().describe('True for likely duplicates, false to exclude them; omit for both.'),
  country: z.string().regex(/^[A-Z]{2}$/).optional().describe('ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded — pass back a COUNTRY bucket to drill into it.'),
  publishingCountry: z.string().regex(/^[A-Z]{2}$/).optional().describe('ISO 3166-1 alpha-2 code, uppercase, of the publishing organization — pass back a PUBLISHING_COUNTRY bucket to drill into it.'),
  stateProvince: z.string().optional().describe('Verbatim state/province, exact and case-sensitive — pass back a STATE_PROVINCE bucket rather than guessing.'),
  year: z.string().optional().describe('Year or year range (e.g., "2020,2024").'),
  basisOfRecord: z.enum(BASIS_OF_RECORD_VALUES).optional().describe('Scope to a specific basis of record.'),
  geometry: z.string().optional().describe('WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Same format as gbif_search_occurrences.'),
  datasetKey: z.string().optional().describe('Scope the aggregation to a single dataset by its GBIF dataset UUID.'),
  occurrenceStatus: z.enum(OCCURRENCE_STATUS_VALUES).default('PRESENT').describe('Presence/absence scope. ANY omits the filter upstream; DETECTED and NOT_DETECTED select the same records as PRESENT and ABSENT.'),
  iucnRedListCategory: z.enum(['CR','EN','VU','NT','LC','DD','EX','EW','CD']).optional().describe('Scope to one IUCN Red List category.'),
  ...sharedOccurrenceFilterFields(), // checklistKey, checklistTaxonKey, decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters, gadmGid, catalogNumber, institutionCode, recordedBy, mediaType, publishingOrg, hasGeospatialIssue, typeStatus, establishmentMeans, license
  facet: z.enum(['BASIS_OF_RECORD','COUNTRY','STATE_PROVINCE','YEAR','DATASET_KEY','KINGDOM_KEY','PHYLUM_KEY','CLASS_KEY','ORDER_KEY','FAMILY_KEY','GENUS_KEY','SPECIES_KEY','PUBLISHING_COUNTRY','MONTH','OCCURRENCE_STATUS','IUCN_RED_LIST_CATEGORY','GADM_LEVEL_0_GID','GADM_LEVEL_1_GID','GADM_LEVEL_2_GID','GADM_LEVEL_3_GID','INSTITUTION_CODE','MEDIA_TYPE','RECORDED_BY','PUBLISHING_ORG','TYPE_STATUS','ESTABLISHMENT_MEANS','LICENSE']).describe('Dimension to aggregate by.'),
  facetLimit: readLimitSchema(z.number().int().min(1), 100).default(10).describe('Maximum number of facet values to return (default 10, max 100).'),
  facetOffset: z.number().int().min(0).default(0).describe('Zero-based offset into the ranked facet values.'),
  includeLabels: z.boolean().default(false).describe('Name the taxon, dataset, publishing organization, or administrative area behind each KINGDOM_KEY…SPECIES_KEY, DATASET_KEY, PUBLISHING_ORG, or GADM_LEVEL_0_GID…GADM_LEVEL_3_GID bucket on the page.'),
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
    label: z.string().optional().describe('canonicalName, dataset title, organization title, or administrative area name; present only with includeLabels, and only when the lookup for this bucket succeeded.'),
  })).describe('Facet values ranked by count descending.'),
})
```

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_search_datasets`

Searches GBIF datasets. Useful for locating the specific dataset behind a set of records, or understanding what data collections are available for a country or taxonomic group.

**Key inputs:** `q` (free text, rejected blank — `/dataset/search?q=` returns all 123,527 datasets and `?q=%20%20` returns none; see decision 16), `type` (OCCURRENCE | CHECKLIST | METADATA | SAMPLING_EVENT), `publishingCountry` (`^[A-Z]{2}$` — `/dataset/search` matches the verbatim stored code, so `gb` and `GBR` return zero datasets rather than an error; see decision 14), `publishingOrg` and `hostingOrg` (lowercase organization UUIDs naming two different relationships; see decision 15), `limit` (integer, default 20), `offset` (integer, with `offset + limit` at most 125,000, the deepest page `/dataset/search` serves; see decision 8)

**Errors:** `pagination_cap_exceeded` when `offset + limit` on the applied `limit` passes 125,000, checked before any request; `invalid_filter` for a blank string filter, a malformed or uppercase organization key, or a value GBIF rejects. Whenever `totalCount` exceeds the ceiling, a notice on every page names it and the narrowing routes: `type` partitions the index with no gap or overlap, since every dataset carries exactly one of its four values, then `q`, `publishingCountry`, `publishingOrg`, and `hostingOrg`.

**Output per dataset:** `key`, `title`, `type`, `recordCount`, `publishingCountry`, `license`, `doi`, brief `description`, and optional `publishingOrganizationKey` (what `publishingOrg` takes) and `publishingOrganizationTitle`. `recordCount` is GBIF's own indexed occurrence total and spans every `occurrenceStatus` — see decision 12.

**Annotations:** `readOnlyHint: true`

---

### `gbif_get_dataset`

Full dataset metadata including title, description, citation text, contacts, license, DOI, `publishingOrganizationKey`, `numConstituents`, and temporal coverage. Use after `gbif_search_datasets` or when an occurrence record's `datasetKey` needs provenance detail.

**Input:** `datasetKey: z.string()` (the handler validates the 8-4-4-4-12 hex UUID), `contactLimit` (default 10, applied cap 100; `0` suppresses contact detail while still reporting the count)

**Output:** Full dataset record. `citation.text` is the citable reference. Contacts are capped at `contactLimit`, with `contactsTotal`/`contactsReturned` reporting the full count. `recordCount` is fetched separately — the detail endpoint omits it — and spans every `occurrenceStatus`, matching `gbif_search_datasets` rather than `gbif_count_occurrences`; see decision 12.

`publishingOrganizationKey` names the organization that published the dataset and chains into `gbif_search_datasets` as `publishingOrg`. `/dataset/{key}` carries no organization name, and resolving one would add a second request to a one-request call, so the name is left to `gbif_search_datasets` rows, which carry it; see decision 21.

The supplementary count uses one request with a three-second deadline for every dataset type. Operational failures preserve metadata with `recordCountNotice`; cancellation and invalid input or responses propagate. Declared counts, including zero, suppress the lookup.

Temporal coverage preserves optional `start`/`end` bounds, single `date`, and verbatim `period`/`type`, plus GBIF's `@type` discriminator. Unsupported or unusable entries produce `temporalCoverageNotice` rather than implying completeness. These additive fields preserve legacy ranges without inferring dates. The dataset resource uses the same projection.

Publisher HTML extraction decodes numeric and supported named character references once and preserves paragraph breaks. Structured text remains plain text; dataset and species formatters escape publisher text at the CommonMark boundary so literal references and markup retain their meaning.

**Errors:** `not_found` when the UUID doesn't match any dataset; `invalid_filter` when `datasetKey` is not a UUID or GBIF rejects the request as malformed.

**Annotations:** `readOnlyHint: true`, `openWorldHint: true`

---

### `gbif_search_publishers`

Searches organizations registered with GBIF by name fragment or country. Returns organization key, title, and country — sufficient to chain into `gbif_search_datasets` as `publishingOrg` (the datasets the organization published) or `hostingOrg` (the ones its own installation serves), or to understand who publishes data for a region. `publishingOrg` is the usual chain; see decision 15.

**Key inputs:** `q` (rejected blank in either form — `/organization` drops one and answers with all 3,561 organizations), `country` (unpatterned, since the registry resolves the parsed country — but the empty string is rejected, because `/organization?country=` answers with all 3,561 too, while whitespace draws an upstream 400 naming the value; see decisions 14 and 16), `limit` (integer), `offset` (integer)

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
| 2 | `gbif_occurrence_facets` | `{ geometry: "...", facet: "SPECIES_KEY", facetLimit: 100, includeLabels: true }` → named species list |

---

## Design Decisions

**1. `gbif_match_species` as the mandatory first step for species workflows.** The backbone taxon key is the stable identifier across GBIF's APIs — it handles synonymy, aggregates records across checklist sources, and is the primary parameter for occurrence search. Designing `gbif_match_species` as the explicit first step (rather than accepting scientific name strings everywhere) makes the two-step pattern visible and encourages correct use. The `scientificName` convenience parameter on the occurrence tools exists for a name the caller already holds; it resolves a synonym but matches nothing for a name shared across kingdoms, so the key stays preferred.

**2. `gbif_occurrence_facets` as a separate tool, not folded into `gbif_search_occurrences`.** Facet-only queries (`limit=0`) are a fundamentally different use pattern — no records returned, just aggregate counts. Exposing them as a separate tool makes the intent clear and avoids the cognitive overhead of understanding `limit=0` as a special mode. The tool names the facet dimensions explicitly via an enum, which is more discoverable than a free string parameter.

**3. No complete-retrieval path past the pagination cap, and the guidance says so.** `/occurrence/search` has no cursor, scroll, or search-after — `offset`/`limit` under 100,001 is its entire pagination surface, and it answers 200 while ignoring parameter names it does not recognize, so a probe for a continuation token looks like a success and returns the first page again. Three routes past the cap exist, and none can live in this server:

- **The Download API** (`POST /occurrence/download/request`) answers `403 Access is denied` unauthenticated. It authenticates with HTTP Basic against a GBIF.org username and password — there is no API-key mode — then queues a job the caller polls until `SUCCEEDED` and collects as a ZIP. Proxying it would mean one shared account's credentials, quota, and notification inbox serving every tenant of a keyless multi-tenant server, and the job/poll/archive shape has no synchronous MCP equivalent. The archive can hold tens of millions of rows, which no agent context can read regardless of transport.
- **The AWS Open Data snapshot** (`gbif-open-data-us-east-1`, keyless) is a monthly Parquet dump for DuckDB or Spark — a bulk analytical dataset, not a live filtered query.
- **Caller-side partitioning** is the only route that works through this surface, and `datasetKey` is the dimension for it: every occurrence carries exactly one, so `DATASET_KEY` facet buckets cover the scope with no gap and no overlap, and the dimension has the cardinality to cut a large scope into pageable pieces. Measured on `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` (60,290,950 records): 550 `DATASET_KEY` buckets summing to 60,290,950 exactly, against 224 `YEAR` buckets summing to 59,407,400 — 883,550 undated records in no bucket. `basisOfRecord` and `publishingCountry` are gap-free as well (both sum to the whole 3.9-billion-record index exactly, in 9 and 250 buckets; 9 and 41 within the measured scope, where `PUBLISHING_COUNTRY` buckets summed to the scope total with no gap), and both have a matching filter on all three occurrence tools, so either drives a further split of a bucket still over the cap — but at that cardinality neither reaches pageable pieces as a first cut. Partitioning does not close the gap on its own either: 29 of the 550 buckets individually exceed the cap, and splitting the largest (`4fa7b334-ce0d-4e88-aaae-2e0c138d049e`, 42,437,187 records) by year leaves 41 of its 165 sub-buckets still over. Recursion depth is data-dependent and unbounded, so this is a technique for the caller to apply, not a bounded tool call.

Search, count and facets accept the same biological filters. Repeat every effective filter on the facet call and each per-`datasetKey` search: bucket counts reconcile only for the same population. The shared `scope` echo makes this comparison explicit, excluding pagination/facet controls and resolving the count coordinate alias to `hasCoordinate`.

What ships instead is accurate guidance: the `pagination_cap_exceeded` recovery, the partition note on the `facet` description, an over-cap notice on `gbif_search_occurrences` and `gbif_count_occurrences`, and the server `instructions` all name the partition technique and state plainly that a bulk download is a route the caller takes outside this server.

**4. Occurrence record output normalization.** GBIF's occurrence search response is verbose (the `classifications` object includes entries for both the Catalogue of Life backbone and the legacy GBIF backbone, with deeply nested structure). The handler extracts the simpler top-level Darwin Core fields (`taxonKey`, `scientificName`, `kingdom`, etc.) and discards the `classifications` nested object to reduce response size. The full record is available via `gbif_get_occurrence` when needed.

**5. WKT geometry and lat/lon bounding box.** GBIF's occurrence search supports both — `decimalLatitude`/`decimalLongitude` ranges for simple bounding boxes, `geometry` for WKT polygons. Every supplied spatial filter remains active and results are their intersection: adding a disjoint latitude range to a matching polygon returns zero. The geometry does not override the ranges.

**6. No `gbif_get_species_synonyms` tool.** The synonyms endpoint (`/species/{key}/synonyms`) returns a paginated list of species records that are synonyms of the given accepted taxon. This is niche — most workflows need only to know whether a taxon *is* a synonym (surfaced in `gbif_get_species`), not to enumerate all synonyms of an accepted name. Deferred to a future iteration if demand warrants.

**7. Two data resources, not more (plus the published `skill://` guide).** Species and dataset records are the two stable, addressable, reference objects with real utility as injectable context. Occurrence records are too numerous (3.9B+) and too transient to be useful as resources. Publisher/organization records are rarely needed as injectable context. The resource surface is intentionally minimal.

**8. Pagination ceilings enforced before the request, one per paged search endpoint.** GBIF rejects an `offset + limit` past each ceiling with an error a retry cannot change, which would otherwise burn the whole retry budget. `/occurrence/search` serves up to 100,001 and answers 400 past it; `/species/search` up to 100,000, answering 500 past it and 400 `Max offset of 100000 exceeded.` at an offset of 100,000 or more, whatever the query, scope, or checklist; `/dataset/search` up to 125,000, answering 500 past it at any offset. Each handler checks the sum on the applied (clamped) limit, so a clamped page that fits is still sent, and fails with `pagination_cap_exceeded` naming the boundary and the way past it: the partition technique from decision 3 for occurrences; for species, narrowing by `kingdom`, `family`, `genus`, `rank`, `isExtinct`, or `q`, or walking a subtree with `gbif_get_species_children`, which has no ceiling; for datasets, `type`, which partitions the index with no gap or overlap since every dataset has exactly one of its four values, then `q`, `publishingCountry`, `publishingOrg`, and `hostingOrg`. On species and datasets the same guidance rides every page as a notice whenever `totalCount` exceeds the ceiling, because the choice between paging and narrowing is made on the first page; `endOfRecords` stays GBIF's value, since the records exist.

**9. Presence/absence filtering defaults to `PRESENT` across every occurrence query tool.** A GBIF `ABSENT` record documents a survey that looked for a taxon and did not find it, yet it arrives with coordinates, a date, and a recorder — indistinguishable from a sighting. GBIF returns both by default, and for absence-heavy taxa the mix dominates: *Radicipes gracilis* (`taxonKey` 2263005) has 2,351,582 indexed records, 79 of them presences. `gbif_search_occurrences`, `gbif_count_occurrences`, and `gbif_occurrence_facets` therefore all default to `PRESENT` so they answer the question a caller actually asked and agree with each other on the same filters. The default is never silent: each tool reports the applied `occurrenceStatus` in its enrichment and emits a notice naming the opt-out. `ANY` is a server-side sentinel, not a GBIF term — it resolves to an omitted parameter, since GBIF's terms are `PRESENT` and `ABSENT` plus the `DETECTED` and `NOT_DETECTED` its records and `OCCURRENCE_STATUS` buckets read, and it rejects anything else with a 400. The filter takes all four, sent and echoed as given; `DETECTED` selects the same records as `PRESENT`, and `NOT_DETECTED` the same as `ABSENT`, so a value read off a record or bucket passes back unchanged.

**10. `gbif_count_occurrences` reads its total from `/occurrence/search?limit=0`, not `/occurrence/count`.** The dedicated count endpoint accepts a closed parameter set and answers `Invalid parameter name` for both `occurrenceStatus` and `iucnRedListCategory`, so decision 9 is unreachable through it and the count tool would contradict the search tool on the same question. The two report the same total, and where they diverge `/occurrence/count` is the stale side: its responses are edge-cached at `max-age=600` and served well past it, so an entry hours old trails the search figure by a few thousand records and matches exactly once it refreshes. Search is also self-consistent, its own `OCCURRENCE_STATUS` facet counts summing to its total. One parameter does not carry over: `/occurrence/search` has no `isGeoreferenced` and silently ignores it rather than rejecting it, so the service maps it to `hasCoordinate`, which returns identical figures in both directions. `/occurrence/count` is still used for the supplementary dataset record count, where no such filter applies.

**11. IUCN Red List categories are a closed enum of the nine GBIF actually indexes.** GBIF answers an unrecognized `iucnRedListCategory` with HTTP 200 and a count of zero rather than an error, so an unvalidated string produces a confident empty result. The enum is taken from an unscoped `facet=IUCN_RED_LIST_CATEGORY` over the whole index: `CR`, `EN`, `VU`, `NT`, `LC`, `DD`, `EX`, `EW`, `CD`. `NE` (Not Evaluated) is deliberately excluded — it matches no record, so offering it would only produce that silent zero.

**12. Dataset `recordCount` stays unfiltered and says so, rather than being narrowed to match decision 9.** It is GBIF's own figure for its own dataset — `/dataset/search` publishes it, and re-scoping it to presences would make `gbif_get_dataset` and the `gbif://dataset/{datasetKey}` resource disagree with both `gbif_search_datasets` and gbif.org, trading one inconsistency for a worse one. Surfacing a second presence-scoped figure alongside it is no better: `gbif_search_datasets` returns up to 1,000 datasets per page and cannot afford a per-dataset count call, so only the detail surfaces could carry it and the list surface would be the odd one out. What was actually missing is the scope label. Every surface carrying the figure — both dataset tools, the resource, and the server `instructions` — now states that it spans every `occurrenceStatus` and names `gbif_count_occurrences` as the presence-scoped alternative, in the field description *and* in the rendered `content[]` text, since a `content[]`-only client never reads an output schema. The gap is not hypothetical: dataset `b6b4502f-ffc8-4048-a91b-af502288faa8` reports 30,622,351 records against 61,357 presences, a factor of 499.

The same pass dropped the `type === 'OCCURRENCE'` condition on the supplementary lookup. `/dataset/search` reports `recordCount` for all four dataset types, and `SAMPLING_EVENT` and `METADATA` datasets carry indexed occurrences in the tens of millions — including that same `b6b4502f` dataset, a `SAMPLING_EVENT`. Gating on `type` left the detail surfaces silent on exactly the datasets the list surface counts, which contradicted their own claim to match it; a `CHECKLIST` now resolves to 0, which is what search reports for it.

**13. `publishingCountry` and `stateProvince` are filters on all three occurrence tools, guarded differently because their vocabularies differ.** `gbif_occurrence_facets` offered `PUBLISHING_COUNTRY` and `STATE_PROVINCE` as dimensions while no occurrence tool could filter on either, so those buckets were a dead end — a caller could read that England holds 47,672,439 of a scope's records and had no way to fetch them. Every other dimension in the enum already had a matching filter. Both go on all three tools rather than one: adding a filter to `gbif_search_occurrences` alone would recreate the search/count/facets disagreement decision 9 exists to prevent. `/occurrence/search` backs all three, so one verification covers them — measured on `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` (60,290,950 records), `publishingCountry=US` gives 1,548,928 and `stateProvince=England` gives 47,672,439, with the facet call's bucket sums tracking the narrowed total in each case.

The guards differ because the failure modes do. `publishingCountry` draws on a closed vocabulary, and GBIF splits its rejections: an unparseable code (`XX`) answers HTTP 400, but a lowercase or alpha-3 form (`us`, `USA`) answers 200 with zero records — a silent wrong answer of exactly the shape decision 11 removed for `iucnRedListCategory`. A `^[A-Z]{2}$` pattern on the Zod schema turns every silent case into a local validation error, and lands in the JSON Schema a model reads from `tools/list` rather than in prose it may skip. `stateProvince` has no vocabulary to validate against — GBIF stores whatever each dataset recorded, unnormalized, so `England`, `England - Greater London`, and `Greater London` are three distinct values, matching is exact and case-sensitive (`england` and `ENGLAND` each return zero), and no pattern can separate a typo from a real value. Its guard is therefore a runtime notice: an empty result under a `stateProvince` filter says the match is verbatim and case-sensitive and points at the `STATE_PROVINCE` facet for the exact strings, which is what lets a caller tell a misspelling from a region that genuinely holds nothing. Every description also names the sibling field, because `country` (where the record was observed) and `publishingCountry` (the publisher's country) are easy to conflate and disagree on most records.

`publishingCountry` additionally repairs a gap decision 3 had to work around: `PUBLISHING_COUNTRY` is gap-free but was undrillable, so it could not serve as a second split axis. It can now. `stateProvince` does not gain that role — it stays lossy, so it partitions nothing.

The pre-existing `country` filter has the same silent-zero behavior; decision 14 closes it. The `stateProvince` notice also names `gadmGid`, the normalized alternative: a GADM unit GBIF derives from each record's coordinates, so it matches a region however datasets spell it; decision 20.

**14. The `^[A-Z]{2}$` country-code pattern goes on every field whose route matches the verbatim stored code — `country` on all three occurrence tools, and `publishingCountry` on `gbif_search_datasets` — and deliberately not on `gbif_search_publishers`.** Constraining an already-published parameter changes an existing tool's contract: a call that previously succeeded, returning zero, now fails validation. That is the point. Those were the last filters in this server still answering a malformed value with a confident wrong number, and the guard is the one decision 13 established rather than a second mechanism.

The pattern is applied per endpoint, because the endpoints do not agree. `/occurrence/search` parses the code and then matches the verbatim string, so a form that parses but is not stored answers 200 with zero records — `gb`, `Us`, `uS`, `USA`, and `gb ` all return 0 against `taxonKey=212` + `occurrenceStatus=PRESENT`, where `GB` returns 60,290,950. `/dataset/search` behaves the same way one layer up: `gb`, `Gb`, `gB`, `gbr`, `GBR`, and `USA` each return 0 datasets where `GB` returns 2,416 and `US` returns 3,246. `/organization`, behind `gbif_search_publishers`, resolves the parsed country instead: `gb`, `gbr`, `GBR`, and `Gb` each return the same 223 organizations as `GB`, and `USA` the same 499 as `US`. There is no silent zero to close there, so the same pattern would reject values that currently answer correctly — a regression dressed as consistency. One value it would have caught incidentally does misbehave on that route: the empty string, which `/organization` reads as no filter and answers with the whole 3,561-organization registry. Decision 16 closes that one in the handler, which is where it belongs once the pattern is off the table. `gbif_search_publishers` otherwise keeps a plain string, and its description names the divergence so the rule the other three tools follow is not over-generalized onto it.

Only `publishingCountry` moves on `gbif_search_datasets`. Its other filters are already guarded or have nothing to guard against on *shape*: `type` is an enum, the organization UUIDs are checked in the handler and fail as `invalid_filter` (decision 15 extends that check to the empty string, which this decision closed for `publishingCountry` at the schema), and `q` is free text with no vocabulary to pattern-match against — though decision 16 gives it the same blank guard the rest carry. `/dataset/search` also accepts `hostingCountry`, which carries the identical hole (`hostingCountry=gb` returns 0 against `GB`'s 1,240), but it is not exposed by this server and is not added here.

A shape check rather than a closed enum, though the vocabulary *is* closed — `/v1/enumeration/basic/Country` lists 253 codes, the 249 officially assigned ISO 3166-1 alpha-2 entries plus GBIF's own `AA`, `XK`, `XZ`, and `ZZ`, and `^[A-Z]{2}$` admits every one of them. Three reasons against enumerating them. A 253-member `enum` in every `tools/list` response costs roughly a kilobyte per field of tokens a model gains nothing from. The set is upstream data, so a code GBIF adds is rejected locally until this server ships a release. And the values the enum would catch that the pattern does not — `XX`, `QQ`, `GB-ENG` — are exactly the ones GBIF already answers with `400 Cannot parse XX into a known Country`, which the service folds into the message and tags `invalid_filter` with the tool's recovery hint; a bare `-32602` schema rejection under the framework's generic `invalid_arguments` reason would be the less actionable of the two. The pattern covers the silent class, the upstream 400 covers the unknown-code class, and each failure lands where its message is best.

Rejecting rather than upper-casing, for the same reason `datasetKey` is not trimmed: normalizing a value the caller believes it sent hides a caller-side defect, and it only half-works anyway — no case fix rescues `USA` or `Britain`. Padding is rejected on the same ground even though both routes trim it upstream (` GB ` answers as `GB` on each) — the schema states one accepted form rather than one form plus whatever GBIF happens to tolerate. The empty string goes with them, on both routes. It used to be dropped by a `?.trim()` guard in the handler, which meant `country: ""` returned an unfiltered result to a caller who believed they had filtered by country, and `publishingCountry: ""` on `gbif_search_datasets` returned all 123,527 indexed datasets the same way — the same class of confident wrong answer, one layer down. Both now fail validation, and each handler guard drops to a plain truthiness check.

**15. `gbif_search_datasets` exposes both organization filters `/dataset/search` offers, and every chaining surface names `publishingOrg` first.** `hostingOrg` was the only one, and it matches a dataset's `hostingOrganizationKey` — the organization running the installation the dataset is served from, which for most organizations is somebody else's. So the documented `gbif_search_publishers` → `gbif_search_datasets` chain answered a question almost no caller was asking and returned zero without saying why. Measured on the first 25 organizations `/organization?country=GB` lists: all 25 host no datasets, and 13 of them publish one or two that only `publishingOrg` reaches. The relationships are genuinely distinct rather than one being a better name for the other — Butterfly Conservation (`0d72dd7f-6f05-46af-85c2-8b6e77ce5534`) publishes 3 datasets and hosts none, the National Biodiversity Network (`07f617d0-c688-11d8-bf62-b8a03c50a862`) hosts 984 and publishes 1, and dataset `a86201a4-fa20-44e5-ade2-68ea3563cfa8` is one of the 3 the first published and one of the 984 the second serves.

Both stay. Dropping `hostingOrg` would break a published parameter that answers a real question — "what does this installation serve" — and gains nothing, since the fix is that the chain now points somewhere useful, not that the old target was meaningless. Two similar-sounding organization filters is the same hazard `country` and `publishingCountry` created on the occurrence tools, and it gets the same treatment: each description states what it matches, names the other one as the different question, and carries a measured figure showing how far apart they land, so a caller reading either field alone can tell which they want.

Supplied together, GBIF intersects them rather than combining them — `hostingOrg=07f617d0` (984) with `publishingOrg=28eb1a3f-1c15-4a95-931a-4af90ecb574d` (1) returns 0, and putting one key in both fields returns only what that organization published *and* serves, which for most organizations is nothing. That is a trap a caller falls into precisely when reaching for "everything about this organization," so it is stated in both field descriptions and again by name in the empty-result notice, which splits on whether both filters were applied.

Validation stays in the handler, failing as `invalid_filter`, and covers three classes rather than the one `hostingOrg` used to check. A malformed value is the only class `/dataset/search` answers loudly, with `400 Invalid UUID string`; the other two are silent, and each is a confident wrong answer rather than an error the caller can see.

The first is the empty string, which fires the guard on presence rather than on a non-blank value. `/dataset/search?publishingOrg=` answers 200 with all 123,527 indexed datasets, so a `?.trim()` guard would drop it and hand the whole index to a caller who believed they had filtered by organization — the same wrong answer decision 14 closed for `publishingCountry`, and worse than the zero it replaces. The second is letter case. These two parameters are matched case-sensitively, unlike every other UUID this server forwards: `publishingOrg=0D72DD7F-6F05-46AF-85C2-8B6E77CE5534` answers 200 with 0 where the same key lowercased answers 3, and `hostingOrg` upper-cased drops 984 to 0. `datasetKey` on `/occurrence/search`, `/occurrence/count`, and `/dataset/{key}` resolves either case, so the shared `isGbifUuid` check keeps its case-insensitive regex and only the organization fields add the lowercase requirement.

A handler guard over a Zod `pattern` for all three. The tradeoff runs the other way from decision 14's: a pattern is advertised in `tools/list` where a model reads it, but its rejection arrives as `-32602` under the framework's generic `invalid_arguments` reason, which no declared `recovery` hint can reach; a handler guard is not advertised, but it carries the typed reason and the contract's hint. Here the guard already has to cover the empty string and the case rule, which a shape pattern alone would express awkwardly, and both field descriptions state the lowercase form — so the advertised half of the pattern's advantage is kept without giving up the actionable failure.

One case no guard reaches: a well-formed lowercase UUID belonging to no organization answers 200 with a count of 0. Nothing local can distinguish that from an organization with no datasets, so it stays the empty-result notice's job.

**16. Every optional filter this server forwards fires its guard on presence rather than on a non-blank value, so a blank or whitespace-only value is rejected instead of dropped.** Decision 15 settled the reasoning for the two organization filters; this is the same defect everywhere else, and it gets the identical treatment rather than a second mechanism. Guard and forward both tested `?.trim()`, so a blank value cleared both: the filter was dropped and the tool answered the whole unfiltered scope to a caller who believed they had narrowed it. That is the worse of the two failures on offer — a rejected call costs one retry, an unfiltered answer is wrong and looks right. The rule states itself precisely in terms of what changed: the set of values the old `?.trim()` test silently dropped is exactly the set now named, and every value it forwarded is still forwarded byte-identically.

Measured against the built server and the live API. The identifier filters: `gbif_count_occurrences` on `taxonKey=212` returns 2,351,689,943 with `datasetKey: ""` and 2,351,689,943 with the field omitted, where a real key (`4fa7b334-ce0d-4e88-aaae-2e0c138d049e`) returns 1,775,781,186; `gbif_search_occurrences` matches on that total and on the first record returned (occurrence 1291505203); `gbif_search_species` on `q=Aves` returns the same 4,972 taxa either way; `gbif_search_publishers` with `country: ""` returns all 3,561 registered organizations against 223 for `GB`. The rest, on a `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` scope of 60,290,950 records: `stateProvince` blank returns 60,290,950 against `England`'s 47,672,439; `year` blank returns 60,290,950 against `2020`'s 4,179,801; `geometry` blank returns 60,290,950 against a WKT box's 1,460,291; `decimalLatitude` blank returns 60,290,950 against `50,52`'s 23,162,542; `coordinateUncertaintyInMeters` blank returns 60,290,950 against `0,1000`'s 5,898,755; and `scientificName` blank returns the 255,619,737-record GB scope against `Parus major`'s 1,103,773. Whitespace alone behaves as blank in every one of those. On `/species/match`, `Parus major` with `kingdom` blank resolves to usage key 9705453 at confidence 99, the same as omitting it, where `Plantae` resolves to 9711704.

The shape check itself is unchanged for `datasetKey`. `isGbifUuid` stays case-insensitive and still refuses to trim, so moving the guard to presence is enough to cover the empty string, a whitespace-only value (`/occurrence/search?datasetKey=%20%20` also answers 200 with the unfiltered total), and the malformed values GBIF answers with `400 Invalid UUID string`. Letter case is deliberately *not* tightened: `/occurrence/search`, `/occurrence/count`, `/species/search`, and `/dataset/{key}` each resolve a key in either case, so the lowercase rule decision 15 added belongs to `/dataset/search`'s two organization parameters alone. The filters with no shape to check share one helper, `firstBlankFilter`, which names the offending field; each handler throws its own `invalid_filter` so the tool's own recovery hint rides along. The three occurrence tools share one check, `occurrenceFilterViolation`, instead of per-tool blank lists, so a filter added to the shared set is guarded on search, count, and facets at once.

The rule covers a blank value even where the upstream answer is not the unfiltered scope, because the alternative is a boundary no caller can plan around. `/dataset/search?q=` returns all 123,527 indexed datasets while `?q=%20%20` returns none; `/species/search` splits the same way, 46,623,754 against 0. One space between the whole index and an empty page is not a distinction to leave running, and neither side of it is the search that was asked for. `/organization` does not split — it drops `q` in either form and answers with all 3,561 organizations against 460 for `museum`.

`country` on `gbif_search_publishers` is the one field guarded more narrowly than the rest, and upstream behavior is why. It takes a handler guard rather than the `^[A-Z]{2}$` pattern decision 14 put on every other country field: `/organization` resolves the parsed country, so `gb`, `gbr`, and `GBR` each answer the same 223 organizations as `GB`, and constraining the shape would reject values that answer correctly. Of the values a pattern would have caught, only the empty string misbehaves — the route reads it as no filter and answers with the whole registry. Whitespace draws `400 Cannot parse    into a known Country`, an error naming the value, which the service already tags `invalid_filter` with this tool's own hint. So the guard covers exactly the value that fails quietly, and leaves the loud one where its message is best.

`kingdom`, `family`, and `genus` on `gbif_search_species` sat outside the rule while they were inert, because a blank value dropped no filter — `/species/search` implements none of the three, each answering identically to a parameter name invented for the probe. Guarding them then would have advertised a validation on fields that never filtered. Decision 17 makes them scope, and they take the rule with them: a blank one names no taxon, and rejecting it by field beats reporting that the empty string matched no backbone family.

Decision 13's empty-result notice is untouched, and it answers a different question: it fires when a *supplied, non-blank* `stateProvince` matched nothing, which is what separates a misspelling from a region that genuinely holds nothing. Its own `!stateProvince?.trim()` early return can no longer see a blank value now that all three callers reject one, and it stays — the branch is the function's precondition rather than dead weight, and removing it would change behavior on an input no caller can produce.

**17. `kingdom`, `family`, and `genus` on `gbif_search_species` keep their names and are resolved to a backbone key, which is forwarded as the `higherTaxonKey` the endpoint actually implements.** The three were declared filters that filtered nothing. `/species/search` carries no `kingdom`, `family`, or `genus` parameter — nor `kingdomKey`, `familyKey`, `genusKey`, `phylumKey`, `taxonKey`, or `parentKey`, all of which were probed and all of which are equally unrecognized — and it ignores a name it does not know rather than rejecting it, so each answered 200 with the whole index. Measured at `limit=0`: 46,623,754 names with `family=Paridae`, with `genus=Quercus`, with `kingdom=Plantae`, with no parameters at all, and with a `bogusParam=zzz` invented for the control, against 558,589 for the implemented `rank=FAMILY`. The same holds on a narrowed base — `q=Aves` returns 4,972 on its own and 4,972 with each of the three appended, and `rank=GENUS` returns 4,018,720 either way. GBIF's own OpenAPI description of the operation lists the parameters it takes, and the three are not among them; `higherTaxonKey` is, described as filtering "by any of the higher Linnean rank keys," and it works: `higherTaxonKey=6` returns 2,101,916, `higherTaxonKey=9327` returns 641.

Resolved rather than removed. Removing the three would delete declared input fields, and the call that reaches for them is exactly the call that has been getting a wrong answer: after a removal that caller's next attempt is a `-32602` schema rejection under the framework's generic `invalid_arguments` reason, which no declared `recovery` hint can reach (the tradeoff decision 15 weighed). Resolving them answers the question instead, and it needs no new capability — `gbif_match_species` already turns a name into a backbone key, and the same `matchSpecies` service call does it here. A raw `higherTaxonKey` input was considered and left out: it would put a second, key-shaped way to express the same scope beside three name-shaped ones, and the endpoint's key is reachable through the existing tools for any rank the three do not name.

The narrowest supplied field is what scopes, and only it is sent. `/species/search` OR-s repeated `higherTaxonKey` values rather than intersecting them — keys 1 (Animalia) and 6 (Plantae) together return 6,534,100, exactly their sum — so a kingdom sent beside a family would widen what the family narrowed. The three nest, so the narrowest is the intersection once the broader ones are confirmed to contain it. Two checks confirm it. The kingdom is not resolved separately when something narrower was supplied; it is passed to that lookup as GBIF's own `kingdom` disambiguator, which both resolves a name several kingdoms share ("Prunella" matches nothing alone, the accentor genus 2495070 under Animalia, the self-heal genus 2926553 under Plantae) and rejects a contradiction upstream ("Paridae" under Plantae matches nothing). A `family` hint is *not* honored the same way — `/species/match` ignores it, returning the oak genus for `Quercus` under `family=Asteraceae` — so the family/genus pair is checked locally, against the genus match's own `familyKey`.

The rank key is forwarded, not `usageKey`, and that is what resolves a synonym: `Compositae` matches `usageKey` 6070956 with `familyKey` 3065, and `higherTaxonKey=6070956` returns 0 names where `higherTaxonKey=3065` returns 201,100 — the same figure `Asteraceae` gives. The returned rank is verified against the field's own rank before that key is read, because `/species/match` treats `rank` as a scoring hint rather than a constraint: unstrict, `Aves` asked for as a FAMILY comes back as the CLASS Aves at confidence 83, and `Parus major` asked for as a GENUS comes back as a SPECIES. Matching is strict for the same reason fuzzy matching is right for `q` and wrong for a scope — `Fagacae` fuzzy-matches Fagaceae at confidence 85, and `Quercus` under kingdom Animalia fuzzy-matches the leafhopper genus *Quernus*, a scope silently moved onto a taxon the caller never named. Strict answers NONE for both, and the strictness costs nothing on case, since GBIF matches a lowercase `paridae` to nothing either way.

Two failures are declared rather than folded into `invalid_filter`, because their recoveries differ. `unresolved_taxon_scope` covers a name that reached no backbone taxon at that rank — a misspelling, a lowercase name, a name entered under the wrong rank, a cross-kingdom name with no kingdom beside it — and points at `gbif_match_species` to see what a name resolves to. `conflicting_taxon_scope` covers a family and genus that each resolved into different lineages, and names the family the genus actually belongs to. Both are handler guards, so both carry the tool's recovery hint.

One interaction is announced rather than guarded. GBIF reads a higher-taxon key inside the checklist that key belongs to, and the key resolved here is always a backbone key: `higherTaxonKey=9327` returns the same 641 names with and without the backbone `datasetKey`, and 0 against the 455-name "Checklist of alien birds of Belgium". So a taxon scope paired with another checklist's `datasetKey` matches nothing by construction. Nothing local can tell that apart from a checklist that genuinely holds no such taxa without a second lookup per call, so the empty-result notice names the rule and the two ways out.

The applied scope is reported in the enrichment on every scoped call — which field scoped, the backbone taxon its name resolved to, and that key — so a scope that resolved to something other than what the caller had in mind is visible in the response rather than inferred from the count. The taxon is named from the match's rank name rather than its `scientificName`, for the same reason the rank key is read rather than `usageKey`: on a synonym the two name different taxa, and `scientificName` is the name that matched. `Compositae` would otherwise report itself back beside key 3065, echoing the caller's input over the one resolution the field exists to surface.

**18. A `HIGHERRANK` match is disclosed, never rejected, and bulk matching takes `kingdom` per entry, never batch-wide.** GBIF labels two different things `HIGHERRANK`. A misspelled or unknown species falls back to its genus or kingdom at a confidence that can top 90 (a nonsense species under *Panthera* came back as the kingdom Animalia at 92), and a bare genus name such as `Bombus` is also `HIGHERRANK`, matched at its own genus. Rejecting the label would fail the second legitimate case to catch the first. Both therefore succeed with a `notice` (`note` on a bulk row) naming the taxon and rank, stating what `taxonKey` covers — that whole taxon, or its accepted taxon when the fallback taxon is a synonym — and pointing at `strict: true`, under which GBIF matches the name itself or answers no match. A `NONE` carries GBIF's own note, and a tie ("Multiple equal matches for Oenanthe", a bird genus and a plant genus) offers `kingdom` as the retry while it is unset. A `kingdom` applied to a whole bulk batch was rejected because it re-targets every name that exists in more than one kingdom: *Parus major* under Plantae resolves to *Pyrus major*, so a batch-wide filter helps one name by silently moving another. Each `names` entry takes the `{ name, kingdom }` form instead, whose kingdom applies to that name alone and resolves a cross-kingdom homonym such as *Oenanthe* (a bird genus and a plant genus, otherwise a tie that matches nothing) without moving the rest; a plain string still matches with no kingdom, and a blank entry kingdom fails the call as `invalid_filter`, by decision 16.

**19. Numeric inputs are integers at the schema, and `taxonKey` is non-negative.** `taxonKey` (six tools), `occurrenceKey`, `limit` and `offset` on the five paged tools, `facetLimit`, `facetOffset`, and `month` (three tools) were `z.number()`, and GBIF answers a fraction by replacing it quietly — a default page size, a zero-match scope — which hands the caller a confident answer to a question it did not ask. They are now JSON Schema `integer`, so a fraction fails as `-32602 invalid_arguments` before any request; an over-cap integer still clamps under `GBIF_CLAMP_READ_LIMITS`, while an over-cap fraction now fails. `taxonKey` allows 0 because key 0 is the backbone kingdom *incertae sedis*, a real taxon that `gbif_get_species`, `gbif_match_species`, and `gbif://species/0` resolve; a negative key names nothing. `gbif_get_occurrence` lost its `invalid_filter` because nothing reaches it: the schema rejects a non-positive or fractional key, and every positive safe-integer key answers 200 or 404. The species tools keep `invalid_filter` for a key past GBIF's 32-bit range.

**20. `gadmGid` is checked against the GID alphabet, not a grammar; there is no `GADM_GID` facet; `mediaType` is a closed enum.** GADM identifiers are irregular (`ESP.1_1`, but also `Z01`, `CHN.HKG`, `GHA7_2`), so a grammar check would reject real GIDs; the alphabet `[A-Z0-9._]` catches the forms GBIF matches against nothing (lowercase, padded, a place name) and a well-formed GID GBIF does not hold answers zero with a notice. The aggregate `GADM_GID` facet is not offered because it mixes levels, so a record counts once per level in one list; the four `GADM_LEVEL_n_GID` facets are the per-level cuts, and each bucket is a value `gadmGid` takes. `mediaType` is a four-value enum (`StillImage`, `MovingImage`, `Sound`, `InteractiveResource`) so a misspelling fails at the schema rather than answering zero. `institutionCode` matches case-insensitively and its facet buckets come back lowercased, so a bucket goes back in unchanged; `recordedBy` matches exactly and case-sensitively against each name in a record's list, so its spelling comes from a `RECORDED_BY` facet and a zero-match notice says why.

**21. The publishing organization's name is left to `gbif_search_datasets` rows; `gbif_get_dataset` and the dataset resource carry the key alone.** `/dataset/{key}` returns `publishingOrganizationKey` and no organization name. Resolving the name would add a second request to a call that costs one, on every call, for a field the caller can get from a search row (`publishingOrganizationTitle`) or an organization lookup. The key is what chains: it goes into `gbif_search_datasets` as `publishingOrg`.

**22. `includeLabels` on `gbif_occurrence_facets` names taxon-, dataset-, organization-, and GADM-area buckets: opt-in, page-only, bounded, best-effort.** A `SPECIES_KEY`, `DATASET_KEY`, `PUBLISHING_ORG`, or `GADM_LEVEL_n_GID` page is up to 100 bare keys, and naming them takes up to 100 follow-up calls (`/species/{key}`, `/dataset/{key}`, `/organization/{key}`, `/geocode/gadm/{gid}`). The 2026-08-06 entry declining a secondary lookup for the accepted taxon's name stands for the match tools, where a lookup would run on every call by default; the name `acceptedName` carries is read from the match response itself, at no request (decision 24). Here the caller opts in, lookups cover only the exposed page, and each is bounded: one attempt, 8 in flight server-wide, and one 10 s deadline per page (the facet request's own retries can take about 49 s of the 60 s an MCP SDK client waits). A failed or late lookup is disclosed in `notice`, not raised. The default stays one request, and a `DATASET_KEY` partition needs keys alone.

GADM buckets are the one code dimension it names, because a GID such as `ESP.1_1` is a bare code and telling which bucket is Andalucía otherwise took a `gbif_search_occurrences` call scoped to each GID plus a `gbif_get_occurrence` to read its `gadm` names. Each is labeled with the `name` from `/geocode/gadm/{gid}`, which answers every level (`ESP`, `ESP.1.5_1`, `ZAF.1.1.1_1`) and irregular GIDs (`Z01`, `CHN.HKG`), and answers a GID it does not hold with HTTP 200 and an empty body, not a 404. The empty body is that endpoint's not-found, so it leaves the bucket unlabeled and counted in `notice`; any other body that does not parse as JSON still fails the call, as it does on the taxon and dataset paths. A bucket becomes a path segment only in GID shape (the `gadmGid` alphabet, starting with a letter, so no segment resolves to `.` or `..`). The notice for an unlabeled GADM bucket points at `gadmGid` and the `gadm` field of `gbif_get_occurrence`. Taxon buckets take their lookup from `checklistKey`, never from the shape of the key; see decision 26.

**23. The published skill carries the cross-tool gates no single tool description owns; `instructions` keeps the identifier and filter contract.** Which region filter selects which records, records versus organisms, effort-driven trends, when to stop concluding a taxon is absent, and triaging a name list are judgments that span several tools, so no one description can hold them. They live in `skills/gbif-biodiversity-guide/SKILL.md`, delivered with the plugins and the `.mcpb` and served over MCP through `createApp({ skills: 'skills' })`. A client that connects directly may never load the skill, so the identifiers, filter semantics, and call order a client needs to avoid a wrong answer stay in `instructions` and the schemas.

**24. The Catalogue of Life eXtended Release is reached through an opt-in `checklistKey` on the match tools, and its keys travel only in new string fields.** GBIF no longer updates the Backbone, so a name described or revised since its last build falls back to a higher taxon there (or matches nothing), where the Catalogue of Life eXtended Release (`7ddf754f-d193-4cc9-b351-99906754a03b`), the taxonomy GBIF now maintains, can match it exactly. It stays opt-in because the Backbone is the API's default and every numeric key field this server returns, and every tool that takes a `taxonKey`, is Backbone-only; defaulting to the Catalogue of Life would change what every downstream key means. A Catalogue of Life key is a case-sensitive string, and a digit-only one such as `8288` names an unrelated Backbone taxon, so it goes in `checklistTaxonKey` and `checklistMatchedTaxonKey`, never in `taxonKey`, and `taxonKey`, `matchedTaxonKey`, and the rank keys are absent under it. The match goes to `/v2/species/match`, which renames `name` to `scientificName` and `rank` to `taxonRank` and nests the matched and accepted taxa under `usage` and `acceptedUsage`; its root is `GBIF_BASE_URL` with the trailing `/v1` replaced by `/v2`, and a base URL not ending in `/v1` fails with a `ConfigurationError` rather than guess a root, since no rule recovers a v2 root from an arbitrary one. `acceptedName` came with it on both checklists and costs no request: the Catalogue of Life answer carries `acceptedUsage.canonicalName`, and the Backbone answer's classification fields are the accepted taxon's, so the rank field whose key equals `acceptedUsageKey` names it (absent when the accepted taxon is infraspecific and no rank field holds its key). The same key reaches the occurrence tools as `checklistTaxonKey` beside the same `checklistKey`; see decision 26.

**25. `typeStatus` and `establishmentMeans` are canonicalized in the handler against a bundled vocabulary, not declared as `z.enum`, and not checked against a live fetch.** GBIF matches both exactly and case-sensitively, and answers any other string (`holotype`, a translated label) with 200 and zero records, so an unchecked value is a confident wrong answer. The handler matches the caller's value ignoring case and surrounding whitespace against the TypeStatus (51 concepts) and EstablishmentMeans (7) lists and sends and echoes the concept's own spelling; a value naming no concept fails as `invalid_filter` listing every concept. A `z.enum` was rejected because a schema rejection arrives as `-32602 invalid_arguments` with no recovery hint, and it would force the exact spelling the handler is built to forgive; a live vocabulary fetch was rejected because it adds a second upstream request to every filtered call for a list that changes rarely. The bundled list costs nothing per call, a concept GBIF adds later stays reachable through its broader parent (a concept matches every narrower one), and a concept missing from the list fails loudly. `license` is the opposite case and takes `z.enum`: three codes every record carries, a closed set GBIF answers anything else for with HTTP 400, so there is no spelling to forgive.

**26. The occurrence tools scope by a Catalogue of Life key through `checklistKey` plus a separate `checklistTaxonKey`, and `taxonKey` stays Backbone-only.** A name matched in the Catalogue of Life eXtended Release (decision 24) yields a key such as `3WSJV`, which a Backbone integer `taxonKey` cannot carry. `/occurrence/search` answers the same population for both taxonomies when given `checklistKey` with the key: `3WSJV` and `taxonKey` 2435261 (*Lynx pardinus*) each count 2,657 records, 2,268 of them `PRESENT`. The key goes in its own string input, `checklistTaxonKey`, which the handler sends as `taxonKey` beside `checklistKey` and never under its own name, because GBIF ignores an unknown parameter and `checklistTaxonKey=3WSJV` answers the whole 3,876,944,011-record index. A separate string field keeps decision 24's rule that a Catalogue of Life key never lands in a numeric Backbone slot, which would otherwise read as a Backbone key under one `checklistKey` and a Catalogue of Life key under the other.

The pairing is enforced before any request: `taxonKey` under the Catalogue of Life `checklistKey`, `checklistTaxonKey` without it, and a `checklistTaxonKey` outside uppercase letters and digits each fail as `invalid_filter`. GBIF cannot tell them from an empty result, since a Backbone key under the Catalogue of Life, a Catalogue of Life key under the Backbone, and an invented key each answer 200 with zero records, and a lowercase key (`3wsjv`) matches nothing because keys are case-sensitive. Facet buckets follow the same rule: under the Catalogue of Life `KINGDOM_KEY`…`SPECIES_KEY` buckets are its keys, some all digits (`8288` is the genus *Tringa*, while `/v1/species/8288` is the family Lagenismataceae), so `includeLabels` chooses its lookup from `checklistKey` and never from the shape of a key. Catalogue of Life buckets are labeled from `/v2/species/match?checklistKey=<Catalogue of Life>&usageKey=<key>`, and a `NONE` leaves the bucket unlabeled. Rows and records keep their Backbone `taxonKey` either way, so no existing output field changes meaning.

**27. Record license, rights holder, publisher, accepted taxon, and specimen fields are returned on `gbif_get_occurrence` and every search row; media on a search row is opt-in through `includeMedia`.** The record's reuse terms, attribution, and provenance were dropped while only media carried a license: `license` and `publishingOrgKey` are populated on every sampled record (300/300 on each scope), `rightsHolder` on 300/300 Swedish bird records but 40/300 *Quercus* specimens, and `recordNumber`, `elevation`, `depth`, `typeStatus`, and `establishmentMeans` on the specimen and marine records that use them. The search row needs `acceptedTaxonKey` and `acceptedScientificName` because a record filed under a synonym otherwise shows only the synonym (occurrence 6490801341 is under *Quercus tristis* 2879003, accepted *Quercus castanea* 2879127). All are optional and omitted, not placeholdered, when GBIF has none. Names follow the neighbors: `publishingOrganizationKey` is the name the dataset tools give the same key, `license` is the URL GBIF stores (the filter takes the code, and each description names the other form), and `acceptedScientificName` keeps authorship so it stays distinct from the canonical `acceptedName` on the match tools. `typeStatus` and `establishmentMeans` come back as the concept names the filters take (decision 25). Media on a search row is off by default (`includeMedia`): each item adds to both response surfaces, about 16 KB to `structuredContent` and 13 KB to `content[]` on a 20-row page carrying 78 items, so a caller who wants photos asks for them and pays the bytes; when on, every item of the record is returned whatever `mediaType` selected, since that filter picks records, not items. Media items gain `rightsHolder`, which CC BY attribution needs.

---

## Known Limitations

- **Pagination hard caps, with no complete-retrieval path here.** Occurrence search stops at offset+limit 100,001, species search at 100,000, and dataset search at 125,000 (decision 8). GBIF's search API supports no cursor or scroll, so records past those offsets are unreachable through this server; species and datasets are narrowed (species also walked with `gbif_get_species_children`, which has no ceiling), and occurrences partitioned. Covering a larger result set means partitioning it on `datasetKey` and paging each part, which is exhaustive but data-dependent in depth; retrieving it in one piece means GBIF's account-only download API or the AWS Open Data snapshot, both outside this server. See decision 3.
- **Occurrence search is not full-text.** The search endpoint filters on Darwin Core structured fields only. There is no free-text search across collector notes, locality descriptions, or identification remarks.
- **Backbone vs. checklist taxon keys.** GBIF has a single backbone taxonomy (`d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`) and many secondary checklists. Occurrence search takes `taxonKey` only as a backbone key (the `nubKey`), and scopes by a Catalogue of Life key only through `checklistTaxonKey` with the Catalogue of Life `checklistKey`; a key from any other checklist has no route. The match tools return backbone keys unless `checklistKey` selects the Catalogue of Life, whose string keys come back in separate fields and fit no tool that takes a numeric `taxonKey` (decisions 24 and 26).
- **Name matching confidence.** Below confidence ~80, matches should be treated with caution. The `confidence` field is surfaced in the output. The `/species/match` endpoint does not return an `alternatives` array — callers with low-confidence matches should retry with broader or different input (e.g., remove `strict`, try a higher-rank name). A `HIGHERRANK` match is disclosed, never rejected; see decision 18.
- **Occurrence record sparsity.** Many fields in Darwin Core are optional. Coordinates, collector name, collection code, and locality may be absent, especially in older or museum-digitized records. Output schemas reflect this — most fields are optional.
- **Rate limiting is load-based, not credential-tiered.** GBIF throttles search traffic according to its own server load and returns 429 when a caller exceeds it; no credential raises the ceiling. Requests carry an identifying `User-Agent` (overridable via `GBIF_USER_AGENT`) so GBIF can make contact about problem traffic.
- **WKT geometry coordinate order.** GBIF expects `longitude latitude` order in WKT (matching GeoJSON convention, not GML). This is noted in the `geometry` parameter description.

---

## API Reference

### Base URL

`https://api.gbif.org/v1`; checklist-scoped name matching uses `https://api.gbif.org/v2/species/match`.

### Key endpoints

| Resource | Endpoint | Notes |
|:---------|:---------|:------|
| Species match | `GET /species/match` | `name`, `strict`, `kingdom`, `rank`; a blank `kingdom` is dropped and the name matches against the whole backbone |
| Species match, checklist | `GET /v2/species/match` | `checklistKey`, `scientificName`, `strict`, `kingdom`, `taxonRank`; the Catalogue of Life eXtended Release is `7ddf754f-d193-4cc9-b351-99906754a03b`. The answer nests `usage`, `acceptedUsage`, `classification`, and `diagnostics`, with string keys; the root is the v1 base URL with `/v1` replaced by `/v2`. With `usageKey` in place of the name, the same route names a facet bucket (`usage.canonicalName`), and a key the checklist does not hold answers 200 with `matchType` `NONE` and no `usage` |
| GADM area | `GET /geocode/gadm/{gid}` | `name`, `gadmLevel`, `higherRegions` for a GID at any level; a GID it does not hold answers HTTP 200 with an empty body, not a 404 |
| Species get | `GET /species/{key}` | backbone taxon key |
| Species search | `GET /species/search` | `q`, `rank`, `higherTaxonKey`, `datasetKey`, `limit`, `offset`; a blank `q` returns the whole index while a whitespace-only one returns nothing. `higherTaxonKey` is the only higher-taxon scope — it takes a key, is read within one checklist, and OR-s repeated values. `kingdom`, `family`, `genus`, and the `*Key` variants of them are **not implemented** — each answers identically to an invented parameter name, at every value. `offset + limit` is served up to 100,000; past it, HTTP 500, and an offset of 100,000 or more draws 400 `Max offset of 100000 exceeded.` |
| Species children | `GET /species/{key}/children` | paginated |
| Species parents | `GET /species/{key}/parents` | returns array root→leaf |
| Occurrence search | `GET /occurrence/search` | Darwin Core filters + facets; a filter given with no value is ignored and the response is the unfiltered scope. `checklistKey` makes `taxonKey` a key of that checklist, and a key from the other taxonomy answers 200 with zero records or an unrelated taxon |
| Occurrence count | `GET /occurrence/search` at `limit=0` | full Darwin Core filter set; `/occurrence/count` is used only for the dataset record-count lookup, since its closed parameter set rejects `occurrenceStatus` and `iucnRedListCategory` |
| Occurrence get | `GET /occurrence/{key}` | full DwC record |
| Dataset search | `GET /dataset/search` | rows carry `publishingOrganizationKey` and `publishingOrganizationTitle`; q, type, publishingCountry — matches the verbatim stored code, so only the uppercase alpha-2 form resolves; publishingOrg and hostingOrg are two distinct organization filters, intersected when both are sent; a blank `q` returns the whole index while a whitespace-only one returns nothing; `offset + limit` is served up to 125,000, and a larger sum answers HTTP 500 at any offset |
| Dataset get | `GET /dataset/{uuid}` | carries `publishingOrganizationKey` but no organization title |
| Publisher search | `GET /organization` | q, country — resolves the parsed country, so alpha-2 and alpha-3 forms both match, case-insensitively; a blank country or a blank `q` in either form returns the whole registry, while a whitespace-only country draws a 400 |

### Pagination pattern

List endpoints return `{ offset, limit, endOfRecords, count, results[] }`, except `/species/{key}/children`, which carries no `count`. Page with `offset` + `limit`. Occurrence search: capped at `offset + limit ≤ 100,001`; species search at `≤ 100,000`; dataset search at `≤ 125,000`. Each is checked locally on the applied limit (decision 8).

### Facet query pattern

Add `facet=FIELD_NAME` to occurrence search, set `limit=0` to skip record fetching. The tool exposes `facetLimit=N` (default 10, max 100) and sends `N+1` upstream for exact continuation, returning at most N values. `facetOffset` advances by the exposed page size. Buckets are bare values; naming a taxon, dataset, organization, or GADM area costs one `/species/{key}` (`/v2/species/match` under the Catalogue of Life), `/dataset/{key}`, `/organization/{key}`, or `/geocode/gadm/{gid}` read per bucket (`includeLabels`). The upstream API also accepts `facetMincount` and multiple `facet` parameters.

### Name matching confidence

| Confidence | Interpretation |
|:-----------|:---------------|
| 90–100 | High confidence for `EXACT`/`FUZZY`; a `HIGHERRANK` fallback can also score here, so read `matchType` first |
| 80–89 | Good match — minor differences (author, formatting) |
| 60–79 | Fuzzy match — verify before use |
| <60 | Low confidence — likely a different species |

### Auth

None. GBIF issues no API key, and the read endpoints this server calls take no credentials. GBIF's HTTP Basic auth — a GBIF.org username and password, with no API-key alternative — applies only to occurrence downloads and registry writes, neither of which is in this surface. Search traffic is throttled by GBIF's server load and returns 429 when it exceeds the current ceiling.

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
| 2026-05-23 | No occurrence download tool | The Download API authenticates with a GBIF.org username and password (no API-key mode), so a keyless multi-tenant server would have to share one account's credentials, quota, and notification inbox; the job/poll/ZIP shape has no synchronous MCP equivalent, and the archive can hold tens of millions of rows no agent context can read |
| 2026-08-06 | No complete-retrieval path past the pagination cap — ship accurate guidance instead | `/occurrence/search` exposes no cursor or scroll and ignores unrecognized parameters with a 200, so nothing continues past offset+limit 100,001. Caller-side partitioning on `datasetKey` is the only route through this surface and needs unbounded, data-dependent recursion, so it belongs in the guidance rather than in a tool |
| 2026-08-06 | `DATASET_KEY` named as the partition dimension, in the `facet` description | Every occurrence carries exactly one `datasetKey`, so its buckets sum to the scope's total, and it is the only gap-free dimension with the cardinality to reach pageable pieces (`basisOfRecord` and `publishingCountry` are gap-free but far too coarse for a first cut — 9 and 41 buckets against 550 on the measured scope). `YEAR`, `MONTH`, `STATE_PROVINCE`, and `SPECIES_KEY` silently drop records missing the field (883,550 of 60,290,950 in the measured case). A caller cannot infer the difference from the facet list, and a doc-only note never reaches a model reading `tools/list` |
| 2026-08-06 | `publishingCountry` and `stateProvince` added as filters on all three occurrence tools | `PUBLISHING_COUNTRY` and `STATE_PROVINCE` were offered as facet dimensions with no matching filter anywhere, so those buckets were a dead end — and the partition guidance steers callers toward faceting in the first place. Adding them to only one of the three tools would recreate the search/count/facets disagreement the presence/absence default was fixed to remove, so all three take both. `publishingCountry` also makes `PUBLISHING_COUNTRY` a usable second split axis, which decision 3 previously had to rule out |
| 2026-08-06 | `publishingCountry` constrained by a `^[A-Z]{2}$` pattern; `stateProvince` left unconstrained but announced on an empty result | GBIF answers an unparseable country code with a 400 but a lowercase or alpha-3 form (`us`, `USA`) with 200 and zero records — a silent wrong answer. The vocabulary is closed, so a JSON Schema `pattern` turns every silent case into a local validation error a model can read from `tools/list`. `stateProvince` has no vocabulary to constrain against (`England`, `England - Greater London`, and `Greater London` are three distinct verbatim values), so the guard has to be a runtime notice instead: an empty result under a `stateProvince` filter says the match is verbatim and case-sensitive and points at the `STATE_PROVINCE` facet, which is what separates a misspelling from a genuinely empty region. The pre-existing `country` filter has the same silent-zero behavior and is deliberately left alone here — tightening an already-published parameter is its own change, tracked separately |
| 2026-08-06 | `^[A-Z]{2}$` extended to `country` on the three occurrence tools and to `publishingCountry` on `gbif_search_datasets`; `gbif_search_publishers` left unpatterned | The routes disagree. `/occurrence/search` parses the code then matches the verbatim string, so `gb`, `Us`, `USA`, and `gb ` all answer 200 with zero records where `GB` answers 60,290,950; `/dataset/search` does the same one layer up, where `gb`, `GBR`, and `USA` answer 0 against `GB`'s 2,416 — the last silent-zero filters left in the server, and worth the contract change that constraining a published parameter costs. `/organization` resolves the parsed country instead: `gb`, `gbr`, and `GBR` each return the same 223 organizations as `GB`, so the same pattern there would reject values that answer correctly. A shape check rather than the closed 253-code vocabulary (`/enumeration/basic/Country`) — enumerating it costs ~1KB of `tools/list` tokens per field, goes stale when GBIF adds a code, and the values it would additionally catch (`XX`, `QQ`) are the ones GBIF already rejects by name with a 400 the service tags `invalid_filter`, which reads better than a bare schema rejection. Rejecting rather than upper-casing follows `datasetKey`: no case fix rescues `USA` or `Britain`, and normalizing hides a caller-side defect. The empty string now fails too, instead of being dropped into an unfiltered query |
| 2026-08-06 | `publishingOrg` added to `gbif_search_datasets` alongside `hostingOrg`, and every chaining surface repointed at it | `hostingOrg` matches the organization running the installation a dataset is served from, which for most organizations is somebody else's, so the documented publishers → datasets chain returned zero: of the first 25 GB organizations the registry lists, all 25 host nothing while 13 publish one or two reachable only through `publishingOrg`. Both filters stay — "what does this installation serve" is a real question, and 984 datasets answer it for the National Biodiversity Network — so the pair gets the `country` / `publishingCountry` treatment: each description names the other as the different question and carries a measured figure. GBIF intersects the two when both are sent (984 ∩ 1 = 0), which is a trap for anyone reaching for "everything about this organization," so both descriptions and the empty-result notice say so. Both are validated in the handler against the lowercase 8-4-4-4-12 form whenever present, which covers the two silent classes on top of the malformed one GBIF answers with a 400: `/dataset/search?publishingOrg=` returns all 123,527 indexed datasets, and these two parameters alone are matched case-sensitively, so an upper-cased key returns 0 (984 → 0 on `hostingOrg`) where the lowercase one matches. `datasetKey` resolves either case upstream, so the shared `isGbifUuid` check is unchanged. A handler guard over a Zod `pattern` because a schema rejection arrives as `-32602` with empty `structuredContent`, out of reach of the contract's recovery hint; the descriptions carry the lowercase form instead |
| 2026-08-06 | Every optional filter guards on presence instead of on a non-blank value, so a blank or whitespace-only one fails as `invalid_filter` | Guard and forward both tested `?.trim()`, so a blank value cleared both and the tool answered the whole unfiltered scope while the caller believed it was scoped. On a `taxonKey=212` + `country=GB` + `occurrenceStatus=PRESENT` scope of 60,290,950 records, blank `stateProvince`, `year`, `geometry`, `decimalLatitude`, and `coordinateUncertaintyInMeters` each return all 60,290,950 against 47,672,439 for `England`, 4,179,801 for `2020`, 1,460,291 for a WKT box, 23,162,542 for `50,52`, and 5,898,755 for `0,1000`; `gbif_count_occurrences` on `taxonKey=212` returns the same 2,351,689,943 with `datasetKey: ""` as without it (a real key returns 1,775,781,186); `gbif_search_publishers` with `country: ""` returns all 3,561 organizations against 223 for `GB`; and `/species/match` drops a blank `kingdom`, resolving `Parus major` to 9705453 where `Plantae` resolves to 9711704. Whitespace behaves as blank throughout. The rule holds where the upstream answer is not the unfiltered scope either — `/dataset/search?q=` returns all 123,527 datasets while `?q=%20%20` returns none, and one space between the whole index and an empty page is not a boundary a caller can plan around. Each guard names the offending field via a shared `firstBlankFilter` helper and each handler throws its own `invalid_filter` so the tool's recovery hint rides along; `isGbifUuid` is unchanged and still untrimmed, so it covers blank, whitespace-only, and malformed keys at once, and letter case stays unchecked because those routes resolve a key either way. One carve-out, upstream behavior: `country` on `gbif_search_publishers` guards the empty string alone, since whitespace already draws a 400 naming the value. `kingdom`, `family`, and `genus` on `gbif_search_species` were a second one while they were inert, and joined the rule when decision 17 made them scope |
| 2026-08-06 | `kingdom`, `family`, and `genus` on `gbif_search_species` resolved to a backbone key and forwarded as `higherTaxonKey`, rather than removed | `/species/search` implements none of the three, and ignores an unrecognized name instead of rejecting it: `family=Paridae`, `genus=Quercus`, `kingdom=Plantae`, no parameters at all, and an invented `bogusParam=zzz` each return the same 46,623,754 names, against 558,589 for the implemented `rank=FAMILY`; on a `q=Aves` base all three leave 4,972 unchanged. GBIF's OpenAPI description of the operation omits them and lists `higherTaxonKey`, which does scope — `higherTaxonKey=9327` returns 641. Removing the three would turn the call that was already getting a wrong answer into a `-32602` schema rejection with empty `structuredContent`, out of reach of any recovery hint; resolving them answers it, reusing the `matchSpecies` call `gbif_match_species` already makes. Only the narrowest is sent, because repeated `higherTaxonKey` values are OR-ed (keys 1 and 6 together return 6,534,100, their exact sum) so a broader one beside a narrower would widen the search. The kingdom rides along as GBIF's own disambiguator instead ("Prunella" resolves to nothing alone, 2495070 under Animalia, 2926553 under Plantae) and rejects a contradiction upstream; the family/genus pair is checked locally against the genus match's `familyKey`, since `/species/match` ignores a `family` hint. The rank key is forwarded rather than `usageKey` — that is what resolves a synonym, `Compositae` carrying `familyKey` 3065 where `higherTaxonKey=6070956` returns 0 and 3065 returns 201,100 — and the returned rank is verified, because `rank` is a scoring hint upstream (`Aves` asked for as a FAMILY answers as a CLASS). Matched strictly: fuzzy shifts a scope onto a taxon nobody named (`Quercus` under Animalia matches the leafhopper genus *Quernus*). `unresolved_taxon_scope` and `conflicting_taxon_scope` are declared separately from `invalid_filter` because their recoveries differ, and a backbone key paired with another checklist's `datasetKey` matches nothing by construction, which the empty-result notice states |
| 2026-08-06 | Every partition surface states that the facet call must repeat the query's filters | Search, count, and facets accept the same biological filters, but a facet call that drops one (`month`, say, or `hasCoordinate`, which count also takes as `isGeoreferenced`) returns buckets that partition a wider scope than the caller asked about. Left unsaid, "the buckets sum to this total" is wrong exactly when the caller most needs to trust the arithmetic |
| 2026-05-23 | Normalized occurrence output (drop nested `classifications` object) | GBIF includes both CoL and legacy backbone entries per occurrence, creating deep nesting. Top-level Darwin Core fields cover the agent use cases, including the license, publisher, accepted-taxon, and specimen fields decision 27 adds; GADM levels, identifiers, and media titles and formats are on `gbif_get_occurrence` |
| 2026-05-23 | No `gbif_get_species_synonyms` tool in v1 | Niche use case; synonym status already surfaced in `gbif_get_species` — enumerate-all-synonyms workflow can be added later if needed |
| 2026-05-23 | Two data resources only (species + dataset) | These are the only stable reference objects with real utility as injectable context; occurrence records are too numerous and publishers too rarely needed |
| 2026-05-23 | Pagination cap surfaced as an over-cap `notice` and a `pagination_cap_exceeded` error | GBIF silently returns no more data past the cap; the notice on an over-cap total and the error on an over-cap request prevent silent truncation in agent workflows |
| 2026-05-23 | Both WKT geometry and lat/lon ranges exposed as occurrence search params | WKT supports complex polygons (watersheds, protected area boundaries); lat/lon ranges are simpler for rectangular queries — both have clear agent use cases |
| 2026-08-06 | `gbif_match_species` / `gbif_bulk_match_species` return the **accepted** key as `taxonKey`, with the matched synonym key as `matchedTaxonKey` | The tool exists to hand the occurrence tools a key they can filter on; a synonym key returns only the records filed under that name (106 vs 18,961 for *Felis leo*) with nothing marking the gap. Surfacing the accepted key as a second field would have left the documented chain — "pass `taxonKey` to the occurrence tools" — still wrong by default |
| 2026-08-06 | No secondary lookup to resolve the accepted taxon's *name*; `acceptedName` is read from the match response itself | `/species/match` reports the accepted taxon as a bare `acceptedUsageKey`, so a lookup costs one extra request per match — 50 for a full bulk batch. The response's classification fields are the accepted taxon's, so the rank field whose key equals `acceptedUsageKey` names it at no request, and the Catalogue of Life answer carries `acceptedUsage.canonicalName`. It is absent when the accepted taxon is infraspecific and no rank field holds its key, where `gbif_get_species` with `taxonKey` names it |
| 2026-08-06 | `invalid_filter` on the match tools reaches only a locally rejected blank `kingdom`, on `gbif_match_species` and on any `gbif_bulk_match_species` entry | `/species/match` answers HTTP 200 for every schema-valid input, so no upstream 400 maps to the reason. Both tools declare it for the one input the handler rejects itself, a blank `kingdom`; the bulk tool checks every entry's before the first request and still reports a per-name lookup failure as an `ERROR` row |
| 2026-10-31 | `HIGHERRANK` matches are disclosed in a `notice` (`note` on bulk rows), never rejected; `kingdom` on `gbif_bulk_match_species` is per entry (`{ name, kingdom }`), never batch-wide | GBIF applies the label both to a misspelled species falling back to its genus or kingdom (a nonsense *Panthera* species came back as Animalia at confidence 92) and to a bare genus name matched at its own genus, so rejecting it would fail legitimate matches. The notice names the taxon and rank GBIF matched, what `taxonKey` covers (its accepted taxon when that taxon is a synonym), and the `strict: true` lever. A batch-wide `kingdom` re-targets names that exist in several kingdoms (*Parus major* under Plantae resolves to *Pyrus major*), so a kingdom applies to the one entry that carries it, which resolves a homonym such as *Oenanthe* without moving the rest |
| 2026-10-31 | Numeric inputs are integers at the schema; `taxonKey` is non-negative; `gbif_get_occurrence` drops `invalid_filter` | GBIF replaces a fractional value quietly (a default page size, a zero-match scope), which answers a question the caller did not ask. A fraction now fails as `-32602 invalid_arguments`; over-cap integers still clamp. Key 0 is a real taxon (*incertae sedis*), so `taxonKey` allows it. Every positive safe-integer occurrence key answers 200 or 404, leaving `invalid_filter` unreachable there |
| 2026-10-31 | `gadmGid` checks the GID alphabet rather than a grammar; no aggregate `GADM_GID` facet; `mediaType` is a closed four-value enum | Real GIDs are irregular (`Z01`, `CHN.HKG`, `GHA7_2`), so the check is `[A-Z0-9._]`. `GADM_GID` ranks every level in one list, so a level-0 bucket and its own level-1 buckets double-count; the four per-level facets are offered instead. An enum turns a misspelled media type into a schema error rather than a zero |
| 2026-10-31 | The publishing organization's name stays on `gbif_search_datasets` rows; `gbif_get_dataset` and `gbif://dataset/{datasetKey}` carry the key only | `/dataset/{key}` carries no organization name, and resolving it would add a second request to a one-request call on every invocation. The key chains into `gbif_search_datasets` as `publishingOrg` |
| 2026-10-31 | `includeLabels` on `gbif_occurrence_facets` names taxon- and dataset-key buckets: opt-in, page-only, bounded, best-effort | A `SPECIES_KEY` or `DATASET_KEY` page is up to 100 bare keys and 100 follow-up calls. The 2026-08-06 "no secondary lookup" entry stands for the match tools, where the lookup would run on every call by default; here the caller opts in, lookups cover only the exposed page, and each is bounded (one attempt, 8 in flight server-wide, one 10 s deadline per page, since the facet request's own retries can take about 49 s of a client's 60 s). A failed or late lookup is disclosed in `notice`, not raised; the default stays one request |
| 2026-10-31 | A published skill, `gbif-biodiversity-guide`, carries the cross-tool gates; `instructions` keeps the identifier and filter contract | Region-filter populations, records versus organisms, effort-driven trends, the absence stop rule, and name-list reconciliation span several tools, so no single description can own them. A client connecting directly may never load the skill, so what it needs to avoid a wrong answer stays in `instructions` and the schemas |
| 2026-11-12 | `gbif_search_species` and `gbif_search_datasets` check `offset + limit` against 100,000 and 125,000 before the request and fail as `pagination_cap_exceeded`; a notice rides every page whose `totalCount` exceeds the ceiling | Past each ceiling GBIF answers an error no retry changes (500, or 400 `Max offset of 100000 exceeded.` on species), the same shape that decision 8 closed for occurrences. The check runs on the applied (clamped) limit so a page that fits is still sent. The notice goes on the first page, where the choice between paging and narrowing is made, and names the routes: `type` partitions datasets with no gap or overlap (four values, one per dataset), species narrow by name scope or walk `gbif_get_species_children`, which has no ceiling. `endOfRecords` stays GBIF's value, since the records exist |
| 2026-11-12 | The Catalogue of Life eXtended Release is matched through an opt-in `checklistKey` on the match tools, with string keys in `checklistTaxonKey` and `checklistMatchedTaxonKey` | The Backbone is the API default and no longer updated, so a recently described or revised name falls back to a higher taxon there; the Catalogue of Life can match it exactly. Opt-in because every numeric key field and every tool taking a `taxonKey` is Backbone-only, and a Catalogue of Life key is a case-sensitive string (a digit-only one names an unrelated Backbone taxon), so it travels only in new fields and never reaches a numeric slot. The `/v2` route is derived from `GBIF_BASE_URL` by replacing its trailing `/v1`, and a base URL without it fails with a `ConfigurationError` rather than guess. The occurrence tools take such a key as `checklistTaxonKey` with the same `checklistKey` (2026-11-12 entry below) |
| 2026-11-12 | `typeStatus` and `establishmentMeans` are canonicalized in the handler against a bundled vocabulary; `license` is a `z.enum` | GBIF matches the two exactly and case-sensitively and answers any other string with 200 and zero records. A `z.enum` would reject with `-32602` and no recovery hint and demand the exact spelling; a live vocabulary fetch would add a second upstream request to every filtered call. The handler forgives case and whitespace, sends the concept's own spelling, and fails an unknown value as `invalid_filter` listing the concepts. `license` has three codes every record carries and nothing to forgive, so an enum fits |
| 2026-11-12 | A comma-less `decimalLatitude`, `decimalLongitude`, or `coordinateUncertaintyInMeters` is forwarded unchanged and draws a notice on every result; a bare `*` fails as `invalid_filter` | GBIF reads those fields as a range only when the value holds a comma, and anything else as one exact value (`"38"` matches 0 records where `"38,39"` matches 504 on one scope), which reads as "near" or "within" and is neither. An exact match is a filter a caller can mean, so it is announced rather than refused. A bare `*` draws an empty-bodied HTTP 404 upstream, which would reach the caller as a not-found with no reason, so it is refused locally; `*` stays valid as one open end of an uncertainty range (`"*,1000"`) |
| 2026-11-12 | The occurrence tools scope by a Catalogue of Life key through `checklistKey` and a separate string `checklistTaxonKey`; `taxonKey` stays Backbone-only | `/occurrence/search` counts the same population for `3WSJV` under the Catalogue of Life and Backbone `taxonKey` 2435261 (2,657 records each). `checklistTaxonKey` is sent as `taxonKey` beside `checklistKey`, never under its own name, which GBIF ignores and answers with the whole 3,876,944,011-record index. `taxonKey` under the Catalogue of Life, `checklistTaxonKey` without it, and a key outside uppercase letters and digits fail as `invalid_filter` before any request, since a mismatched or invented key answers 200 with zero records. Facet buckets under the Catalogue of Life are its keys (`8288` is the genus *Tringa*, but `/v1/species/8288` is a family), so `includeLabels` picks its lookup from `checklistKey`, never from key shape |
| 2026-11-12 | `gbif_get_occurrence` and every search row return `license`, `rightsHolder`, `publishingOrganizationKey`, `acceptedTaxonKey`, `acceptedScientificName`, `recordNumber`, `elevation`, `depth`, `typeStatus`, and `establishmentMeans`; search rows carry media only with `includeMedia` | Only media carried a license, and a synonym record showed only the synonym. Each field is optional and omitted when GBIF has none; `license` stays the Creative Commons URL GBIF stores while the filter takes the code, `publishingOrganizationKey` matches the dataset tools' name for the key, and `acceptedScientificName` keeps authorship against the match tools' canonical `acceptedName`. Media is opt-in because each item adds to both response surfaces (about 16 KB to `structuredContent` and 13 KB to `content[]` on a 20-row page of 78 items) and `mediaType` picks records, so a row returns every item of its record when on |
| 2026-11-12 | The `occurrenceStatus` filter on the three occurrence tools also takes `DETECTED` and `NOT_DETECTED`, and the default stays `PRESENT` | GBIF serves `DETECTED` and `NOT_DETECTED` on records, rows, and `OCCURRENCE_STATUS` buckets, and accepts them as filter terms selecting the same records as `PRESENT` and `ABSENT`. A value read off a record or bucket passes back unchanged, sent and echoed as given, instead of needing a translation the caller would have to know |
| 2026-11-12 | `includeLabels` extends to `PUBLISHING_ORG` (organization title) and `GADM_LEVEL_0_GID` through `GADM_LEVEL_3_GID` (area name), and taxon buckets are looked up in the taxonomy `checklistKey` selects | Same bounds as the 2026-10-31 entry. A GADM bucket is labeled with the `name` from `/geocode/gadm/{gid}`, whose empty 200 body for a GID it does not hold leaves the bucket unlabeled rather than failing the call. A taxon bucket under the Catalogue of Life is read from `/v2/species/match` by `usageKey`, chosen by `checklistKey` and never by key shape, since a digit-only Catalogue of Life key names an unrelated Backbone taxon |
