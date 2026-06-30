/**
 * @fileoverview Resolve many scientific names to GBIF backbone taxon keys in one call.
 * @module mcp-server/tools/definitions/gbif-bulk-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifBulkMatchSpecies = tool('gbif_bulk_match_species', {
  title: 'Bulk Match Species Names',
  description:
    'Resolve up to 50 scientific names to GBIF backbone taxon keys in one call — the batch ' +
    'counterpart to gbif_match_species for checklist, inventory, and species-list workflows that ' +
    'would otherwise need one round trip per name. Each name is matched independently and results ' +
    'are returned in input order, one entry per name. A name with no backbone match yields ' +
    'matchType NONE (no taxonKey) instead of failing the batch; a per-name lookup failure yields ' +
    'matchType ERROR with the reason, leaving the rest of the batch intact. Resolves synonyms to ' +
    'the accepted backbone key. Common names are not supported — use gbif_search_species for ' +
    'vernacular searches. Below confidence 80, review the match.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    names: z
      .array(z.string().min(1).describe('A scientific name to match, e.g. "Panthera leo".'))
      .min(1)
      .max(50)
      .describe(
        'Scientific names to match against the GBIF backbone. 1–50 per call, matched in parallel.',
      ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        'When true, require an exact match for every name (no fuzzy matching). When false (default), GBIF applies fuzzy matching to tolerate minor misspellings.',
      ),
  }),
  output: z.object({
    results: z
      .array(
        z
          .object({
            name: z.string().describe('The input name this entry corresponds to.'),
            taxonKey: z
              .number()
              .optional()
              .describe(
                'Matched GBIF backbone taxon key — use in gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets. Absent when matchType is NONE or ERROR.',
              ),
            scientificName: z
              .string()
              .optional()
              .describe('Full matched scientific name with authorship. Absent when unmatched.'),
            canonicalName: z
              .string()
              .optional()
              .describe('Matched scientific name without authorship. Absent when unmatched.'),
            rank: z.string().optional().describe('Taxonomic rank of the matched taxon.'),
            status: z
              .string()
              .optional()
              .describe('Taxonomic status: ACCEPTED, SYNONYM, or DOUBTFUL.'),
            confidence: z
              .number()
              .optional()
              .describe('Match confidence 0–100. Below 80 warrants review. Absent on ERROR.'),
            matchType: z
              .string()
              .describe(
                'EXACT, FUZZY, or HIGHERRANK for a match; NONE when GBIF found no usable match; ERROR when the lookup itself failed for this name (see error).',
              ),
            error: z
              .string()
              .optional()
              .describe('Failure reason when matchType is ERROR. Absent otherwise.'),
          })
          .describe('Match outcome for one input name.'),
      )
      .describe('One result per input name, in input order.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('Bulk matching species names', {
      count: input.names.length,
      strict: input.strict,
    });
    const gbif = getGbifService();

    // Per-name isolation: each lookup resolves to a result entry and never rejects, so a
    // single unmatched name (NONE) or transient failure (ERROR) cannot sink the batch.
    // Promise.all preserves input order. The in-loop try/catch is the deliberate batch-tool
    // exception to "handlers throw" — per-item isolation is the point.
    const results = await Promise.all(
      input.names.map(async (name) => {
        try {
          const raw = await gbif.matchSpecies({ name, strict: input.strict }, ctx);
          if (raw.usageKey == null || raw.matchType == null || raw.matchType === 'NONE') {
            return { name, matchType: 'NONE' };
          }
          return {
            name,
            taxonKey: raw.usageKey,
            scientificName: raw.scientificName ?? undefined,
            canonicalName: raw.canonicalName ?? undefined,
            rank: raw.rank ?? undefined,
            status: raw.status ?? undefined,
            confidence: raw.confidence ?? undefined,
            matchType: raw.matchType,
          };
        } catch (err) {
          return {
            name,
            matchType: 'ERROR',
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );

    return { results };
  },

  format: (result) => {
    const lines: string[] = [];
    for (const r of result.results) {
      lines.push(`## ${r.name}`);
      if (r.canonicalName) lines.push(`**Canonical name:** ${r.canonicalName}`);
      if (r.scientificName) lines.push(`**Scientific name:** ${r.scientificName}`);
      if (r.taxonKey != null) lines.push(`**Taxon key:** ${r.taxonKey}`);
      if (r.rank) lines.push(`**Rank:** ${r.rank}`);
      if (r.status) lines.push(`**Status:** ${r.status}`);
      lines.push(`**Match type:** ${r.matchType}`);
      if (r.confidence != null) lines.push(`**Confidence:** ${r.confidence}/100`);
      if (r.error) lines.push(`**Error:** ${r.error}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
