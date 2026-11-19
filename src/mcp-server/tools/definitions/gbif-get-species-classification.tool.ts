/**
 * @fileoverview Return the full parent chain for a GBIF taxon.
 * @module mcp-server/tools/definitions/gbif-get-species-classification
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawParentNode } from '@/services/gbif/types.js';

export const gbifGetSpeciesClassification = tool('gbif_get_species_classification', {
  title: 'Get Species Classification',
  description:
    "Return the parent chain for a taxon — from kingdom (or domain) down to the immediate parent of the queried taxon — as an ordered array. Each entry has its rank, canonical name, taxon usage key, checklist, and backbone mapping. The array is returned root-first (kingdom → phylum → class → … → immediate parent of the queried taxon); the queried taxon itself is not included — call gbif_get_species for its own record. The chain is read in the queried taxon's own checklist: datasetKey names it, each key is a taxon usage key there, and nubKey is the mapped backbone key the occurrence tools take, absent where the backbone has no mapping. Useful for building taxonomic trees or understanding placement without walking the checklist level by level.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    // 0 is the backbone kingdom incertae sedis; no negative key names a taxon.
    taxonKey: z
      .number()
      .int()
      .nonnegative()
      .describe(
        'GBIF taxon key: a backbone key from gbif_match_species, or a taxon usage key of any checklist, such as key from gbif_search_species.',
      ),
  }),
  output: z.object({
    classification: z
      .array(
        z
          .object({
            key: z
              .number()
              .optional()
              .describe(
                'Taxon usage key within the source checklist; not necessarily a backbone key.',
              ),
            datasetKey: z
              .string()
              .optional()
              .describe('Source checklist dataset UUID, when GBIF supplies it.'),
            nubKey: z
              .number()
              .optional()
              .describe(
                'Mapped backbone taxon key for occurrence queries, when GBIF supplies it. Otherwise resolve the name with gbif_match_species.',
              ),
            rank: z.string().optional().describe('Taxonomic rank (KINGDOM, PHYLUM, CLASS, etc.).'),
            name: z.string().optional().describe('Canonical name at this rank.'),
            scientificName: z.string().optional().describe('Full scientific name with authorship.'),
          })
          .describe('A single rank entry in the classification chain.'),
      )
      .describe(
        'Classification chain ordered from root (kingdom) to the immediate parent of the queried taxon. ' +
          'The queried taxon itself is not included — call gbif_get_species for its own record.',
      ),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when the chain is empty because the taxon sits at the root of its checklist. Absent when the chain has entries.',
      ),
  },

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No GBIF checklist has a taxon usage with this taxonKey.',
      recovery: 'Use gbif_match_species to resolve a name to a valid backbone taxon key.',
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'GBIF rejected the taxonKey as unparseable — a value outside the 32-bit signed integer range.',
      recovery:
        'GBIF taxon keys fit in a 32-bit signed integer; take one from gbif_match_species or gbif_search_species rather than constructing it.',
      thrownBy: 'service',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching species classification', { taxonKey: input.taxonKey });
    const notFoundMessage = `Taxon key ${input.taxonKey} not found in GBIF: no checklist has a taxon usage with that key.`;

    let raw: RawParentNode[];
    try {
      raw = await getGbifService().getSpeciesParents(input.taxonKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('not_found', notFoundMessage);
      }
      throw err;
    }

    if (!Array.isArray(raw)) {
      throw ctx.fail('not_found', notFoundMessage);
    }

    // GBIF /species/{key}/parents returns [] for both nonexistent keys and kingdom-level taxa.
    // When empty, verify the taxon exists to distinguish the two cases.
    if (raw.length === 0) {
      try {
        await getGbifService().getSpecies(input.taxonKey, ctx);
      } catch (err) {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw ctx.fail('not_found', notFoundMessage);
        }
        throw err;
      }
      // The existence check passed, so an empty chain is the correct answer for a root
      // taxon (issue #7) — say so, rather than returning a bare [] that reads the same
      // as a lookup that found nothing.
      ctx.enrich.notice(
        `Taxon ${input.taxonKey} sits at the root of its checklist and has no parent ranks, so the chain is empty rather than missing. Use gbif_get_species for its own record, or gbif_get_species_children to walk downward.`,
      );
    }

    const classification = raw.map((node) => ({
      key: node.key,
      // As GBIF sends them: an unmapped usage has no nubKey, and none is inferred from key.
      datasetKey: node.datasetKey,
      nubKey: node.nubKey,
      rank: node.rank,
      name: node.canonicalName,
      scientificName: node.scientificName,
    }));

    return { classification };
  },

  format: (result) => {
    const lines: string[] = [`**Classification chain** (${result.classification.length} ranks):\n`];
    for (const [i, node] of result.classification.entries()) {
      const indent = '  '.repeat(i);
      const name = node.name ?? 'Unknown';
      const rank = node.rank ?? '';
      // Keys tested with `!= null`, never truthiness: key 0 is the backbone kingdom incertae sedis.
      const keys = [
        node.key != null && `Taxon usage key: ${node.key}`,
        node.datasetKey != null && `Dataset key: ${node.datasetKey}`,
        node.nubKey != null && `Backbone key: ${node.nubKey}`,
      ].filter(Boolean);
      const ids = keys.length > 0 ? ` (${keys.join(' · ')})` : '';
      const sci =
        node.scientificName && node.scientificName !== name ? ` [${node.scientificName}]` : '';
      lines.push(`${indent}${rank}: **${name}**${sci}${ids}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
