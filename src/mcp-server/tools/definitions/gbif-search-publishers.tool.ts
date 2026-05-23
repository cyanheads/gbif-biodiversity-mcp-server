/**
 * @fileoverview Search GBIF publishing organizations by name or country.
 * @module mcp-server/tools/definitions/gbif-search-publishers
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifSearchPublishers = tool('gbif_search_publishers', {
  title: 'Search Publishers',
  description:
    'Search organizations registered with GBIF by name fragment or country. ' +
    'Returns organization key, title, and country — sufficient to chain into gbif_search_datasets ' +
    'with hostingOrg, or to understand who publishes data for a region.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    q: z.string().optional().describe('Name fragment to search for. Matches organization names.'),
    country: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code to filter organizations by country.'),
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
              .describe('Organization UUID for gbif_search_datasets hostingOrg parameter.'),
            title: z.string().optional().describe('Organization name.'),
            country: z.string().optional().describe('ISO 3166-1 alpha-2 country code.'),
            city: z.string().optional().describe('City. May be absent.'),
          })
          .describe('A GBIF-registered publishing organization.'),
      )
      .describe('Matching organizations.'),
    totalCount: z.number().describe('Total matching organizations before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Organizations returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
  }),

  async handler(input, ctx) {
    ctx.log.info('Searching publishers', { q: input.q, country: input.country });
    const raw = await getGbifService().searchPublishers(
      {
        ...(input.q?.trim() && { q: input.q }),
        ...(input.country?.trim() && { country: input.country }),
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

    return {
      publishers,
      totalCount: raw.count ?? 0,
      offset: raw.offset ?? input.offset,
      limit: raw.limit ?? input.limit,
      endOfRecords: raw.endOfRecords ?? true,
    };
  },

  format: (result) => {
    const lines: string[] = [
      `**Total matches:** ${result.totalCount} | **Showing:** ${result.publishers.length} | **Limit:** ${result.limit} | **End of records:** ${result.endOfRecords} (offset ${result.offset})`,
    ];
    for (const pub of result.publishers) {
      lines.push(`\n- **${pub.title ?? 'Unknown'}**`);
      if (pub.key) lines.push(`  Key: ${pub.key}`);
      const location: string[] = [];
      if (pub.city) location.push(pub.city);
      if (pub.country) location.push(pub.country);
      if (location.length > 0) lines.push(`  Location: ${location.join(', ')}`);
    }
    if (!result.endOfRecords) {
      lines.push(`\n*More results — use offset ${result.offset + result.limit} to continue.*`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
