/**
 * @fileoverview Match a species name against the GBIF Backbone or the Catalogue of Life.
 * @module mcp-server/tools/definitions/gbif-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { CHECKLIST_KEY_VALUES, COL_XR_CHECKLIST_KEY } from '@/services/gbif/types.js';
import {
  escapeMarkdownText,
  firstBlankFilter,
  higherRankNote,
  isAmbiguousMatchNote,
  type MatchedTaxon,
  matchKeyFields,
  matchName,
} from '../utils.js';

/**
 * One notice for the match: a later enrich.notice() call replaces an earlier one, and a
 * higher-rank match on a synonym (Nyctea xyzzyqq → genus Nyctea → Bubo) needs both
 * disclosures. Only a Backbone key is pointed at the occurrence tools and
 * gbif_get_species, which take Backbone integers.
 */
function matchNotice(name: string, taxon: MatchedTaxon): string | undefined {
  const { key, matchType, canonicalName, status, acceptedName } = taxon;
  const backbone = key.field === 'taxonKey';
  const notices: string[] = [];
  if (matchType === 'HIGHERRANK') {
    notices.push(
      `${higherRankNote(name, taxon)} If a narrower taxon was meant, check the spelling; with strict: true GBIF matches the name itself or answers no_match, never a taxon above it.`,
    );
  }
  if (key.matched !== undefined) {
    if (matchType === 'HIGHERRANK') {
      // The disclosure above already names the synonym and what the key covers; only
      // the synonym's own key is left to say.
      const synonymStatus = status ? ` (status ${status})` : '';
      notices.push(
        backbone
          ? `The synonym's own key ${key.matched}${synonymStatus} covers only records filed under ${canonicalName ?? 'the synonym itself'} — pass taxonKey ${key.value} to the occurrence tools.`
          : `The synonym's own key ${key.matched}${synonymStatus} is returned as checklistMatchedTaxonKey.`,
      );
    } else {
      const synonym = `The matched name${canonicalName ? ` ${canonicalName}` : ''} is a synonym`;
      const resolvesTo = `is the accepted taxon it resolves to${acceptedName ? `, ${acceptedName}` : ''}`;
      notices.push(
        backbone
          ? `${synonym} (key ${key.matched}, status ${status ?? 'SYNONYM'}). taxonKey ${key.value} ${resolvesTo} — pass that to the occurrence tools; the synonym's key covers only records filed under that name.${acceptedName ? '' : ` Call gbif_get_species with ${key.value} for the accepted name.`}`
          : `${synonym} (Catalogue of Life key ${key.matched}, status ${status ?? 'SYNONYM'}). checklistTaxonKey ${key.value} ${resolvesTo} — pass that to the occurrence tools as checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}.`,
      );
    }
  }
  return notices.length > 0 ? notices.join(' ') : undefined;
}

export const gbifMatchSpecies = tool('gbif_match_species', {
  title: 'Match Species Name',
  description:
    "Match a scientific name against the GBIF backbone taxonomy. Returns the best-matching taxon with full classification and a confidence score (0–100). This is the mandatory first step for any GBIF workflow — it returns the backbone taxonKey required by gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets. When the name GBIF matched is a synonym — the queried name, or the higher taxon a HIGHERRANK match falls back to — taxonKey is the accepted taxon it resolves to and matchedTaxonKey carries the synonym's own key; occurrence counts differ sharply between the two, so pass taxonKey. acceptedName names that accepted taxon whenever GBIF's answer does. matchType HIGHERRANK is GBIF's label for a match made at a higher rank: a misspelled or unknown species falls back to its genus or even its kingdom, at a confidence that can exceed 90, and a bare genus name carries the label too, matched as that genus. taxonKey then covers that whole taxon, or its accepted taxon when it is a synonym, and a notice names it. Below confidence 80, the match should be reviewed. matchType NONE means no usable match was found — try removing the strict flag or broadening the name; when GBIF reports several equal matches, as for a genus name shared by an animal and a plant, set kingdom to pick one. GBIF no longer updates the backbone, so a name described or revised since its last build falls back to a higher taxon there; checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b matches against the Catalogue of Life eXtended Release instead, GBIF's current taxonomy, and returns its keys as strings in checklistTaxonKey and checklistMatchedTaxonKey with no taxonKey or rank keys — they are not backbone keys, and no tool that takes a numeric taxonKey can use them, but gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets take checklistTaxonKey under that name, with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    name: z
      .string()
      .describe(
        'Scientific name to match. Examples: "Parus major", "Agaricus bisporus", "Homo sapiens". Fuzzy matching handles minor spelling variations. Common names are not supported — use gbif_search_species for vernacular name searches.',
      ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        'When true, only return an exact match. When false (default), GBIF applies fuzzy matching — useful for minor spelling variations and abbreviated names.',
      ),
    kingdom: z
      .string()
      .optional()
      .describe(
        'Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms. Omit the field to match against the whole checklist — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the undisambiguated match, which is indistinguishable from a match that honored the kingdom.',
      ),
    rank: z
      .enum(['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY', 'GENUS', 'SPECIES', 'SUBSPECIES'])
      .optional()
      .describe(
        'Expected taxonomic rank. Use to avoid matching a genus when you expect a species.',
      ),
    checklistKey: z
      .enum(CHECKLIST_KEY_VALUES)
      .optional()
      .describe(
        'Taxonomy to match against. Omitted, or d7dddbf4-2cf0-4f39-9b2a-bb099caae36c, is the GBIF Backbone, whose integer keys the occurrence and species tools take; GBIF no longer updates it. 7ddf754f-d193-4cc9-b351-99906754a03b is the Catalogue of Life eXtended Release, the taxonomy GBIF now maintains, where a recently described or revised name can match exactly; its keys come back as strings in checklistTaxonKey and checklistMatchedTaxonKey, and taxonKey, matchedTaxonKey, and the rank keys are absent.',
      ),
  }),
  output: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        "GBIF backbone taxon key to pass to downstream tools. The accepted taxon's key when the name GBIF matched is a synonym, otherwise the matched taxon's own key. Absent under the Catalogue of Life, whose key is checklistTaxonKey.",
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
        'Catalogue of Life key of the accepted taxon (or of the matched taxon when it is not a synonym), a case-sensitive string such as TPJ7G. Present only when checklistKey selects the Catalogue of Life. Not a backbone key: a digit-only one such as 8288 names an unrelated backbone taxon, so never pass it where a numeric taxonKey is asked for. The occurrence tools take it as checklistTaxonKey, with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b.',
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
        'Canonical name, without authorship, of the accepted taxon a synonym resolves to. Present only on a synonym match whose answer names that taxon: under the backbone it is read from the classification field whose key equals taxonKey, so it is absent when the accepted taxon is below species rank (call gbif_get_species with taxonKey for it); under the Catalogue of Life every synonym carries it.',
      ),
    scientificName: z.string().optional().describe('Full scientific name with authorship.'),
    canonicalName: z.string().optional().describe('Scientific name without authorship.'),
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
        'Match confidence score 0–100. Below 80 warrants review. A HIGHERRANK match can score above 90, so read matchType too.',
      ),
    matchType: z
      .string()
      .optional()
      .describe(
        'EXACT, FUZZY, HIGHERRANK, or NONE; under the Catalogue of Life, VARIANT takes the place of FUZZY for a variant spelling or authorship. HIGHERRANK means GBIF matched at a higher rank — a misspelled species falls back to its genus or kingdom, and a bare genus name carries it too — and the key covers that whole taxon, or its accepted taxon when it is a synonym. NONE means no usable match.',
      ),
    kingdom: z.string().optional().describe('Kingdom of the matched taxon.'),
    phylum: z.string().optional().describe('Phylum of the matched taxon.'),
    class: z.string().optional().describe('Class of the matched taxon.'),
    order: z.string().optional().describe('Order of the matched taxon.'),
    family: z.string().optional().describe('Family of the matched taxon.'),
    genus: z.string().optional().describe('Genus of the matched taxon.'),
    species: z.string().optional().describe('Species canonical name of the matched taxon.'),
    kingdomKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the kingdom. Absent under the Catalogue of Life.'),
    phylumKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the phylum. Absent under the Catalogue of Life.'),
    classKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the class. Absent under the Catalogue of Life.'),
    orderKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the order. Absent under the Catalogue of Life.'),
    familyKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the family. Absent under the Catalogue of Life.'),
    genusKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the genus. Absent under the Catalogue of Life.'),
    speciesKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the species. Absent under the Catalogue of Life.'),
  }),

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when matchType is HIGHERRANK — naming the taxon and rank GBIF matched and what the key covers — or when the matched name was a synonym and the key was resolved to the accepted taxon. A higher-rank match on a synonym carries both. Absent on any other match of an accepted name.',
      ),
  },

  /**
   * `invalid_filter` covers a locally rejected value only. `/species/match` answers
   * HTTP 200 for every input this schema can produce — a malformed kingdom, an
   * out-of-enum rank, and an empty, very long, or control-character name all come
   * back as a normal match or matchType NONE — so nothing upstream can raise it.
   */
  errors: [
    {
      reason: 'no_match',
      code: JsonRpcErrorCode.NotFound,
      when: "matchType is NONE — no candidate met the match threshold, or several equal candidates tied; the message then carries GBIF's note.",
      recovery:
        'Try a broader name, remove the strict flag, set kingdom when GBIF reports several equal matches, or search with gbif_search_species instead.',
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'kingdom was supplied blank or whitespace-only, which disambiguates nothing.',
      recovery:
        'Supply kingdom as a kingdom name such as Animalia, Plantae, or Fungi, or omit the field to match against the whole checklist — a blank value is not a way to skip the filter.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Matching species name', {
      name: input.name,
      strict: input.strict,
      checklistKey: input.checklistKey,
    });
    /**
     * Checked on presence rather than on a non-blank value. `/species/match` ignores
     * a blank kingdom and matches against the whole backbone: `Parus major` with
     * `kingdom=` and with `kingdom=%20%20` each resolve to usageKey 9705453 at
     * confidence 99, the same as omitting the field, where `kingdom=Plantae` resolves
     * to 9711704 instead. The undisambiguated answer is the one the caller reached
     * for this field to avoid, and nothing in the response says the constraint was
     * dropped.
     */
    const blankFilter = firstBlankFilter({ kingdom: input.kingdom });
    if (blankFilter) {
      throw ctx.fail(
        'invalid_filter',
        `${blankFilter} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }

    const answer = await matchName(
      {
        name: input.name,
        strict: input.strict,
        ...(input.kingdom !== undefined && { kingdom: input.kingdom }),
        ...(input.rank && { rank: input.rank }),
      },
      input.checklistKey,
      ctx,
    );

    if (answer.kind === 'none') {
      /**
       * GBIF's note is the only explanation a NONE carries. On a tie ("Multiple equal
       * matches for Oenanthe" — a bird genus and a plant genus) kingdom is the lever on
       * this call that picks one, so the retry is offered only while kingdom is unset.
       */
      const retry =
        isAmbiguousMatchNote(answer.note) && input.kingdom === undefined
          ? ' Retry with kingdom set (such as Animalia or Plantae) to choose between them.'
          : '';
      const gbifNote = answer.note ? ` — GBIF reported "${answer.note}".${retry}` : '';
      const checklist =
        input.checklistKey === COL_XR_CHECKLIST_KEY ? 'Catalogue of Life' : 'backbone';
      throw ctx.fail('no_match', `No ${checklist} match for "${input.name}"${gbifNote}`);
    }

    const { taxon } = answer;
    const notice = matchNotice(input.name, taxon);
    if (notice) ctx.enrich.notice(notice);

    return {
      ...matchKeyFields(taxon.key),
      ...(taxon.acceptedName !== undefined && { acceptedName: taxon.acceptedName }),
      scientificName: taxon.scientificName,
      canonicalName: taxon.canonicalName,
      rank: taxon.rank,
      status: taxon.status,
      confidence: taxon.confidence,
      matchType: taxon.matchType,
      ...taxon.classification,
      ...taxon.classificationKeys,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    if (result.canonicalName) lines.push(`## ${result.canonicalName}`);
    if (result.scientificName) lines.push(`**Scientific name:** ${result.scientificName}`);
    if (result.taxonKey != null) lines.push(`**Taxon key:** ${result.taxonKey}`);
    if (result.matchedTaxonKey != null) {
      lines.push(
        `**Matched taxon key:** ${result.matchedTaxonKey} — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.`,
      );
    }
    if (result.checklistTaxonKey) {
      lines.push(
        `**Checklist taxon key:** ${escapeMarkdownText(result.checklistTaxonKey)} — a Catalogue of Life key, not a backbone taxonKey.`,
      );
    }
    if (result.checklistMatchedTaxonKey) {
      lines.push(
        `**Checklist matched taxon key:** ${escapeMarkdownText(result.checklistMatchedTaxonKey)} — the name GBIF matched is a synonym; the checklist taxon key above is the accepted taxon it resolves to.`,
      );
    }
    if (result.acceptedName) {
      lines.push(`**Accepted name:** ${escapeMarkdownText(result.acceptedName)}`);
    }
    if (result.rank) lines.push(`**Rank:** ${result.rank}`);
    if (result.status) lines.push(`**Status:** ${result.status}`);
    if (result.matchType) lines.push(`**Match type:** ${result.matchType}`);
    if (result.confidence != null) lines.push(`**Confidence:** ${result.confidence}/100`);
    // `!= null`, not truthiness: key 0 is the backbone kingdom incertae sedis.
    const classificationParts: string[] = [];
    if (result.kingdom)
      classificationParts.push(
        `Kingdom: ${result.kingdom}${result.kingdomKey != null ? ` (${result.kingdomKey})` : ''}`,
      );
    if (result.phylum)
      classificationParts.push(
        `Phylum: ${result.phylum}${result.phylumKey != null ? ` (${result.phylumKey})` : ''}`,
      );
    if (result.class)
      classificationParts.push(
        `Class: ${result.class}${result.classKey != null ? ` (${result.classKey})` : ''}`,
      );
    if (result.order)
      classificationParts.push(
        `Order: ${result.order}${result.orderKey != null ? ` (${result.orderKey})` : ''}`,
      );
    if (result.family)
      classificationParts.push(
        `Family: ${result.family}${result.familyKey != null ? ` (${result.familyKey})` : ''}`,
      );
    if (result.genus)
      classificationParts.push(
        `Genus: ${result.genus}${result.genusKey != null ? ` (${result.genusKey})` : ''}`,
      );
    if (result.species)
      classificationParts.push(
        `Species: ${result.species}${result.speciesKey != null ? ` (${result.speciesKey})` : ''}`,
      );
    if (classificationParts.length > 0) {
      lines.push(`**Classification:** ${classificationParts.join(' › ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
