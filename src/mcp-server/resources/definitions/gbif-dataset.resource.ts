/**
 * @fileoverview GBIF dataset resource — stable URI for dataset metadata.
 * @module mcp-server/resources/definitions/gbif-dataset
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { stripHtml } from '@/mcp-server/tools/utils.js';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawDatasetRecord } from '@/services/gbif/types.js';

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

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The datasetKey UUID does not match any dataset in GBIF.',
      recovery:
        "Use gbif_search_datasets to find valid dataset keys, or check the UUID from an occurrence record's datasetKey field.",
    },
  ],

  async handler(params, ctx) {
    ctx.log.debug('Fetching dataset resource', { datasetKey: params.datasetKey });
    let raw: RawDatasetRecord;
    try {
      raw = await getGbifService().getDataset(params.datasetKey, ctx);
    } catch (err) {
      // Map the upstream GBIF 404 envelope to a clean domain not_found, mirroring
      // gbif_get_dataset — the service throws before the !raw.key check can run.
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('not_found', `Dataset ${params.datasetKey} not found in GBIF.`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Dataset ${params.datasetKey} not found in GBIF.`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    return {
      key: raw.key,
      title: raw.title,
      type: raw.type,
      description: raw.description ? stripHtml(raw.description) : undefined,
      license: raw.license,
      doi: raw.doi,
      citationText: raw.citation?.text,
      publishingCountry: raw.publishingCountry,
      recordCount: raw.numRecords ?? raw.recordCount,
      numConstituents: raw.numConstituents,
    };
  },
});
