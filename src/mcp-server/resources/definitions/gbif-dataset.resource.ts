/**
 * @fileoverview GBIF dataset resource — stable URI for dataset metadata.
 * @module mcp-server/resources/definitions/gbif-dataset
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { notFound } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifDatasetResource = resource('gbif://dataset/{datasetKey}', {
  name: 'gbif-dataset',
  title: 'GBIF Dataset',
  description:
    'Dataset metadata — title, description, citation, license, contacts, coverage. ' +
    'Stable URI for provenance context. Use the dataset UUID from gbif_search_datasets or ' +
    "an occurrence record's datasetKey field.",
  mimeType: 'application/json',
  params: z.object({
    datasetKey: z.string().describe('Dataset UUID.'),
  }),
  output: z.object({
    key: z.string().optional().describe('Dataset UUID.'),
    title: z.string().optional().describe('Dataset title.'),
    type: z.string().optional().describe('Dataset type.'),
    description: z.string().optional().describe('Dataset description. May be absent.'),
    license: z.string().optional().describe('License identifier. May be absent.'),
    doi: z.string().optional().describe('DOI for citation. May be absent.'),
    citationText: z.string().optional().describe('Full citation text. May be absent.'),
    publishingCountry: z.string().optional().describe('Publishing organization country.'),
    recordCount: z.number().optional().describe('Number of records. May be absent.'),
    numConstituents: z.number().optional().describe('Number of sub-datasets. May be absent.'),
  }),

  async handler(params, ctx) {
    ctx.log.debug('Fetching dataset resource', { datasetKey: params.datasetKey });
    const raw = await getGbifService().getDataset(params.datasetKey, ctx);

    if (!raw.key) {
      throw notFound(`Dataset ${params.datasetKey} not found in GBIF.`);
    }

    return {
      key: raw.key,
      title: raw.title,
      type: raw.type,
      description: raw.description,
      license: raw.license,
      doi: raw.doi,
      citationText: raw.citation?.text,
      publishingCountry: raw.publishingCountry,
      recordCount: raw.numRecords ?? raw.recordCount,
      numConstituents: raw.numConstituents,
    };
  },
});
