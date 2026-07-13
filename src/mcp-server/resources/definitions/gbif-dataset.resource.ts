/**
 * @fileoverview GBIF dataset resource — stable URI for dataset metadata.
 * @module mcp-server/resources/definitions/gbif-dataset
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  compactGeographicCoverages,
  compactTemporalCoverages,
  projectContacts,
  stripHtml,
} from '@/mcp-server/tools/utils.js';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawDatasetRecord } from '@/services/gbif/types.js';

/**
 * Fixed contact cap for the resource. The resource has no contactLimit input (unlike
 * gbif_get_dataset), so it applies a constant cap while still reporting the full count.
 */
const CONTACT_CAP = 10;

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
    contacts: z
      .array(
        z
          .object({
            type: z
              .string()
              .optional()
              .describe('Contact type (e.g., ADMINISTRATIVE_POINT_OF_CONTACT). May be absent.'),
            firstName: z.string().optional().describe('First name. May be absent.'),
            lastName: z.string().optional().describe('Last name. May be absent.'),
            organization: z.string().optional().describe('Organization name. May be absent.'),
            email: z
              .array(z.string())
              .optional()
              .describe('Contact email addresses. May be absent.'),
          })
          .describe('A dataset contact with role, name, organization, and email.'),
      )
      .optional()
      .describe('Dataset contacts, capped at 10. Absent when the dataset has no contacts.'),
    contactsTotal: z
      .number()
      .optional()
      .describe('Total contacts before the cap. Present when the dataset has any contacts.'),
    contactsReturned: z
      .number()
      .optional()
      .describe('Number of contacts included (≤ 10). Present when the dataset has any contacts.'),
    temporalCoverages: z
      .array(
        z
          .object({
            start: z
              .string()
              .optional()
              .describe('Coverage start as an ISO 8601 date-time. May be absent.'),
            end: z
              .string()
              .optional()
              .describe('Coverage end as an ISO 8601 date-time. May be absent.'),
          })
          .describe('A temporal coverage range.'),
      )
      .optional()
      .describe('Temporal coverage ranges declared by the dataset. May be absent.'),
    geographicCoverages: z
      .array(
        z
          .object({
            description: z
              .string()
              .optional()
              .describe('Geographic coverage description (e.g. "Worldwide"). May be absent.'),
          })
          .describe('A geographic coverage entry.'),
      )
      .optional()
      .describe('Geographic coverage descriptions declared by the dataset. May be absent.'),
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
      ...projectContacts(raw.contacts, CONTACT_CAP),
      temporalCoverages: compactTemporalCoverages(raw.temporalCoverages),
      geographicCoverages: compactGeographicCoverages(raw.geographicCoverages),
    };
  },
});
