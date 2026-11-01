/**
 * @fileoverview Aggregate GBIF occurrence counts by a facet dimension.
 * @module mcp-server/tools/definitions/gbif-occurrence-facets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  BASIS_OF_RECORD_VALUES,
  type FacetLabelKind,
  IUCN_RED_LIST_CATEGORY_VALUES,
  OCCURRENCE_STATUS_VALUES,
} from '@/services/gbif/types.js';
import { clampReadLimit, readLimitSchema } from '../read-limits.js';
import {
  escapeMarkdownText,
  isGbifUuid,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  occurrenceScopeSchema,
  occurrenceStatusNotice,
  sharedOccurrenceFilterFields,
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
] as const;

/**
 * Dimensions whose buckets are registry keys `includeLabels` can name. The rest are
 * codes or verbatim values that read as they are — country codes, years, GADM GIDs —
 * and are never looked up.
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
};

/** A backbone taxon key as a facet bucket names it; anything else is not a `/species/{key}` segment. */
const TAXON_KEY = /^\d+$/;

/**
 * Total budget for one call's label lookups, queue time included. The facet request
 * before them can take about 49 s at the default 10 s per attempt (four attempts
 * plus backoff), so the two together stay under the 60 s request timeout MCP SDK
 * clients apply.
 */
const LABEL_DEADLINE_MS = 10_000;
const LABEL_DEADLINE_SECONDS = LABEL_DEADLINE_MS / 1000;

export const gbifOccurrenceFacets = tool('gbif_occurrence_facets', {
  title: 'Occurrence Facet Aggregation',
  description:
    'Aggregate occurrence counts across a dimension (COUNTRY, STATE_PROVINCE, YEAR, BASIS_OF_RECORD, DATASET_KEY, ' +
    'KINGDOM_KEY, etc.). Returns one page of facet values ranked by count descending — the top ' +
    'facetLimit at facetOffset 0, a later slice of the same ranking past that. No record payloads returned. ' +
    'Core tool for distribution analysis and trend queries: "which countries have the most records ' +
    'for this species?", "how has observation volume changed since 2010?". ' +
    'Key dimensions (KINGDOM_KEY through SPECIES_KEY, DATASET_KEY) return bare keys; includeLabels names the taxon or dataset behind each one on the page. ' +
    'Scope the aggregation with taxonKey, country (uppercase ISO 3166-1 alpha-2), ' +
    'publishingCountry, stateProvince, gadmGid, year, scientificName, latitude/longitude ranges, month, hasCoordinate, isInCluster, coordinateUncertaintyInMeters, geometry (all spatial filters intersect), basisOfRecord, datasetKey, catalogNumber, institutionCode, recordedBy, mediaType, ' +
    'occurrenceStatus, or iucnRedListCategory filters. Also the way to split a result set too ' +
    'large for gbif_search_occurrences to page (offset+limit caps at 100,001): facet by ' +
    'DATASET_KEY, then search each datasetKey on its own. Aggregates sightings only by default, ' +
    'matching gbif_search_occurrences and gbif_count_occurrences; to measure the presence/absence ' +
    'split itself, pass facet OCCURRENCE_STATUS with occurrenceStatus ANY.',
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
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Calendar month (1–12), matching the occurrence search filter.'),
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
    coordinateUncertaintyInMeters: z
      .string()
      .optional()
      .describe(
        'Coordinate uncertainty radius in meters, e.g. "0,1000"; range endpoints inclusive. Omit for any uncertainty; blank or whitespace-only is rejected.',
      ),
    facet: z
      .enum(FACET_VALUES)
      .describe(
        'Dimension to aggregate by (e.g., COUNTRY, YEAR, BASIS_OF_RECORD, SPECIES_KEY, OCCURRENCE_STATUS, IUCN_RED_LIST_CATEGORY). DATASET_KEY is the first cut when a result set is too large to page: every occurrence carries exactly one datasetKey, so its buckets cover totalOccurrences with no gap or overlap. BASIS_OF_RECORD and PUBLISHING_COUNTRY are gap-free second cuts for a dataset bucket still too large; both have a matching filter on the occurrence tools. A dimension a record can lack drops that record from every bucket: YEAR loses undated records; MONTH, STATE_PROVINCE, SPECIES_KEY, INSTITUTION_CODE, MEDIA_TYPE, and RECORDED_BY lose records lacking that dimension; GADM_LEVEL_0_GID, GADM_LEVEL_1_GID, GADM_LEVEL_2_GID, and GADM_LEVEL_3_GID lose records without coordinates or outside every GADM unit at that level — each even where the occurrence tools can filter on it. MEDIA_TYPE and RECORDED_BY buckets also overlap: a record with two media types or two collectors counts in each, so their sums can exceed totalOccurrences. GADM buckets are GIDs to pass back as gadmGid; INSTITUTION_CODE buckets come back lowercased and institutionCode takes them unchanged; RECORDED_BY buckets are the exact spellings recordedBy matches. Sums are comparable only across the same occurrenceStatus scope.',
      ),
    taxonKey: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'Backbone taxon key to scope the aggregation. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    country: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'country must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("gb"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded, to scope to one country. Not the publisher\'s country — that is publishingCountry, and the two disagree on most records. Scope to one country, or pass back a value this tool returned under facet COUNTRY to drill into that bucket. Lowercase and alpha-3 forms ("gb", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
      ),
    publishingCountry: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'publishingCountry must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("us"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
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
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range (e.g., "2020,2024") to scope the aggregation. Both endpoints inclusive. Omit the field to aggregate across every year — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered aggregation.',
      ),
    basisOfRecord: z
      .enum(BASIS_OF_RECORD_VALUES)
      .optional()
      .describe('Scope to a specific basis of record.'),
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
        'Presence/absence scope. Defaults to PRESENT so the aggregation counts sightings, not the surveys that looked and found nothing, and agrees with gbif_count_occurrences on the same filters. Use ANY for both — required to see both buckets when facet is OCCURRENCE_STATUS — or ABSENT for non-observations alone.',
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Scope to records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Leave unset and facet on IUCN_RED_LIST_CATEGORY to see the whole distribution instead.',
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
        'Zero-based offset into the ranked facet values, for paging past the first facetLimit values on high-cardinality dimensions like DATASET_KEY. Advance by facetLimit to fetch the next page (0, then facetLimit, then 2×facetLimit, …).',
      ),
    includeLabels: z
      .boolean()
      .default(false)
      .describe(
        `True names the taxon or dataset behind each bucket on the returned page with a label: the canonicalName for a KINGDOM_KEY, PHYLUM_KEY, CLASS_KEY, ORDER_KEY, FAMILY_KEY, GENUS_KEY, or SPECIES_KEY bucket, the dataset title for a DATASET_KEY bucket. Costs one extra GBIF request per bucket, up to facetLimit, all bounded by one ${LABEL_DEADLINE_SECONDS} s deadline; a bucket whose lookup fails or misses it comes back without a label and is counted in notice. Every other dimension ignores it. Leave it false when keys are enough, as when partitioning by DATASET_KEY.`,
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
                'Name of the taxon (its canonicalName) or dataset (its title) the key identifies. Present only with includeLabels on a KINGDOM_KEY through SPECIES_KEY or DATASET_KEY facet, and only when the lookup for this bucket succeeded.',
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
        'facetLimit applied when the page was capped. Re-call with facetOffset advanced by this value to page on. Absent otherwise.',
      ),
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream — PRESENT, ABSENT, or ANY when no filter was sent. Says what totalOccurrences and every bucket cover.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no facet values were returned, a read limit was clamped, a lookahead bucket proves more remain, includeLabels left buckets without a label, an exact-match stateProvince, gadmGid, or recordedBy filter matched nothing, or a presence/absence filter narrowed the aggregation. Absent only when none applies.',
      ),
  },

  enrichmentTrailer: { scope: { render: (scope) => `**scope:** ${JSON.stringify(scope)}` } },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A string scope filter other than country and publishingCountry was supplied blank or whitespace-only (a blank country or publishingCountry fails earlier, at its uppercase pattern, as -32602 invalid_arguments), datasetKey is not an 8-4-4-4-12 hex UUID, gadmGid holds a character other than an uppercase letter, digit, dot, or underscore, a two-letter country or publishingCountry code is one GBIF does not know, or GBIF rejected another filter as malformed.',
      recovery:
        'The message names the rejected value. A blank scope filter is not a way to skip one — omit the field instead. Otherwise correct that one filter: geometry is a closed WKT ring in longitude latitude order, year is a single year or "min,max", datasetKey is a UUID from gbif_search_datasets, gadmGid is an uppercase GADM GID such as ESP.1_1 from a GADM_LEVEL_0_GID through GADM_LEVEL_3_GID facet or the gadm field of gbif_get_occurrence, and country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet.',
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
    const violation = occurrenceFilterViolation(input);
    if (violation) throw ctx.fail('invalid_filter', violation);

    const { facet, facetLimit, facetOffset, includeLabels, ...filters } = input;
    const service = getGbifService();
    const raw = await service.getOccurrenceFacets(
      { ...occurrenceFilters(filters), facet, facetLimit: facetLimit + 1, facetOffset },
      ctx,
    );

    const facetData = raw.facets?.find((f) => f.field?.toUpperCase() === input.facet.toUpperCase());
    const buckets = facetData?.counts ?? [];
    const page = buckets.slice(0, input.facetLimit).map((c) => ({
      name: c.name ?? '',
      count: c.count ?? 0,
    }));

    // Labels cover the exposed page only — never the lookahead bucket.
    const labelKind = includeLabels ? LABELED_FACETS[facet] : undefined;
    const labels =
      labelKind &&
      (await service.getFacetLabels(
        {
          kind: labelKind,
          keys: page
            .map((c) => c.name)
            .filter((name) => (labelKind === 'taxon' ? TAXON_KEY.test(name) : isGbifUuid(name))),
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
        ? `Showing ${counts.length} facet values; more remain. Re-call with facetOffset ${input.facetOffset + counts.length} for the next page.`
        : undefined,
      unlabeled > 0
        ? `${unlabeled} of ${counts.length} buckets carry no label: the name lookup for each failed, found no name, or did not finish within the ${LABEL_DEADLINE_SECONDS} s label deadline. The keys are exact; pass one as ${labelKind === 'taxon' ? 'taxonKey to gbif_get_species' : 'datasetKey to gbif_get_dataset'} for its name.`
        : undefined,
      ...occurrenceNoMatchNotices(input, raw.count ?? 0),
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
