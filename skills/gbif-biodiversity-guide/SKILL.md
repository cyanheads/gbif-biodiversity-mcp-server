---
name: gbif-biodiversity-guide
description: Use with gbif_* tools to map where and when a taxon was recorded, list the species of a group in a region, reconcile a name list, or trace records to collections, datasets, and publishers. Covers where each key comes from, which region filter selects which records, and the checks to run before quoting a count, a trend, or an absence.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

GBIF indexes occurrence records (specimens, field observations, literature and survey records) from thousands of publishers, alongside the GBIF backbone taxonomy and other checklists. Access is keyless and read-only. Reach for it to answer where and when a taxon has been recorded, which collections hold it, what a group contains, and where a record came from.

It does not:

- Resolve a place name. A region is a country code, a `stateProvince` string taken from a facet, a GADM GID, a latitude/longitude box, or a WKT polygon built from coordinates you already hold.
- Search occurrence records by free text. Locality descriptions, collector notes, and identification remarks are not searchable; every occurrence filter is a structured Darwin Core field.
- Measure abundance. Every occurrence count it returns is a number of records.

## Identifiers

| Identifier | Where it comes from | Where it goes |
|:--|:--|:--|
| Backbone `taxonKey` | `taxonKey` from `gbif_match_species` or `gbif_bulk_match_species`; `key` from `gbif_get_species`, `gbif_get_species_children`, and `gbif_get_species_classification`; `nubKey` (not `key`) on `gbif_search_species` rows; `taxonKey` on occurrence records and rows, with `acceptedTaxonKey` beside it (the accepted taxon when the record is filed under a synonym); a `KINGDOM_KEY` … `SPECIES_KEY` bucket's `name` under the default checklist | Occurrence tools, species tools |
| `datasetKey` | `gbif_search_datasets`, an occurrence row, a `DATASET_KEY` bucket | Occurrence tools, `gbif_get_dataset` |
| Organization key | `gbif_search_publishers`; `publishingOrganizationKey` on the dataset tools, `gbif_get_occurrence`, and occurrence rows; a `PUBLISHING_ORG` bucket's `name` | `publishingOrg` on `gbif_search_datasets` and the occurrence tools |
| Catalogue of Life key | `checklistTaxonKey` from the match tools when `checklistKey` selects the Catalogue of Life; a `KINGDOM_KEY` … `SPECIES_KEY` bucket's `name` when the facet call sets that `checklistKey` | `checklistTaxonKey` on the occurrence tools, with the same `checklistKey`. Never `taxonKey` or the species tools: it is a case-sensitive string, not a backbone key, and a digit-only one such as `8288` names an unrelated backbone taxon |
| Occurrence key | `gbif_search_occurrences` | `gbif_get_occurrence` |
| GADM GID (`ESP`, `ESP.1_1`) | The `gadm` block of `gbif_get_occurrence`, or a `GADM_LEVEL_0_GID` … `GADM_LEVEL_3_GID` bucket (`includeLabels` names the area) | `gadmGid` on the occurrence tools |

Facet bucket names are strings. Under the default checklist, a `SPECIES_KEY` bucket named `"2878688"` is the backbone key 2878688: pass it as a number. When the facet call sets the Catalogue of Life `checklistKey`, the same buckets are Catalogue of Life keys: pass them as `checklistTaxonKey` strings, all-digit ones included, on a call that sets the same `checklistKey`.

## Gates

1. **Read `matchType` before using a matched key.** On HIGHERRANK, use `taxonKey` only when the taxon its notice names is the one you meant. A species name that fell back to its genus or kingdom is not a match for that species.
2. **Choose the region filter for the population you mean.** They select different records:
   - `country` is where the record was made, and includes records without coordinates.
   - `stateProvince` is the string each dataset wrote, so it misses other spellings of the same region.
   - `gadmGid`, the latitude/longitude ranges, and `geometry` are computed from coordinates, so they drop every record that has none.

   For Iberian lynx in Spain, `stateProvince` "Andalucía" matches 381 records and `gadmGid` `ESP.1_1` matches 787, while 237 Spanish records carry no coordinates and fall outside every GID. Name the filter that defined the region whenever you report a regional count.
3. **A count is records, not organisms.** One specimen or sighting can be indexed by several datasets. `isInCluster` false drops every member of a likely-duplicate cluster, the original included, so it gives a lower bound rather than a deduplicated total. `individualCount` is per record and often absent. Say "records" when you quote a number.
4. **Record volume over time measures effort before it measures populations.** Digitization and citizen-science uptake drive the curve: all bird records from Sweden rose from 666,092 in 2000 to 5,450,939 in 2022. Before calling a trend, divide the taxon's yearly counts by those of a reference group (its family or class) under the same filters.
5. **Zero records is not absence.** Before saying a taxon is absent from an area, confirm the key came from a tool and names the taxon you meant (gate 1), since a `taxonKey` GBIF does not hold counts zero rather than erroring. Then confirm the region filter did not exclude the records you expected (gate 2), and rerun with `occurrenceStatus` ANY to look for survey absences. A NOT_DETECTED record (the filter takes ABSENT or NOT_DETECTED for it) documents one survey at one place and time, not a range limit. Report the result as "no records in GBIF under these filters" and list the filters.
6. **YEAR buckets are ranked by count, not by year.** A ten-year *Parus major* series for Sweden lists 2016 ahead of 2017. Set `facetLimit` to at least the number of years, sort the buckets by year yourself, and read a year missing from a page with no `truncated` flag as zero records under that scope.

## Workflows

### Where and when a taxon was recorded

Match the name (gate 1), take a total with `gbif_count_occurrences`, then break it down with `gbif_occurrence_facets` on COUNTRY, a GADM level (`includeLabels` names each area), STATE_PROVINCE, or YEAR (gate 6). Pull example records with `gbif_search_occurrences`, and open one with `gbif_get_occurrence` for its full GADM chain, identifiers, and media.

### Species of a group in a region

Two questions that sound alike:

- **What the group contains taxonomically.** Walk `gbif_get_species_children` from the genus or family key, paging by offset.
- **What has been recorded in the area.** Facet on SPECIES_KEY with the group's `taxonKey` and the region filter, then advance `facetOffset` until no `truncated` flag comes back. The number of buckets across all pages is the species count. `includeLabels` names each bucket's taxon in the same call; without it, each name costs a `gbif_get_species` call.

Records identified only to genus land in no SPECIES_KEY bucket. A genus-level count from the same scope shows how many records that leaves out.

### Reconciling a name list

Send names through `gbif_bulk_match_species`, 50 per call, and sort the rows:

- EXACT or FUZZY at confidence 80 or above: accept, and record `taxonKey`.
- FUZZY below 80: review before accepting.
- HIGHERRANK where the list named a species: unreconciled. The row's `note` names the genus or kingdom it fell back to.
- NONE: unreconciled. When the row carries a `note`, follow it: for a name shared across kingdoms, such as *Oenanthe*, it points at resubmitting that name as an entry with its own `kingdom`, which leaves the rest of the batch untouched.
- ERROR: retry that name.

Then group the accepted rows by `taxonKey` (`checklistTaxonKey` in a Catalogue of Life rerun). Two names on the list that share a key are one species, whether as a synonym (`matchedTaxonKey` marks which name was the synonym, and `acceptedName` names the accepted taxon when GBIF's answer does) or as a misspelling GBIF matched fuzzily.

GBIF no longer updates the backbone, so a name described or revised since its last build falls back to a higher taxon there (HIGHERRANK). Rerun those with `checklistKey` set to the Catalogue of Life eXtended Release to see whether it matches them exactly; its rows use VARIANT in place of FUZZY, can carry the status PROVISIONALLY_ACCEPTED, and return string keys that fit no species tool. To count or list a rerun name's records, pass its key to the occurrence tools as `checklistTaxonKey` with the same `checklistKey`; records and rows keep their backbone `taxonKey`.

### Which collections hold a taxon

- Specimens are spread across several `basisOfRecord` values (PRESERVED_SPECIMEN, FOSSIL_SPECIMEN, LIVING_SPECIMEN, MATERIAL_SAMPLE), and the filter takes one at a time. Facet on BASIS_OF_RECORD first to see which are present.
- An INSTITUTION_CODE facet names the holding institutions.
- A DATASET_KEY facet followed by `gbif_get_dataset` gives each source dataset's title and its publisher's organization key. A single record already carries that key as `publishingOrganizationKey`, with its `license`, `rightsHolder`, and `recordNumber` (the collector's number, how herbarium specimens are cited).
- Photos of a taxon: search with `mediaType` StillImage and `includeMedia` on, which returns every media item of each record in one call instead of one `gbif_get_occurrence` per row. Each item has its own `license` and `rightsHolder`; read those, not the record's, for the image.

### What an organization publishes

Take the organization key from `gbif_search_publishers` and pass it as `publishingOrg` to `gbif_count_occurrences`, `gbif_search_occurrences`, or `gbif_occurrence_facets` to scope records to everything that organization published, across all its datasets. A PUBLISHING_ORG facet lists the organizations behind any scope. To see the datasets themselves, list them through `gbif_search_datasets` with the same `publishingOrg`, or facet on DATASET_KEY. `publishingOrg` is the organization whose data it is, not `publishingCountry` and not the installation hosting it.
