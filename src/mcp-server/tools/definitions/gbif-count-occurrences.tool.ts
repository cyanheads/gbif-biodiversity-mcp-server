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
  firstBlankFilter,
  isGbifUuid,
  occurrenceScope,
  occurrenceScopeSchema,
  occurrenceStatusNotice,
  overPaginationCapNotice,
  stateProvinceNoMatchNotice,
} from '../utils.js';

export const gbifCountOccurrences = tool('gbif_count_occurrences', {
  title: 'Count Occurrences',
  description:
    'Count occurrences matching a taxon + location filter without fetching records. ' +
    'Use for quick totals ("how many Aves records in Sweden?") or before deciding whether ' +
    'to paginate a full search. Accepts taxonKey, country (uppercase ISO 3166-1 alpha-2), ' +
    'publishingCountry, stateProvince, scientificName, spatial ranges and geometry (intersected), month, basisOfRecord, hasCoordinate (alias isGeoreferenced), isInCluster, coordinateUncertaintyInMeters, datasetKey, year, ' +
    'occurrenceStatus, and iucnRedListCategory. Counts sightings only by default, matching ' +
    'gbif_search_occurrences — GBIF also indexes absence records, and for some taxa they are ' +
    'the overwhelming majority. A count above 100,001 is the signal to partition rather than ' +
    'page: gbif_search_occurrences cannot reach past that offset, so split the query by ' +
    'DATASET_KEY via gbif_occurrence_facets and search each dataset separately.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name; does not match synonyms. With taxonKey GBIF takes their union (OR), not their intersection. Omit to leave names unfiltered; blank or whitespace-only is rejected.',
      ),
    decimalLatitude: z
      .string()
      .optional()
      .describe(
        'Latitude or latitude range "min,max" in decimal degrees (WGS84). All supplied spatial filters intersect, including geometry. Omit to leave latitude unbounded; blank or whitespace-only is rejected.',
      ),
    decimalLongitude: z
      .string()
      .optional()
      .describe(
        'Longitude or longitude range "min,max" in decimal degrees (WGS84). All supplied spatial filters intersect, including geometry. Omit to leave longitude unbounded; blank or whitespace-only is rejected.',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon in longitude latitude order. All supplied spatial filters intersect: decimalLatitude and decimalLongitude remain active and restrict results to the overlap. Omit to leave geometry unfiltered; blank or whitespace-only is rejected.',
      ),
    month: z
      .number()
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
    coordinateUncertaintyInMeters: z
      .string()
      .optional()
      .describe(
        'Coordinate uncertainty radius in meters, e.g. "0,1000"; range endpoints inclusive. Omit for any uncertainty; blank or whitespace-only is rejected.',
      ),
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
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
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — not where the occurrence was observed, which is country. The two differ constantly: of 60,290,950 records observed in GB, 1,548,928 were published by US organizations. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets. Lowercase and alpha-3 forms ("us", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
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
        "Presence/absence filter. Defaults to PRESENT: an ABSENT record documents a survey that looked for the taxon and did not find it, so counting one inflates the total with the opposite of a sighting. Use ANY for both (GBIF's own default), or ABSENT for non-observations alone. Matches the gbif_search_occurrences default, so the two tools agree.",
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Count only records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Records with no category are excluded when this is set.',
      ),
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
        'The presence/absence filter applied upstream — PRESENT, ABSENT, or ANY when no filter was sent. Says what the count covers.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when the count is zero under a verbatim stateProvince filter, larger than gbif_search_occurrences can page to, or narrowed by a presence/absence filter. Absent when none applies.',
      ),
  },

  enrichmentTrailer: { scope: { render: (scope) => `**scope:** ${JSON.stringify(scope)}` } },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A filter was supplied blank or whitespace-only, hasCoordinate conflicts with isGeoreferenced, datasetKey is not an 8-4-4-4-12 hex UUID, a two-letter country or publishingCountry code is one GBIF does not know, or GBIF rejected another filter value as malformed.',
      recovery:
        'A blank filter is not a way to skip one — omit the field instead. Supply hasCoordinate or its alias isGeoreferenced alone, or both with equal values. Otherwise correct the named filter: geometry is a closed WKT ring in longitude latitude order, ranges are "min,max", datasetKey is a UUID from gbif_search_datasets, and country and publishingCountry come from COUNTRY or PUBLISHING_COUNTRY facets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Counting occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
    });

    /**
     * String filters are checked on presence rather than on a
     * non-blank value. `/occurrence/search` ignores a parameter it is given with no
     * value and answers the unfiltered total, so the `?.trim()` spread these fields
     * used to sit behind widened the count and reported it as the caller's own:
     * `stateProvince: ""` counts all 60,290,950 records of a `taxonKey=212` +
     * `country=GB` scope where `England` counts 47,672,439, and a whitespace-only
     * value does the same. A count is the whole output here, so nothing else in the
     * response contradicts the wrong figure.
     */
    const blankFilter = firstBlankFilter({
      scientificName: input.scientificName,
      decimalLatitude: input.decimalLatitude,
      decimalLongitude: input.decimalLongitude,
      geometry: input.geometry,
      coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
      stateProvince: input.stateProvince,
      year: input.year,
    });
    if (blankFilter) {
      throw ctx.fail(
        'invalid_filter',
        `${blankFilter} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }

    /**
     * Checked whenever datasetKey is present, not only when it is non-blank. A
     * malformed key is rejected locally so the failure carries this tool's recovery
     * hint instead of a bare upstream 400 that costs a round trip and the retry
     * budget. The empty string is rejected for the opposite reason: it draws no error
     * at all — `/occurrence/search?datasetKey=` answers 200 with the unfiltered scope,
     * so a `?.trim()` guard dropped the filter and returned all 2,351,689,943 records
     * under taxonKey 212 to a caller who believed the count was scoped to one dataset.
     * Letter case stays unchecked: this route resolves a key either way, unlike
     * `/dataset/search`'s two organization filters.
     */
    if (input.datasetKey !== undefined && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
      );
    }

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
    const hasCoordinate = input.hasCoordinate ?? input.isGeoreferenced;
    const scope = occurrenceScope({
      ...input,
      hasCoordinate,
    });
    const count = await getGbifService().countOccurrences(
      {
        ...(input.scientificName !== undefined && { scientificName: input.scientificName }),
        ...(input.decimalLatitude !== undefined && { decimalLatitude: input.decimalLatitude }),
        ...(input.decimalLongitude !== undefined && { decimalLongitude: input.decimalLongitude }),
        ...(input.geometry !== undefined && { geometry: input.geometry }),
        ...(input.month !== undefined && { month: input.month }),
        ...(input.basisOfRecord !== undefined && { basisOfRecord: input.basisOfRecord }),
        ...(hasCoordinate !== undefined && { hasCoordinate }),
        ...(input.isInCluster !== undefined && { isInCluster: input.isInCluster }),
        ...(input.coordinateUncertaintyInMeters !== undefined && {
          coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
        }),
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country && { country: input.country }),
        ...(input.publishingCountry && { publishingCountry: input.publishingCountry }),
        ...(input.stateProvince !== undefined && { stateProvince: input.stateProvince }),
        ...(input.datasetKey !== undefined && { datasetKey: input.datasetKey }),
        ...(input.year !== undefined && { year: input.year }),
        ...(input.occurrenceStatus !== 'ANY' && { occurrenceStatus: input.occurrenceStatus }),
        ...(input.iucnRedListCategory && { iucnRedListCategory: input.iucnRedListCategory }),
      },
      ctx,
    );

    ctx.enrich({ occurrenceStatus: input.occurrenceStatus, scope });
    const notice = [
      stateProvinceNoMatchNotice(input.stateProvince, count),
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
