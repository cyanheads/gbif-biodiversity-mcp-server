/**
 * @fileoverview Search GBIF publishing organizations by name or country.
 * @module mcp-server/tools/definitions/gbif-search-publishers
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import { firstBlankFilter } from '../utils.js';

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  publisherCount: number;
  offset: number;
}): string | undefined {
  const { totalCount, publisherCount, offset } = args;
  if (totalCount === 0) {
    return 'No publishers matched. Try a shorter name fragment or remove the country filter.';
  }
  if (publisherCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

export const gbifSearchPublishers = tool('gbif_search_publishers', {
  title: 'Search Publishers',
  description:
    'Search organizations registered with GBIF by name fragment or country. ' +
    'Returns organization key, title, and country — sufficient to chain into gbif_search_datasets ' +
    'as publishingOrg for the datasets an organization published, or as hostingOrg for the ones ' +
    'its own installation serves, or to understand who publishes data for a region. ' +
    'publishingOrg is the usual chain: most organizations publish through an installation ' +
    'someone else runs, so hostingOrg matches nothing for them.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    q: z
      .string()
      .optional()
      .describe(
        'Name fragment to search for. Matches organization names. Omit the field to browse without a term — a blank or whitespace-only value is rejected rather than sent, because the registry answers either with all 3,561 registered organizations.',
      ),
    /**
     * Deliberately unpatterned, unlike the country codes on the occurrence tools
     * and `publishingCountry` on `gbif_search_datasets`. Those hit
     * `/occurrence/search` and `/dataset/search`, which parse a code and then
     * match the verbatim stored string, so `gb` and `GBR` answer 200 with zero
     * rows — a silent wrong answer a `^[A-Z]{2}$` pattern removes.
     * `/organization` resolves the parsed country instead of the string: `gb`
     * returns the same 223 organizations as `GB`, and `USA` the same 499 as
     * `US`. Every form the pattern would reject answers correctly here but one —
     * the empty string, which the registry reads as no filter at all — and the
     * handler rejects that value on its own, so the pattern would buy nothing
     * and cost the forms that work.
     */
    country: z
      .string()
      .optional()
      .describe(
        'ISO 3166-1 country code to filter organizations by country. The alpha-2 form ("GB") is canonical; unlike the country codes on the occurrence tools and gbif_search_datasets, this one also resolves the alpha-3 form ("GBR") and is case-insensitive, because the registry endpoint matches the parsed country rather than the string. A value GBIF cannot parse as a country errors rather than returning an empty list. Omit the field to search every country — an empty string is rejected rather than read as no filter, because the registry answers a blank country with all 3,561 organizations.',
      ),
    limit: z
      .number()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Number of organizations to return (default 20, max 1000).'),
    offset: z.number().min(0).default(0).describe('Pagination offset.'),
  }),
  output: z.object({
    publishers: z
      .array(
        z
          .object({
            key: z
              .string()
              .optional()
              .describe(
                'Organization UUID. Chains into gbif_search_datasets as publishingOrg for the datasets this organization published, or as hostingOrg for the ones its own installation serves — publishingOrg is the usual one, since most organizations host nothing.',
              ),
            title: z.string().optional().describe('Organization name.'),
            country: z.string().optional().describe('ISO 3166-1 alpha-2 country code.'),
            city: z.string().optional().describe('City. May be absent.'),
          })
          .describe('A GBIF-registered publishing organization.'),
      )
      .describe('Matching organizations.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching organizations before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Organizations returned in this page.'),
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
      when: 'q was supplied blank or whitespace-only, country is the empty string, or GBIF could not parse the country value as a country.',
      recovery:
        'A blank filter is not a way to skip one — omit the field instead. Supply country as an ISO 3166-1 alpha-2 code such as US, GB, or SE; a country name is not accepted.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching publishers', { q: input.q, country: input.country });
    /**
     * `q` takes the shared blank check; `country` below does not, and the split is
     * upstream behavior rather than an inconsistency. `/organization` drops a blank
     * `q` in either form — `?q=` and `?q=%20%20` each answer with all 3,561
     * registered organizations against 460 for `museum` — so both are silent. On
     * `country` only the empty string is silent; whitespace draws
     * `400 Cannot parse    into a known Country`, an error naming the value, which
     * the service already tags `invalid_filter` with this tool's own hint.
     */
    const blankFilter = firstBlankFilter({ q: input.q });
    if (blankFilter) {
      throw ctx.fail(
        'invalid_filter',
        `${blankFilter} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`,
      );
    }

    /**
     * The empty string is the one country value the registry answers quietly.
     * `/organization` resolves the parsed country, so `gb`, `gbr`, and `GBR` all
     * answer correctly — which is why the schema carries no shape pattern — and a
     * value it cannot parse, whitespace alone included, draws a 400 the service tags
     * `invalid_filter`. But `/organization?country=` answers 200 with all 3,561
     * registered organizations, so a `?.trim()` guard dropped the filter and handed
     * back the whole registry to a caller who believed they had narrowed it to one
     * country — 223 for GB. Rejecting it is the treatment `^[A-Z]{2}$` already gives a
     * blank value on every other country field in this server.
     */
    if (input.country === '') {
      throw ctx.fail(
        'invalid_filter',
        'country was supplied as an empty string, which filters nothing. Omit it to search every country.',
      );
    }

    const raw = await getGbifService().searchPublishers(
      {
        ...(input.q !== undefined && { q: input.q }),
        ...(input.country !== undefined && { country: input.country }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const publishers = (raw.results ?? []).map((r) => ({
      key: r.key,
      title: r.title,
      country: r.country,
      city: r.city,
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({ totalCount, offset, limit, endOfRecords });
    const notice = buildNotice({ totalCount, publisherCount: publishers.length, offset });
    if (notice) ctx.enrich.notice(notice);

    return { publishers };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.publishers.length}`];
    for (const pub of result.publishers) {
      lines.push(`\n- **${pub.title ?? 'Unknown'}**`);
      if (pub.key) lines.push(`  Key: ${pub.key}`);
      const location: string[] = [];
      if (pub.city) location.push(pub.city);
      if (pub.country) location.push(pub.country);
      if (location.length > 0) lines.push(`  Location: ${location.join(', ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
