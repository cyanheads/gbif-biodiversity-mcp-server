/**
 * @fileoverview Fetch a taxon record by GBIF backbone key.
 * @module mcp-server/tools/definitions/gbif-get-species
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawSpeciesRecord } from '@/services/gbif/types.js';
import { stripHtml } from '../utils.js';

export const gbifGetSpecies = tool('gbif_get_species', {
  title: 'Get Species Record',
  description:
    'Fetch a single backbone taxon by its GBIF taxon key. Returns full classification, authorship, ' +
    'taxonomic status, vernacular name, descendant count, and publication reference. ' +
    'Use after gbif_match_species when you need the complete record rather than the match summary. ' +
    'When taxonomicStatus is SYNONYM, acceptedKey and accepted fields identify the accepted taxon. ' +
    'The extinct field is absent (not false) on most records — only present on explicitly flagged taxa.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    taxonKey: z
      .number()
      .describe('GBIF backbone taxon key from gbif_match_species or another taxonomy tool.'),
  }),
  output: z.object({
    key: z.number().optional().describe('GBIF backbone taxon key.'),
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
      .describe('Count of child taxa in the backbone under this taxon.'),
    numOccurrences: z.number().optional().describe('Occurrence record count in GBIF.'),
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
    kingdomKey: z.number().optional().describe('Taxon key for the kingdom.'),
    phylumKey: z.number().optional().describe('Taxon key for the phylum.'),
    classKey: z.number().optional().describe('Taxon key for the class.'),
    orderKey: z.number().optional().describe('Taxon key for the order.'),
    familyKey: z.number().optional().describe('Taxon key for the family.'),
    genusKey: z.number().optional().describe('Taxon key for the genus.'),
    speciesKey: z.number().optional().describe('Taxon key for the species.'),
    acceptedKey: z
      .number()
      .optional()
      .describe('Backbone key of the accepted taxon when this record is a synonym.'),
    accepted: z
      .string()
      .optional()
      .describe('Scientific name of the accepted taxon when this record is a synonym.'),
    parentKey: z.number().optional().describe('Taxon key of the immediate parent.'),
    parent: z.string().optional().describe('Name of the immediate parent taxon.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The taxonKey does not exist in the GBIF backbone.',
      recovery:
        'Use gbif_match_species to resolve a name to a valid backbone key, or gbif_search_species to browse.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching species record', { taxonKey: input.taxonKey });
    let raw: RawSpeciesRecord;
    try {
      raw = await getGbifService().getSpecies(input.taxonKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === -32001) {
        throw ctx.fail('not_found', `Taxon key ${input.taxonKey} not found in the GBIF backbone.`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Taxon key ${input.taxonKey} not found in the GBIF backbone.`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    return {
      key: raw.key,
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

  format: (result) => {
    const lines: string[] = [];
    if (result.canonicalName || result.scientificName) {
      lines.push(`## ${result.canonicalName ?? result.scientificName}`);
    }
    if (result.key != null) lines.push(`**Taxon key:** ${result.key}`);
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
    // clients never lose the rank key that structuredContent already carries.
    const classificationParts: string[] = [];
    if (result.kingdom)
      classificationParts.push(
        `Kingdom: ${result.kingdom}${result.kingdomKey ? ` (${result.kingdomKey})` : ''}`,
      );
    else if (result.kingdomKey != null)
      classificationParts.push(`Kingdom key: ${result.kingdomKey}`);
    if (result.phylum)
      classificationParts.push(
        `Phylum: ${result.phylum}${result.phylumKey ? ` (${result.phylumKey})` : ''}`,
      );
    else if (result.phylumKey != null) classificationParts.push(`Phylum key: ${result.phylumKey}`);
    if (result.class)
      classificationParts.push(
        `Class: ${result.class}${result.classKey ? ` (${result.classKey})` : ''}`,
      );
    else if (result.classKey != null) classificationParts.push(`Class key: ${result.classKey}`);
    if (result.order)
      classificationParts.push(
        `Order: ${result.order}${result.orderKey ? ` (${result.orderKey})` : ''}`,
      );
    else if (result.orderKey != null) classificationParts.push(`Order key: ${result.orderKey}`);
    if (result.family)
      classificationParts.push(
        `Family: ${result.family}${result.familyKey ? ` (${result.familyKey})` : ''}`,
      );
    else if (result.familyKey != null) classificationParts.push(`Family key: ${result.familyKey}`);
    if (result.genus)
      classificationParts.push(
        `Genus: ${result.genus}${result.genusKey ? ` (${result.genusKey})` : ''}`,
      );
    else if (result.genusKey != null) classificationParts.push(`Genus key: ${result.genusKey}`);
    if (result.species)
      classificationParts.push(
        `Species: ${result.species}${result.speciesKey ? ` (${result.speciesKey})` : ''}`,
      );
    else if (result.speciesKey != null)
      classificationParts.push(`Species key: ${result.speciesKey}`);
    if (classificationParts.length > 0) {
      lines.push(`**Classification:** ${classificationParts.join(' › ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
