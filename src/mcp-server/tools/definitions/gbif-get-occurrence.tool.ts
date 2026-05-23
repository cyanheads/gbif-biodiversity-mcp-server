/**
 * @fileoverview Fetch a single GBIF occurrence record by key.
 * @module mcp-server/tools/definitions/gbif-get-occurrence
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';

export const gbifGetOccurrence = tool('gbif_get_occurrence', {
  title: 'Get Occurrence Record',
  description:
    'Fetch a single occurrence record by its GBIF occurrence key. Returns the complete Darwin Core ' +
    'record — all coordinates, administrative geography (GADM), dates, collections metadata, ' +
    'collector identifiers, media links, and quality issue flags. Use the occurrence key from ' +
    'gbif_search_occurrences results to fetch full detail.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    occurrenceKey: z.number().describe('GBIF occurrence key from gbif_search_occurrences results.'),
  }),
  output: z.object({
    key: z.number().optional().describe('GBIF occurrence key.'),
    datasetKey: z.string().optional().describe('UUID of the source dataset.'),
    taxonKey: z.number().optional().describe('Backbone taxon key.'),
    scientificName: z.string().optional().describe('Scientific name from occurrence record.'),
    canonicalName: z.string().optional().describe('Canonical name without authorship.'),
    kingdom: z.string().optional().describe('Kingdom classification.'),
    phylum: z.string().optional().describe('Phylum classification.'),
    order: z.string().optional().describe('Order classification.'),
    family: z.string().optional().describe('Family classification.'),
    genus: z.string().optional().describe('Genus classification.'),
    species: z.string().optional().describe('Species canonical name.'),
    taxonRank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
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
    continent: z.string().optional().describe('Continent name. May be absent.'),
    country: z.string().optional().describe('Country name. May be absent.'),
    countryCode: z.string().optional().describe('ISO 3166-1 alpha-2 country code. May be absent.'),
    stateProvince: z.string().optional().describe('State or province. May be absent.'),
    locality: z.string().optional().describe('Locality description. May be absent.'),
    publishingCountry: z
      .string()
      .optional()
      .describe('Country code of the publishing organization.'),
    eventDate: z
      .string()
      .optional()
      .describe('Observation date as ISO 8601 string. May be absent.'),
    year: z.number().optional().describe('Observation year. May be absent.'),
    month: z.number().optional().describe('Observation month (1–12). May be absent.'),
    day: z.number().optional().describe('Observation day. May be absent.'),
    basisOfRecord: z.string().optional().describe('How the occurrence was recorded.'),
    institutionCode: z
      .string()
      .optional()
      .describe('Code of the contributing institution. May be absent.'),
    collectionCode: z
      .string()
      .optional()
      .describe('Collection code within the institution. May be absent.'),
    catalogNumber: z
      .string()
      .optional()
      .describe('Catalog number within the collection. May be absent.'),
    recordedBy: z.string().optional().describe('Collector name(s). May be absent.'),
    identifiedBy: z.string().optional().describe('Identifier name(s). May be absent.'),
    individualCount: z.number().optional().describe('Number of individuals. May be absent.'),
    sex: z.string().optional().describe('Sex of the individual(s). May be absent.'),
    lifeStage: z.string().optional().describe('Life stage of the individual(s). May be absent.'),
    issues: z.array(z.string()).optional().describe('GBIF data quality issue flags.'),
    media: z
      .array(
        z
          .object({
            type: z.string().optional().describe('Media type (StillImage, Sound, etc.).'),
            format: z.string().optional().describe('MIME format of the media.'),
            identifier: z.string().optional().describe('URL to the media file.'),
            title: z.string().optional().describe('Media title.'),
            license: z.string().optional().describe('License for the media.'),
          })
          .describe('A media item (image, audio, video) associated with the occurrence.'),
      )
      .optional()
      .describe('Associated media (images, audio, video). May be absent.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The occurrenceKey does not exist in GBIF.',
      recovery: 'Use gbif_search_occurrences to find valid occurrence keys.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence record', { occurrenceKey: input.occurrenceKey });
    const raw = await getGbifService().getOccurrence(input.occurrenceKey, ctx);

    if (!raw.key) {
      throw ctx.fail('not_found', `Occurrence key ${input.occurrenceKey} not found in GBIF.`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    return {
      key: raw.key,
      datasetKey: raw.datasetKey,
      taxonKey: raw.taxonKey,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      kingdom: raw.kingdom,
      phylum: raw.phylum,
      order: raw.order,
      family: raw.family,
      genus: raw.genus,
      species: raw.species,
      taxonRank: raw.taxonRank,
      decimalLatitude: raw.decimalLatitude,
      decimalLongitude: raw.decimalLongitude,
      coordinateUncertaintyInMeters: raw.coordinateUncertaintyInMeters,
      continent: raw.continent,
      country: raw.country,
      countryCode: raw.countryCode,
      stateProvince: raw.stateProvince,
      locality: raw.locality,
      publishingCountry: raw.publishingCountry,
      eventDate: raw.eventDate,
      year: raw.year,
      month: raw.month,
      day: raw.day,
      basisOfRecord: raw.basisOfRecord,
      institutionCode: raw.institutionCode,
      collectionCode: raw.collectionCode,
      catalogNumber: raw.catalogNumber,
      recordedBy: raw.recordedBy,
      identifiedBy: raw.identifiedBy,
      individualCount: raw.individualCount,
      sex: raw.sex,
      lifeStage: raw.lifeStage,
      issues: raw.issues?.length ? raw.issues : undefined,
      media: raw.media?.length
        ? raw.media.map((m) => ({
            type: m.type,
            format: m.format,
            identifier: m.identifier,
            title: m.title,
            license: m.license,
          }))
        : undefined,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    const canonical = result.canonicalName ?? 'Unknown taxon';
    const sci =
      result.scientificName && result.scientificName !== canonical
        ? ` [${result.scientificName}]`
        : '';
    lines.push(`## ${canonical}${sci}`);
    if (result.key != null) lines.push(`**Occurrence key:** ${result.key}`);
    if (result.taxonKey != null) lines.push(`**Taxon key:** ${result.taxonKey}`);
    if (result.taxonRank) lines.push(`**Rank:** ${result.taxonRank}`);
    if (result.basisOfRecord) lines.push(`**Basis of record:** ${result.basisOfRecord}`);
    // Taxonomy
    const taxParts: string[] = [];
    if (result.kingdom) taxParts.push(`Kingdom: ${result.kingdom}`);
    if (result.phylum) taxParts.push(`Phylum: ${result.phylum}`);
    if (result.order) taxParts.push(`Order: ${result.order}`);
    if (result.family) taxParts.push(`Family: ${result.family}`);
    if (result.genus) taxParts.push(`Genus: ${result.genus}`);
    if (result.species) taxParts.push(`Species: ${result.species}`);
    if (taxParts.length > 0) lines.push(`**Taxonomy:** ${taxParts.join(' › ')}`);
    lines.push('');
    if (result.eventDate) {
      lines.push(`**Date:** ${result.eventDate}`);
    } else if (result.year == null) {
      lines.push('**Date:** Not available');
    }
    if (result.year != null) lines.push(`**Year:** ${result.year}`);
    if (result.month != null) lines.push(`**Month:** ${result.month}`);
    if (result.day != null) lines.push(`**Day:** ${result.day}`);
    if (result.decimalLatitude != null && result.decimalLongitude != null) {
      lines.push(
        `**Coordinates:** ${result.decimalLatitude}, ${result.decimalLongitude}${result.coordinateUncertaintyInMeters != null ? ` (±${result.coordinateUncertaintyInMeters}m)` : ''}`,
      );
    } else {
      lines.push('**Coordinates:** Not available');
    }
    const geo: string[] = [];
    if (result.locality) geo.push(result.locality);
    if (result.stateProvince) geo.push(result.stateProvince);
    if (result.country) geo.push(result.country);
    if (result.continent) geo.push(result.continent);
    if (geo.length > 0)
      lines.push(
        `**Location:** ${geo.join(', ')}${result.countryCode ? ` (${result.countryCode})` : ''}`,
      );
    else if (result.countryCode) lines.push(`**Country code:** ${result.countryCode}`);
    if (result.recordedBy) lines.push(`**Recorded by:** ${result.recordedBy}`);
    if (result.identifiedBy) lines.push(`**Identified by:** ${result.identifiedBy}`);
    if (result.individualCount != null)
      lines.push(`**Individual count:** ${result.individualCount}`);
    if (result.sex) lines.push(`**Sex:** ${result.sex}`);
    if (result.lifeStage) lines.push(`**Life stage:** ${result.lifeStage}`);
    lines.push('');
    if (result.institutionCode) lines.push(`**Institution:** ${result.institutionCode}`);
    if (result.collectionCode) lines.push(`**Collection:** ${result.collectionCode}`);
    if (result.catalogNumber) lines.push(`**Catalog number:** ${result.catalogNumber}`);
    if (result.datasetKey) lines.push(`**Dataset key:** ${result.datasetKey}`);
    if (result.publishingCountry) lines.push(`**Publishing country:** ${result.publishingCountry}`);
    if (result.media?.length) {
      lines.push(`\n**Media:** ${result.media.length} item(s)`);
      for (const m of result.media) {
        const mediaType = m.type ?? 'Media';
        const mediaTitle = m.title ? ` — ${m.title}` : '';
        const mediaFmt = m.format ? ` (${m.format})` : '';
        const mediaLicense = m.license ? ` [${m.license}]` : '';
        lines.push(
          `  - ${mediaType}${mediaTitle}${mediaFmt}${mediaLicense}${m.identifier ? `: ${m.identifier}` : ''}`,
        );
      }
    }
    if (result.issues?.length) lines.push(`\n**Quality issues:** ${result.issues.join(', ')}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
