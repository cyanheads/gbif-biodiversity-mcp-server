/**
 * @fileoverview GBIF species resource — stable URI for taxon records from the backbone.
 * @module mcp-server/resources/definitions/gbif-species
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, validationError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawSpeciesRecord } from '@/services/gbif/types.js';

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

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The taxonKey does not exist in the GBIF backbone.',
      recovery:
        'Use gbif_match_species to resolve a name to a valid backbone key, or gbif_search_species to browse.',
    },
  ],

  async handler(params, ctx) {
    const taxonKey = parseInt(params.taxonKey, 10);
    if (Number.isNaN(taxonKey)) {
      throw validationError(
        `Invalid taxon key: "${params.taxonKey}". Must be a numeric backbone key.`,
      );
    }
    ctx.log.debug('Fetching species resource', { taxonKey });
    let raw: RawSpeciesRecord;
    try {
      raw = await getGbifService().getSpecies(taxonKey, ctx);
    } catch (err) {
      // Map the upstream GBIF 404 envelope to a clean domain not_found, mirroring
      // gbif_get_species — the service throws before the !raw.key check can run.
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('not_found', `Taxon key ${taxonKey} not found in the GBIF backbone.`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Taxon key ${taxonKey} not found in the GBIF backbone.`, {
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
