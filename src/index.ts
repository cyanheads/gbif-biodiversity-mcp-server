#!/usr/bin/env node
/**
 * @fileoverview gbif-biodiversity-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
// Resources
import { gbifDatasetResource } from './mcp-server/resources/definitions/gbif-dataset.resource.js';
import { gbifSpeciesResource } from './mcp-server/resources/definitions/gbif-species.resource.js';
import { gbifBulkMatchSpecies } from './mcp-server/tools/definitions/gbif-bulk-match-species.tool.js';
import { gbifCountOccurrences } from './mcp-server/tools/definitions/gbif-count-occurrences.tool.js';
import { gbifGetDataset } from './mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetOccurrence } from './mcp-server/tools/definitions/gbif-get-occurrence.tool.js';
import { gbifGetSpecies } from './mcp-server/tools/definitions/gbif-get-species.tool.js';
import { gbifGetSpeciesChildren } from './mcp-server/tools/definitions/gbif-get-species-children.tool.js';
import { gbifGetSpeciesClassification } from './mcp-server/tools/definitions/gbif-get-species-classification.tool.js';
// Taxonomy tools
import { gbifMatchSpecies } from './mcp-server/tools/definitions/gbif-match-species.tool.js';
import { gbifOccurrenceFacets } from './mcp-server/tools/definitions/gbif-occurrence-facets.tool.js';
// Dataset and publisher tools
import { gbifSearchDatasets } from './mcp-server/tools/definitions/gbif-search-datasets.tool.js';
// Occurrence tools
import { gbifSearchOccurrences } from './mcp-server/tools/definitions/gbif-search-occurrences.tool.js';
import { gbifSearchPublishers } from './mcp-server/tools/definitions/gbif-search-publishers.tool.js';
import { gbifSearchSpecies } from './mcp-server/tools/definitions/gbif-search-species.tool.js';
import { initGbifService } from './services/gbif/gbif-service.js';

await createApp({
  name: 'gbif-biodiversity-mcp-server',
  title: 'gbif-biodiversity-mcp-server',
  instructions:
    'Use the gbif_* tools to query species taxonomy, occurrences, datasets, and publishers via the GBIF API. Keyless — these endpoints need no credentials. Resolve any name with gbif_match_species first — it returns the backbone taxonKey the occurrence tools expect, resolving a synonym to its accepted taxon and reporting the matched synonym key alongside as matchedTaxonKey, unlike the raw scientificName filter. A matchType of HIGHERRANK means GBIF matched at a higher rank — a misspelled species can come back as its genus or kingdom — so that taxonKey covers the whole higher taxon; the notice on the result names it. gbif_search_species defaults to the GBIF Backbone Taxonomy checklist d7dddbf4-2cf0-4f39-9b2a-bb099caae36c and honors an explicit datasetKey. Its key is the source checklist usage key; use the optional nubKey for occurrence queries, otherwise resolve the name with gbif_match_species. The optional datasetKey identifies the source checklist. The kingdom, family, and genus filters on gbif_search_species take names and are resolved to backbone keys the same way before the search runs, since /species/search scopes by taxon key alone: the narrowest of the three supplied is what scopes, a name is matched exactly and capitalized as GBIF writes it, one that reaches no backbone taxon at that rank fails rather than widening the search, and pairing any of them with datasetKey matches nothing unless that checklist is the GBIF backbone. Countries use ISO 3166-1 alpha-2; datasets and publishers are keyed by UUID, occurrences by integer key. Omit a filter you do not want rather than sending it blank: GBIF ignores a parameter it is given with no value and answers with the whole unfiltered scope, so every optional filter on these tools rejects a blank or whitespace-only value instead of quietly widening the query. That rejection is a typed invalid_filter carrying the recovery hint the tool declares, except on country and publishingCountry of the occurrence tools and publishingCountry of gbif_search_datasets, where the uppercase-only pattern rejects it at the schema, so the failure is the generic -32602 invalid_arguments rejection, carrying the message of that pattern instead. On the occurrence tools country and publishingCountry, and on gbif_search_datasets publishingCountry, the uppercase two-letter form is the only one accepted — lowercase and alpha-3 forms ("gb", "USA") match nothing on those routes, so those fields reject anything else rather than answering zero, while gbif_search_publishers resolves either form case-insensitively against the registry and needs no such constraint. An organization key from gbif_search_publishers chains into gbif_search_datasets two ways: publishingOrg for the datasets that organization published, hostingOrg for the ones its own installation serves. publishingOrg is almost always the one meant — most organizations publish through an installation someone else runs, so hostingOrg matches nothing for them — and supplying both intersects the two rather than combining them. gbif_get_dataset, the gbif://dataset/{datasetKey} resource, and each gbif_search_datasets row also return the publishingOrganizationKey of the dataset, which goes into publishingOrg the same way. On the occurrence tools country is where the record was observed and publishingCountry is the country of the organization that published it — different questions that disagree on most records, so pick deliberately; stateProvince is matched verbatim, exactly and case-sensitively, and an unrecognized value returns zero records rather than an error, so take one from a STATE_PROVINCE facet instead of guessing a spelling. gadmGid is the normalized alternative: a GADM GID (ESP.1_1) GBIF derives from the coordinates of each record, matched exactly and taken from a GADM_LEVEL_0_GID … GADM_LEVEL_3_GID facet or the gadm field of gbif_get_occurrence; records without coordinates carry none. catalogNumber and institutionCode match whole values case-insensitively, recordedBy matches one collector exactly and case-sensitively (take a spelling from a RECORDED_BY facet), and mediaType is one of StillImage, MovingImage, Sound, InteractiveResource. GBIF indexes absence records — a documented survey that looked for a taxon and did not find it — alongside sightings, so gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets all default occurrenceStatus to PRESENT and report the applied filter in their enrichment; pass ANY to include absences, or ABSENT for absences alone. For some taxa absences dominate: an unfiltered count can run five orders of magnitude above the sightings it appears to report. The dataset recordCount on gbif_search_datasets, gbif_get_dataset, and the gbif://dataset/{datasetKey} resource is not filtered that way — it spans every occurrenceStatus, so it can exceed a gbif_count_occurrences total for the same datasetKey. Occurrence paging caps at offset+limit=100,001 and GBIF exposes no cursor or scroll, so a larger result set is reached only by partitioning it: gbif_occurrence_facets with facet DATASET_KEY splits a scope into buckets that sum to its full total, since every occurrence carries exactly one datasetKey, and each bucket is then searchable on its own; a facet on a dimension a record can lack — YEAR, MONTH, STATE_PROVINCE, SPECIES_KEY, INSTITUTION_CODE, MEDIA_TYPE, RECORDED_BY, and the GADM_LEVEL_0_GID … GADM_LEVEL_3_GID GIDs (records without coordinates or outside every GADM unit at that level) — leaves those records in no bucket, and MEDIA_TYPE and RECORDED_BY buckets overlap. Search, count and facets accept the same biological filters and echo only effective supplied filters in scope, always including occurrenceStatus; isGeoreferenced is a count alias for hasCoordinate and conflicting values fail as invalid_filter. Repeat every biological filter on the facet call and each partition search so bucket counts reconcile. All supplied spatial filters intersect, while taxonKey and scientificName combine with OR. Key-dimension buckets (KINGDOM_KEY through SPECIES_KEY, DATASET_KEY) are bare keys; includeLabels adds the name of each as label at one extra request per bucket, under a 10 s deadline, and notice counts any left unlabeled. This server cannot retrieve a result set in bulk — the GBIF Download API needs a GBIF.org account and returns an archive asynchronously, and the monthly GBIF Parquet snapshot on AWS Open Data is a bulk dataset; both are routes to take outside this server. The gbif-biodiversity-guide skill (skill://gbif-biodiversity-guide/SKILL.md) carries the gates for choosing a region filter, reading counts and trends, reconciling a name list, tracing records to collections and publishers, and concluding a taxon is absent.',
  // Declared here rather than left to MCP_SESSION_MODE, so a source run and the
  // container resolve the same posture. No handler calls ctx.requestInput, so
  // nothing needs the stateful-only elicitation path a 2025-era client relies on.
  sessionMode: 'stateless',
  tools: [
    gbifMatchSpecies,
    gbifBulkMatchSpecies,
    gbifGetSpecies,
    gbifSearchSpecies,
    gbifGetSpeciesClassification,
    gbifGetSpeciesChildren,
    gbifSearchOccurrences,
    gbifCountOccurrences,
    gbifGetOccurrence,
    gbifOccurrenceFacets,
    gbifSearchDatasets,
    gbifGetDataset,
    gbifSearchPublishers,
  ],
  resources: [gbifSpeciesResource, gbifDatasetResource],
  prompts: [],
  // The published agent guide in root skills/, served over MCP as skill:// resources.
  skills: 'skills',
  // Public catalog — serve the full landing inventory regardless of auth mode.
  landing: { requireAuth: false },
  setup(core) {
    const cfg = getServerConfig();
    initGbifService(core.config, core.storage, {
      baseUrl: cfg.baseUrl,
      timeoutMs: cfg.requestTimeoutMs,
      userAgent: cfg.userAgent,
    });
  },
});
