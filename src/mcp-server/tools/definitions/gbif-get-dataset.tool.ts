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
  isGbifUuid,
  projectContacts,
  resolveDatasetRecordCount,
  stripHtml,
} from '../utils.js';

export const gbifGetDataset = tool('gbif_get_dataset', {
  title: 'Get Dataset',
  description:
    'Fetch full dataset metadata by UUID key — title, description, citation text, contacts, license, ' +
    'DOI, record count, numConstituents (sub-datasets), and temporal/geographic coverage. Use after gbif_search_datasets ' +
    "or when an occurrence record's datasetKey needs provenance detail. " +
    'Contacts are capped by contactLimit (default 10); contactsTotal and contactsReturned report the full count.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    datasetKey: z
      .string()
      .describe('Dataset UUID (8-4-4-4-12 hex) from gbif_search_datasets or an occurrence record.'),
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
    recordCount: z
      .number()
      .optional()
      .describe(
        'Occurrence records GBIF has indexed for this dataset, matching the figure gbif_search_datasets reports. Spans every occurrenceStatus: absence records — surveys that looked for a taxon and did not find it — are counted alongside sightings, and on some datasets they are the overwhelming majority. gbif_count_occurrences with this datasetKey answers the other question, defaulting to occurrenceStatus PRESENT, so the two figures are expected to differ rather than one being wrong. Fetched separately because the detail endpoint omits it; absent when that lookup does not return in time.',
      ),
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

  /**
   * Contact truncation, disclosed in the framework's canonical shape so a client reading
   * only the enrichment trailer learns the list was cut. `contactsTotal`/`contactsReturned`
   * on `output` carry the same fact for callers reading `structuredContent`; both are kept
   * because they are the tool's established output contract and `format()` renders them.
   */
  enrichment: {
    truncated: z
      .boolean()
      .optional()
      .describe(
        'True when the dataset carries more contacts than contactLimit allowed through. Absent when every contact was returned.',
      ),
    shown: z
      .number()
      .optional()
      .describe('Contacts included in this response when the list was capped. Absent otherwise.'),
    cap: z
      .number()
      .optional()
      .describe(
        'contactLimit applied when the list was capped. Raise it (max 100) to see more. Absent otherwise.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'How to reach the contacts contactLimit held back. Absent when every contact was returned.',
      ),
  },

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The datasetKey UUID does not match any dataset in GBIF.',
      recovery:
        "Use gbif_search_datasets to find valid dataset keys, or check the UUID from an occurrence record's datasetKey field.",
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'datasetKey is not a UUID, or GBIF rejected the request as malformed.',
      recovery:
        "Supply the 8-4-4-4-12 hex UUID exactly as gbif_search_datasets returns it, or as it appears in an occurrence record's datasetKey field — a dataset title or DOI is not a key.",
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching dataset record', { datasetKey: input.datasetKey });
    if (!isGbifUuid(input.datasetKey)) {
      throw ctx.fail(
        'invalid_filter',
        `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`,
      );
    }

    let raw: RawDatasetRecord;
    try {
      raw = await getGbifService().getDataset(input.datasetKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail('not_found', `Dataset ${input.datasetKey} not found in GBIF.`);
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Dataset ${input.datasetKey} not found in GBIF.`);
    }

    // contactLimit: 0 suppresses contact detail while projectContacts still reports
    // contactsTotal/contactsReturned, so callers learn the dataset has contacts.
    const contactFields = projectContacts(raw.contacts, input.contactLimit);

    // Disclosed off the projected counts rather than contactLimit alone, so a dataset with
    // fewer contacts than the cap is not reported as truncated.
    if (
      contactFields.contactsTotal !== undefined &&
      contactFields.contactsReturned !== undefined &&
      contactFields.contactsTotal > contactFields.contactsReturned
    ) {
      ctx.enrich.truncated({
        shown: contactFields.contactsReturned,
        cap: input.contactLimit,
        guidance: `Showing ${contactFields.contactsReturned} of ${contactFields.contactsTotal} dataset contacts. Raise contactLimit (max 100) to see more, or set it to 0 to drop contact detail entirely while still reading contactsTotal.`,
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
      recordCount: await resolveDatasetRecordCount(raw, ctx),
      numConstituents: raw.numConstituents,
      ...contactFields,
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
    /**
     * The scope qualifier is rendered inline rather than left to the output
     * schema: a `content[]`-only client never reads the field's description, and
     * a bare figure five orders of magnitude above the sightings for the same key
     * is exactly what reads as a data error.
     */
    if (result.recordCount != null)
      lines.push(
        `**Records:** ${result.recordCount.toLocaleString()} — every indexed occurrence record, absences included. gbif_count_occurrences with this key counts sightings only by default.`,
      );
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
