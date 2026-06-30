/**
 * @fileoverview Aggregate GBIF occurrence counts by a facet dimension.
 * @module mcp-server/tools/definitions/gbif-occurrence-facets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

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
] as const;

export const gbifOccurrenceFacets = tool('gbif_occurrence_facets', {
  title: 'Occurrence Facet Aggregation',
  description:
    'Aggregate occurrence counts across a dimension (COUNTRY, STATE_PROVINCE, YEAR, BASIS_OF_RECORD, DATASET_KEY, ' +
    'KINGDOM_KEY, etc.). Returns the top-N facet values ranked by count — no record payloads returned. ' +
    'Core tool for distribution analysis and trend queries: "which countries have the most records ' +
    'for this species?", "how has observation volume changed since 2010?". ' +
    'Scope the aggregation with taxonKey, country, year, geometry, basisOfRecord, or datasetKey filters.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    facet: z
      .enum(FACET_VALUES)
      .describe('Dimension to aggregate by (e.g., COUNTRY, YEAR, BASIS_OF_RECORD, SPECIES_KEY).'),
    taxonKey: z
      .number()
      .optional()
      .describe(
        'Backbone taxon key to scope the aggregation. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    country: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code to scope to one country.'),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range (e.g., "2020,2024") to scope the aggregation. Both endpoints inclusive.',
      ),
    basisOfRecord: z
      .enum(BASIS_OF_RECORD_VALUES)
      .optional()
      .describe('Scope to a specific basis of record.'),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon to scope the aggregation to a geographic area (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Scope the aggregation to a single dataset by its GBIF dataset UUID. Obtain one from gbif_search_datasets, gbif_get_dataset, a DATASET_KEY facet, or the datasetKey field on an occurrence record.',
      ),
    facetLimit: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe('Maximum number of facet values to return (default 10, max 100).'),
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
      .describe('Facet values ranked by count descending (top facetLimit entries).'),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    facetLimit: z.number().describe('Maximum facet values requested.'),
    notice: z
      .string()
      .optional()
      .describe('Guidance when no facet values were returned. Absent when counts are non-empty.'),
  },

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence facets', { facet: input.facet, taxonKey: input.taxonKey });
    const raw = await getGbifService().getOccurrenceFacets(
      {
        facet: input.facet,
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.year?.trim() && { year: input.year }),
        ...(input.basisOfRecord && { basisOfRecord: input.basisOfRecord }),
        ...(input.geometry?.trim() && { geometry: input.geometry }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        facetLimit: input.facetLimit,
      },
      ctx,
    );

    const facetData = raw.facets?.find((f) => f.field?.toUpperCase() === input.facet.toUpperCase());
    const counts = (facetData?.counts ?? []).map((c) => ({
      name: c.name ?? '',
      count: c.count ?? 0,
    }));

    ctx.enrich({ facetLimit: input.facetLimit });
    if (counts.length === 0) {
      ctx.enrich.notice(
        'No facet values returned. The filter combination may match zero occurrences, or the facet dimension has no data for the given scope.',
      );
    }

    return {
      facet: input.facet,
      totalOccurrences: raw.count ?? 0,
      counts,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `## ${result.facet} Facet`,
      `**Total occurrences in scope:** ${result.totalOccurrences}`,
      `**Top ${result.counts.length} values:**`,
    ];
    const total = result.totalOccurrences || 1;
    for (const entry of result.counts) {
      const pct = ((entry.count / total) * 100).toFixed(1);
      lines.push(`- **${entry.name}**: ${entry.count.toLocaleString()} (${pct}% of total)`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
