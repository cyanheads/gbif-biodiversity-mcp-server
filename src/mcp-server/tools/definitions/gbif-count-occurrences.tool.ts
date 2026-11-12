/**
 * @fileoverview Count GBIF occurrences matching a filter without fetching records.
 * @module mcp-server/tools/definitions/gbif-count-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  BASIS_OF_RECORD_VALUES,
  IUCN_RED_LIST_CATEGORY_VALUES,
  OCCURRENCE_STATUS_VALUES,
} from '@/services/gbif/types.js';
import {
  exactCoordinateMatchNotice,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  occurrenceScopeSchema,
  occurrenceStatusNotice,
  overPaginationCapNotice,
  sharedOccurrenceFilterFields,
} from '../utils.js';

export const gbifCountOccurrences = tool('gbif_count_occurrences', {
  title: 'Count Occurrences',
  description:
    'Count occurrences matching a taxon + location filter without fetching records. Use for quick totals ("how many Aves records in Sweden?") or before deciding whether to paginate a full search. Accepts taxonKey (or checklistTaxonKey with checklistKey, for a Catalogue of Life key), country (uppercase ISO 3166-1 alpha-2), publishingCountry, stateProvince, gadmGid, scientificName, spatial ranges and geometry (intersected), month, basisOfRecord, hasCoordinate (alias isGeoreferenced), hasGeospatialIssue, isInCluster, coordinateUncertaintyInMeters, datasetKey, publishingOrg, year, catalogNumber, institutionCode, recordedBy, mediaType, typeStatus, establishmentMeans, license, occurrenceStatus, and iucnRedListCategory. Counts sightings only by default, matching gbif_search_occurrences — GBIF also indexes absence records, and for some taxa they are the overwhelming majority. A count above 100,001 is the signal to partition rather than page: gbif_search_occurrences cannot reach past that offset, so split the query by DATASET_KEY via gbif_occurrence_facets and search each dataset separately.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name, which GBIF resolves to its accepted taxon, so a synonym counts the records of that taxon; a name shared across kingdoms, such as Oenanthe (a bird genus and a plant genus), counts zero — use taxonKey from gbif_match_species with kingdom set for one. With taxonKey GBIF takes their union (OR), not their intersection. Omit to leave names unfiltered; blank or whitespace-only is rejected.',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon in longitude latitude order. All supplied spatial filters intersect: decimalLatitude and decimalLongitude remain active and restrict results to the overlap. Omit to leave geometry unfiltered; blank or whitespace-only is rejected.',
      ),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Calendar month (1–12), matching the occurrence search filter.'),
    basisOfRecord: z
      .enum(BASIS_OF_RECORD_VALUES)
      .optional()
      .describe(
        'Filter by how the occurrence was recorded; accepts every GBIF BasisOfRecord vocabulary member.',
      ),
    hasCoordinate: z
      .boolean()
      .optional()
      .describe(
        'True counts records with coordinates; false counts only records without coordinates. Omit for both. Alias isGeoreferenced may be supplied alone or with the same value; conflicts fail as invalid_filter.',
      ),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'True counts likely duplicates; false excludes them. Omit to include all records. GBIF exposes membership only, with no cluster identifier.',
      ),
    taxonKey: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.). Rejected under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b — pass a Catalogue of Life key as checklistTaxonKey there.',
      ),
    country: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'country must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("gb"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded (e.g., "GB", "US"). Not the publisher\'s country — that is publishingCountry, and the two disagree on most records. Lowercase and alpha-3 forms ("gb", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here. Take a value from a COUNTRY facet on gbif_occurrence_facets; an uppercase pair GBIF does not know ("XX") is rejected upstream by name.',
      ),
    publishingCountry: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'publishingCountry must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("us"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — distinct from where the occurrence was observed, which is country. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets. Lowercase and alpha-3 forms ("us", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
      ),
    stateProvince: z
      .string()
      .optional()
      .describe(
        'State, province, or first-level administrative division, matched as a verbatim string — exact and case-sensitive. GBIF stores what each dataset recorded without normalizing it, so there is no vocabulary to guess from: "England", "England - Greater London", and "Greater London" are three distinct values, and "england" is none of them. Take one from a STATE_PROVINCE facet on gbif_occurrence_facets scoped the same way and pass it back unchanged — an unmatched value counts zero rather than erroring. Omit the field to count across every state or province — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered total.',
      ),
    isGeoreferenced: z
      .boolean()
      .optional()
      .describe(
        'Alias for hasCoordinate. True counts only georeferenced records; false only non-georeferenced records. Supplying both requires equal values.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Filter to a specific dataset UUID (8-4-4-4-12 hex) from gbif_search_datasets. Omit the field to count across every dataset — an empty string is rejected rather than read as no filter, because GBIF answers a blank datasetKey with the unfiltered total. The result is not the recordCount the dataset tools and the gbif://dataset/{datasetKey} resource report for the same key: that figure spans every occurrenceStatus, while this count applies occurrenceStatus below, PRESENT by default.',
      ),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range (e.g., "2024" or "2020,2024"). Both endpoints inclusive. Omit the field to count across every year — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered total.',
      ),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        "Presence/absence filter. Defaults to PRESENT: an ABSENT record documents a survey that looked for the taxon and did not find it, so counting one inflates the total with the opposite of a sighting. Use ANY for both (GBIF's own default), or ABSENT for non-observations alone. DETECTED and NOT_DETECTED, the spelling records and OCCURRENCE_STATUS facet buckets carry, select the same records as PRESENT and ABSENT and are sent as given. Matches the gbif_search_occurrences default, so the two tools agree.",
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Count only records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Records with no category are excluded when this is set.',
      ),
    ...sharedOccurrenceFilterFields(),
  }),
  output: z.object({
    count: z.number().describe('Total occurrences matching the supplied filters.'),
  }),

  // States which presence/absence filter produced the count — reaches both surfaces.
  enrichment: {
    scope: occurrenceScopeSchema,
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream, as sent — PRESENT or DETECTED for sightings, ABSENT or NOT_DETECTED for absences, or ANY when no filter was sent. Says what the count covers.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when the count is zero under an exact-match stateProvince, gadmGid, or recordedBy filter, a decimalLatitude, decimalLongitude, or coordinateUncertaintyInMeters without a comma matched only that exact value, the count is larger than gbif_search_occurrences can page to, or a presence/absence filter narrowed it. Absent when none applies.',
      ),
  },

  enrichmentTrailer: { scope: { render: (scope) => `**scope:** ${JSON.stringify(scope)}` } },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A string filter other than country and publishingCountry was supplied blank or whitespace-only (a blank country or publishingCountry fails earlier, at its uppercase pattern, as -32602 invalid_arguments), hasCoordinate conflicts with isGeoreferenced, decimalLatitude, decimalLongitude, or coordinateUncertaintyInMeters is a bare "*", datasetKey or publishingOrg is not an 8-4-4-4-12 hex UUID, gadmGid holds a character other than an uppercase letter, digit, dot, or underscore, checklistTaxonKey holds a character other than an uppercase letter or digit, taxonKey was supplied under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b or checklistTaxonKey without it, typeStatus or establishmentMeans names no concept in its GBIF vocabulary, a two-letter country or publishingCountry code is one GBIF does not know, or GBIF rejected another filter value as malformed.',
      recovery:
        'A blank filter is not a way to skip one — omit the field instead. Supply hasCoordinate or its alias isGeoreferenced alone, or both with equal values. Otherwise correct the named filter: geometry is a closed WKT ring in longitude latitude order, ranges are "min,max", datasetKey is a UUID from gbif_search_datasets, publishingOrg is an organization UUID from gbif_search_publishers, gadmGid is an uppercase GADM GID such as ESP.1_1 from a GADM_LEVEL_0_GID through GADM_LEVEL_3_GID facet or the gadm field of gbif_get_occurrence, taxonKey takes a Backbone key and checklistTaxonKey a Catalogue of Life key such as 3WSJV from gbif_match_species, the second only with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b and the first only without it, typeStatus and establishmentMeans take a concept the message lists, and country and publishingCountry come from COUNTRY or PUBLISHING_COUNTRY facets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Counting occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
    });

    const violation = occurrenceFilterViolation(input);
    if (violation) throw ctx.fail('invalid_filter', violation);

    if (
      input.hasCoordinate !== undefined &&
      input.isGeoreferenced !== undefined &&
      input.hasCoordinate !== input.isGeoreferenced
    ) {
      throw ctx.fail(
        'invalid_filter',
        'hasCoordinate and isGeoreferenced conflict. Supply one or give both the same value.',
      );
    }
    const { isGeoreferenced, ...supplied } = input;
    const filters = { ...supplied, hasCoordinate: supplied.hasCoordinate ?? isGeoreferenced };
    const count = await getGbifService().countOccurrences(occurrenceFilters(filters), ctx);

    ctx.enrich({ occurrenceStatus: input.occurrenceStatus, scope: occurrenceScope(filters) });
    const notice = [
      ...occurrenceNoMatchNotices(input, count),
      exactCoordinateMatchNotice(input),
      overPaginationCapNotice(count),
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
    if (notice) ctx.enrich.notice(notice);

    return { count };
  },

  format: (result) => [{ type: 'text', text: `**Occurrence count:** ${result.count}` }],
});
