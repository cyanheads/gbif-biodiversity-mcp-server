/**
 * @fileoverview Search or browse the GBIF backbone taxonomy. The kingdom, family,
 * and genus filters are names over an endpoint that scopes by key alone, so each is
 * resolved through `/species/match` and the narrowest is forwarded as
 * `higherTaxonKey`.
 * @module mcp-server/tools/definitions/gbif-search-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawSpeciesMatch } from '@/services/gbif/types.js';
import { firstBlankFilter, isGbifUuid } from '../utils.js';

/** The three name filters, ordered broadest first, with the rank each one names. */
const SCOPE_RANKS = {
  kingdom: 'KINGDOM',
  family: 'FAMILY',
  genus: 'GENUS',
} as const;

type ScopeField = keyof typeof SCOPE_RANKS;

/**
 * Backbone key `/species/match` carries for the rank `field` names, or `undefined`
 * when the match did not reach that rank.
 *
 * The rank key rather than `usageKey`, because the two differ on a synonym and only
 * the rank key scopes anything: `Compositae` matches `usageKey` 6070956 with
 * `familyKey` 3065, and `higherTaxonKey=6070956` returns 0 names where
 * `higherTaxonKey=3065` returns 201,100. Reading the rank key is what makes an
 * alternative family name resolve to the taxon it is a synonym of.
 */
function rankKeyOf(field: ScopeField, match: RawSpeciesMatch): number | undefined {
  if (field === 'kingdom') return match.kingdomKey;
  if (field === 'family') return match.familyKey;
  return match.genusKey;
}

/**
 * Name `/species/match` carries for the rank `field` names — the taxon the rank key
 * denotes, which is what the enrichment has to report.
 *
 * `scientificName` is the name that *matched*, not the taxon the key points at, and
 * on a synonym the two are different taxa: `Compositae` matches `scientificName`
 * "Compositae" while `familyKey` 3065 is Asteraceae. Reporting the matched name
 * there would echo the caller's own input back and hide the one resolution a caller
 * most needs to see.
 */
function rankNameOf(field: ScopeField, match: RawSpeciesMatch): string | undefined {
  if (field === 'kingdom') return match.kingdom;
  if (field === 'family') return match.family;
  return match.genus;
}

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  taxaCount: number;
  offset: number;
  scopedBy: ScopeField | undefined;
  datasetKey: string | undefined;
}): string | undefined {
  const { totalCount, taxaCount, offset, scopedBy, datasetKey } = args;
  if (totalCount === 0) {
    /**
     * A higher-taxon key is read inside one checklist rather than across all of
     * them, and the key this tool resolves is a GBIF backbone key — so pairing a
     * taxon scope with another checklist's datasetKey matches nothing by
     * construction, not because the checklist holds no such taxa. Measured:
     * `higherTaxonKey=9327` (Paridae) returns 641 names on the backbone and 0
     * against the 455-name "Checklist of alien birds of Belgium".
     */
    if (scopedBy && datasetKey) {
      return `No taxa matched. ${scopedBy} resolved to a GBIF backbone key, and GBIF applies a higher-taxon key only within the checklist that key belongs to — so a backbone key paired with another checklist's datasetKey matches nothing whatever that checklist holds. Drop datasetKey to browse the backbone under this ${scopedBy}, or drop ${scopedBy} to browse the checklist.`;
    }
    return 'No taxa matched the query. Try a shorter name fragment, drop the rank filter or the kingdom/family/genus scope, or use gbif_match_species for exact name lookup.';
  }
  if (taxaCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchSpecies = tool('gbif_search_species', {
  title: 'Search Species Taxonomy',
  description:
    'Search or browse the GBIF backbone taxonomy. Accepts scientific name fragments, rank filters, ' +
    'and higher-taxon constraints. Useful for exploring what species exist under a higher taxon ' +
    '(e.g., "list all families of Coleoptera"), for simple name-fragment searches, or when ' +
    'gbif_match_species returns too narrow a result. kingdom, family, and genus scope the browse ' +
    'to a higher taxon: each is resolved to its backbone key before the search runs, so the ' +
    'narrowest one supplied is what scopes, an alternative name resolves to the taxon it is a ' +
    'synonym of, and a name that matches no backbone taxon at that rank fails rather than ' +
    'returning the whole index. Names are capitalized as GBIF writes them ("Paridae", not ' +
    '"paridae") and are matched exactly, not fuzzily. Paginated — use limit and offset to walk ' +
    'through results.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    q: z
      .string()
      .optional()
      .describe(
        'Name fragment to search for. Matches scientific and vernacular names. Omit the field to browse without a name term — a blank or whitespace-only value is rejected rather than sent, because GBIF answers a blank one with the whole 46,623,754-name index and a whitespace-only one with nothing, and neither is the search a caller who filled the field was asking for.',
      ),
    rank: z
      .enum(['KINGDOM', 'PHYLUM', 'CLASS', 'ORDER', 'FAMILY', 'GENUS', 'SPECIES', 'SUBSPECIES'])
      .optional()
      .describe('Filter to a specific taxonomic rank.'),
    kingdom: z
      .string()
      .optional()
      .describe(
        'Scope the search to a kingdom, by name — "Animalia", "Plantae", "Fungi". Resolved to its backbone key before the search runs, and matched exactly: capitalize it as GBIF writes it, since "animalia" resolves to nothing. Supplied alongside family or genus it disambiguates that name rather than scoping on its own — "Prunella" alone names both a bird genus and a plant genus and resolves to neither. Omit the field to browse every kingdom; a blank or whitespace-only value is rejected rather than dropped.',
      ),
    family: z
      .string()
      .optional()
      .describe(
        'Scope the search to a family, by name — "Paridae", "Fagaceae". Resolved to its backbone key before the search runs, so an alternative family name lands on the taxon it is a synonym of ("Compositae" scopes to Asteraceae). Matched exactly and capitalized as GBIF writes it; a name that is not a backbone family fails rather than being ignored. Supplied with genus, it must be that genus\'s own family. Omit the field to browse every family; a blank or whitespace-only value is rejected rather than dropped.',
      ),
    genus: z
      .string()
      .optional()
      .describe(
        'Scope the search to a genus, by name — "Quercus", "Parus". Resolved to its backbone key before the search runs, and it is the narrowest of the three, so it is what scopes when kingdom or family is supplied too. Matched exactly and capitalized as GBIF writes it; a name shared across kingdoms ("Prunella", "Oenanthe") resolves only when kingdom is supplied with it. Omit the field to browse every genus; a blank or whitespace-only value is rejected rather than dropped.',
      ),
    isExtinct: z.boolean().optional().describe('Filter to extinct (true) or extant (false) taxa.'),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Scope to a specific checklist dataset UUID (8-4-4-4-12 hex). Omit the field to search the GBIF backbone — an empty string is rejected rather than read as no scope, because GBIF answers a blank datasetKey with the unfiltered backbone result.',
      ),
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
        z
          .object({
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
          })
          .describe('A backbone taxon with classification, status, and occurrence counts.'),
      )
      .describe('Matching taxa.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matches before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    taxonScope: z
      .string()
      .optional()
      .describe(
        'The higher-taxon scope actually applied — which of kingdom, family, or genus scoped the search, the backbone taxon its name resolved to, and that taxon key. Absent when none of the three was supplied.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty or paging overshot. Absent on successful result pages.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'q, kingdom, family, genus, or datasetKey was supplied blank or whitespace-only, datasetKey is not an 8-4-4-4-12 hex UUID, or GBIF rejected another filter value as malformed.',
      recovery:
        'A blank filter is not a way to skip one — omit the field instead. Otherwise supply datasetKey as the 8-4-4-4-12 hex UUID of a checklist dataset from gbif_search_datasets with type CHECKLIST, or omit it to search the backbone.',
    },
    {
      reason: 'unresolved_taxon_scope',
      code: JsonRpcErrorCode.NotFound,
      when: 'kingdom, family, or genus named no GBIF backbone taxon at that rank — a misspelling, a lowercase name, a name entered under the wrong rank, or a name shared across kingdoms with no kingdom supplied to separate them.',
      recovery:
        'Check the spelling and the capitalization GBIF uses, and confirm the name belongs to the rank the field names — gbif_match_species with that name and rank reports what it resolves to. A genus or family name that several kingdoms share needs kingdom supplied alongside it.',
    },
    {
      reason: 'conflicting_taxon_scope',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The supplied family and genus each resolved, but to taxa in different lineages — the genus does not sit in that family.',
      recovery:
        'Drop one of the two: genus alone already scopes to everything below it, and the failure message names the family the genus actually belongs to. Use gbif_get_species_classification on a taxon key to read a lineage before pairing filters.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching species taxonomy', { q: input.q, rank: input.rank });
    /**
     * Every filter is checked on presence rather than on a non-blank value.
     * `/species/search` answers the two blank `q` forms two different ways and
     * neither is the search that was asked for: `?q=` returns the whole
     * 46,623,754-name index, `?q=%20%20` returns nothing. One space between the
     * whole backbone and an empty page is not a distinction a caller can plan
     * around. `kingdom`, `family`, and `genus` join the rule now that they scope:
     * a blank one resolves to no backbone taxon, and rejecting it by name beats
     * reporting that the empty string is not a kingdom.
     */
    const blankFilter = firstBlankFilter({
      q: input.q,
      kingdom: input.kingdom,
      family: input.family,
      genus: input.genus,
    });
    if (blankFilter) {
      throw ctx.fail(
        'invalid_filter',
        `${blankFilter} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }

    /**
     * Checked whenever datasetKey is present, not only when it is non-blank. A
     * malformed key is rejected locally so the failure carries this tool's recovery
     * hint instead of a bare upstream 400 that costs a round trip and the retry
     * budget. The empty string is rejected for the opposite reason: it draws no error
     * at all — `/species/search?datasetKey=` answers 200 with the unfiltered backbone
     * result, so a `?.trim()` guard dropped the scope and returned the same 4,972 taxa
     * under q=Aves that the unscoped call returns, to a caller who believed the search
     * was confined to one checklist. Letter case stays unchecked: this route resolves a
     * key either way, unlike `/dataset/search`'s two organization filters.
     */
    if (input.datasetKey !== undefined && !isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
      );
    }

    const service = getGbifService();

    /**
     * `kingdom`, `family`, and `genus` are name filters over an endpoint that
     * scopes by key alone, so each is resolved through `/species/match` and the
     * narrowest one is forwarded as `higherTaxonKey`. Forwarding all three is not
     * an option: `/species/search` OR-s repeated `higherTaxonKey` values rather
     * than intersecting them (keys 1 and 6 together return 6,534,100, their exact
     * sum), so a kingdom sent beside a family would widen the search the family
     * narrowed. The three nest, so the narrowest is the intersection — once the
     * broader ones are confirmed to contain it, which is what the two checks below
     * are for.
     *
     * The kingdom rides along as GBIF's own disambiguator on the narrower lookups
     * instead of being resolved separately: it is what makes a name several
     * kingdoms share resolve at all ("Prunella" with kingdom Animalia matches the
     * accentor genus 2495070, with Plantae the self-heal genus 2926553, and alone
     * matches nothing), and it rejects a contradiction upstream ("Paridae" under
     * kingdom Plantae matches nothing). So it only needs a lookup of its own when
     * nothing narrower was supplied.
     *
     * Matched strictly. Fuzzy matching is right for a search term and wrong for a
     * scope: `Fagacae` fuzzy-matches Fagaceae at confidence 85, and `Quercus`
     * under kingdom Animalia fuzzy-matches the leafhopper genus *Quernus* — a
     * scope silently shifted onto a taxon the caller never named. Under `strict`
     * both answer NONE and fail here by name.
     */
    const requested = (['kingdom', 'family', 'genus'] as const).flatMap((field) => {
      const name = input[field];
      return name === undefined ? [] : [{ field, name }];
    });
    const toResolve =
      requested.length > 1 ? requested.filter((f) => f.field !== 'kingdom') : requested;

    const resolved = await Promise.all(
      toResolve.map(async (f) => ({
        ...f,
        match: await service.matchSpecies(
          {
            name: f.name,
            rank: SCOPE_RANKS[f.field],
            strict: true,
            ...(f.field !== 'kingdom' && input.kingdom !== undefined && { kingdom: input.kingdom }),
          },
          ctx,
        ),
      })),
    );

    /**
     * The rank is verified, not assumed. `/species/match` treats `rank` as a
     * scoring hint rather than a constraint — unstrict, `Aves` at rank FAMILY
     * comes back as the CLASS Aves and `Parus major` at rank GENUS as a SPECIES —
     * and reading `familyKey` or `genusKey` off such a match would scope to a
     * taxon the field never named. A matchType of NONE needs no separate test: it
     * carries neither a rank nor a key, so both conditions already hold.
     */
    const underKingdom = input.kingdom === undefined ? '' : ` under kingdom "${input.kingdom}"`;
    const scoped = resolved.map((r) => {
      const taxonKey = rankKeyOf(r.field, r.match);
      if (r.match.rank !== SCOPE_RANKS[r.field] || taxonKey === undefined) {
        throw ctx.fail(
          'unresolved_taxon_scope',
          `${r.field} "${r.name}" matched no GBIF backbone ${r.field}${r.field === 'kingdom' ? '' : underKingdom}.`,
        );
      }
      return { ...r, taxonKey };
    });

    /**
     * A family and a genus that both resolve can still name disjoint lineages, and
     * GBIF does not catch it: `/species/match` ignores a `family` hint outright
     * (`Quercus` under family Asteraceae still matches the oak genus). Only the
     * genus key would be forwarded, so an unchecked pair would answer the genus
     * question under the caller's belief that the family narrowed it too.
     */
    const familyScope = scoped.find((s) => s.field === 'family');
    const genusScope = scoped.find((s) => s.field === 'genus');
    if (familyScope && genusScope && genusScope.match.familyKey !== familyScope.taxonKey) {
      throw ctx.fail(
        'conflicting_taxon_scope',
        `genus "${genusScope.name}" sits in family ${genusScope.match.family ?? 'a different family'}, not "${familyScope.name}" — the two filters name different lineages, so nothing satisfies both.`,
      );
    }

    // Ordered broadest first, so the last entry is the narrowest scope supplied.
    const scope = scoped.at(-1);

    const raw = await service.searchSpecies(
      {
        ...(input.q !== undefined && { q: input.q }),
        ...(input.rank && { rank: input.rank }),
        ...(scope && { higherTaxonKey: scope.taxonKey }),
        ...(input.isExtinct !== undefined && { isExtinct: input.isExtinct }),
        ...(input.datasetKey !== undefined && { datasetKey: input.datasetKey }),
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
      class: r.class,
      order: r.order,
      family: r.family,
      genus: r.genus,
      vernacularName: r.vernacularName,
      numOccurrences: r.numOccurrences,
      numDescendants: r.numDescendants,
      ...(typeof r.extinct === 'boolean' && { extinct: r.extinct }),
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({
      totalCount,
      offset,
      limit,
      endOfRecords,
      ...(scope && {
        taxonScope: `${scope.field} "${scope.name}" scoped the search to backbone taxon ${rankNameOf(scope.field, scope.match) ?? scope.name} (key ${scope.taxonKey}).`,
      }),
    });
    const notice = buildNotice({
      totalCount,
      taxaCount: taxa.length,
      offset,
      scopedBy: scope?.field,
      datasetKey: input.datasetKey,
    });
    if (notice) ctx.enrich.notice(notice);

    return { taxa };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.taxa.length}`];
    for (const t of result.taxa) {
      // GBIF leaves canonicalName null on backbone entries whose names are not parseable
      // binomials; fall through to scientificName rather than printing Unknown over a
      // name the record does carry. Same three-step fallback as the occurrence tools.
      const name = t.canonicalName ?? t.scientificName ?? 'Unknown';
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
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
