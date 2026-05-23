/**
 * @fileoverview Search or browse the GBIF backbone taxonomy.
 * @module mcp-server/tools/definitions/gbif-search-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifSearchSpecies = tool('gbif_search_species', {
  title: 'Search Species Taxonomy',
  description:
    'Search or browse the GBIF backbone taxonomy. Accepts scientific name fragments, rank filters, ' +
    'and higher-taxon constraints. Useful for exploring what species exist under a higher taxon ' +
    '(e.g., "list all families of Coleoptera"), for simple name-fragment searches, or when ' +
    'gbif_match_species returns too narrow a result. Paginated — use limit and offset to walk through results.',
  annotations: { readOnlyHint: true },
  input: z.object({
    q: z
      .string()
      .optional()
      .describe('Name fragment to search for. Matches scientific and vernacular names.'),
    rank: z
      .enum(['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY', 'GENUS', 'SPECIES', 'SUBSPECIES'])
      .optional()
      .describe('Filter to a specific taxonomic rank.'),
    kingdom: z
      .string()
      .optional()
      .describe('Scope search to a kingdom (e.g., "Animalia", "Plantae").'),
    family: z.string().optional().describe('Scope search to a family name.'),
    genus: z.string().optional().describe('Scope search to a genus name.'),
    isExtinct: z.boolean().optional().describe('Filter to extinct (true) or extant (false) taxa.'),
    datasetKey: z
      .string()
      .optional()
      .describe('Scope to a specific checklist dataset UUID. Omit to search the GBIF backbone.'),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of records to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    taxa: z
      .array(
        z.object({
          key: z.number().optional().describe('GBIF backbone taxon key.'),
          scientificName: z.string().optional().describe('Full scientific name with authorship.'),
          canonicalName: z.string().optional().describe('Scientific name without authorship.'),
          rank: z.string().optional().describe('Taxonomic rank.'),
          taxonomicStatus: z.string().optional().describe('ACCEPTED, SYNONYM, DOUBTFUL, etc.'),
          kingdom: z.string().optional().describe('Kingdom classification.'),
          phylum: z.string().optional().describe('Phylum classification.'),
          class: z.string().optional().describe('Class classification.'),
          order: z.string().optional().describe('Order classification.'),
          family: z.string().optional().describe('Family classification.'),
          genus: z.string().optional().describe('Genus classification.'),
          vernacularName: z.string().optional().describe('Common name when available.'),
          numOccurrences: z.number().optional().describe('Occurrence record count in GBIF.'),
          numDescendants: z.number().optional().describe('Count of child taxa in the backbone.'),
          extinct: z.boolean().optional().describe('True when explicitly flagged as extinct.'),
        }),
      )
      .describe('Matching taxa.'),
    totalCount: z.number().describe('Total matches before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('Searching species taxonomy', { q: input.q, rank: input.rank });
    const raw = await getGbifService().searchSpecies(
      {
        ...(input.q?.trim() && { q: input.q }),
        ...(input.rank && { rank: input.rank }),
        ...(input.kingdom?.trim() && { kingdom: input.kingdom }),
        ...(input.family?.trim() && { family: input.family }),
        ...(input.genus?.trim() && { genus: input.genus }),
        ...(input.isExtinct !== undefined && { isExtinct: input.isExtinct }),
        ...(input.datasetKey?.trim() && { datasetKey: input.datasetKey }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const taxa = (raw.results ?? []).map((r) => ({
      key: r.key,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.rank,
      taxonomicStatus: r.taxonomicStatus,
      kingdom: r.kingdom,
      phylum: r.phylum,
      class: r.clazz,
      order: r.order,
      family: r.family,
      genus: r.genus,
      vernacularName: r.vernacularName,
      numOccurrences: r.numOccurrences,
      numDescendants: r.numDescendants,
      ...(typeof r.extinct === 'boolean' && { extinct: r.extinct }),
    }));

    return {
      taxa,
      totalCount: raw.count ?? 0,
      offset: raw.offset ?? input.offset,
      limit: raw.limit ?? input.limit,
      endOfRecords: raw.endOfRecords ?? true,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `**Total matches:** ${result.totalCount} | **Showing:** ${result.taxa.length} | **Limit:** ${result.limit} | **End of records:** ${result.endOfRecords} (offset ${result.offset})`,
    ];
    for (const t of result.taxa) {
      const name = t.canonicalName ?? 'Unknown';
      const sci = t.scientificName && t.scientificName !== name ? ` [${t.scientificName}]` : '';
      lines.push(`\n## ${name}${sci}`);
      if (t.key != null) lines.push(`**Taxon key:** ${t.key}`);
      if (t.rank) lines.push(`**Rank:** ${t.rank}`);
      if (t.taxonomicStatus) lines.push(`**Status:** ${t.taxonomicStatus}`);
      if (t.vernacularName) lines.push(`**Common name:** ${t.vernacularName}`);
      const classificationParts: string[] = [];
      if (t.kingdom) classificationParts.push(`Kingdom: ${t.kingdom}`);
      if (t.phylum) classificationParts.push(`Phylum: ${t.phylum}`);
      if (t.class) classificationParts.push(`Class: ${t.class}`);
      if (t.order) classificationParts.push(`Order: ${t.order}`);
      if (t.family) classificationParts.push(`Family: ${t.family}`);
      if (t.genus) classificationParts.push(`Genus: ${t.genus}`);
      if (classificationParts.length > 0)
        lines.push(`**Classification:** ${classificationParts.join(' › ')}`);
      if (t.numOccurrences != null) lines.push(`**Occurrences:** ${t.numOccurrences}`);
      if (t.numDescendants != null) lines.push(`**Descendants:** ${t.numDescendants}`);
      if (typeof t.extinct === 'boolean') lines.push(`**Extinct:** ${t.extinct ? 'Yes' : 'No'}`);
    }
    if (!result.endOfRecords) {
      lines.push(
        `\n*More results available — use offset ${result.offset + result.limit} to continue.*`,
      );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
