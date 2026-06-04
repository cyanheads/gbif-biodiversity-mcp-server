/**
 * @fileoverview List direct children of a backbone taxon.
 * @module mcp-server/tools/definitions/gbif-get-species-children
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Pagination guidance when end of records is reached. */
function buildNotice(args: { childCount: number; endOfRecords: boolean }): string | undefined {
  const { childCount, endOfRecords } = args;
  if (childCount === 0 && endOfRecords) {
    return 'This taxon has no direct children in the GBIF backbone at this rank.';
  }
  return;
}

export const gbifGetSpeciesChildren = tool('gbif_get_species_children', {
  title: 'Get Species Children',
  description:
    'List direct children of a backbone taxon — genera within a family, species within a genus, ' +
    'subspecies within a species. Paginated. Use gbif_match_species to get the taxonKey first, ' +
    'then iterate with offset for large groups.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    taxonKey: z
      .number()
      .describe('GBIF backbone taxon key from gbif_match_species or another taxonomy tool.'),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of children to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    children: z
      .array(
        z
          .object({
            key: z.number().optional().describe('GBIF backbone taxon key.'),
            scientificName: z.string().optional().describe('Full scientific name with authorship.'),
            canonicalName: z.string().optional().describe('Scientific name without authorship.'),
            rank: z.string().optional().describe('Taxonomic rank.'),
            taxonomicStatus: z.string().optional().describe('ACCEPTED, SYNONYM, DOUBTFUL, etc.'),
            vernacularName: z.string().optional().describe('Common name when available.'),
            numOccurrences: z.number().optional().describe('Occurrence record count.'),
            numDescendants: z.number().optional().describe('Count of child taxa under this node.'),
          })
          .describe('A direct child taxon with key, name, rank, and status.'),
      )
      .describe('Direct child taxa.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when no children are found for a valid taxon. Absent on successful result pages.',
      ),
  },

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The taxonKey does not exist in the GBIF backbone.',
      recovery: 'Use gbif_match_species to resolve a name to a valid backbone taxon key.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching species children', { taxonKey: input.taxonKey });
    const raw = await getGbifService().getSpeciesChildren(
      input.taxonKey,
      { limit: input.limit, offset: input.offset },
      ctx,
    );

    const children = (raw.results ?? []).map((r) => ({
      key: r.key,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.rank,
      taxonomicStatus: r.taxonomicStatus,
      vernacularName: r.vernacularName,
      numOccurrences: r.numOccurrences,
      numDescendants: r.numDescendants,
    }));

    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    // GBIF /species/{key}/children returns [] for both nonexistent keys and taxa with no children.
    // When empty and end of records, verify the taxon exists to distinguish the two cases.
    if (children.length === 0 && endOfRecords) {
      try {
        await getGbifService().getSpecies(input.taxonKey, ctx);
      } catch (err) {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail(
            'not_found',
            `Taxon key ${input.taxonKey} not found in the GBIF backbone.`,
            { ...ctx.recoveryFor('not_found') },
          );
        }
        throw err;
      }
    }

    ctx.enrich({ offset, limit, endOfRecords });
    const notice = buildNotice({ childCount: children.length, endOfRecords });
    if (notice) ctx.enrich.notice(notice);

    return { children };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.children.length}`];
    for (const child of result.children) {
      const name = child.canonicalName ?? 'Unknown';
      const sci =
        child.scientificName && child.scientificName !== name ? ` [${child.scientificName}]` : '';
      lines.push(`\n- **${name}**${sci}`);
      if (child.key != null) lines.push(`  Key: ${child.key}`);
      if (child.rank) lines.push(`  Rank: ${child.rank}`);
      if (child.taxonomicStatus) lines.push(`  Status: ${child.taxonomicStatus}`);
      if (child.vernacularName) lines.push(`  Common name: ${child.vernacularName}`);
      if (child.numOccurrences != null) lines.push(`  Occurrences: ${child.numOccurrences}`);
      if (child.numDescendants != null) lines.push(`  Descendants: ${child.numDescendants}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
