/**
 * @fileoverview Fetch a taxon usage record by GBIF taxon key, from the backbone or any
 * other checklist.
 * @module mcp-server/tools/definitions/gbif-get-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawSpeciesRecord } from '@/services/gbif/types.js';
import { escapeMarkdownText, stripHtml } from '../utils.js';

export const gbifGetSpecies = tool('gbif_get_species', {
  title: 'Get Species Record',
  description:
    'Fetch a single taxon usage by its GBIF taxon key, from the GBIF backbone or any other checklist. Returns full classification, authorship, taxonomic status, vernacular name, descendant count, and publication reference. Use after gbif_match_species when you need the complete record rather than the match summary, or on a taxon usage key from gbif_search_species. datasetKey names the checklist the record belongs to, and key and the rank, parent, and accepted keys are taxon usage keys of that checklist. nubKey is the mapped backbone key, the one the occurrence tools take as taxonKey; it is absent where the backbone has no mapping. When taxonomicStatus is SYNONYM, acceptedKey and accepted fields identify the accepted taxon. The extinct field is absent (not false) on most records — only present on explicitly flagged taxa.',
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
    key: z
      .number()
      .optional()
      .describe('Taxon usage key within the source checklist; not necessarily a backbone key.'),
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
    scientificName: z.string().optional().describe('Full scientific name with authorship.'),
    canonicalName: z.string().optional().describe('Scientific name without authorship.'),
    authorship: z.string().optional().describe('Taxonomic authorship of the name.'),
    vernacularName: z.string().optional().describe('English common name when available.'),
    rank: z.string().optional().describe('Taxonomic rank (SPECIES, GENUS, FAMILY, etc.).'),
    taxonomicStatus: z
      .string()
      .optional()
      .describe(
        'ACCEPTED, SYNONYM, DOUBTFUL, etc. SYNONYM means acceptedKey/accepted are populated.',
      ),
    numDescendants: z
      .number()
      .optional()
      .describe('Count of descendant taxa under this taxon in its source checklist.'),
    numOccurrences: z
      .number()
      .optional()
      .describe(
        'Occurrence record count, when GBIF includes one. Its taxon record endpoint does not, so this is normally absent — count with gbif_count_occurrences, passing nubKey as taxonKey, instead.',
      ),
    publishedIn: z.string().optional().describe('Original description citation when available.'),
    extinct: z
      .boolean()
      .optional()
      .describe('True when the taxon is explicitly flagged as extinct. Absent on most records.'),
    kingdom: z.string().optional().describe('Kingdom classification.'),
    phylum: z.string().optional().describe('Phylum classification.'),
    class: z.string().optional().describe('Class classification.'),
    order: z.string().optional().describe('Order classification.'),
    family: z.string().optional().describe('Family classification.'),
    genus: z.string().optional().describe('Genus classification.'),
    species: z.string().optional().describe('Species canonical name.'),
    kingdomKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the kingdom, in the source checklist.'),
    phylumKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the phylum, in the source checklist.'),
    classKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the class, in the source checklist.'),
    orderKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the order, in the source checklist.'),
    familyKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the family, in the source checklist.'),
    genusKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the genus, in the source checklist.'),
    speciesKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the species, in the source checklist.'),
    acceptedKey: z
      .number()
      .optional()
      .describe(
        'Taxon usage key of the accepted taxon, in the source checklist, when this record is a synonym.',
      ),
    accepted: z
      .string()
      .optional()
      .describe('Scientific name of the accepted taxon when this record is a synonym.'),
    parentKey: z
      .number()
      .optional()
      .describe('Taxon usage key of the immediate parent, in the source checklist.'),
    parent: z.string().optional().describe('Name of the immediate parent taxon.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No GBIF checklist has a taxon usage with this taxonKey.',
      recovery:
        'Use gbif_match_species to resolve a name to a valid backbone key, or gbif_search_species to browse.',
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
    ctx.log.info('Fetching species record', { taxonKey: input.taxonKey });
    const notFoundMessage = `Taxon key ${input.taxonKey} not found in GBIF: no checklist has a taxon usage with that key.`;
    let raw: RawSpeciesRecord;
    try {
      raw = await getGbifService().getSpecies(input.taxonKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === -32001) {
        throw ctx.fail('not_found', notFoundMessage);
      }
      throw err;
    }

    // Presence, not truthiness: key 0 is the backbone kingdom incertae sedis.
    if (raw.key == null) {
      throw ctx.fail('not_found', notFoundMessage);
    }

    return {
      key: raw.key,
      // As GBIF sends them: an unmapped usage has no nubKey, and none is inferred from key.
      datasetKey: raw.datasetKey,
      nubKey: raw.nubKey,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      authorship: raw.authorship,
      vernacularName: raw.vernacularName,
      rank: raw.rank,
      taxonomicStatus: raw.taxonomicStatus,
      numDescendants: raw.numDescendants,
      numOccurrences: raw.numOccurrences,
      // GBIF embeds HTML (e.g. <em>) in the original-description citation; strip to plain text.
      publishedIn: raw.publishedIn ? stripHtml(raw.publishedIn) : undefined,
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
      acceptedKey: raw.acceptedKey,
      accepted: raw.accepted,
      parentKey: raw.parentKey,
      parent: raw.parent,
      ...(typeof raw.extinct === 'boolean' && { extinct: raw.extinct }),
    };
  },

  format: (rawResult) => {
    const result = {
      ...rawResult,
      canonicalName: rawResult.canonicalName && escapeMarkdownText(rawResult.canonicalName),
      scientificName: rawResult.scientificName && escapeMarkdownText(rawResult.scientificName),
      authorship: rawResult.authorship && escapeMarkdownText(rawResult.authorship),
      vernacularName: rawResult.vernacularName && escapeMarkdownText(rawResult.vernacularName),
      rank: rawResult.rank && escapeMarkdownText(rawResult.rank),
      taxonomicStatus: rawResult.taxonomicStatus && escapeMarkdownText(rawResult.taxonomicStatus),
      accepted: rawResult.accepted && escapeMarkdownText(rawResult.accepted),
      parent: rawResult.parent && escapeMarkdownText(rawResult.parent),
      publishedIn: rawResult.publishedIn && escapeMarkdownText(rawResult.publishedIn),
      kingdom: rawResult.kingdom && escapeMarkdownText(rawResult.kingdom),
      phylum: rawResult.phylum && escapeMarkdownText(rawResult.phylum),
      class: rawResult.class && escapeMarkdownText(rawResult.class),
      order: rawResult.order && escapeMarkdownText(rawResult.order),
      family: rawResult.family && escapeMarkdownText(rawResult.family),
      genus: rawResult.genus && escapeMarkdownText(rawResult.genus),
      species: rawResult.species && escapeMarkdownText(rawResult.species),
    };
    const lines: string[] = [];
    if (result.canonicalName || result.scientificName) {
      lines.push(`## ${result.canonicalName ?? result.scientificName}`);
    }
    if (result.key != null) lines.push(`**Taxon usage key:** ${result.key}`);
    if (result.datasetKey != null) lines.push(`**Dataset key:** ${result.datasetKey}`);
    if (result.nubKey != null) lines.push(`**Backbone key:** ${result.nubKey}`);
    if (result.scientificName) lines.push(`**Scientific name:** ${result.scientificName}`);
    if (result.authorship) lines.push(`**Authorship:** ${result.authorship}`);
    if (result.vernacularName) lines.push(`**Common name:** ${result.vernacularName}`);
    if (result.rank) lines.push(`**Rank:** ${result.rank}`);
    if (result.taxonomicStatus) lines.push(`**Status:** ${result.taxonomicStatus}`);
    if (result.accepted)
      lines.push(
        `**Accepted name:** ${result.accepted}${result.acceptedKey != null ? ` (key: ${result.acceptedKey})` : ''}`,
      );
    else if (result.acceptedKey != null) lines.push(`**Accepted key:** ${result.acceptedKey}`);
    if (result.parent)
      lines.push(
        `**Parent:** ${result.parent}${result.parentKey != null ? ` (key: ${result.parentKey})` : ''}`,
      );
    else if (result.parentKey != null) lines.push(`**Parent key:** ${result.parentKey}`);
    if (result.numDescendants != null) lines.push(`**Descendants:** ${result.numDescendants}`);
    if (result.numOccurrences != null) lines.push(`**Occurrences:** ${result.numOccurrences}`);
    if (typeof result.extinct === 'boolean') {
      lines.push(`**Extinct:** ${result.extinct ? 'Yes' : 'No'}`);
    }
    if (result.publishedIn) lines.push(`**Published in:** ${result.publishedIn}`);
    // Each rank renders "Name (key)" when the name is present, and a key-only entry when the
    // name is absent but GBIF still supplies the key (sparse records, e.g. Panthera leo's classKey
    // with no class name). Mirrors this file's accepted/parent key-only fallback so text-only
    // clients never lose the rank key that structuredContent already carries. Keys are tested
    // with `!= null`, never truthiness: key 0 is the backbone kingdom incertae sedis.
    const classificationParts: string[] = [];
    if (result.kingdom)
      classificationParts.push(
        `Kingdom: ${result.kingdom}${result.kingdomKey != null ? ` (${result.kingdomKey})` : ''}`,
      );
    else if (result.kingdomKey != null)
      classificationParts.push(`Kingdom key: ${result.kingdomKey}`);
    if (result.phylum)
      classificationParts.push(
        `Phylum: ${result.phylum}${result.phylumKey != null ? ` (${result.phylumKey})` : ''}`,
      );
    else if (result.phylumKey != null) classificationParts.push(`Phylum key: ${result.phylumKey}`);
    if (result.class)
      classificationParts.push(
        `Class: ${result.class}${result.classKey != null ? ` (${result.classKey})` : ''}`,
      );
    else if (result.classKey != null) classificationParts.push(`Class key: ${result.classKey}`);
    if (result.order)
      classificationParts.push(
        `Order: ${result.order}${result.orderKey != null ? ` (${result.orderKey})` : ''}`,
      );
    else if (result.orderKey != null) classificationParts.push(`Order key: ${result.orderKey}`);
    if (result.family)
      classificationParts.push(
        `Family: ${result.family}${result.familyKey != null ? ` (${result.familyKey})` : ''}`,
      );
    else if (result.familyKey != null) classificationParts.push(`Family key: ${result.familyKey}`);
    if (result.genus)
      classificationParts.push(
        `Genus: ${result.genus}${result.genusKey != null ? ` (${result.genusKey})` : ''}`,
      );
    else if (result.genusKey != null) classificationParts.push(`Genus key: ${result.genusKey}`);
    if (result.species)
      classificationParts.push(
        `Species: ${result.species}${result.speciesKey != null ? ` (${result.speciesKey})` : ''}`,
      );
    else if (result.speciesKey != null)
      classificationParts.push(`Species key: ${result.speciesKey}`);
    if (classificationParts.length > 0) {
      lines.push(`**Classification:** ${classificationParts.join(' › ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
