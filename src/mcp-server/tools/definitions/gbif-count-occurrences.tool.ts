/**
 * @fileoverview Count GBIF occurrences matching a filter without fetching records.
 * @module mcp-server/tools/definitions/gbif-count-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifCountOccurrences = tool('gbif_count_occurrences', {
  title: 'Count Occurrences',
  description:
    'Count occurrences matching a taxon + location filter without fetching records. ' +
    'Use for quick totals ("how many Aves records in Sweden?") or before deciding whether ' +
    'to paginate a full search. Accepts taxonKey, country, isGeoreferenced, datasetKey, and year.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    country: z.string().optional().describe('ISO 3166-1 alpha-2 country code (e.g., "GB", "US").'),
    isGeoreferenced: z
      .boolean()
      .optional()
      .describe(
        'When true, count only georeferenced records. When false, count only non-georeferenced records.',
      ),
    datasetKey: z.string().optional().describe('Filter to a specific dataset UUID.'),
    year: z
      .string()
      .optional()
      .describe('Year or year range (e.g., "2024" or "2020,2024"). Both endpoints inclusive.'),
  }),
  output: z.object({
    count: z.number().describe('Total occurrences matching the supplied filters.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('Counting occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
    });
    const count = await getGbifService().countOccurrences(
      {
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.isGeoreferenced !== undefined && { isGeoreferenced: input.isGeoreferenced }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        ...(input.year?.trim() && { year: input.year }),
      },
      ctx,
    );
    return { count };
  },

  format: (result) => [{ type: 'text', text: `**Occurrence count:** ${result.count}` }],
});
