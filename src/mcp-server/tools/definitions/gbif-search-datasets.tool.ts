/**
 * @fileoverview Search GBIF datasets by keyword, type, country, publishing
 * organization, or hosting organization.
 * @module mcp-server/tools/definitions/gbif-search-datasets
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { firstBlankFilter, isGbifUuid, stripHtml } from '../utils.js';

/**
 * Empty-result and pagination-overshoot guidance.
 *
 * The empty case splits on whether both organization filters were applied.
 * GBIF intersects them, so a caller who put one organization key in both fields
 * asked for the datasets that organization published *and* hosts — usually
 * nothing, since most organizations run no installation of their own. Naming the
 * intersection is what separates that from a genuinely empty search.
 */
function buildNotice(args: {
  totalCount: number;
  datasetCount: number;
  offset: number;
  bothOrgFilters: boolean;
}): string | undefined {
  const { totalCount, datasetCount, offset, bothOrgFilters } = args;
  if (totalCount === 0) {
    return bothOrgFilters
      ? 'No datasets matched, and publishingOrg and hostingOrg were both applied. GBIF intersects them, so only a dataset one organization published and the other serves can match — drop whichever of the two is not the question. Otherwise try a shorter keyword or remove the type or country filter.'
      : 'No datasets matched. Try a shorter keyword, remove the type or country filter, or drop the organization filter — publishingOrg matches only datasets an organization published, hostingOrg only those its installation serves.';
  }
  if (datasetCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchDatasets = tool('gbif_search_datasets', {
  title: 'Search Datasets',
  description:
    'Search GBIF datasets by keyword, type, publishing country (uppercase ISO 3166-1 alpha-2), ' +
    'publishing organization, or hosting organization. ' +
    'The two organization filters answer different questions — publishingOrg matches the ' +
    'organization whose data it is, hostingOrg the organization whose installation serves it — ' +
    'and an organization key from gbif_search_publishers usually wants publishingOrg. ' +
    'Returns dataset title, description, license, record count, and DOI. ' +
    'Use to find the source dataset behind a set of records, or to explore what data collections ' +
    'are available for a taxon, country, or organization.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    q: z
      .string()
      .optional()
      .describe(
        'Free-text search across dataset title and description. Omit the field to browse without a term — a blank or whitespace-only value is rejected rather than sent, because GBIF answers a blank one with all 123,527 indexed datasets and a whitespace-only one with none, and neither is the search a caller who filled the field was asking for.',
      ),
    type: z
      .enum(['OCCURRENCE', 'CHECKLIST', 'METADATA', 'SAMPLING_EVENT'])
      .optional()
      .describe(
        'Filter by dataset type. OCCURRENCE for observation records, CHECKLIST for species lists.',
      ),
    publishingCountry: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'publishingCountry must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("gb"), alpha-3 ("GBR"), and country names ("Britain") match no datasets upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the dataset (e.g., "GB", "US", "DE", "SE"). Lowercase and alpha-3 forms ("gb", "GBR") match nothing upstream, which is why only the uppercase two-letter form is accepted here — unlike the country filter on gbif_search_publishers, which resolves either form. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets; an uppercase pair GBIF does not assign ("XX") is rejected upstream by name.',
      ),
    publishingOrg: z
      .string()
      .optional()
      .describe(
        'UUID (8-4-4-4-12 hex, lowercase — GBIF matches these two keys case-sensitively, so an upper-cased rendering of a real key matches nothing) of the organization that published the dataset — the organization whose data it is, and the question a key from gbif_search_publishers is usually asking. Not the organization that serves it, which is hostingOrg and matches a different set: Butterfly Conservation (0d72dd7f-6f05-46af-85c2-8b6e77ce5534) publishes 3 datasets and hosts none, while the National Biodiversity Network (07f617d0-c688-11d8-bf62-b8a03c50a862) hosts 984 — those 3 among them — and publishes 1. Supplied together the two filters are intersected, not combined, so the same key in both fields returns only what that organization both published and serves.',
      ),
    hostingOrg: z
      .string()
      .optional()
      .describe(
        'UUID (8-4-4-4-12 hex, lowercase — matched case-sensitively, as publishingOrg is) of the organization whose installation serves the dataset — not the organization that published it, which is publishingOrg. Most organizations publish through an installation someone else runs, so a key from gbif_search_publishers matches nothing here for them: of the first 25 GB organizations the registry lists, all 25 host no datasets while 13 publish one or two. Supplied together the two filters are intersected, not combined.',
      ),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of datasets to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    datasets: z
      .array(
        z
          .object({
            key: z.string().optional().describe('Dataset UUID for gbif_get_dataset chaining.'),
            title: z.string().optional().describe('Dataset title.'),
            type: z.string().optional().describe('Dataset type (OCCURRENCE, CHECKLIST, etc.).'),
            description: z
              .string()
              .optional()
              .describe('Brief description, truncated to a 300-character preview. May be absent.'),
            descriptionTruncated: z
              .boolean()
              .optional()
              .describe(
                'True when the description was shortened to the 300-char preview; call gbif_get_dataset with this key for the full text. Omitted when the dataset has no description.',
              ),
            license: z.string().optional().describe('License identifier. May be absent.'),
            doi: z.string().optional().describe('DOI for citation. May be absent.'),
            publishingCountry: z.string().optional().describe('Country code of the publisher.'),
            recordCount: z
              .number()
              .optional()
              .describe(
                'Occurrence records GBIF has indexed for this dataset, spanning every occurrenceStatus: absence records — surveys that looked for a taxon and did not find it — are counted alongside sightings, and on some datasets they are the overwhelming majority. For the sightings-only figure, call gbif_count_occurrences with this key; it defaults to occurrenceStatus PRESENT, so the two figures are expected to differ rather than one being wrong.',
              ),
          })
          .describe('A GBIF dataset with key, title, type, license, and record count.'),
      )
      .describe('Matching datasets.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching datasets before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Datasets returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty or paging overshot. Absent on successful result pages.',
      ),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A filter was supplied blank or whitespace-only, publishingOrg or hostingOrg is not a lowercase 8-4-4-4-12 hex UUID, publishingCountry is a two-letter code GBIF does not assign, or GBIF rejected another filter value as malformed.',
      recovery:
        'A blank filter is not a way to skip one — omit the field instead. Supply publishingOrg and hostingOrg exactly as gbif_search_publishers returns them in its key field — lowercase 8-4-4-4-12 hex; an organization name is not a key, and an upper-cased rendering matches nothing. publishingCountry is a code GBIF assigns, so take one from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching datasets', { q: input.q, type: input.type });
    /**
     * `q` is checked on presence rather than on a non-blank value, because
     * `/dataset/search` answers the two blank forms two different ways and neither
     * is the search that was asked for: `?q=` returns all 123,527 indexed datasets,
     * `?q=%20%20` returns none. One space between the whole index and an empty page
     * is not a distinction a caller can plan around.
     */
    const blankFilter = firstBlankFilter({ q: input.q });
    if (blankFilter) {
      throw ctx.fail(
        'invalid_filter',
        `${blankFilter} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }

    /**
     * Checked whenever the key is present rather than only when it is non-blank,
     * and against the lowercase form rather than `isGbifUuid`'s case-insensitive
     * one. Both departures close a silent wrong answer `/dataset/search` gives on
     * these two parameters specifically. An empty value answers 200 with all
     * 123,527 indexed datasets, so a `?.trim()` guard would hand the entire index
     * to a caller who believes they filtered by organization. And the two
     * organization filters are matched case-sensitively — `publishingOrg` at
     * 0D72DD7F-6F05-46AF-85C2-8B6E77CE5534 answers 200 with 0 where the same key
     * lowercased answers 3 — unlike `datasetKey` on the occurrence routes, which
     * resolves either case, so the shared UUID check is not tightened for it.
     * Kept in the handler rather than a Zod pattern because it catches both the
     * silent class and the malformed one while carrying the invalid_filter reason
     * and its recovery hint; a schema rejection arrives as -32602 under the
     * framework's generic invalid_arguments reason, which no contract can reach.
     */
    for (const [field, value] of [
      ['publishingOrg', input.publishingOrg],
      ['hostingOrg', input.hostingOrg],
    ] as const) {
      if (value !== undefined && !(isGbifUuid(value) && value === value.toLowerCase())) {
        throw ctx.fail(
          'invalid_filter',
          `${field} "${value}" is not a GBIF organization UUID in lowercase 8-4-4-4-12 hex form.`,
        );
      }
    }

    const raw = await getGbifService().searchDatasets(
      {
        ...(input.q !== undefined && { q: input.q }),
        ...(input.type && { type: input.type }),
        ...(input.publishingCountry && { publishingCountry: input.publishingCountry }),
        ...(input.publishingOrg !== undefined && { publishingOrg: input.publishingOrg }),
        ...(input.hostingOrg !== undefined && { hostingOrg: input.hostingOrg }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const datasets = (raw.results ?? []).map((r) => {
      const stripped = r.description ? stripHtml(r.description) : undefined;
      return {
        key: r.key,
        title: r.title,
        type: r.type,
        description: stripped?.slice(0, 300),
        ...(stripped !== undefined && { descriptionTruncated: stripped.length > 300 }),
        license: r.license,
        doi: r.doi,
        publishingCountry: r.publishingCountry,
        recordCount: r.numRecords ?? r.recordCount,
      };
    });

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({ totalCount, offset, limit, endOfRecords });
    const notice = buildNotice({
      totalCount,
      datasetCount: datasets.length,
      offset,
      bothOrgFilters: input.publishingOrg !== undefined && input.hostingOrg !== undefined,
    });
    if (notice) ctx.enrich.notice(notice);

    return { datasets };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.datasets.length}`];
    /**
     * Stated once per page rather than per row, and only when a figure is
     * actually rendered. A `content[]`-only client never reads the field's
     * description, so without this the per-dataset totals arrive unscoped.
     */
    if (result.datasets.some((ds) => ds.recordCount != null)) {
      lines.push(
        'Record counts span every occurrenceStatus, absences included. gbif_count_occurrences with a dataset key counts sightings only by default.',
      );
    }
    for (const ds of result.datasets) {
      lines.push(`\n## ${ds.title ?? 'Untitled dataset'}`);
      if (ds.key) lines.push(`**Key:** ${ds.key}`);
      if (ds.type) lines.push(`**Type:** ${ds.type}`);
      if (ds.license) lines.push(`**License:** ${ds.license}`);
      if (ds.doi) lines.push(`**DOI:** ${ds.doi}`);
      if (ds.publishingCountry) lines.push(`**Publishing country:** ${ds.publishingCountry}`);
      if (ds.recordCount != null) lines.push(`**Records:** ${ds.recordCount.toLocaleString()}`);
      if (ds.description)
        lines.push(
          ds.descriptionTruncated
            ? `${ds.description}… (description truncated — full text via \`gbif_get_dataset\`)`
            : ds.description,
        );
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
