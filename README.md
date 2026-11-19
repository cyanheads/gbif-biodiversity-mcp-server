<div align="center">
  <h1>@cyanheads/gbif-biodiversity-mcp-server</h1>
  <p><b>Search GBIF species taxonomy, occurrence records, datasets, and publishers via MCP. STDIO or Streamable HTTP.</b>
  <div>13 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.8.1-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/gbif-biodiversity-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^2.4.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/gbif-biodiversity-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/gbif-biodiversity-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^7.0.2-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.4.4-blueviolet.svg?style=flat-square)](https://bun.sh/)

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

Species taxonomy, occurrence records, datasets, and publishers from the Global Biodiversity Information Facility (GBIF). Match names to the backbone taxonomy, search and aggregate 3.9B+ occurrence records with Darwin Core filters, and trace records back to their datasets and publishers.

### Tools

| Tool | Description |
|:---|:---|
| `gbif_match_species` | Match a scientific name to the GBIF backbone or the Catalogue of Life, returning its taxon key, confidence, and classification |
| `gbif_bulk_match_species` | Match up to 50 scientific names, each optionally narrowed to a kingdom, in one call, one result per name in input order |
| `gbif_get_species` | Fetch a taxon usage by key, from the backbone or any checklist: classification, authorship, synonymy, vernacular name, descendant count |
| `gbif_search_species` | Search or browse the backbone by name fragment, rank, taxonomic status, or a kingdom, family, or genus name |
| `gbif_get_species_classification` | Return a taxon's parent chain, root-first from kingdom to its immediate parent |
| `gbif_get_species_children` | List a taxon's direct children, such as the genera in a family or the species in a genus |
| `gbif_search_occurrences` | Search 3.9B+ occurrence records by taxon, place, date, basis of record, publishing organization, type status, establishment means, license, presence/absence, and IUCN category |
| `gbif_count_occurrences` | Count occurrences matching a filter without fetching records |
| `gbif_get_occurrence` | Fetch one Darwin Core occurrence record by key |
| `gbif_occurrence_facets` | Aggregate occurrence counts by country, year, dataset, taxon, status, and other dimensions, optionally naming taxon, dataset, publishing organization, and GADM area buckets |
| `gbif_search_datasets` | Search datasets by keyword, type, publishing country, or publishing or hosting organization |
| `gbif_get_dataset` | Fetch full dataset metadata by UUID: citation, contacts, license, DOI, publishing organization key, coverage with bounding boxes, deletion timestamp |
| `gbif_search_publishers` | Search GBIF-registered publishing organizations by name or country |

### Resources

| Resource | Description |
|:---|:---|
| `gbif://species/{taxonKey}` | Taxon usage record from the GBIF backbone or any checklist: classification, authorship, synonymy status, vernacular name |
| `gbif://dataset/{datasetKey}` | Dataset metadata: title, description, citation, license, contacts, coverage with bounding boxes, deletion timestamp, publishing organization key |

Both resources are also reachable via `gbif_get_species` and `gbif_get_dataset`; many MCP clients are tool-only and never surface resources.

### Skills

| Skill | Description |
|:---|:---|
| `gbif-biodiversity-guide` | Agent guide: where each key comes from, which region filter selects which records, and the checks before quoting a count, a trend, or an absence. Installed with the Claude Code and Codex plugins and the `.mcpb`, and served over MCP at `skill://gbif-biodiversity-guide/SKILL.md` |

## Capability reference

### `gbif_match_species` <sub>tool</sub>

- One scientific `name` (common names go to `gbif_search_species`), with optional `strict`, a `kingdom` to disambiguate, an expected `rank`, and a `checklistKey`
- Returns `taxonKey`, the accepted taxon to pass to the occurrence tools, plus `matchedTaxonKey` when a synonym was resolved and `acceptedName` (its canonical name, without authorship) whenever GBIF's answer names the accepted taxon, `matchType` (`EXACT`, `FUZZY`, or `HIGHERRANK`: a match at a higher rank, such as a misspelled species falling back to its genus or kingdom, where `taxonKey` covers that whole taxon, or its accepted taxon when the taxon GBIF fell back to is a synonym, and a `notice` names it), `confidence` 0–100 (review below 80; a `HIGHERRANK` match can score above 90), and the classification with a key at each rank
- `matchType` `NONE` fails as `no_match`, carrying GBIF's note when it gives one (for several equal matches, set `kingdom`); a blank `kingdom` fails as `invalid_filter`
- `checklistKey` is opt-in. Omitted, or `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`, matches the GBIF Backbone, whose integer keys the occurrence and species tools take; GBIF no longer updates it. `7ddf754f-d193-4cc9-b351-99906754a03b` matches the Catalogue of Life eXtended Release, the taxonomy GBIF now maintains, where a recently described or revised name can match exactly. Its keys come back as case-sensitive strings in `checklistTaxonKey` (and `checklistMatchedTaxonKey` for a synonym) with no `taxonKey`, `matchedTaxonKey`, or rank keys. The occurrence tools take one as `checklistTaxonKey` with the same `checklistKey`; the species tools, which take a numeric backbone `taxonKey`, do not. `status` may then be `PROVISIONALLY_ACCEPTED` and `matchType` `VARIANT`. The route is `GBIF_BASE_URL` with its trailing `/v1` replaced by `/v2`, so a base URL not ending in `/v1` fails the call as a configuration error

---

### `gbif_bulk_match_species` <sub>tool</sub>

- Scientific `names` with `strict` and `checklistKey` (as on `gbif_match_species`, applied to the whole batch); the first 50 are processed in input order. Each entry is a name string or `{ name, kingdom }`, where the entry's `kingdom` applies to that name alone and resolves a name shared across kingdoms such as *Oenanthe* (a bird genus and a plant genus). A blank `kingdom` on any entry, the unprocessed tail included, fails the call as `invalid_filter`. With read-limit clamping enabled (default), extra entries are returned in `unprocessedNames` exactly as submitted, preserving order and duplicates for the next call
- Each result carries `name` and `matchType`, and on a match `taxonKey`, `matchedTaxonKey` and `acceptedName` (synonyms), and `confidence`; a `HIGHERRANK` row carries a `note` naming the higher taxon GBIF matched and what its `taxonKey` covers: that taxon, or its accepted taxon when it is a synonym. An unmatched name is `NONE`, with GBIF's explanation in `note` when it gives one (such as several equal matches for a name shared across kingdoms, with a pointer to resubmit the entry with `kingdom` while it has none); a failed lookup is `ERROR` with `error` and, when classified, `reason`, and neither fails the batch

---

### `gbif_get_species` <sub>tool</sub>

- One `taxonKey`, a non-negative integer (`0` is the backbone kingdom *incertae sedis*): a backbone key, or the taxon usage key of any checklist, such as a `gbif_search_species` row's `key`. A key no checklist has fails as `not_found`, one past the 32-bit range as `invalid_filter`, and a fraction or negative key fails at the schema
- Returns the classification with rank keys, `datasetKey` (the source checklist), `nubKey` (the mapped backbone key, the one the occurrence tools take as `taxonKey`; absent where the backbone has no mapping), `authorship`, `vernacularName`, `numDescendants`, `publishedIn`, and `parentKey`; `key`, the rank keys, `parentKey`, and `acceptedKey` are taxon usage keys of that checklist, equal to `nubKey` only on a backbone usage. A `taxonomicStatus` of `SYNONYM` comes with `acceptedKey` and `accepted`. GBIF's taxon record carries no occurrence count: use `gbif_count_occurrences` with `nubKey`

---

### `gbif_search_species` <sub>tool</sub>

- `q` name fragment (scientific and vernacular), `rank`, `status`, `isExtinct`, and a checklist `datasetKey` (omit for the backbone); up to 1,000 per page with integer `limit` and `offset`, where `offset + limit` may not exceed 100,000
- Taxa carry the checklist usage `key`, optional source `datasetKey` and mapped backbone `nubKey`, `rank`, `taxonomicStatus`, classification names, `vernacularName` (GBIF's own, else the first English vernacular name containing `q` when `q` is not part of the row's own scientific name, else the first English one), and `numDescendants`. `numOccurrences` appears only when GBIF supplies a positive value; its species search sends a `0` placeholder on every row, so count with `gbif_count_occurrences` on `nubKey` or a `SPECIES_KEY` facet. Enrichment reports `totalCount`, `endOfRecords`, the `taxonScope` applied, and the `status` values applied. Occurrence queries use `nubKey` when supplied; otherwise resolve the name with `gbif_match_species`. Omitted `datasetKey` selects GBIF Backbone Taxonomy `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`
- `status` takes one or more of `ACCEPTED`, `DOUBTFUL`, `SYNONYM`, `HETEROTYPIC_SYNONYM`, `HOMOTYPIC_SYNONYM`, `PROPARTE_SYNONYM`, and `MISAPPLIED`, and a name matches when it carries any of them; `SYNONYM` matches only names whose status is exactly `SYNONYM`, not the heterotypic, homotypic, or pro parte forms. An empty list fails at the schema. `status: ["ACCEPTED"]` with `rank: "SPECIES"` and a `genus` lists that genus's accepted species
- `kingdom`, `family`, and `genus` take names, matched by their exact spelling in any letter case, never fuzzily; the narrowest one scopes, and `kingdom` beside a narrower one disambiguates it. An unknown name fails as `unresolved_taxon_scope`, a genus outside the named family as `conflicting_taxon_scope`, and a scope paired with a non-backbone `datasetKey` matches nothing. A blank filter or a malformed `datasetKey` fails as `invalid_filter`
- GBIF's species search serves nothing past an `offset + limit` of 100,000, whatever the query. The sum is checked on the applied `limit` before any request, and a larger one fails as `pagination_cap_exceeded`. When `totalCount` exceeds 100,000, every page carries a notice naming the ceiling and the way past it: narrow with `kingdom`, `family`, `genus`, `rank`, `status`, `isExtinct`, or `q`, or walk a subtree with `gbif_get_species_children`, which has no ceiling

---

### `gbif_get_species_classification` <sub>tool</sub>

- One `taxonKey` (a backbone key or the taxon usage key of any checklist); returns `classification` root-first from kingdom to the immediate parent, each entry with `key`, `rank`, `name`, `scientificName`, `datasetKey`, and `nubKey`. The chain is read in the queried taxon's own checklist: each `key` is a taxon usage key there, and `nubKey` is the mapped backbone key the occurrence tools take, absent where the backbone has no mapping
- The queried taxon is not included (use `gbif_get_species`); a root taxon returns an empty chain with a notice, an unknown key fails as `not_found`, one past the 32-bit range as `invalid_filter`, and a fraction or negative key fails at the schema

---

### `gbif_get_species_children` <sub>tool</sub>

- One `taxonKey` (a non-negative integer, a backbone key or the taxon usage key of any checklist; `0` is the backbone's *incertae sedis* kingdom), whose children are listed within its own checklist, up to 1,000 children per page with integer `limit` and `offset`; no filters. A fraction or negative value fails at the schema; an unknown key fails as `not_found`, one past GBIF's 32-bit range as `invalid_filter`
- Each child carries `key` (its taxon usage key in the parent's checklist), `datasetKey`, `nubKey` (the mapped backbone key, absent where the backbone has no mapping), `canonicalName`, `rank`, `taxonomicStatus`, `vernacularName` when GBIF has one, and `numDescendants`; GBIF sends no occurrence count, so use `gbif_count_occurrences` with the child's `nubKey`. GBIF reports no total, so `endOfRecords` (with `truncated` while more remain) is the continuation signal
- An empty later page gives offset-reset guidance; only an empty first page for an existing taxon means no direct children

---

### `gbif_search_occurrences` <sub>tool</sub>

- Filters: `taxonKey` (preferred: a key names exactly one taxon, where a `scientificName` shared across kingdoms, such as *Oenanthe*, matches nothing; `scientificName` does resolve synonyms), `checklistKey` with `checklistTaxonKey`, `country`, `publishingCountry`, `stateProvince`, `gadmGid`, a `decimalLatitude`/`decimalLongitude` box, WKT `geometry`, or `geoDistance` (a radius around a point), `elevation`, `depth`, `year`, `month` (one month or a range), `eventDate`, `basisOfRecord`, `hasCoordinate`, `hasGeospatialIssue`, `isInCluster`, `coordinateUncertaintyInMeters`, `datasetKey`, `publishingOrg`, `catalogNumber`, `institutionCode`, `recordedBy`, `mediaType`, `typeStatus`, `establishmentMeans`, `license`, `occurrenceStatus`, `iucnRedListCategory`; `includeMedia` adds each row's media; up to 300 per page
- `checklistKey` selects the taxonomy a taxon key is read in. Omitted, or `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`, is the GBIF Backbone and `taxonKey` takes its integer keys. Either value also leaves out the records GBIF has not matched to a taxon in that checklist, which a call with no `checklistKey` keeps. `7ddf754f-d193-4cc9-b351-99906754a03b` is the Catalogue of Life eXtended Release: scope by one of its keys with `checklistTaxonKey` (such as `3WSJV`, the key `gbif_match_species` returns under the same `checklistKey`), which matches the taxon and every descendant, as `taxonKey` does. A key holds uppercase letters and digits only and is matched case-sensitively; a digit-only one such as `8288` (the genus *Tringa*) is not the Backbone `taxonKey` of the same spelling. `checklistTaxonKey` without the Catalogue of Life `checklistKey`, and `taxonKey` with it, fail as `invalid_filter` before any request, since GBIF answers a key from the other taxonomy with zero records or an unrelated taxon. Rows keep their Backbone `taxonKey` either way
- `country`, `basisOfRecord`, `taxonKey`, and `checklistTaxonKey` each take one value or a non-empty array, and a record matching any one member matches (`country: ["ES", "PT"]` covers both countries, and a facet call ranks them as one scope). `taxonKey` and `checklistTaxonKey` take at most 100 members; an empty array fails at the schema, and each member passes the check a single value does. Different filters still intersect (a taxon key with `scientificName` excepted, below), and an array is echoed in `scope` as the array
- `gadmGid` is an uppercase GADM GID (`ESP.1_1`) GBIF derives from each record's coordinates, so records without coordinates match none; take one from a `GADM_LEVEL_0_GID`–`GADM_LEVEL_3_GID` facet or `gbif_get_occurrence`'s `gadm` field. `catalogNumber` and `institutionCode` match the whole value case-insensitively, `recordedBy` one collector exactly and case-sensitively (take a spelling from a `RECORDED_BY` facet), and `mediaType` is `StillImage`, `MovingImage`, `Sound`, or `InteractiveResource`. `limit` and `offset` are integers, `taxonKey` is an integer or an array of them, and `month` is an integer 1–12 or a string
- `publishingOrg` is the UUID of the organization that published the records, across all its datasets; take one from `gbif_search_publishers`, a dataset's or an occurrence record's `publishingOrganizationKey`, or a `PUBLISHING_ORG` facet. It is not the organization hosting the installation, and not `publishingCountry`
- `typeStatus` and `establishmentMeans` are matched case-insensitively against GBIF's TypeStatus (51 concepts) and EstablishmentMeans (7) vocabularies, then sent and echoed in the concept's own spelling. A value matches its concept and every narrower one: `Type` covers every kind of type, `Lectotype` covers `Isolectotype`, `native` covers `nativeEndemic` and `nativeReintroduced`, `introduced` covers `introducedAssistedColonisation`. A value naming no concept fails as `invalid_filter` listing them
- `license` is `CC0_1_0`, `CC_BY_4_0`, or `CC_BY_NC_4_0`; a blank or other value fails at the schema as `-32602`, not `invalid_filter`
- `hasGeospatialIssue: true` keeps records GBIF flagged with a spatial issue (zero coordinates, coordinates out of range, outside the stated country); `false` keeps unflagged ones. GBIF often drops the coordinates of a flagged record, so pair `false` with `hasCoordinate: true` for records to map
- All supplied spatial filters intersect: combining `geometry` or `geoDistance` with latitude or longitude ranges restricts results to their overlap
- `geoDistance` is `"latitude,longitude,distance"`, latitude first, with the distance ending in a lowercase `km` or `m` (`"38.17,-3.95,25km"` and `"38.17,-3.95,25000m"` are the same circle). The unit is required, because GBIF reads a distance with no unit as meters, so any other form fails as `invalid_filter`
- `decimalLatitude`, `decimalLongitude`, `coordinateUncertaintyInMeters`, `elevation`, and `depth` are ranges written `"min,max"`, both ends inclusive. A value without a comma is an exact match, not a range around it, and every result carries a notice saying so, with an example range per field (`decimalLatitude "38,39"`, `decimalLongitude "-4,-3"`, `coordinateUncertaintyInMeters "0,1000"` for within 1 km, `elevation "2000,*"` for 2,000 m and above, `depth "200,*"` for 200 m and deeper), listing only the fields the notice names. `coordinateUncertaintyInMeters`, `elevation`, and `depth` also take `*` for one open end (`"*,1000"`, `"2000,*"`); a bare `*`, padded or not, fails as `invalid_filter` on these and on `year`, `month`, and `eventDate`. A `*` end with whitespace between it and the comma (`"* ,1990"`, `"2020, *"`) also fails as `invalid_filter` on `coordinateUncertaintyInMeters`, `year`, `month`, `elevation`, and `depth`, and the message gives the corrected form (`"*,1990"`), because GBIF answers that spacing with HTTP 404 and an empty body, as it does a bare `*`; whitespace on the outer side of a `*` end (`" *,1990"`) or beside a number end (`"*, 1990"`, `"1990 ,*"`) is read by GBIF and forwarded, and `eventDate` with that spacing goes to GBIF, whose 400 names the value
- `year` is one year or a `"min,max"` range, `month` an integer 1–12 or a string holding one month or an ascending range (`"3,5"` for March through May, with no wrap past December), and `eventDate` is `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`, each covering its whole period, or a range of any mix of them (`"2026-01-01,2026-06-30"`). `*` opens one end of each range (`"*,1990"`, `"2020,*"`), and any value, `"*,*"` included, drops records that carry no value for that field. GBIF rejects a time of day, a descending range, or an impossible date by name
- Records carry `key`, `taxonKey`, `taxonomicStatus`, coordinates, `eventDate` and `eventTime`, `basisOfRecord`, `occurrenceStatus`, `iucnRedListCategory`, `datasetKey`, `institutionCode`, `catalogNumber`, and `issues`, plus each of these where GBIF has it: `acceptedTaxonKey` and `acceptedScientificName` (the accepted taxon behind a synonym record, the name with authorship), `publishingOrganizationKey`, `license` (the record's Creative Commons URL; the `license` filter takes the code form), `rightsHolder`, `recordNumber` (the collector's number, not `catalogNumber`), `elevation` and `depth` in meters, and `typeStatus` and `establishmentMeans` (both go back unchanged to their filters). `occurrenceStatus` reads `DETECTED` or `NOT_DETECTED`, as GBIF serves it. With `includeMedia`, each row also carries every media item of its record as `{ type, identifier, license, rightsHolder }` in source order, whatever `mediaType` selected; it is off by default because it adds to both response surfaces. Enrichment reports `totalCount`, `endOfRecords`, and the `occurrenceStatus` applied
- Search, count and facets echo the same `scope`: effective supplied biological filters, with `occurrenceStatus` always included and pagination controls excluded. `ANY` is echoed but omitted upstream. `taxonKey` and `scientificName` combine with OR, so a name GBIF cannot resolve (one shared across kingdoms, or one it does not know) empties the combined query, the `taxonKey` records included; a zero then carries a notice saying so and naming two ways out: drop the name, or resolve it with `gbif_match_species` and add the returned key to the call's `taxonKey` (or `checklistTaxonKey`) array in place of the name. All 11 GBIF basis-of-record values are accepted, including `FOSSIL_SPECIMEN`, `OBSERVATION`, and `UNKNOWN`
- Latitude, longitude and coordinate uncertainty are independent optional facts; text renders each supplied value, including zero, in decimal degrees or meters
- `offset + limit` caps at 100,001 and GBIF has no cursor; a deeper request fails as `pagination_cap_exceeded`, and a larger match is reached by partitioning on a `DATASET_KEY` facet from `gbif_occurrence_facets`. A rejected filter value fails as `invalid_filter`

---

### `gbif_count_occurrences` <sub>tool</sub>

- Accepts every biological filter listed for `gbif_search_occurrences`, with the same constraints and spatial intersection. `isGeoreferenced` remains an alias for `hasCoordinate`; either alone or both equal works, conflicting values fail as `invalid_filter`
- Returns `count`, with the `occurrenceStatus` applied in the enrichment; a count above 100,001 carries a notice naming the partition route, and a rejected filter value fails as `invalid_filter`

---

### `gbif_get_occurrence` <sub>tool</sub>

- One `occurrenceKey` from a search result, a positive integer (a non-positive or fractional key is rejected at the schema); an unknown key fails as `not_found`
- The Darwin Core record: `occurrenceStatus` (`NOT_DETECTED` is a survey that found nothing, not a sighting; the `occurrenceStatus` filter takes `ABSENT` or `NOT_DETECTED` for it), coordinates with `elevation` and `depth` in meters and, where the publisher gave them, `informationWithheld` and `dataGeneralizations` (the coordinates are coarser than observed on purpose), GADM levels 0–3 under `gadm`, dates with `eventTime` and `dateIdentified`, `taxonomicStatus`, the backbone key at every rank (`kingdomKey` through `speciesKey`), `acceptedTaxonKey` and `acceptedScientificName` (the accepted taxon behind a synonym record), `iucnRedListCategory`, institution, collection, and catalog codes, `datasetName`, `recordedBy`, `identifiedBy`, and `recordNumber`, `occurrenceRemarks`, `habitat`, `samplingProtocol`, `organismQuantity` with `organismQuantityType`, `typeStatus` and `establishmentMeans`, `license` (the Creative Commons URL), `rightsHolder`, and `publishingOrganizationKey` (goes into `publishingOrg`), `references` (the link to the source record), `isInCluster`, `media` with each item's `rightsHolder`, `identifiers`, and `issues`. Each field is omitted when GBIF sends none

---

### `gbif_occurrence_facets` <sub>tool</sub>

- `facet` is one of `COUNTRY`, `STATE_PROVINCE`, `YEAR`, `MONTH`, `BASIS_OF_RECORD`, `DATASET_KEY`, `PUBLISHING_COUNTRY`, `KINGDOM_KEY`, `PHYLUM_KEY`, `CLASS_KEY`, `ORDER_KEY`, `FAMILY_KEY`, `GENUS_KEY`, `SPECIES_KEY`, `OCCURRENCE_STATUS`, `IUCN_RED_LIST_CATEGORY`, `GADM_LEVEL_0_GID`–`GADM_LEVEL_3_GID`, `INSTITUTION_CODE`, `MEDIA_TYPE`, `RECORDED_BY`, `PUBLISHING_ORG`, `TYPE_STATUS`, `ESTABLISHMENT_MEANS`, `LICENSE`; up to 100 values per page (`facetLimit`, default 10), paged with `facetOffset`
- Accepts every biological filter listed for `gbif_search_occurrences`, with the same constraints and spatial intersection. Repeat them on the facet call and each partition search to preserve the population. Returns `totalOccurrences` and `counts` ranked by count; a rejected scope value fails as `invalid_filter`
- Each facet request fetches one extra bucket to prove continuation. `truncated`, `shown`, and `cap` appear only when that bucket exists; advance `facetOffset` by the exposed page size. GBIF pages a ranking only so far: `facetOffset + facetLimit` may reach 1,199,999 on any scope, past which the call fails as `pagination_cap_exceeded` before any request, and 500,000 on a scope ranking more than 500,001 buckets, where GBIF refuses a deeper page and the call fails the same way; when the next page at the same `facetLimit` would reach past position 500,001 (the lookahead bucket counts), the continuation notice names the `facetLimit` that lands the next page exactly on it, and that page carries a notice in place of a continuation, with `truncated` still set, so a walk at any `facetLimit` ends at position 500,001. To rank buckets past either, narrow the scope with filters (`taxonKey` of a class or order, `country`, `year`, `basisOfRecord`, or a `datasetKey` from a `DATASET_KEY` facet) and page each narrower scope from 0. An exactly full final page carries no truncation flag. Empty later pages give offset-reset guidance; an empty first page distinguishes zero matching occurrences from a dimension with no data
- `DATASET_KEY` buckets sum to the scope's full total, so it is the facet for partitioning a search too large to page; `YEAR`, `MONTH`, `STATE_PROVINCE`, `SPECIES_KEY`, `INSTITUTION_CODE`, `MEDIA_TYPE`, `RECORDED_BY`, `TYPE_STATUS`, and `ESTABLISHMENT_MEANS` drop records that lack the field, and the GADM levels drop records without coordinates or outside every GADM unit at that level. `MEDIA_TYPE` and `RECORDED_BY` buckets overlap (a record with two media types or two collectors counts in each), and so do `TYPE_STATUS` and `ESTABLISHMENT_MEANS` (a record counts under its concept and every broader one: an `Isolectotype` also under `Lectotype` and `Type`), so their sums can exceed `totalOccurrences`. `INSTITUTION_CODE` buckets come back lowercased and `institutionCode` takes them unchanged; `PUBLISHING_ORG`, `TYPE_STATUS`, `ESTABLISHMENT_MEANS`, and `LICENSE` buckets go back unchanged as `publishingOrg`, `typeStatus`, `establishmentMeans`, and `license`, and `GADM_LEVEL_*_GID` buckets as `gadmGid`. `OCCURRENCE_STATUS` buckets read `DETECTED` and `NOT_DETECTED`, which the `occurrenceStatus` filter takes unchanged. `KINGDOM_KEY`–`SPECIES_KEY` buckets are Backbone keys for `taxonKey`, or, under the Catalogue of Life `checklistKey`, Catalogue of Life keys for `checklistTaxonKey`. Pass `facet: OCCURRENCE_STATUS` with `occurrenceStatus: ANY` for the presence/absence split
- `includeLabels: true` names each bucket on a `KINGDOM_KEY`–`SPECIES_KEY`, `DATASET_KEY`, `PUBLISHING_ORG`, or `GADM_LEVEL_0_GID`–`GADM_LEVEL_3_GID` page: `counts[].label` is the taxon's `canonicalName`, the dataset `title`, the organization `title`, or the administrative area's `name`. Taxon buckets are looked up in the taxonomy `checklistKey` selects, never by the shape of the key, since `8288` is a Catalogue of Life genus and a Backbone family. It costs one GBIF request per exposed bucket (never the lookahead), at most 8 in flight server-wide, no retries, and one 10 s deadline per page; a bucket whose lookup fails, finds no name, or misses it has no `label` and is counted in `notice`, which points an unlabeled GADM bucket at `gbif_get_occurrence`'s `gadm` field. Other dimensions ignore it, and without it a facet call is one request. Labeling Catalogue of Life buckets reads the `/v2` route, so a `GBIF_BASE_URL` not ending in `/v1` fails that call as a configuration error

---

### `gbif_search_datasets` <sub>tool</sub>

- Filters: `q`, `type` (`OCCURRENCE`, `CHECKLIST`, `METADATA`, `SAMPLING_EVENT`), `publishingCountry`, `publishingOrg`, `hostingOrg`; up to 1,000 per page, where `offset + limit` may not exceed 125,000
- Returns `key`, `title`, `type`, `license`, `doi`, `recordCount`, `publishingOrganizationKey` and `publishingOrganizationTitle`, and a 300-character `description` preview, with `descriptionTruncated` flagging a cut (`gbif_get_dataset` has the full text). `publishingOrganizationKey` goes back in as `publishingOrg`. `limit` and `offset` are integers
- `publishingOrg` matches the organization whose data it is and is the usual chain from `gbif_search_publishers`; `hostingOrg` matches the organization whose installation serves it, and the two together intersect. Both take the lowercase UUID form; anything else, like any rejected filter value, fails as `invalid_filter`
- GBIF's dataset search serves nothing past an `offset + limit` of 125,000. The sum is checked on the applied `limit` before any request, and a larger one fails as `pagination_cap_exceeded`. When `totalCount` exceeds 125,000, every page carries a notice naming the ceiling and the way past it: `type` splits the index with no gap or overlap, since every dataset has exactly one of the four types, and `q`, `publishingCountry`, `publishingOrg`, and `hostingOrg` narrow it further

---

### `gbif_get_dataset` <sub>tool</sub>

- One `datasetKey` UUID and `contactLimit` (default 10, max 100; `0` drops contact detail but keeps `contactsTotal`); a malformed key fails as `invalid_filter`, an unknown one as `not_found`
- Returns `description`, `citationText`, `license`, `doi`, `publishingOrganizationKey` (goes into `gbif_search_datasets` as `publishingOrg`; the detail record carries no organization name), `recordCount`, `numConstituents`, `contacts` with `contactsTotal` and `contactsReturned`, `temporalCoverages`, `geographicCoverages` (each a description, a `boundingBox` as GBIF sends it, or both; a `minLongitude` above `maxLongitude` is a box crossing the antimeridian), and `deleted`, GBIF's timestamp for a dataset it no longer publishes (it is then not searchable and GBIF indexes none of its occurrences; absent on a published dataset)

---

### `gbif_search_publishers` <sub>tool</sub>

- `q` name fragment and `country` (alpha-2 or alpha-3, any case); up to 1,000 per page with integer `limit` and `offset`
- Returns organization `key`, `title`, `country`, and `city`; the key chains into `gbif_search_datasets` as `publishingOrg`
- A blank `q`, an empty `country`, or a country GBIF cannot parse fails as `invalid_filter`. Besides the codes, GBIF parses its own enum name for a country (`UNITED_KINGDOM`, or `United Kingdom`), but no other name: `Britain`, `UK`, and numeric codes fail

---

### `gbif://species/{taxonKey}` <sub>resource</sub>

- Taxon usage record as `application/json`: classification names, `authorship`, `vernacularName`, `taxonomicStatus` with `acceptedKey` and `accepted`, `numDescendants`, `datasetKey` (the source checklist), and `nubKey` (the mapped backbone key the occurrence tools take); `key` and `acceptedKey` are taxon usage keys of that checklist
- `taxonKey` is a whole signed decimal integer within the signed 32-bit range; `0` is the backbone kingdom *incertae sedis*. The segment is URI-decoded once and surrounding whitespace is trimmed; leading `+`, zero padding and their percent-encoded equivalents are accepted. An unknown key fails as `not_found`; malformed escapes, suffixes, fractions, exponents, hexadecimal forms, embedded whitespace and out-of-range values fail as `invalid_filter` before a request. Use a backbone key from `gbif_match_species` or a taxon usage key of any checklist, such as a search result's `key`

---

### `gbif://dataset/{datasetKey}` <sub>resource</sub>

- The `gbif_get_dataset` record as `application/json`, including `publishingOrganizationKey`, with contacts fixed at 10
- `datasetKey` comes from `gbif_search_datasets` or an occurrence record; an unknown key fails as `not_found`, a malformed one as `invalid_filter`

## Features

Built on [`@cyanheads/mcp-ts-core`](https://github.com/cyanheads/mcp-ts-core): stdio and Streamable HTTP transports, pluggable auth (`none` / `jwt` / `oauth`), swappable storage (`in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`), structured logging with optional OpenTelemetry tracing.

GBIF-specific:

- GBIF API v1 species, occurrence, dataset, organization, and GADM endpoints, plus v2 species matching for the Catalogue of Life, keyless, with an identifying `User-Agent` on every request
- Synonym-safe keys: `gbif_match_species` resolves a synonym to its accepted taxon, and the occurrence tools filter on that `taxonKey`
- Opt-in Catalogue of Life matching: `checklistKey` on both match tools matches against the Catalogue of Life eXtended Release and returns string keys in separate fields, and the occurrence tools take them as `checklistTaxonKey`, so a Catalogue of Life key never lands in a backbone integer field
- Sightings by default: the search, count, and facet tools default `occurrenceStatus` to `PRESENT`, excluding absence records. Records and facet buckets read `DETECTED` and `NOT_DETECTED`, which the filter takes as well as `PRESENT` and `ABSENT`. Dataset `recordCount` spans every status, so it can exceed a `gbif_count_occurrences` total for the same key
- Strict country codes: `country` (where a record was observed) and `publishingCountry` (the publisher's country) on the occurrence tools, and `publishingCountry` on `gbif_search_datasets`, accept only uppercase ISO 3166-1 alpha-2, because lowercase and alpha-3 forms silently match nothing there and a country name such as `Britain` draws a 400 upstream. `stateProvince` matches verbatim and case-sensitively, so take values from a `STATE_PROVINCE` facet
- Blank filters rejected: GBIF reads an empty parameter as no filter, so an optional filter sent blank or whitespace-only fails as `invalid_filter` instead of widening the query. The exception is a blank `country` or `publishingCountry` on the occurrence tools, or a blank `publishingCountry` on `gbif_search_datasets`, which fails earlier at the uppercase pattern as `-32602 invalid_arguments`, as does a blank or unknown `license` at its enum. Omit a field to leave it off

Agent-friendly output:

- Scope echo: enrichment reports `totalCount`, `endOfRecords`, the `occurrenceStatus` applied, and the resolved `taxonScope`, with notices on empty results, over-cap totals, and a `scientificName`, `stateProvince`, `gadmGid`, or `recordedBy` that matched nothing
- Graceful partial failure: `gbif_bulk_match_species` returns a `NONE` or `ERROR` row per name instead of failing the batch
- Typed errors: `invalid_filter`, `not_found`, `no_match`, `unresolved_taxon_scope`, `conflicting_taxon_scope`, and `pagination_cap_exceeded` (on `gbif_search_occurrences`, `gbif_occurrence_facets`, `gbif_search_species`, and `gbif_search_datasets`), each with a recovery hint
- Sparse fields omitted rather than null-filled: `extinct` appears only on taxa GBIF explicitly flags
- Dataset metadata preserves temporal ranges, single dates, and verbatim periods such as `1975-current`, and geographic coverage bounding boxes as GBIF sends them; unsupported coverage entries are disclosed. A deleted dataset carries its `deleted` timestamp. An unavailable supplementary record count carries `recordCountNotice` while retaining metadata
- Publisher descriptions retain paragraph breaks and decode numeric character references once; Markdown output renders publisher text literally, in dataset and occurrence output alike. A value containing Markdown or character-reference syntax appears in `content[]` as numeric character references (`&#NN;`) standing for one character each, never part of the value; `structuredContent` carries every string as GBIF sent it. An http(s) URL in an occurrence record (`occurrenceID`, `references`, a media or `identifiers` entry) renders as a link whose text is the URL, and any other value as escaped text

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

- [Bun v1.4.4](https://bun.sh/) or higher (or Node.js v24+).
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
| `GBIF_BASE_URL` | GBIF API base URL. Keep the trailing `/v1`: `checklistKey` on the match tools, and `includeLabels` on `gbif_occurrence_facets` under the Catalogue of Life `checklistKey`, call the `/v2` route derived by replacing it, and fail as a configuration error without it. | `https://api.gbif.org/v1` |
| `GBIF_CLAMP_READ_LIMITS` | Clamp oversized whole-number read limits to the documented caps and disclose requested/applied values. Bulk matching processes the first 50 names and returns the remainder in `unprocessedNames`. Set `false` to advertise and enforce rejecting maxima instead. Strict boolean parsing rejects malformed values. | `true` |
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
