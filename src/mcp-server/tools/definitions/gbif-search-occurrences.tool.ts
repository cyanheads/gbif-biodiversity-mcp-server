/**
 * @fileoverview Search GBIF occurrence records with Darwin Core filters.
 * @module mcp-server/tools/definitions/gbif-search-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

/** Empty-result and pagination-overshoot guidance. */
function buildNotice(args: {
  totalCount: number;
  occurrenceCount: number;
  offset: number;
}): string | undefined {
  const { totalCount, occurrenceCount, offset } = args;
  if (totalCount === 0) {
    return 'No occurrences matched the filters. Try broadening the taxon (use gbif_match_species for a reliable taxonKey), relaxing geographic filters, expanding the year range, or removing basisOfRecord.';
  }
  if (occurrenceCount === 0 && offset > 0 && offset >= totalCount) {
    return `Offset ${offset} exceeds totalCount (${totalCount}). Reset offset to 0 or reduce it below ${totalCount} to page through results.`;
  }
  return;
}

const PAGINATION_CAP = 99_000;

export const gbifSearchOccurrences = tool('gbif_search_occurrences', {
  title: 'Search Occurrences',
  description:
    'Search 2.4B+ GBIF occurrence records with Darwin Core filters. Use taxonKey from gbif_match_species ' +
    'for reliable results — it resolves synonyms automatically. Accepts country (ISO 3166-1 alpha-2), ' +
    'bounding box (decimalLatitude/decimalLongitude ranges), WKT polygon geometry, year range, month, ' +
    'basis of record, and coordinate filter. Pagination is capped at approximately offset+limit=100,000 — ' +
    'use gbif_occurrence_facets for aggregate counts across large result sets.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    taxonKey: z
      .number()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — matches all synonyms automatically. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.).',
      ),
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name filter. Less precise than taxonKey — does not match synonyms. Use taxonKey from gbif_match_species for reliable results.',
      ),
    country: z
      .string()
      .optional()
      .describe('ISO 3166-1 alpha-2 country code (e.g., "GB", "US", "DE", "SE").'),
    decimalLatitude: z
      .string()
      .optional()
      .describe(
        'Latitude range as "min,max" (e.g., "47.0,48.5"). Decimal degrees, WGS84. Combine with decimalLongitude for a bounding box.',
      ),
    decimalLongitude: z
      .string()
      .optional()
      .describe(
        'Longitude range as "min,max" (e.g., "8.0,9.5"). Decimal degrees, WGS84. Combine with decimalLatitude for a bounding box.',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. Takes precedence over decimalLatitude/decimalLongitude.',
      ),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year. Both endpoints inclusive.',
      ),
    month: z
      .number()
      .min(1)
      .max(12)
      .optional()
      .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
    basisOfRecord: z
      .enum([
        'HUMAN_OBSERVATION',
        'MACHINE_OBSERVATION',
        'PRESERVED_SPECIMEN',
        'LIVING_SPECIMEN',
        'MATERIAL_SAMPLE',
        'MATERIAL_CITATION',
        'OCCURRENCE',
        'LITERATURE',
      ])
      .optional()
      .describe(
        'Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science. PRESERVED_SPECIMEN covers natural history collections.',
      ),
    hasCoordinate: z
      .boolean()
      .optional()
      .describe(
        'When true, return only georeferenced records. When false, include records without coordinates.',
      ),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all. ' +
          'Note: GBIF does not expose a cluster identifier — only the membership flag. To de-duplicate, set ' +
          'isInCluster: false to exclude all clustered records.',
      ),
    coordinateUncertaintyInMeters: z
      .string()
      .optional()
      .describe(
        'Filter by coordinate uncertainty radius in meters. Range format: "min,max" (e.g., "0,1000" for sub-kilometer precision). Both endpoints inclusive.',
      ),
    limit: z
      .number()
      .min(1)
      .max(300)
      .default(20)
      .describe('Number of records to return (default 20, max 300).'),
    offset: z
      .number()
      .min(0)
      .default(0)
      .describe(
        'Pagination offset. GBIF caps offset+limit at approximately 100,000 — use gbif_occurrence_facets for aggregate analysis beyond this.',
      ),
  }),
  output: z.object({
    occurrences: z
      .array(
        z
          .object({
            key: z
              .number()
              .optional()
              .describe('GBIF occurrence key for gbif_get_occurrence chaining.'),
            taxonKey: z.number().optional().describe('Backbone taxon key.'),
            scientificName: z
              .string()
              .optional()
              .describe('Scientific name from occurrence record.'),
            canonicalName: z.string().optional().describe('Canonical name without authorship.'),
            rank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
            decimalLatitude: z
              .number()
              .optional()
              .describe('Latitude in decimal degrees (WGS84). May be absent.'),
            decimalLongitude: z
              .number()
              .optional()
              .describe('Longitude in decimal degrees (WGS84). May be absent.'),
            coordinateUncertaintyInMeters: z
              .number()
              .optional()
              .describe('Coordinate uncertainty radius in meters. May be absent.'),
            country: z.string().optional().describe('Country name. May be absent.'),
            countryCode: z
              .string()
              .optional()
              .describe('ISO 3166-1 alpha-2 country code. May be absent.'),
            stateProvince: z.string().optional().describe('State or province name. May be absent.'),
            locality: z.string().optional().describe('Locality description. May be absent.'),
            eventDate: z
              .string()
              .optional()
              .describe('Observation date as ISO 8601 string. May be absent.'),
            year: z.number().optional().describe('Observation year. May be absent.'),
            month: z.number().optional().describe('Observation month (1–12). May be absent.'),
            day: z.number().optional().describe('Observation day. May be absent.'),
            basisOfRecord: z.string().optional().describe('How the occurrence was recorded.'),
            individualCount: z
              .number()
              .optional()
              .describe('Number of individuals. May be absent.'),
            datasetKey: z.string().optional().describe('UUID of the source dataset.'),
            datasetName: z
              .string()
              .optional()
              .describe('Name of the source dataset. May be absent.'),
            publishingCountry: z
              .string()
              .optional()
              .describe('Country code of the publishing organization.'),
            recordedBy: z.string().optional().describe('Collector name(s). May be absent.'),
            issues: z
              .array(z.string())
              .optional()
              .describe('GBIF data quality issue flags for this record.'),
          })
          .describe(
            'A single occurrence record with location, taxon, date, and provenance fields.',
          ),
      )
      .describe('Occurrence records matching the filters.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    totalCount: z.number().describe('Total matching occurrences before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
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
      reason: 'pagination_cap_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'offset + limit exceeds the GBIF API pagination cap of ~100,000.',
      recovery:
        'Reduce offset or limit so their sum stays under 100,000. Use gbif_occurrence_facets for aggregate analysis across large result sets.',
    },
    {
      reason: 'upstream_error',
      code: JsonRpcErrorCode.InternalError,
      when: 'The GBIF occurrence search API returned an unexpected error.',
      recovery:
        'Retry the request or narrow the filters. Check that geometry WKT is valid if supplied.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Searching occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
      limit: input.limit,
      offset: input.offset,
    });

    if (input.offset + input.limit > PAGINATION_CAP) {
      throw ctx.fail(
        'pagination_cap_exceeded',
        `offset + limit (${input.offset + input.limit}) exceeds the GBIF pagination cap of ~100,000. Use gbif_occurrence_facets for aggregate analysis, or reduce offset/limit.`,
        { ...ctx.recoveryFor('pagination_cap_exceeded') },
      );
    }

    const raw = await getGbifService().searchOccurrences(
      {
        ...(input.taxonKey !== undefined && { taxonKey: input.taxonKey }),
        ...(input.scientificName?.trim() && { scientificName: input.scientificName }),
        ...(input.country?.trim() && { country: input.country }),
        ...(input.decimalLatitude?.trim() && { decimalLatitude: input.decimalLatitude }),
        ...(input.decimalLongitude?.trim() && { decimalLongitude: input.decimalLongitude }),
        ...(input.geometry?.trim() && { geometry: input.geometry }),
        ...(input.year?.trim() && { year: input.year }),
        ...(input.month !== undefined && { month: input.month }),
        ...(input.basisOfRecord && { basisOfRecord: input.basisOfRecord }),
        ...(input.hasCoordinate !== undefined && { hasCoordinate: input.hasCoordinate }),
        ...(input.isInCluster !== undefined && { isInCluster: input.isInCluster }),
        ...(input.coordinateUncertaintyInMeters?.trim() && {
          coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
        }),
        limit: input.limit,
        offset: input.offset,
      },
      ctx,
    );

    const occurrences = (raw.results ?? []).map((r) => ({
      key: r.key,
      taxonKey: r.taxonKey,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.taxonRank,
      decimalLatitude: r.decimalLatitude,
      decimalLongitude: r.decimalLongitude,
      coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters,
      country: r.country,
      countryCode: r.countryCode,
      stateProvince: r.stateProvince,
      locality: r.locality,
      eventDate: r.eventDate,
      year: r.year,
      month: r.month,
      day: r.day,
      basisOfRecord: r.basisOfRecord,
      individualCount: r.individualCount,
      datasetKey: r.datasetKey,
      datasetName: r.datasetName,
      publishingCountry: r.publishingCountry,
      recordedBy: r.recordedBy,
      issues: r.issues?.length ? r.issues : undefined,
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({ totalCount, offset, limit, endOfRecords });
    const notice = buildNotice({ totalCount, occurrenceCount: occurrences.length, offset });
    if (notice) ctx.enrich.notice(notice);

    return { occurrences };
  },

  format: (result) => {
    const lines: string[] = [`**Results:** ${result.occurrences.length}`];
    for (const occ of result.occurrences) {
      const canonical = occ.canonicalName ?? occ.scientificName ?? 'Unknown taxon';
      const sci =
        occ.scientificName && occ.scientificName !== canonical ? ` [${occ.scientificName}]` : '';
      lines.push(`\n## ${canonical}${sci}`);
      if (occ.key != null) lines.push(`**Occurrence key:** ${occ.key}`);
      if (occ.taxonKey != null) lines.push(`**Taxon key:** ${occ.taxonKey}`);
      if (occ.rank) lines.push(`**Rank:** ${occ.rank}`);
      if (occ.basisOfRecord) lines.push(`**Basis of record:** ${occ.basisOfRecord}`);
      if (occ.eventDate) {
        lines.push(`**Date:** ${occ.eventDate}`);
      }
      if (occ.year != null) lines.push(`**Year:** ${occ.year}`);
      if (occ.month != null) lines.push(`**Month:** ${occ.month}`);
      if (occ.day != null) lines.push(`**Day:** ${occ.day}`);
      if (occ.decimalLatitude != null && occ.decimalLongitude != null) {
        lines.push(
          `**Coordinates:** ${occ.decimalLatitude}, ${occ.decimalLongitude}${occ.coordinateUncertaintyInMeters != null ? ` (±${occ.coordinateUncertaintyInMeters}m)` : ''}`,
        );
      } else {
        lines.push('**Coordinates:** Not available');
      }
      const geo: string[] = [];
      if (occ.locality) geo.push(occ.locality);
      if (occ.stateProvince) geo.push(occ.stateProvince);
      if (occ.country) geo.push(occ.country);
      if (geo.length > 0)
        lines.push(
          `**Location:** ${geo.join(', ')}${occ.countryCode ? ` (${occ.countryCode})` : ''}`,
        );
      else if (occ.countryCode) lines.push(`**Country code:** ${occ.countryCode}`);
      if (occ.publishingCountry) lines.push(`**Publishing country:** ${occ.publishingCountry}`);
      if (occ.recordedBy) lines.push(`**Recorded by:** ${occ.recordedBy}`);
      if (occ.individualCount != null) lines.push(`**Count:** ${occ.individualCount}`);
      if (occ.datasetKey)
        lines.push(`**Dataset:** ${occ.datasetName ?? occ.datasetKey} (key: ${occ.datasetKey})`);
      if (occ.issues?.length) lines.push(`**Issues:** ${occ.issues.join(', ')}`);
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
