/**
 * @fileoverview Resolve many scientific names to GBIF backbone taxon keys in one call.
 * @module mcp-server/tools/definitions/gbif-bulk-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { getServerConfig } from '@/config/server-config.js';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { clampReadLimit } from '../read-limits.js';
import { escapeMarkdownText } from '../utils.js';

const namesSchema = z
  .array(z.string().min(1).describe('A scientific name to match, e.g. "Panthera leo".'))
  .min(1);

export const gbifBulkMatchSpecies = tool('gbif_bulk_match_species', {
  title: 'Bulk Match Species Names',
  description:
    'Resolve up to 50 scientific names to GBIF backbone taxon keys in one call — the batch ' +
    'counterpart to gbif_match_species for checklist, inventory, and species-list workflows that ' +
    'would otherwise need one round trip per name. Each name is matched independently and results ' +
    'are returned in input order, one entry per processed name. By default, an oversized batch processes the first 50 and returns the remainder in unprocessedNames. A name with no backbone match yields ' +
    'matchType NONE (no taxonKey) instead of failing the batch; a per-name lookup failure yields ' +
    "matchType ERROR carrying that name's error message and, when the failure was classified, " +
    'a machine-readable reason — the rest of the batch is unaffected, and the call as a whole ' +
    'still succeeds. When a queried name is a synonym, taxonKey is the accepted taxon it resolves ' +
    "to and matchedTaxonKey carries the synonym's own key. Common names are not supported — use " +
    'gbif_search_species for vernacular searches. Below confidence 80, review the match.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    names: (getServerConfig().clampReadLimits ? namesSchema : namesSchema.max(50)).describe(
      'Scientific names to match against the GBIF backbone. Up to 50 are matched in parallel; additional names are returned in unprocessedNames when read-limit clamping is enabled (default). Every submitted name must be valid.',
    ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        'When true, require an exact match for every name (no fuzzy matching). When false (default), GBIF applies fuzzy matching to tolerate minor misspellings.',
      ),
  }),
  output: z.object({
    unprocessedNames: z
      .array(z.string())
      .optional()
      .describe(
        'Names beyond the first 50, in original order including duplicates. Submit these names in another call. Absent when every name was processed.',
      ),
    results: z
      .array(
        z
          .object({
            name: z.string().describe('The input name this entry corresponds to.'),
            taxonKey: z
              .number()
              .optional()
              .describe(
                "GBIF backbone taxon key to pass to gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets — the accepted taxon's key when this name is a synonym, otherwise the matched taxon's own key. Absent when matchType is NONE or ERROR.",
              ),
            matchedTaxonKey: z
              .number()
              .optional()
              .describe(
                'Backbone key of the name that actually matched. Present only when it differs from taxonKey — that is, when a synonym was resolved to its accepted taxon.',
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
              .describe('Failure message when matchType is ERROR. Absent otherwise.'),
            reason: z
              .string()
              .optional()
              .describe(
                'Machine-readable failure identifier when matchType is ERROR — e.g. invalid_filter when GBIF rejected a supplied value. Absent when the failure carried no classification, and absent on every non-ERROR entry.',
              ),
          })
          .describe('Match outcome for one input name.'),
      )
      .describe('One result per processed input name, in input order (at most 50).'),
  }),

  enrichment: {
    notice: z
      .string()
      .optional()
      .describe('Requested and applied batch size when names exceed the 50-name workload cap.'),
  },

  async handler(input, ctx) {
    const clamp = clampReadLimit(input.names.length, 50, 'gbif_bulk_match_species', 'names', ctx);
    const unprocessedNames = input.names.slice(clamp.applied);
    const names = input.names.slice(0, clamp.applied);
    if (clamp.notice) ctx.enrich.notice(`${clamp.notice} Submit unprocessedNames in another call.`);
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
      names.map(async (name) => {
        try {
          const raw = await gbif.matchSpecies({ name, strict: input.strict }, ctx);
          if (raw.usageKey == null || raw.matchType == null || raw.matchType === 'NONE') {
            return { name, matchType: 'NONE' };
          }
          // `/species/match` names the accepted taxon only as acceptedUsageKey; resolve
          // so taxonKey is safe to hand to the occurrence tools (see gbif_match_species).
          const matchedTaxonKey = raw.usageKey;
          const taxonKey = raw.acceptedUsageKey ?? matchedTaxonKey;
          return {
            name,
            taxonKey,
            ...(taxonKey !== matchedTaxonKey && { matchedTaxonKey }),
            scientificName: raw.scientificName ?? undefined,
            canonicalName: raw.canonicalName ?? undefined,
            rank: raw.rank ?? undefined,
            status: raw.status ?? undefined,
            confidence: raw.confidence ?? undefined,
            matchType: raw.matchType,
          };
        } catch (err) {
          // The per-name catch is the only place a classified failure can surface for this
          // tool, so carry the thrown reason through rather than flattening to a message.
          const reason =
            err instanceof McpError && typeof err.data?.reason === 'string'
              ? err.data.reason
              : undefined;
          return {
            name,
            matchType: 'ERROR',
            error: err instanceof Error ? err.message : String(err),
            ...(reason && { reason }),
          };
        }
      }),
    );

    return { results, ...(unprocessedNames.length > 0 && { unprocessedNames }) };
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.unprocessedNames) {
      lines.push('## Unprocessed names');
      for (const name of result.unprocessedNames) lines.push(`- ${escapeMarkdownText(name)}`);
    }
    for (const r of result.results) {
      lines.push(`## ${r.name}`);
      if (r.canonicalName) lines.push(`**Canonical name:** ${r.canonicalName}`);
      if (r.scientificName) lines.push(`**Scientific name:** ${r.scientificName}`);
      if (r.taxonKey != null) lines.push(`**Taxon key:** ${r.taxonKey}`);
      if (r.matchedTaxonKey != null) {
        lines.push(
          `**Matched taxon key:** ${r.matchedTaxonKey} — this name is a synonym; the taxon key above is the accepted taxon it resolves to.`,
        );
      }
      if (r.rank) lines.push(`**Rank:** ${r.rank}`);
      if (r.status) lines.push(`**Status:** ${r.status}`);
      lines.push(`**Match type:** ${r.matchType}`);
      if (r.confidence != null) lines.push(`**Confidence:** ${r.confidence}/100`);
      if (r.error) lines.push(`**Error:** ${r.error}`);
      if (r.reason) lines.push(`**Reason:** ${r.reason}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
