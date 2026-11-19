/**
 * @fileoverview Aggregate GBIF occurrence counts by a facet dimension.
 * @module mcp-server/tools/definitions/gbif-occurrence-facets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  COL_XR_CHECKLIST_KEY,
  type FacetLabelKind,
  IUCN_RED_LIST_CATEGORY_VALUES,
  OCCURRENCE_STATUS_VALUES,
} from '@/services/gbif/types.js';
import { clampReadLimit, readLimitSchema } from '../read-limits.js';
import {
  alpha2CountryCode,
  basisOfRecordFilter,
  countryFilter,
  escapeMarkdownText,
  exactCoordinateMatchNotice,
  isColTaxonKey,
  isGbifUuid,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  occurrenceScopeSchema,
  occurrenceStatusNotice,
  sharedOccurrenceFilterFields,
  taxonKeyFilter,
} from '../utils.js';

const FACET_VALUES = [
  'BASIS_OF_RECORD',
  'COUNTRY',
  'STATE_PROVINCE',
  'YEAR',
  'DATASET_KEY',
  'KINGDOM_KEY',
  'PHYLUM_KEY',
  'CLASS_KEY',
  'ORDER_KEY',
  'FAMILY_KEY',
  'GENUS_KEY',
  'SPECIES_KEY',
  'PUBLISHING_COUNTRY',
  'MONTH',
  'OCCURRENCE_STATUS',
  'IUCN_RED_LIST_CATEGORY',
  'GADM_LEVEL_0_GID',
  'GADM_LEVEL_1_GID',
  'GADM_LEVEL_2_GID',
  'GADM_LEVEL_3_GID',
  'INSTITUTION_CODE',
  'MEDIA_TYPE',
  'RECORDED_BY',
  'PUBLISHING_ORG',
  'TYPE_STATUS',
  'ESTABLISHMENT_MEANS',
  'LICENSE',
] as const;

/**
 * Dimensions whose buckets are keys `includeLabels` can name: registry keys, and the
 * GADM GIDs, which name nothing a caller can read (`ESP.11_1`). The rest are codes or
 * verbatim values that read as they are — country codes, years — and are never looked
 * up. A `taxon` dimension's kind turns `colTaxon` under the Catalogue of Life.
 */
const LABELED_FACETS: Partial<Record<(typeof FACET_VALUES)[number], FacetLabelKind>> = {
  KINGDOM_KEY: 'taxon',
  PHYLUM_KEY: 'taxon',
  CLASS_KEY: 'taxon',
  ORDER_KEY: 'taxon',
  FAMILY_KEY: 'taxon',
  GENUS_KEY: 'taxon',
  SPECIES_KEY: 'taxon',
  DATASET_KEY: 'dataset',
  PUBLISHING_ORG: 'organization',
  GADM_LEVEL_0_GID: 'gadm',
  GADM_LEVEL_1_GID: 'gadm',
  GADM_LEVEL_2_GID: 'gadm',
  GADM_LEVEL_3_GID: 'gadm',
};

/** A backbone taxon key as a facet bucket names it; anything else is not a `/species/{key}` segment. */
const TAXON_KEY = /^\d+$/;

/**
 * A GID as a facet bucket names it: the `gadmGid` alphabet, starting with a letter as
 * every GID does, so no segment is `.` or `..`, which the URL would resolve away.
 */
const GADM_KEY = /^[A-Z][A-Z0-9._]*$/;

/**
 * The tool's half of each label kind; the service's `FACET_LABEL_LOOKUPS` holds the
 * request and the parse. `isKey` admits only bucket names shaped like the kind's
 * keys, because a name becomes a request path segment or parameter and bucket names
 * are upstream text; a name it refuses is never looked up and counts as unlabeled.
 * `lookup` says where an unlabeled bucket's name can be read instead.
 */
const LABEL_KINDS = {
  taxon: {
    isKey: (name) => TAXON_KEY.test(name),
    lookup: 'pass one as taxonKey to gbif_get_species for its name',
  },
  colTaxon: {
    isKey: isColTaxonKey,
    lookup:
      "pass one as checklistTaxonKey, with the same checklistKey, to gbif_search_occurrences, whose rows name each record's taxon",
  },
  dataset: { isKey: isGbifUuid, lookup: 'pass one as datasetKey to gbif_get_dataset for its name' },
  organization: {
    isKey: isGbifUuid,
    lookup:
      'pass one as publishingOrg to gbif_search_datasets, whose rows name it as publishingOrganizationTitle',
  },
  gadm: {
    isKey: (name) => GADM_KEY.test(name),
    lookup:
      'pass one as gadmGid to gbif_search_occurrences and read the gadm field of gbif_get_occurrence on a returned record for its name',
  },
} satisfies Record<FacetLabelKind, { isKey: (name: string) => boolean; lookup: string }>;

/**
 * Total budget for one call's label lookups, queue time included. The facet request
 * before them can take about 49 s at the default 10 s per attempt (four attempts
 * plus backoff), so the two together stay under the 60 s request timeout MCP SDK
 * clients apply.
 */
const LABEL_DEADLINE_MS = 10_000;
const LABEL_DEADLINE_SECONDS = LABEL_DEADLINE_MS / 1000;

/**
 * GBIF's stated facet paging limit: it answers a page reaching past this ranked
 * position — `facetOffset` plus the `facetLimit` sent — with HTTP 400 "Facets paging is
 * only supported up to 1200000 elements", on every scope.
 */
const FACET_PAGING_CEILING = 1_200_000;

/**
 * Undocumented and observed: on a scope ranking more buckets than this, GBIF answers a
 * page reaching past this position with HTTP 404 and an empty body. A scope that ends
 * before it answers a deeper page with 200 and no buckets, so the edge cannot be checked
 * before the request.
 */
const FACET_DEEP_EDGE = 500_001;

export const gbifOccurrenceFacets = tool('gbif_occurrence_facets', {
  title: 'Occurrence Facet Aggregation',
  description:
    'Aggregate occurrence counts across a dimension (COUNTRY, STATE_PROVINCE, YEAR, BASIS_OF_RECORD, DATASET_KEY, KINGDOM_KEY, etc.). Returns one page of facet values ranked by count descending — the top facetLimit at facetOffset 0, a later slice of the same ranking past that. No record payloads returned. Core tool for distribution analysis and trend queries: "which countries have the most records for this species?", "how has observation volume changed since 2010?". Key and GADM dimensions (KINGDOM_KEY through SPECIES_KEY, DATASET_KEY, PUBLISHING_ORG, GADM_LEVEL_0_GID through GADM_LEVEL_3_GID) return bare keys; includeLabels names the taxon, dataset, publishing organization, or administrative area behind each one on the page. Scope the aggregation with taxonKey (or checklistTaxonKey with checklistKey, for a Catalogue of Life key), country (uppercase ISO 3166-1 alpha-2), publishingCountry, stateProvince, gadmGid, year, month or a month range, eventDate (a date or date range), scientificName, latitude/longitude ranges, hasCoordinate, hasGeospatialIssue, isInCluster, coordinateUncertaintyInMeters, elevation and depth ranges, geometry and geoDistance (a radius around a point; all spatial filters intersect), basisOfRecord, datasetKey, publishingOrg, catalogNumber, institutionCode, recordedBy, mediaType, typeStatus, establishmentMeans, license, occurrenceStatus, or iucnRedListCategory filters. country, basisOfRecord, taxonKey, and checklistTaxonKey each take one value or an array: values within one filter are OR-ed, so an array aggregates into one ranking, and different filters still intersect, except that GBIF unions a taxon key with scientificName. Also the way to split a result set too large for gbif_search_occurrences to page (offset+limit caps at 100,001): facet by DATASET_KEY, then search each datasetKey on its own. Aggregates sightings only by default, matching gbif_search_occurrences and gbif_count_occurrences; to measure the presence/absence split itself, pass facet OCCURRENCE_STATUS with occurrenceStatus ANY.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name, which GBIF resolves to its accepted taxon, so a synonym scopes the records of that taxon; a name shared across kingdoms, such as Oenanthe (a bird genus and a plant genus), matches nothing — use taxonKey from gbif_match_species with kingdom set for one. With taxonKey GBIF takes their union (OR), not their intersection, yet a name GBIF cannot resolve (one shared across kingdoms, or one it does not know) empties the combined aggregation, the taxonKey records included. Omit to leave names unfiltered; blank or whitespace-only is rejected.',
      ),
    hasCoordinate: z
      .boolean()
      .optional()
      .describe(
        'True includes records with coordinates; false only records without coordinates. Omit for both.',
      ),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'True includes likely duplicates; false excludes them. Omit to include all records. GBIF exposes membership only, with no cluster identifier.',
      ),
    facet: z
      .enum(FACET_VALUES)
      .describe(
        'Dimension to aggregate by (e.g., COUNTRY, YEAR, BASIS_OF_RECORD, SPECIES_KEY, OCCURRENCE_STATUS, IUCN_RED_LIST_CATEGORY). DATASET_KEY is the first cut when a result set is too large to page: every occurrence carries exactly one datasetKey, so its buckets cover totalOccurrences with no gap or overlap. BASIS_OF_RECORD and PUBLISHING_COUNTRY are gap-free second cuts for a dataset bucket still too large; both have a matching filter on the occurrence tools. A dimension a record can lack drops that record from every bucket: YEAR loses undated records; MONTH, STATE_PROVINCE, SPECIES_KEY, INSTITUTION_CODE, MEDIA_TYPE, RECORDED_BY, TYPE_STATUS, and ESTABLISHMENT_MEANS lose records lacking that dimension; GADM_LEVEL_0_GID, GADM_LEVEL_1_GID, GADM_LEVEL_2_GID, and GADM_LEVEL_3_GID lose records without coordinates or outside every GADM unit at that level — each even where the occurrence tools can filter on it. MEDIA_TYPE and RECORDED_BY buckets also overlap: a record with two media types or two collectors counts in each, so their sums can exceed totalOccurrences. TYPE_STATUS and ESTABLISHMENT_MEANS buckets overlap the same way: a record counts under its concept and every broader one (an Isolectotype also under Lectotype and Type, a nativeReintroduced record also under native). GADM buckets are GIDs to pass back as gadmGid; INSTITUTION_CODE buckets come back lowercased and institutionCode takes them unchanged; RECORDED_BY buckets are the exact spellings recordedBy matches; PUBLISHING_ORG, TYPE_STATUS, ESTABLISHMENT_MEANS, and LICENSE buckets pass back unchanged as publishingOrg, typeStatus, establishmentMeans, and license. OCCURRENCE_STATUS buckets read DETECTED and NOT_DETECTED, the current GBIF names for PRESENT and ABSENT, and pass back unchanged as occurrenceStatus. KINGDOM_KEY through SPECIES_KEY buckets are Backbone keys to pass back as taxonKey. Under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b they are Catalogue of Life keys to pass back as checklistTaxonKey, some all digits (8288, the genus Tringa) yet never Backbone keys. Sums are comparable only across the same occurrenceStatus scope.',
      ),
    taxonKey: taxonKeyFilter()
      .optional()
      .describe(
        'Backbone taxon key to scope the aggregation, or an array of up to 100 keys to aggregate records of any of them into one ranking. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.). Rejected under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b — scope by a Catalogue of Life key with checklistTaxonKey there.',
      ),
    country: countryFilter()
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded, to scope to one country, or an array of codes to aggregate records from any of them into one ranking (["ES", "PT"] ranks both together). Not the publisher\'s country — that is publishingCountry, and the two disagree on most records. Scope to one country, or pass back a value this tool returned under facet COUNTRY to drill into that bucket. Lowercase and alpha-3 forms ("gb", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here, for every member.',
      ),
    publishingCountry: alpha2CountryCode('publishingCountry')
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — not where the occurrence was observed, which is country. Scope to one publisher country, or pass back a value this tool returned under facet PUBLISHING_COUNTRY to drill into that bucket. Lowercase and alpha-3 forms ("us", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
      ),
    stateProvince: z
      .string()
      .optional()
      .describe(
        'State, province, or first-level administrative division, matched as a verbatim string — exact and case-sensitive. Pass back a value this tool returned under facet STATE_PROVINCE rather than a guessed one: GBIF stores what each dataset recorded without normalizing it, so "England", "England - Greater London", and "Greater London" are three distinct values, "england" is none of them, and an unmatched value aggregates zero records rather than erroring. Omit the field to aggregate across every state or province — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered aggregation.',
      ),
    basisOfRecord: basisOfRecordFilter()
      .optional()
      .describe(
        'Scope to a specific basis of record, or to any of an array of them (["PRESERVED_SPECIMEN", "FOSSIL_SPECIMEN"] aggregates both).',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. All supplied spatial filters intersect: decimalLatitude and decimalLongitude remain active and restrict results to the overlap. Omit the field to aggregate everywhere — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered aggregation.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Scope the aggregation to a single dataset by its GBIF dataset UUID (8-4-4-4-12 hex). Obtain one from gbif_search_datasets, gbif_get_dataset, a DATASET_KEY facet, or the datasetKey field on an occurrence record. Omit the field to aggregate across every dataset — an empty string is rejected rather than read as no scope, because GBIF answers a blank datasetKey with the unfiltered aggregation.',
      ),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        'Presence/absence scope. Defaults to PRESENT so the aggregation counts sightings, not the surveys that looked and found nothing, and agrees with gbif_count_occurrences on the same filters. Use ANY for both — required to see both buckets when facet is OCCURRENCE_STATUS — or ABSENT for non-observations alone. DETECTED and NOT_DETECTED, the spelling records and OCCURRENCE_STATUS buckets carry, select the same records as PRESENT and ABSENT and are sent as given.',
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Scope to records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent, NE Not Evaluated. Leave unset and facet on IUCN_RED_LIST_CATEGORY to see the whole distribution instead.',
      ),
    ...sharedOccurrenceFilterFields(),
    facetLimit: readLimitSchema(z.number().int().min(1), 100)
      .default(10)
      .describe('Maximum number of facet values to return (default 10, max 100).'),
    facetOffset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset into the ranked facet values, for paging past the first facetLimit values on high-cardinality dimensions like DATASET_KEY. Advance by facetLimit to fetch the next page (0, then facetLimit, then 2×facetLimit, …). GBIF pages a ranking only so far, and each page also requests the one bucket after it to tell whether more remain: facetOffset + facetLimit may reach 1,199,999 on any scope, past which the call fails as pagination_cap_exceeded before any request, and 500,000 on a scope ranking more than 500,001 buckets, where GBIF refuses a deeper page and the call fails the same way. On that scope, when the next page at the same facetLimit would reach past position 500,001 (the lookahead bucket counts), the notice names the facetLimit that lands the next page exactly on it. To rank buckets past either, narrow the scope with filters and page each narrower scope from 0.',
      ),
    includeLabels: z
      .boolean()
      .default(false)
      .describe(
        `True names what each bucket on the returned page identifies with a label: the canonicalName for a KINGDOM_KEY, PHYLUM_KEY, CLASS_KEY, ORDER_KEY, FAMILY_KEY, GENUS_KEY, or SPECIES_KEY bucket, read from the Catalogue of Life when checklistKey selects it and from the Backbone otherwise; the dataset title for a DATASET_KEY bucket; the organization title for a PUBLISHING_ORG bucket; the administrative area's name for a GADM_LEVEL_0_GID, GADM_LEVEL_1_GID, GADM_LEVEL_2_GID, or GADM_LEVEL_3_GID bucket. Costs one extra GBIF request per bucket, up to facetLimit, all bounded by one ${LABEL_DEADLINE_SECONDS} s deadline; a bucket whose lookup fails, finds no name, or misses the deadline comes back without a label and is counted in notice. The other dimensions are codes or values that read as they are, and it looks nothing up for them. Leave it false when keys are enough, as when partitioning by DATASET_KEY.`,
      ),
  }),
  output: z.object({
    facet: z.string().describe('The facet dimension aggregated.'),
    totalOccurrences: z.number().describe('Total matching occurrences across all facet values.'),
    counts: z
      .array(
        z
          .object({
            name: z.string().describe('Facet value (country code, year, basisOfRecord, etc.).'),
            count: z.number().describe('Occurrence count for this facet value.'),
            label: z
              .string()
              .optional()
              .describe(
                'Name of the taxon (its canonicalName), dataset (its title), publishing organization (its title), or GADM administrative area (its name) the key identifies. Present only with includeLabels on a KINGDOM_KEY through SPECIES_KEY, DATASET_KEY, PUBLISHING_ORG, or GADM_LEVEL_0_GID through GADM_LEVEL_3_GID facet, and only when the lookup for this bucket found a name.',
              ),
          })
          .describe('A facet value with its occurrence count.'),
      )
      .describe(
        'Facet values ranked by count descending — one page of up to facetLimit entries starting at facetOffset, not necessarily the top ones.',
      ),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    scope: occurrenceScopeSchema,
    facetLimit: z.number().describe('Maximum facet values requested.'),
    facetOffset: z.number().describe('Zero-based offset applied to the ranked facet values.'),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'Present and true only when an extra upstream bucket proves another page exists. Absent on the final page, including an exactly full final page.',
      ),
    shown: z
      .number()
      .optional()
      .describe('Facet values returned in this page when the page was capped. Absent otherwise.'),
    cap: z
      .number()
      .optional()
      .describe(
        'facetLimit applied when the page was capped. Re-call with facetOffset advanced by this value to page on, at the facetLimit that notice names when it names one, unless notice says GBIF serves no later page. Absent otherwise.',
      ),
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream, as sent — PRESENT or DETECTED for sightings, ABSENT or NOT_DETECTED for absences, or ANY when no filter was sent. Says what totalOccurrences and every bucket cover.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no facet values were returned, a read limit was clamped, a lookahead bucket proves more remain (naming the facetLimit that lands the next page exactly on position 500,001 when the next page at this facetLimit would reach past it, or that the page reached position 500,001, past which GBIF serves no later page for a scope ranking more buckets), includeLabels left buckets without a label, a scientificName or an exact-match stateProvince, gadmGid, or recordedBy filter matched nothing, a decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters, elevation, or depth without a comma matched only that exact value, or a presence/absence filter narrowed the aggregation. Absent only when none applies.',
      ),
  },

  enrichmentTrailer: { scope: { render: (scope) => `**scope:** ${JSON.stringify(scope)}` } },

  errors: [
    {
      reason: 'pagination_cap_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'facetOffset + facetLimit exceeds 1,199,999, the deepest GBIF pages facets to on any scope (refused before any request), or GBIF answered a page reaching past position 500,001 with an empty HTTP 404, as it does on a scope ranking more buckets than that.',
      recovery:
        'No parameter pages past these ceilings: keep facetOffset + facetLimit at most 1,199,999 on any scope, and at most 500,000 on a scope ranking more than 500,001 buckets (each page also requests the one bucket after it to tell whether more remain). To rank the buckets past either, narrow the scope so its ranking is shorter and page each narrower scope from facetOffset 0, repeating the other filters of this call on each: taxonKey of a class or order from gbif_match_species (checklistTaxonKey under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b) splits a GENUS_KEY or SPECIES_KEY ranking cleanly, since each genus and species sits under one, while country, year as a "min,max" range, basisOfRecord, or a datasetKey from a DATASET_KEY facet narrow any ranking, though one bucket can then recur in several parts, so merge the parts by bucket name.',
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A string scope filter other than country and publishingCountry, or a checklistTaxonKey member, was supplied blank or whitespace-only (a blank country or publishingCountry fails earlier, at its uppercase pattern, as -32602 invalid_arguments), decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters, elevation, depth, year, month, or eventDate is a bare "*", coordinateUncertaintyInMeters, year, month, elevation, or depth has whitespace between a "*" end and the comma, geoDistance is not latitude,longitude,distance with the distance in a lowercase km or m unit, datasetKey or publishingOrg is not an 8-4-4-4-12 hex UUID, gadmGid holds a character other than an uppercase letter, digit, dot, or underscore, a checklistTaxonKey key holds a character other than an uppercase letter or digit, taxonKey was supplied under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b or checklistTaxonKey without it, typeStatus or establishmentMeans names no concept in its GBIF vocabulary, a two-letter country or publishingCountry code is one GBIF does not know, or GBIF rejected another filter as malformed.',
      recovery:
        'The message names the rejected value. A blank scope filter is not a way to skip one — omit the field instead. Otherwise correct that one filter: geometry is a closed WKT ring in longitude latitude order, geoDistance is latitude,longitude,distance with the distance ending in km or m ("38.17,-3.95,25km"), year, month, and eventDate are a single value or "min,max", where "*" may stand for an open end ("*,1990", "2020,*", written with no whitespace between the "*" and the comma) but never for the whole value, the coordinate ranges are "min,max" (a value without a comma matches only that exact value), and so are elevation and depth, datasetKey is a UUID from gbif_search_datasets, publishingOrg is an organization UUID from gbif_search_publishers, gadmGid is an uppercase GADM GID such as ESP.1_1 from a GADM_LEVEL_0_GID through GADM_LEVEL_3_GID facet or the gadm field of gbif_get_occurrence, taxonKey takes a Backbone key and checklistTaxonKey a Catalogue of Life key such as 3WSJV from gbif_match_species, the second only with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b and the first only without it, typeStatus and establishmentMeans take a concept the message lists or a TYPE_STATUS or ESTABLISHMENT_MEANS bucket, and country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet.',
    },
  ],

  async handler(input, ctx) {
    const clamp = clampReadLimit(
      input.facetLimit,
      100,
      'gbif_occurrence_facets',
      'facetLimit',
      ctx,
    );
    input = { ...input, facetLimit: clamp.applied };
    ctx.log.info('Fetching occurrence facets', { facet: input.facet, taxonKey: input.taxonKey });

    // The deepest ranked position the request asks for: this page and its lookahead bucket.
    const reach = input.facetOffset + input.facetLimit + 1;
    if (reach > FACET_PAGING_CEILING) {
      throw ctx.fail(
        'pagination_cap_exceeded',
        `facetOffset + facetLimit (${input.facetOffset + input.facetLimit}) exceeds ${(FACET_PAGING_CEILING - 1).toLocaleString('en-US')}: GBIF pages facet buckets only through position ${FACET_PAGING_CEILING.toLocaleString('en-US')} on any scope, and each page also requests the one bucket after it to tell whether more remain.`,
      );
    }

    const violation = occurrenceFilterViolation(input);
    if (violation) throw ctx.fail('invalid_filter', violation);

    const { facet, facetLimit, facetOffset, includeLabels, ...filters } = input;
    const service = getGbifService();
    const facetKind = includeLabels ? LABELED_FACETS[facet] : undefined;
    // The checklist says whose key a taxon bucket is, never its shape: 8288 is a COL genus and a Backbone family.
    const labelKind =
      facetKind === 'taxon' && input.checklistKey === COL_XR_CHECKLIST_KEY ? 'colTaxon' : facetKind;
    // An unreachable label route is refused before the aggregation request is spent.
    if (labelKind) service.facetLabelRoot(labelKind);
    const raw = await service
      .getOccurrenceFacets(
        { ...occurrenceFilters(filters), facet, facetLimit: facetLimit + 1, facetOffset },
        ctx,
      )
      .catch((err: unknown) => {
        // GBIF's refusal past the edge; an empty 404 on a page inside it is not a paging cap.
        const emptyNotFound =
          err instanceof McpError &&
          err.data?.status === 404 &&
          typeof err.data.body === 'string' &&
          err.data.body.trim() === '';
        if (emptyNotFound && reach > FACET_DEEP_EDGE) {
          throw ctx.fail(
            'pagination_cap_exceeded',
            `GBIF answered facetOffset ${facetOffset} with facetLimit ${facetLimit} with an empty HTTP 404: it serves no facet bucket past position ${FACET_DEEP_EDGE.toLocaleString('en-US')} on a scope ranking more buckets than that, and this page, with the one bucket after it requested to tell whether more remain, reaches position ${reach.toLocaleString('en-US')}. Keep facetOffset + facetLimit at most ${(FACET_DEEP_EDGE - 1).toLocaleString('en-US')} on this scope.`,
            undefined,
            { cause: err },
          );
        }
        throw err;
      });

    const facetData = raw.facets?.find((f) => f.field?.toUpperCase() === input.facet.toUpperCase());
    const buckets = facetData?.counts ?? [];
    const page = buckets.slice(0, input.facetLimit).map((c) => ({
      name: c.name ?? '',
      count: c.count ?? 0,
    }));

    // Labels cover the exposed page only — never the lookahead bucket.
    const labels =
      labelKind &&
      (await service.getFacetLabels(
        {
          kind: labelKind,
          keys: page.map((c) => c.name).filter(LABEL_KINDS[labelKind].isKey),
          deadlineMs: LABEL_DEADLINE_MS,
        },
        ctx,
      ));
    const counts = page.map((c) => {
      const label = labels?.get(c.name);
      return label === undefined ? c : { ...c, label };
    });
    const unlabeled = labels ? counts.filter((c) => !('label' in c)).length : 0;

    ctx.enrich({
      facetLimit: input.facetLimit,
      facetOffset: input.facetOffset,
      occurrenceStatus: input.occurrenceStatus,
      scope: occurrenceScope(input),
    });

    // One lookahead bucket proves continuation without advancing past an unexposed value.
    // Compose notices once: truncated guidance and notice share a last-wins key.
    const hasMore = buckets.length > input.facetLimit;
    const nextOffset = input.facetOffset + counts.length;
    // The next page, lookahead included, lands on the edge at most; at this facetLimit it may cross it.
    const nextLimit = Math.min(input.facetLimit, FACET_DEEP_EDGE - 1 - nextOffset);
    const notice = [
      clamp.notice,
      counts.length === 0
        ? input.facetOffset > 0
          ? `No facet values returned at facetOffset ${input.facetOffset}. Reset facetOffset to 0 or reduce it to revisit earlier pages.`
          : (raw.count ?? 0) === 0
            ? 'No facet values returned. The filter combination matched zero occurrences.'
            : 'No facet values returned. The facet dimension has no data for the given scope.'
        : undefined,
      hasMore
        ? reach === FACET_DEEP_EDGE
          ? `Showing ${counts.length} facet values; more remain, but GBIF serves no facet bucket past position ${FACET_DEEP_EDGE.toLocaleString('en-US')} on a scope ranking more than that, and this page with its lookahead bucket reaches it, so no later page can be fetched. To rank the rest, narrow the scope with filters (taxonKey of a class or order, or checklistTaxonKey under the Catalogue of Life checklistKey; country; year; a datasetKey from a DATASET_KEY facet) and page each narrower scope from facetOffset 0.`
          : nextLimit < input.facetLimit
            ? `Showing ${counts.length} facet values; more remain. Re-call with facetOffset ${nextOffset} and facetLimit ${nextLimit} for the next page: GBIF serves no facet bucket past position ${FACET_DEEP_EDGE.toLocaleString('en-US')} on a scope ranking more than that, and a larger page there reaches past it.`
            : `Showing ${counts.length} facet values; more remain. Re-call with facetOffset ${nextOffset} for the next page.`
        : undefined,
      labelKind && unlabeled > 0
        ? `${unlabeled} of ${counts.length} buckets carry no label: the name lookup for each failed, found no name, or did not finish within the ${LABEL_DEADLINE_SECONDS} s label deadline. The keys are exact; ${LABEL_KINDS[labelKind].lookup}.`
        : undefined,
      ...occurrenceNoMatchNotices(input, raw.count ?? 0),
      exactCoordinateMatchNotice(input),
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
    if (hasMore) {
      // `notice` always carries at least the continuation sentence on this branch.
      ctx.enrich.truncated({
        shown: counts.length,
        cap: input.facetLimit,
        guidance: notice,
      });
    } else if (notice) {
      ctx.enrich.notice(notice);
    }

    return {
      facet: input.facet,
      totalOccurrences: raw.count ?? 0,
      counts,
    };
  },

  format: (result) => {
    /**
     * The values rendered here are the top `facetLimit` only when `facetOffset` is 0 —
     * past that they are a later slice of the same ranking. `format()` receives `output`
     * alone, so the offset is not in scope; the header states what it can vouch for and
     * the facetOffset enrichment field below it fixes the page's position in the ranking.
     */
    const lines: string[] = [
      `## ${result.facet} Facet`,
      `**Total occurrences in scope:** ${result.totalOccurrences}`,
      result.counts.length === 0
        ? '**No facet values in this page.**'
        : `**Facet values in this page, ranked by count (${result.counts.length}, starting at facetOffset):**`,
    ];
    const total = result.totalOccurrences || 1;
    for (const entry of result.counts) {
      const pct = ((entry.count / total) * 100).toFixed(1);
      const label = entry.label === undefined ? '' : ` — ${escapeMarkdownText(entry.label)}`;
      lines.push(`- **${entry.name}**${label}: ${entry.count.toLocaleString()} (${pct}% of total)`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
