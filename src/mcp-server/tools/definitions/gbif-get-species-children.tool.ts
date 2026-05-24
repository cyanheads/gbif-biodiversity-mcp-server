/**
 * @fileoverview List direct children of a backbone taxon.
 * @module mcp-server/tools/definitions/gbif-get-species-children
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

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
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
  }),

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

    return {
      children,
      offset: raw.offset ?? input.offset,
      limit: raw.limit ?? input.limit,
      endOfRecords: raw.endOfRecords ?? true,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `**Showing:** ${result.children.length} | **Limit:** ${result.limit} | **End of records:** ${result.endOfRecords} (offset ${result.offset})`,
    ];
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
    if (!result.endOfRecords) {
      lines.push(
        `\n*More results available — use offset ${result.offset + result.limit} to continue.*`,
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
