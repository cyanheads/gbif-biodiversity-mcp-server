/**
 * @fileoverview GBIF species resource — stable URI for taxon records from the backbone.
 * @module mcp-server/resources/definitions/gbif-species
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifSpeciesResource = resource('gbif://species/{taxonKey}', {
  name: 'gbif-species',
  title: 'GBIF Species Record',
  description:
    'Taxon record from the GBIF backbone — classification, authorship, synonymy status, ' +
    'vernacular name. Stable URI for caching and injection as context.',
  mimeType: 'application/json',
  params: z.object({
    taxonKey: z.string().describe('GBIF backbone taxon key as a string.'),
  }),
  output: z.object({
    key: z.number().optional().describe('GBIF backbone taxon key.'),
    scientificName: z.string().optional().describe('Full scientific name with authorship.'),
    canonicalName: z.string().optional().describe('Scientific name without authorship.'),
    authorship: z.string().optional().describe('Taxonomic authorship.'),
    vernacularName: z.string().optional().describe('English common name when available.'),
    rank: z.string().optional().describe('Taxonomic rank.'),
    taxonomicStatus: z.string().optional().describe('ACCEPTED, SYNONYM, DOUBTFUL, etc.'),
    kingdom: z.string().optional().describe('Kingdom classification.'),
    phylum: z.string().optional().describe('Phylum classification.'),
    class: z.string().optional().describe('Class classification.'),
    order: z.string().optional().describe('Order classification.'),
    family: z.string().optional().describe('Family classification.'),
    genus: z.string().optional().describe('Genus classification.'),
    numDescendants: z.number().optional().describe('Count of child taxa in backbone.'),
    extinct: z.boolean().optional().describe('True when explicitly flagged as extinct.'),
    acceptedKey: z.number().optional().describe('Accepted taxon key when synonym.'),
    accepted: z.string().optional().describe('Accepted name when synonym.'),
  }),

  async handler(params, ctx) {
    const taxonKey = parseInt(params.taxonKey, 10);
    if (Number.isNaN(taxonKey)) {
      throw validationError(
        `Invalid taxon key: "${params.taxonKey}". Must be a numeric backbone key.`,
      );
    }
    ctx.log.debug('Fetching species resource', { taxonKey });
    const raw = await getGbifService().getSpecies(taxonKey, ctx);

    if (!raw.key) {
      throw notFound(`Taxon key ${taxonKey} not found in the GBIF backbone.`);
    }

    return {
      key: raw.key,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      authorship: raw.authorship,
      vernacularName: raw.vernacularName,
      rank: raw.rank,
      taxonomicStatus: raw.taxonomicStatus,
      kingdom: raw.kingdom,
      phylum: raw.phylum,
      class: raw.clazz,
      order: raw.order,
      family: raw.family,
      genus: raw.genus,
      numDescendants: raw.numDescendants,
      acceptedKey: raw.acceptedKey,
      accepted: raw.accepted,
      ...(typeof raw.extinct === 'boolean' && { extinct: raw.extinct }),
    };
  },
});
