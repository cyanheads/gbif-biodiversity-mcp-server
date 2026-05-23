/**
 * @fileoverview Match a species name against the GBIF backbone taxonomy.
 * @module mcp-server/tools/definitions/gbif-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifMatchSpecies = tool('gbif_match_species', {
  title: 'Match Species Name',
  description:
    'Match a species name (scientific or common) against the GBIF backbone taxonomy. ' +
    'Returns the best-matching taxon with full classification and a confidence score (0–100). ' +
    'This is the mandatory first step for any GBIF workflow — it resolves synonyms and returns ' +
    'the backbone taxonKey required by gbif_search_occurrences, gbif_count_occurrences, and ' +
    'gbif_occurrence_facets. Below confidence 80, the match should be reviewed. ' +
    'matchType NONE means no usable match was found — try removing the strict flag or broadening the name.',
  annotations: { readOnlyHint: true, openWorldHint: false },
  input: z.object({
    name: z
      .string()
      .describe(
        'Scientific or common name to match. Examples: "Parus major", "Great Tit", "Homo sapiens". Fuzzy matching handles minor typos.',
      ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        'When true, only return an exact match. When false (default), GBIF applies fuzzy matching — useful for misspellings and vernacular names.',
      ),
    kingdom: z
      .string()
      .optional()
      .describe(
        'Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms.',
      ),
    rank: z
      .enum(['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY', 'GENUS', 'SPECIES', 'SUBSPECIES'])
      .optional()
      .describe(
        'Expected taxonomic rank. Use to avoid matching a genus when you expect a species.',
      ),
  }),
  output: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key. Use this in downstream tools. Absent when matchType is NONE.',
      ),
    scientificName: z.string().optional().describe('Full scientific name with authorship.'),
    canonicalName: z.string().optional().describe('Scientific name without authorship.'),
    rank: z.string().optional().describe('Taxonomic rank of the matched taxon.'),
    status: z.string().optional().describe('Taxonomic status: ACCEPTED, SYNONYM, or DOUBTFUL.'),
    confidence: z
      .number()
      .optional()
      .describe('Match confidence score 0–100. Below 80 warrants review.'),
    matchType: z
      .string()
      .optional()
      .describe('EXACT, FUZZY, HIGHERORDER, or NONE. NONE means no usable match.'),
    kingdom: z.string().optional().describe('Kingdom of the matched taxon.'),
    phylum: z.string().optional().describe('Phylum of the matched taxon.'),
    class: z.string().optional().describe('Class of the matched taxon.'),
    order: z.string().optional().describe('Order of the matched taxon.'),
    family: z.string().optional().describe('Family of the matched taxon.'),
    genus: z.string().optional().describe('Genus of the matched taxon.'),
    species: z.string().optional().describe('Species canonical name of the matched taxon.'),
    kingdomKey: z.number().optional().describe('Backbone taxon key for the kingdom.'),
    phylumKey: z.number().optional().describe('Backbone taxon key for the phylum.'),
    classKey: z.number().optional().describe('Backbone taxon key for the class.'),
    orderKey: z.number().optional().describe('Backbone taxon key for the order.'),
    familyKey: z.number().optional().describe('Backbone taxon key for the family.'),
    genusKey: z.number().optional().describe('Backbone taxon key for the genus.'),
    speciesKey: z.number().optional().describe('Backbone taxon key for the species.'),
  }),

  errors: [
    {
      reason: 'no_match',
      code: JsonRpcErrorCode.NotFound,
      when: 'matchType is NONE — no candidate met the match threshold.',
      recovery:
        'Try a broader name, remove the strict flag, or search with gbif_search_species instead.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Matching species name', { name: input.name, strict: input.strict });
    const raw = await getGbifService().matchSpecies(
      {
        name: input.name,
        ...(input.strict !== undefined && { strict: input.strict }),
        ...(input.kingdom?.trim() && { kingdom: input.kingdom }),
        ...(input.rank && { rank: input.rank }),
      },
      ctx,
    );

    if (raw.matchType === 'NONE' || !raw.usageKey) {
      throw ctx.fail('no_match', `No backbone match for "${input.name}"`, {
        recovery: {
          hint: `Try a broader name or use gbif_search_species to browse. Remove strict=true if set.`,
        },
      });
    }

    return {
      taxonKey: raw.usageKey,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      rank: raw.rank,
      status: raw.status,
      confidence: raw.confidence,
      matchType: raw.matchType,
      kingdom: raw.kingdom,
      phylum: raw.phylum,
      class: raw.class,
      order: raw.order,
      family: raw.family,
      genus: raw.genus,
      species: raw.species,
      kingdomKey: raw.kingdomKey,
      phylumKey: raw.phylumKey,
      classKey: raw.classKey,
      orderKey: raw.orderKey,
      familyKey: raw.familyKey,
      genusKey: raw.genusKey,
      speciesKey: raw.speciesKey,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.canonicalName) lines.push(`## ${result.canonicalName}`);
    if (result.scientificName) lines.push(`**Scientific name:** ${result.scientificName}`);
    if (result.taxonKey != null) lines.push(`**Taxon key:** ${result.taxonKey}`);
    if (result.rank) lines.push(`**Rank:** ${result.rank}`);
    if (result.status) lines.push(`**Status:** ${result.status}`);
    if (result.matchType) lines.push(`**Match type:** ${result.matchType}`);
    if (result.confidence != null) lines.push(`**Confidence:** ${result.confidence}/100`);
    const classificationParts: string[] = [];
    if (result.kingdom)
      classificationParts.push(
        `Kingdom: ${result.kingdom}${result.kingdomKey ? ` (${result.kingdomKey})` : ''}`,
      );
    if (result.phylum)
      classificationParts.push(
        `Phylum: ${result.phylum}${result.phylumKey ? ` (${result.phylumKey})` : ''}`,
      );
    if (result.class)
      classificationParts.push(
        `Class: ${result.class}${result.classKey ? ` (${result.classKey})` : ''}`,
      );
    if (result.order)
      classificationParts.push(
        `Order: ${result.order}${result.orderKey ? ` (${result.orderKey})` : ''}`,
      );
    if (result.family)
      classificationParts.push(
        `Family: ${result.family}${result.familyKey ? ` (${result.familyKey})` : ''}`,
      );
    if (result.genus)
      classificationParts.push(
        `Genus: ${result.genus}${result.genusKey ? ` (${result.genusKey})` : ''}`,
      );
    if (result.species)
      classificationParts.push(
        `Species: ${result.species}${result.speciesKey ? ` (${result.speciesKey})` : ''}`,
      );
    if (classificationParts.length > 0) {
      lines.push(`**Classification:** ${classificationParts.join(' › ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
