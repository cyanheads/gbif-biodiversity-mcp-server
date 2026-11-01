/**
 * @fileoverview Match a species name against the GBIF backbone taxonomy.
 * @module mcp-server/tools/definitions/gbif-match-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { firstBlankFilter, higherRankNote, isAmbiguousMatchNote } from '../utils.js';

export const gbifMatchSpecies = tool('gbif_match_species', {
  title: 'Match Species Name',
  description:
    "Match a scientific name against the GBIF backbone taxonomy. Returns the best-matching taxon with full classification and a confidence score (0–100). This is the mandatory first step for any GBIF workflow — it returns the backbone taxonKey required by gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets. When the name GBIF matched is a synonym — the queried name, or the higher taxon a HIGHERRANK match falls back to — taxonKey is the accepted taxon it resolves to and matchedTaxonKey carries the synonym's own key; occurrence counts differ sharply between the two, so pass taxonKey. matchType HIGHERRANK is GBIF's label for a match made at a higher rank: a misspelled or unknown species falls back to its genus or even its kingdom, at a confidence that can exceed 90, and a bare genus name carries the label too, matched as that genus. taxonKey then covers that whole taxon, or its accepted taxon when it is a synonym, and a notice names it. Below confidence 80, the match should be reviewed. matchType NONE means no usable match was found — try removing the strict flag or broadening the name; when GBIF reports several equal matches, as for a genus name shared by an animal and a plant, set kingdom to pick one.",
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
        'Narrow the match to a specific kingdom (e.g., "Animalia", "Plantae", "Fungi") to disambiguate names that appear in multiple kingdoms. Omit the field to match against the whole backbone — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the undisambiguated match, which is indistinguishable from a match that honored the kingdom.',
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
        "GBIF backbone taxon key to pass to downstream tools. The accepted taxon's key when the name GBIF matched is a synonym, otherwise the matched taxon's own key.",
      ),
    matchedTaxonKey: z
      .number()
      .optional()
      .describe(
        'Backbone key of the name that actually matched. Present only when it differs from taxonKey — that is, when a synonym was resolved to its accepted taxon.',
      ),
    scientificName: z.string().optional().describe('Full scientific name with authorship.'),
    canonicalName: z.string().optional().describe('Scientific name without authorship.'),
    rank: z.string().optional().describe('Taxonomic rank of the matched taxon.'),
    status: z.string().optional().describe('Taxonomic status: ACCEPTED, SYNONYM, or DOUBTFUL.'),
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
        'EXACT, FUZZY, HIGHERRANK, or NONE. HIGHERRANK means GBIF matched at a higher rank — a misspelled species falls back to its genus or kingdom, and a bare genus name carries it too — and taxonKey covers that whole taxon, or its accepted taxon when it is a synonym. NONE means no usable match.',
      ),
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

  // Agent-facing context — reaches both structuredContent and content[].
  enrichment: {
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when matchType is HIGHERRANK — naming the taxon and rank GBIF matched and what taxonKey covers — or when the matched name was a synonym and taxonKey was resolved to the accepted taxon. A higher-rank match on a synonym carries both. Absent on an EXACT or FUZZY match of an accepted name.',
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
        'Supply kingdom as a backbone kingdom name such as Animalia, Plantae, or Fungi, or omit the field to match against the whole backbone — a blank value is not a way to skip the filter.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Matching species name', { name: input.name, strict: input.strict });
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

    const raw = await getGbifService().matchSpecies(
      {
        name: input.name,
        strict: input.strict,
        ...(input.kingdom !== undefined && { kingdom: input.kingdom }),
        ...(input.rank && { rank: input.rank }),
      },
      ctx,
    );

    // Presence, not truthiness: usageKey 0 is the backbone kingdom incertae sedis.
    if (raw.matchType === 'NONE' || raw.usageKey == null) {
      /**
       * GBIF's note is the only explanation a NONE carries. On a tie ("Multiple equal
       * matches for Oenanthe" — a bird genus and a plant genus) kingdom is the lever on
       * this call that picks one, so the retry is offered only while kingdom is unset.
       */
      const retry =
        isAmbiguousMatchNote(raw.note) && input.kingdom === undefined
          ? ' Retry with kingdom set (such as Animalia or Plantae) to choose between them.'
          : '';
      const gbifNote = raw.note ? ` — GBIF reported "${raw.note}".${retry}` : '';
      throw ctx.fail('no_match', `No backbone match for "${input.name}"${gbifNote}`);
    }

    /**
     * `/species/match` reports the accepted taxon as `acceptedUsageKey` and nothing
     * else — no accepted-name string. Resolving here is what makes the returned
     * taxonKey safe to hand straight to the occurrence tools: filtering on the
     * synonym's own key returns only the records filed under that name.
     */
    const matchedTaxonKey = raw.usageKey;
    const taxonKey = raw.acceptedUsageKey ?? matchedTaxonKey;
    const resolvedSynonym = taxonKey !== matchedTaxonKey;

    // One notice: a later enrich.notice() call replaces an earlier one, and a higher-rank
    // match on a synonym (Nyctea xyzzyqq → genus Nyctea → Bubo) needs both disclosures.
    const notices: string[] = [];
    if (raw.matchType === 'HIGHERRANK') {
      notices.push(
        `${higherRankNote(input.name, taxonKey, raw)} If a narrower taxon was meant, check the spelling; with strict: true GBIF matches the name itself or answers no_match, never a taxon above it.`,
      );
    }
    if (resolvedSynonym) {
      // On a higher-rank synonym the disclosure above already names the synonym and what
      // taxonKey covers; only the synonym's own key is left to say.
      notices.push(
        raw.matchType === 'HIGHERRANK'
          ? `The synonym's own key ${matchedTaxonKey}${raw.status ? ` (status ${raw.status})` : ''} covers only records filed under ${raw.canonicalName ?? 'the synonym itself'} — pass taxonKey ${taxonKey} to the occurrence tools.`
          : `The matched name${raw.canonicalName ? ` ${raw.canonicalName}` : ''} is a synonym (key ${matchedTaxonKey}, status ${raw.status ?? 'SYNONYM'}). taxonKey ${taxonKey} is the accepted taxon it resolves to — pass that to the occurrence tools; the synonym's key covers only records filed under that name. Call gbif_get_species with ${taxonKey} for the accepted name.`,
      );
    }
    if (notices.length > 0) ctx.enrich.notice(notices.join(' '));

    return {
      taxonKey,
      ...(resolvedSynonym && { matchedTaxonKey }),
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
    if (result.matchedTaxonKey != null) {
      lines.push(
        `**Matched taxon key:** ${result.matchedTaxonKey} — the name GBIF matched is a synonym; the taxon key above is the accepted taxon it resolves to.`,
      );
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
