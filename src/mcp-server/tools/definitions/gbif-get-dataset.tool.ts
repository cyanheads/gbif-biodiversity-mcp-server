/**
 * @fileoverview Fetch full metadata for a GBIF dataset by key.
 * @module mcp-server/tools/definitions/gbif-get-dataset
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawDatasetRecord } from '@/services/gbif/types.js';
import {
  compactGeographicCoverages,
  compactTemporalCoverages,
  projectContacts,
  stripHtml,
} from '../utils.js';

export const gbifGetDataset = tool('gbif_get_dataset', {
  title: 'Get Dataset',
  description:
    'Fetch full dataset metadata by UUID key — title, description, citation text, contacts, license, ' +
    'DOI, numConstituents (sub-datasets), and temporal/geographic coverage. Use after gbif_search_datasets ' +
    "or when an occurrence record's datasetKey needs provenance detail. " +
    'Contacts are capped by contactLimit (default 10); contactsTotal and contactsReturned report the full count.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    datasetKey: z
      .string()
      .describe('Dataset UUID from gbif_search_datasets or an occurrence record.'),
    contactLimit: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(10)
      .describe(
        'Maximum number of contacts to include (default 10, max 100). Set to 0 to omit contact detail while still reporting contactsTotal — useful when citation, license, and record count are all you need from a high-contact dataset like eBird.',
      ),
  }),
  output: z.object({
    key: z.string().optional().describe('Dataset UUID.'),
    title: z.string().optional().describe('Dataset title.'),
    type: z.string().optional().describe('Dataset type (OCCURRENCE, CHECKLIST, etc.).'),
    description: z.string().optional().describe('Full dataset description. May be absent.'),
    license: z.string().optional().describe('License identifier. May be absent.'),
    doi: z.string().optional().describe('DOI for citation. May be absent.'),
    citationText: z
      .string()
      .optional()
      .describe('Full citation text for academic reference. May be absent.'),
    publishingCountry: z
      .string()
      .optional()
      .describe('Country code of the publishing organization.'),
    recordCount: z.number().optional().describe('Number of records in the dataset. May be absent.'),
    numConstituents: z
      .number()
      .optional()
      .describe('Number of constituent sub-datasets. May be absent.'),
    contacts: z
      .array(
        z
          .object({
            type: z
              .string()
              .optional()
              .describe('Contact type (e.g., ADMINISTRATIVE_POINT_OF_CONTACT).'),
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
      .describe(
        'Dataset contacts, capped at contactLimit. Absent when the dataset has no contacts or contactLimit is 0.',
      ),
    contactsTotal: z
      .number()
      .optional()
      .describe(
        'Total contacts on the dataset before applying contactLimit. Present when the dataset has any contacts.',
      ),
    contactsReturned: z
      .number()
      .optional()
      .describe(
        'Number of contacts included in this response (≤ contactLimit). Present when the dataset has any contacts.',
      ),
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

  async handler(input, ctx) {
    ctx.log.info('Fetching dataset record', { datasetKey: input.datasetKey });
    let raw: RawDatasetRecord;
    try {
      raw = await getGbifService().getDataset(input.datasetKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === -32001) {
        throw ctx.fail('not_found', `Dataset ${input.datasetKey} not found in GBIF.`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Dataset ${input.datasetKey} not found in GBIF.`, {
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
      // contactLimit: 0 suppresses contact detail while projectContacts still reports
      // contactsTotal/contactsReturned, so callers learn the dataset has contacts.
      ...projectContacts(raw.contacts, input.contactLimit),
      temporalCoverages: compactTemporalCoverages(raw.temporalCoverages),
      geographicCoverages: compactGeographicCoverages(raw.geographicCoverages),
    };
  },

  format: (result) => {
    const lines: string[] = [];
    lines.push(`## ${result.title ?? 'Dataset'}`);
    if (result.key) lines.push(`**Key:** ${result.key}`);
    if (result.type) lines.push(`**Type:** ${result.type}`);
    if (result.license) lines.push(`**License:** ${result.license}`);
    if (result.doi) lines.push(`**DOI:** ${result.doi}`);
    if (result.publishingCountry) lines.push(`**Publishing country:** ${result.publishingCountry}`);
    if (result.recordCount != null)
      lines.push(`**Records:** ${result.recordCount.toLocaleString()}`);
    if (result.numConstituents != null)
      lines.push(`**Constituent datasets:** ${result.numConstituents}`);
    if (result.temporalCoverages?.length) {
      const ranges = result.temporalCoverages.map((t) => `${t.start ?? '?'} → ${t.end ?? '?'}`);
      lines.push(`**Temporal coverage:** ${ranges.join('; ')}`);
    }
    if (result.geographicCoverages?.length) {
      const descs = result.geographicCoverages.map((g) => g.description).filter(Boolean);
      if (descs.length > 0) lines.push(`**Geographic coverage:** ${descs.join('; ')}`);
    }
    if (result.citationText) lines.push(`\n**Citation:**\n> ${result.citationText}`);
    if (result.description) lines.push(`\n${result.description}`);
    if (result.contactsTotal != null) {
      lines.push(`\n**Contacts:** ${result.contactsReturned ?? 0} of ${result.contactsTotal}`);
      for (const c of result.contacts ?? []) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
        const typeLabel = c.type ? ` [${c.type}]` : '';
        lines.push(`- ${name || '(unnamed)'}${typeLabel}`);
        if (c.organization) lines.push(`  Organization: ${c.organization}`);
        if (c.email?.length) lines.push(`  ${c.email.join(', ')}`);
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
