/**
 * @fileoverview Return the full parent chain for a GBIF taxon.
 * @module mcp-server/tools/definitions/gbif-get-species-classification
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifGetSpeciesClassification = tool('gbif_get_species_classification', {
  title: 'Get Species Classification',
  description:
    'Return the complete parent chain for a taxon — from kingdom (or domain) down to the taxon ' +
    'itself — as an ordered array. Each entry has its rank, canonical name, and taxon key. ' +
    'The array is returned root-first (kingdom → phylum → class → … → parent of given taxon). ' +
    'Useful for building taxonomic trees or understanding placement without navigating the backbone level-by-level.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    taxonKey: z
      .number()
      .describe('GBIF backbone taxon key from gbif_match_species or another taxonomy tool.'),
  }),
  output: z.object({
    classification: z
      .array(
        z
          .object({
            key: z.number().optional().describe('Backbone taxon key for this rank.'),
            rank: z.string().optional().describe('Taxonomic rank (KINGDOM, PHYLUM, CLASS, etc.).'),
            name: z.string().optional().describe('Canonical name at this rank.'),
            scientificName: z.string().optional().describe('Full scientific name with authorship.'),
          })
          .describe('A single rank entry in the classification chain.'),
      )
      .describe(
        'Classification chain ordered from root (kingdom) to the immediate parent of the queried taxon.',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The taxonKey does not exist in the GBIF backbone.',
      recovery: 'Use gbif_match_species to resolve a name to a valid backbone taxon key.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching species classification', { taxonKey: input.taxonKey });
    const raw = await getGbifService().getSpeciesParents(input.taxonKey, ctx);

    if (!Array.isArray(raw)) {
      throw ctx.fail('not_found', `Taxon key ${input.taxonKey} not found in the GBIF backbone.`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    // GBIF /species/{key}/parents returns [] for both nonexistent keys and kingdom-level taxa.
    // When empty, verify the taxon exists to distinguish the two cases.
    if (raw.length === 0) {
      try {
        await getGbifService().getSpecies(input.taxonKey, ctx);
      } catch (err) {
        if (err instanceof McpError && err.code === -32001) {
          throw ctx.fail(
            'not_found',
            `Taxon key ${input.taxonKey} not found in the GBIF backbone.`,
            { ...ctx.recoveryFor('not_found') },
          );
        }
        throw err;
      }
    }

    const classification = raw.map((node) => ({
      key: node.key,
      rank: node.rank,
      name: node.canonicalName,
      scientificName: node.scientificName,
    }));

    return { classification };
  },

  format: (result) => {
    const lines: string[] = [`**Classification chain** (${result.classification.length} ranks):\n`];
    result.classification.forEach((node, i) => {
      const indent = '  '.repeat(i);
      const name = node.name ?? 'Unknown';
      const rank = node.rank ?? '';
      const key = node.key != null ? ` (key: ${node.key})` : '';
      const sci =
        node.scientificName && node.scientificName !== name ? ` [${node.scientificName}]` : '';
      lines.push(`${indent}${rank}: **${name}**${sci}${key}`);
    });
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
