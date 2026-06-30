/**
 * @fileoverview Fetch full metadata for a GBIF dataset by key.
 * @module mcp-server/tools/definitions/gbif-get-dataset
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawDatasetRecord } from '@/services/gbif/types.js';
import { stripHtml } from '../utils.js';

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

    const allContacts = raw.contacts ?? [];
    const contactsTotal = allContacts.length;
    const contacts = allContacts.slice(0, input.contactLimit).map((c) => ({
      type: c.type,
      firstName: c.firstName,
      lastName: c.lastName,
      organization: c.organization,
      email: c.email?.length ? c.email : undefined,
    }));

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
      contacts: contacts.length ? contacts : undefined,
      // Report the full count whenever the dataset has contacts, so contactLimit: 0
      // suppresses the detail while preserving how many exist.
      ...(contactsTotal > 0 && { contactsTotal, contactsReturned: contacts.length }),
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
