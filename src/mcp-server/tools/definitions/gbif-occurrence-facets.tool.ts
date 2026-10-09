/**
 * @fileoverview Aggregate GBIF occurrence counts by a facet dimension.
 * @module mcp-server/tools/definitions/gbif-occurrence-facets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { IUCN_RED_LIST_CATEGORY_VALUES, OCCURRENCE_STATUS_VALUES } from '@/services/gbif/types.js';
import {
  firstBlankFilter,
  isGbifUuid,
  occurrenceStatusNotice,
  stateProvinceNoMatchNotice,
} from '../utils.js';

const BASIS_OF_RECORD_VALUES = [
  'HUMAN_OBSERVATION',
  'MACHINE_OBSERVATION',
  'PRESERVED_SPECIMEN',
  'LIVING_SPECIMEN',
  'MATERIAL_SAMPLE',
  'MATERIAL_CITATION',
  'OCCURRENCE',
  'LITERATURE',
] as const;

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
] as const;

export const gbifOccurrenceFacets = tool('gbif_occurrence_facets', {
  title: 'Occurrence Facet Aggregation',
  description:
    'Aggregate occurrence counts across a dimension (COUNTRY, STATE_PROVINCE, YEAR, BASIS_OF_RECORD, DATASET_KEY, ' +
    'KINGDOM_KEY, etc.). Returns one page of facet values ranked by count descending — the top ' +
    'facetLimit at facetOffset 0, a later slice of the same ranking past that. No record payloads returned. ' +
    'Core tool for distribution analysis and trend queries: "which countries have the most records ' +
    'for this species?", "how has observation volume changed since 2010?". ' +
    'Scope the aggregation with taxonKey, country (uppercase ISO 3166-1 alpha-2), ' +
    'publishingCountry, stateProvince, year, ' +
    'geometry, basisOfRecord, datasetKey, ' +
    'occurrenceStatus, or iucnRedListCategory filters. Also the way to split a result set too ' +
    'large for gbif_search_occurrences to page (offset+limit caps at 100,001): facet by ' +
    'DATASET_KEY, then search each datasetKey on its own. Aggregates sightings only by default, ' +
    'matching gbif_search_occurrences and gbif_count_occurrences; to measure the presence/absence ' +
    'split itself, pass facet OCCURRENCE_STATUS with occurrenceStatus ANY.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    facet: z
      .enum(FACET_VALUES)
      .describe(
        "Dimension to aggregate by (e.g., COUNTRY, YEAR, BASIS_OF_RECORD, SPECIES_KEY, OCCURRENCE_STATUS, IUCN_RED_LIST_CATEGORY). DATASET_KEY is the dimension to split on when a result set is too large to page: every occurrence carries exactly one datasetKey, so its buckets sum to totalOccurrences with no gap and no overlap, and it has the cardinality to cut a large scope into pageable pieces. BASIS_OF_RECORD and PUBLISHING_COUNTRY are gap-free too and both have a matching filter on the occurrence tools, so either can drive a further split of a bucket still too large — but on that same scope they return 9 and 41 buckets against DATASET_KEY's 550, so neither replaces it as the first cut. A dimension a record can lack silently drops that record: faceting one 60,290,950-record scope by YEAR returned 224 buckets summing to 59,407,400, leaving 883,550 undated records in no bucket at all, and MONTH, STATE_PROVINCE, and SPECIES_KEY lose records the same way — stateProvince included, even though the occurrence tools can now filter on it. Sums are comparable only across the same occurrenceStatus scope.",
      ),
    taxonKey: z
      .number()
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
        'WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Omit the field to aggregate everywhere — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered aggregation.',
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
    facetLimit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe('Maximum number of facet values to return (default 10, max 100).'),
    facetOffset: z
      .number()
      .min(0)
      .default(0)
      .describe(
        'Zero-based offset into the ranked facet values, for paging past the first facetLimit values on high-cardinality dimensions like DATASET_KEY. Advance by facetLimit to fetch the next page (0, then facetLimit, then 2×facetLimit, …).',
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
          })
          .describe('A facet value with its occurrence count.'),
      )
      .describe(
        'Facet values ranked by count descending — one page of up to facetLimit entries starting at facetOffset, not necessarily the top ones.',
      ),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    facetLimit: z.number().describe('Maximum facet values requested.'),
    facetOffset: z.number().describe('Zero-based offset applied to the ranked facet values.'),
    truncated: z
      .boolean()
      .optional()
      .describe(
        'Heuristic continuation flag: present and true when this page returned a full facetLimit of values, so more distinct values may exist past facetOffset + facetLimit. GBIF exposes no total distinct-value count, so this is an estimate, not exact. Absent when the page came back short, which is the only proof the ranking is exhausted.',
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
        'Guidance when no facet values were returned, the page came back full and more values may remain, a verbatim stateProvince filter matched nothing, or a presence/absence filter narrowed the aggregation. Absent only when none applies.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A scope filter was supplied blank or whitespace-only, datasetKey is not an 8-4-4-4-12 hex UUID, a two-letter country or publishingCountry code is one GBIF does not know, or GBIF rejected the geometry or year scope as malformed.',
      recovery:
        'The message names the rejected value. A blank scope filter is not a way to skip one — omit the field instead. Otherwise correct that one filter: geometry is a closed WKT ring in longitude latitude order, year is a single year or "min,max", datasetKey is a UUID from gbif_search_datasets, and country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence facets', { facet: input.facet, taxonKey: input.taxonKey });
    /**
     * Every string scope filter this tool forwards, checked on presence rather than
     * on a non-blank value. `/occurrence/search` ignores a parameter it is given with
     * no value and answers the unfiltered aggregation, so the `?.trim()` spread these
     * fields used to sit behind partitioned a wider scope than the caller asked
     * about: `stateProvince: ""` aggregates all 60,290,950 records of a
     * `taxonKey=212` + `country=GB` scope where `England` aggregates 47,672,439, and
     * a whitespace-only value does the same. Buckets hide the substitution better
     * than a record list does — nothing in them says which scope they cover.
     */
    const blankFilter = firstBlankFilter({
      stateProvince: input.stateProvince,
      year: input.year,
      geometry: input.geometry,
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
     * so a `?.trim()` guard dropped the scope and aggregated all 2,351,689,943 records
     * under taxonKey 212 for a caller who believed the buckets covered one dataset.
     * Letter case stays unchecked: this route resolves a key either way, unlike
     * `/dataset/search`'s two organization filters.
     */
    if (input.datasetKey !== undefined && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
      );
    }

    const raw = await getGbifService().getOccurrenceFacets(
      {
        facet: input.facet,
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country && { country: input.country }),
        ...(input.publishingCountry && { publishingCountry: input.publishingCountry }),
        ...(input.stateProvince !== undefined && { stateProvince: input.stateProvince }),
        ...(input.year !== undefined && { year: input.year }),
        ...(input.basisOfRecord && { basisOfRecord: input.basisOfRecord }),
        ...(input.geometry !== undefined && { geometry: input.geometry }),
        ...(input.datasetKey !== undefined && { datasetKey: input.datasetKey }),
        ...(input.occurrenceStatus !== 'ANY' && { occurrenceStatus: input.occurrenceStatus }),
        ...(input.iucnRedListCategory && { iucnRedListCategory: input.iucnRedListCategory }),
        facetLimit: input.facetLimit,
        facetOffset: input.facetOffset,
      },
      ctx,
    );

    const facetData = raw.facets?.find((f) => f.field?.toUpperCase() === input.facet.toUpperCase());
    const counts = (facetData?.counts ?? []).map((c) => ({
      name: c.name ?? '',
      count: c.count ?? 0,
    }));

    ctx.enrich({
      facetLimit: input.facetLimit,
      facetOffset: input.facetOffset,
      occurrenceStatus: input.occurrenceStatus,
    });

    /**
     * A full page is the only continuation signal this endpoint offers: GBIF reports no
     * total distinct-value count for a facet, so "more may exist" cannot be sharpened to
     * "N remain". Composed into the notice rather than passed as `truncated({ guidance })`
     * because `guidance` and `ctx.enrich.notice` write the same key on a last-wins basis —
     * one write keeps the ordering of the two calls from deciding what the agent reads.
     */
    const pageIsFull = counts.length >= input.facetLimit;
    const notice = [
      counts.length === 0
        ? 'No facet values returned. The filter combination may match zero occurrences, or the facet dimension has no data for the given scope.'
        : undefined,
      pageIsFull
        ? `Returned a full page of ${counts.length} facet values, so more may exist past this slice of the ranking — re-call with facetOffset ${input.facetOffset + counts.length} for the next page. GBIF publishes no total distinct-value count, so a full page is an estimate of continuation, not proof of it.`
        : undefined,
      stateProvinceNoMatchNotice(input.stateProvince, raw.count ?? 0),
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
    if (pageIsFull) {
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
      lines.push(`- **${entry.name}**: ${entry.count.toLocaleString()} (${pct}% of total)`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
