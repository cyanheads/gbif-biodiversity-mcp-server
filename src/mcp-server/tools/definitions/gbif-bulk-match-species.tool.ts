/**
 * @fileoverview Resolve many scientific names to GBIF taxon keys in one call.
 * @module mcp-server/tools/definitions/gbif-bulk-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getServerConfig } from '@/config/server-config.js';
import { CHECKLIST_KEY_VALUES } from '@/services/gbif/types.js';
import { clampReadLimit } from '../read-limits.js';
import {
  escapeMarkdownText,
  firstBlankFilter,
  higherRankNote,
  isAmbiguousMatchNote,
  matchKeyFields,
  matchName,
} from '../utils.js';

const entrySchema = z
  .union([
    z.string().min(1).describe('A scientific name to match, e.g. "Panthera leo".'),
    z
      .object({
        name: z.string().min(1).describe('A scientific name to match, e.g. "Oenanthe".'),
        kingdom: z
          .string()
          .optional()
          .describe(
            'Kingdom for this name alone, such as Animalia, Plantae, or Fungi, sent to GBIF as gbif_match_species sends its own. Omit it to match the name without one; a blank or whitespace-only value is rejected.',
          ),
      })
      .strict()
      .describe('A scientific name with a kingdom that applies to it alone.'),
  ])
  .describe('A scientific name, or { name, kingdom } to narrow that one name to a kingdom.');

const namesSchema = z.array(entrySchema).min(1);

export const gbifBulkMatchSpecies = tool('gbif_bulk_match_species', {
  title: 'Bulk Match Species Names',
  description:
    "Resolve up to 50 scientific names to GBIF backbone taxon keys in one call — the batch counterpart to gbif_match_species for checklist, inventory, and species-list workflows that would otherwise need one round trip per name. Each name is matched independently and results are returned in input order, one entry per processed name. An entry is a name string, or { name, kingdom } to narrow that one name to a kingdom: a name shared across kingdoms, such as Oenanthe (a bird genus and a plant genus), matches nothing until its entry names one, while a kingdom applied to every name would move the others (Parus major under Plantae matches the pear Pyrus major). By default, an oversized batch processes the first 50 and returns the remaining entries, as submitted, in unprocessedNames. A name GBIF matched at a higher rank yields matchType HIGHERRANK with a note naming the taxon matched and what its key covers: that whole taxon, or its accepted taxon when it is a synonym — a misspelled species can fall back to its genus or kingdom at a confidence above 90, and a bare genus name carries the label too, matched as that genus. A name with no match yields matchType NONE (no key) instead of failing the batch, with a note carrying GBIF's explanation when it gives one, such as several equal matches for a name shared across kingdoms; a per-name lookup failure yields matchType ERROR carrying that name's error message and, when the failure was classified, a machine-readable reason — the rest of the batch is unaffected, and the call as a whole still succeeds unless the deployment cannot reach the Catalogue of Life route checklistKey needs (a GBIF_BASE_URL not ending in /v1), which fails the call. When the name GBIF matched is a synonym — the queried name, or the higher taxon a HIGHERRANK match falls back to — taxonKey is the accepted taxon it resolves to, matchedTaxonKey carries the synonym's own key, and acceptedName names the accepted taxon whenever GBIF's answer does. checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b matches the whole batch against the Catalogue of Life eXtended Release instead of the backbone, which GBIF no longer updates; its keys come back as strings in checklistTaxonKey and checklistMatchedTaxonKey, with no taxonKey, and the occurrence tools take checklistTaxonKey under that name, with the same checklistKey. Common names are not supported — use gbif_search_species for vernacular searches. Below confidence 80, review the match.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    names: (getServerConfig().clampReadLimits ? namesSchema : namesSchema.max(50)).describe(
      'Scientific names to match, each a name string or { name, kingdom } — an entry kingdom applies to that name alone and is how a name GBIF reports several equal matches for is resolved. Up to 50 are matched in parallel; additional entries are returned as submitted in unprocessedNames when read-limit clamping is enabled (default). Every submitted entry must be valid, and a blank kingdom on any of them fails the call.',
    ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        'When true, require an exact match for every name (no fuzzy matching). When false (default), GBIF applies fuzzy matching to tolerate minor misspellings.',
      ),
    checklistKey: z
      .enum(CHECKLIST_KEY_VALUES)
      .optional()
      .describe(
        'Taxonomy to match every name against. Omitted, or d7dddbf4-2cf0-4f39-9b2a-bb099caae36c, is the GBIF Backbone, whose integer keys the occurrence and species tools take; GBIF no longer updates it. 7ddf754f-d193-4cc9-b351-99906754a03b is the Catalogue of Life eXtended Release, the taxonomy GBIF now maintains; its keys come back as strings in checklistTaxonKey and checklistMatchedTaxonKey, and taxonKey and matchedTaxonKey are absent.',
      ),
  }),
  output: z.object({
    unprocessedNames: z
      .array(
        z
          .union([
            z.string().describe('A name submitted as a string.'),
            z
              .object({
                name: z.string().describe('The submitted name.'),
                kingdom: z.string().optional().describe('The submitted kingdom, when given.'),
              })
              .describe('A name submitted as { name, kingdom }.'),
          ])
          .describe('One remaining entry, exactly as submitted.'),
      )
      .optional()
      .describe(
        'Entries beyond the first 50, as submitted, in original order including duplicates. Submit these entries in another call. Absent when every entry was processed.',
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
                "GBIF backbone taxon key to pass to gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets — the accepted taxon's key when the name GBIF matched is a synonym, otherwise the matched taxon's own key. Absent when matchType is NONE or ERROR, and under the Catalogue of Life.",
              ),
            matchedTaxonKey: z
              .number()
              .optional()
              .describe(
                'Backbone key of the name that actually matched. Present only when it differs from taxonKey — that is, when a synonym was resolved to its accepted taxon.',
              ),
            checklistTaxonKey: z
              .string()
              .optional()
              .describe(
                'Catalogue of Life key of the accepted taxon (or of the matched taxon when it is not a synonym), a case-sensitive string. Present only when checklistKey selects the Catalogue of Life. Not a backbone key: never pass it where a numeric taxonKey is asked for. The occurrence tools take it as checklistTaxonKey, with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b.',
              ),
            checklistMatchedTaxonKey: z
              .string()
              .optional()
              .describe(
                'Catalogue of Life key of the name that actually matched. Present only when it differs from checklistTaxonKey — that is, when a synonym was resolved to its accepted taxon.',
              ),
            acceptedName: z
              .string()
              .optional()
              .describe(
                'Canonical name, without authorship, of the accepted taxon a synonym resolves to. Present only on a synonym match whose answer names that taxon: under the backbone it is absent when the accepted taxon is below species rank (gbif_get_species with taxonKey names it); under the Catalogue of Life every synonym carries it.',
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
              .describe(
                'Taxonomic status of the matched name: ACCEPTED, SYNONYM, or DOUBTFUL, and under the Catalogue of Life also PROVISIONALLY_ACCEPTED.',
              ),
            confidence: z
              .number()
              .optional()
              .describe(
                'Match confidence 0–100. Below 80 warrants review; a HIGHERRANK match can score above 90, so read matchType too. Absent on ERROR.',
              ),
            matchType: z
              .string()
              .describe(
                'EXACT or FUZZY for a match, with VARIANT in place of FUZZY under the Catalogue of Life; HIGHERRANK when GBIF matched at a higher rank — a misspelled species falls back to its genus or kingdom, and a bare genus name carries it too — so the key covers that whole taxon, or its accepted taxon when it is a synonym (see note); NONE when GBIF found no usable match; ERROR when the lookup itself failed for this name (see error).',
              ),
            note: z
              .string()
              .optional()
              .describe(
                "On HIGHERRANK, names the taxon and rank GBIF matched and what the key covers: that whole taxon, or its accepted taxon when it is a synonym. On NONE, GBIF's own explanation when it gave one — for a name shared across kingdoms, its report of several equal matches, with a pointer to resubmit the entry with kingdom set unless it already carried one. Absent on other matches, on ERROR entries, and on a NONE GBIF did not explain.",
              ),
            error: z
              .string()
              .optional()
              .describe('Failure message when matchType is ERROR. Absent otherwise.'),
            reason: z
              .string()
              .optional()
              .describe(
                'Machine-readable failure identifier when matchType is ERROR and the failure was classified. Absent when the failure carried no classification, and absent on every non-ERROR entry.',
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

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'An entry in names carried a blank or whitespace-only kingdom, which disambiguates nothing.',
      recovery:
        'Give that entry a kingdom name such as Animalia, Plantae, or Fungi, or submit the name as a plain string to match it without one — a blank value is not a way to skip the filter.',
    },
  ],

  async handler(input, ctx) {
    /**
     * Every entry, the unprocessed tail included, before the first request: GBIF matches
     * a name given a blank kingdom as if it had none, which is the undisambiguated answer
     * the caller reached for the field to avoid.
     */
    for (const [index, entry] of input.names.entries()) {
      if (typeof entry !== 'string' && firstBlankFilter({ kingdom: entry.kingdom })) {
        throw ctx.fail(
          'invalid_filter',
          `names[${index}].kingdom was supplied blank for "${entry.name}". Omit kingdom on that entry to match the name without one — a blank value is not a way to skip a filter.`,
        );
      }
    }

    const clamp = clampReadLimit(input.names.length, 50, 'gbif_bulk_match_species', 'names', ctx);
    const unprocessedNames = input.names.slice(clamp.applied);
    const entries = input.names.slice(0, clamp.applied);
    if (clamp.notice) ctx.enrich.notice(`${clamp.notice} Submit unprocessedNames in another call.`);
    ctx.log.info('Bulk matching species names', {
      count: input.names.length,
      strict: input.strict,
      checklistKey: input.checklistKey,
    });

    // Per-name isolation: each lookup resolves to a result entry and never rejects, so a
    // single unmatched name (NONE) or transient failure (ERROR) cannot sink the batch.
    // Promise.all preserves input order. The in-loop try/catch is the deliberate batch-tool
    // exception to "handlers throw" — per-item isolation is the point.
    const results = await Promise.all(
      entries.map(async (entry) => {
        const { name, kingdom } = typeof entry === 'string' ? { name: entry } : entry;
        try {
          const answer = await matchName(
            { name, strict: input.strict, ...(kingdom !== undefined && { kingdom }) },
            input.checklistKey,
            ctx,
          );
          if (answer.kind === 'none') {
            // GBIF's note is the only explanation a NONE carries; a tie across kingdoms is
            // resolved by this entry's own kingdom, so the pointer goes while it has none.
            const retry =
              isAmbiguousMatchNote(answer.note) && kingdom === undefined
                ? ' Resubmit this name as an entry with kingdom set (such as Animalia or Plantae) to choose between them.'
                : '';
            return {
              name,
              matchType: 'NONE',
              ...(answer.note && { note: `GBIF reported "${answer.note}".${retry}` }),
            };
          }
          const { taxon } = answer;
          return {
            name,
            ...matchKeyFields(taxon.key),
            ...(taxon.acceptedName !== undefined && { acceptedName: taxon.acceptedName }),
            scientificName: taxon.scientificName,
            canonicalName: taxon.canonicalName,
            rank: taxon.rank,
            status: taxon.status,
            confidence: taxon.confidence,
            matchType: taxon.matchType,
            ...(taxon.matchType === 'HIGHERRANK' && {
              note: `${higherRankNote(name, taxon)} If a narrower taxon was meant, check the spelling; with strict: true GBIF matches each name itself or answers NONE, never a taxon above it.`,
            }),
          };
        } catch (err) {
          /**
           * A row records one name's own failure. The caller's cancellation, and a
           * deployment that cannot reach the Catalogue of Life route at all, are not
           * per-name, so they fail the call instead of filling every row with the same
           * error.
           */
          if (
            ctx.signal.aborted ||
            (err instanceof McpError && err.code === JsonRpcErrorCode.ConfigurationError)
          ) {
            throw err;
          }
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
      for (const entry of result.unprocessedNames) {
        const { name, kingdom } = typeof entry === 'string' ? { name: entry } : entry;
        const scope = kingdom !== undefined ? ` (kingdom: ${escapeMarkdownText(kingdom)})` : '';
        lines.push(`- ${escapeMarkdownText(name)}${scope}`);
      }
    }
    for (const r of result.results) {
      // A heading holds one line, and the name is the caller's own text.
      lines.push(`## ${escapeMarkdownText(r.name)}`);
      if (r.canonicalName) lines.push(`**Canonical name:** ${r.canonicalName}`);
      if (r.scientificName) lines.push(`**Scientific name:** ${r.scientificName}`);
      if (r.taxonKey != null) lines.push(`**Taxon key:** ${r.taxonKey}`);
      if (r.matchedTaxonKey != null) {
        lines.push(
          `**Matched taxon key:** ${r.matchedTaxonKey} — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.`,
        );
      }
      if (r.checklistTaxonKey) {
        lines.push(
          `**Checklist taxon key:** ${escapeMarkdownText(r.checklistTaxonKey)} — a Catalogue of Life key, not a backbone taxonKey.`,
        );
      }
      if (r.checklistMatchedTaxonKey) {
        lines.push(
          `**Checklist matched taxon key:** ${escapeMarkdownText(r.checklistMatchedTaxonKey)} — the name GBIF matched is a synonym; the checklist taxon key above is the accepted taxon it resolves to.`,
        );
      }
      if (r.acceptedName) lines.push(`**Accepted name:** ${escapeMarkdownText(r.acceptedName)}`);
      if (r.rank) lines.push(`**Rank:** ${r.rank}`);
      if (r.status) lines.push(`**Status:** ${r.status}`);
      lines.push(`**Match type:** ${r.matchType}`);
      if (r.confidence != null) lines.push(`**Confidence:** ${r.confidence}/100`);
      // The note embeds the queried name, GBIF's taxon name, and GBIF's own wording.
      if (r.note) lines.push(`**Note:** ${escapeMarkdownText(r.note)}`);
      if (r.error) lines.push(`**Error:** ${r.error}`);
      if (r.reason) lines.push(`**Reason:** ${r.reason}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
