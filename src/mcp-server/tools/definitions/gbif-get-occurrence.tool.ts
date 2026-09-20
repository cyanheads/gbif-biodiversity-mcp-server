/**
 * @fileoverview Fetch a single GBIF occurrence record by key.
 * @module mcp-server/tools/definitions/gbif-get-occurrence
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawGadm, RawGadmLevel, RawOccurrenceRecord } from '@/services/gbif/types.js';

/** Output schema for one GADM administrative level. A fresh instance per call keeps the emitted JSON Schema inline (no $ref). */
const gadmLevel = () =>
  z.object({
    gid: z
      .string()
      .optional()
      .describe(
        'GADM GID — stable administrative-unit identifier (e.g. SWE, SWE.2_1). May be absent.',
      ),
    name: z.string().optional().describe('Administrative-unit name. May be absent.'),
  });

/** Keep a GADM level only when it carries a gid or name; drop empty placeholders. */
const compactLevel = (l: RawGadmLevel | undefined) =>
  l && (l.gid || l.name) ? { gid: l.gid, name: l.name } : undefined;

/**
 * Project the raw GADM object to gid/name at levels 0–3; undefined when no level
 * carries data. Level 3 is the finest GBIF's occurrence index carries, and only
 * where a country subdivides that far — Sweden stops at level 2, South Africa
 * reaches the municipality.
 */
const compactGadm = (g: RawGadm | undefined) => {
  if (!g) return;
  const level0 = compactLevel(g.level0);
  const level1 = compactLevel(g.level1);
  const level2 = compactLevel(g.level2);
  const level3 = compactLevel(g.level3);
  if (!level0 && !level1 && !level2 && !level3) return;
  return { level0, level1, level2, level3 };
};

export const gbifGetOccurrence = tool('gbif_get_occurrence', {
  title: 'Get Occurrence Record',
  description:
    'Fetch a single occurrence record by its GBIF occurrence key. Returns the complete Darwin Core ' +
    'record — all coordinates, administrative geography (GADM levels 0–3), dates, collections metadata, ' +
    'collector identifiers, conservation status, media links, and quality issue flags. Check ' +
    'occurrenceStatus before reading the record as a sighting: ABSENT means a survey looked for the ' +
    'taxon and did not find it. Use the occurrence key from gbif_search_occurrences results.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    occurrenceKey: z.number().describe('GBIF occurrence key from gbif_search_occurrences results.'),
  }),
  output: z.object({
    key: z.number().optional().describe('GBIF occurrence key.'),
    datasetKey: z.string().optional().describe('UUID of the source dataset.'),
    occurrenceID: z
      .string()
      .optional()
      .describe(
        'Darwin Core occurrenceID — the source record identifier, often a URL back to the origin record. May be absent.',
      ),
    taxonKey: z.number().optional().describe('Backbone taxon key.'),
    scientificName: z.string().optional().describe('Scientific name from occurrence record.'),
    canonicalName: z.string().optional().describe('Canonical name without authorship.'),
    kingdom: z.string().optional().describe('Kingdom classification.'),
    phylum: z.string().optional().describe('Phylum classification.'),
    class: z.string().optional().describe('Class classification. May be absent.'),
    classKey: z.number().optional().describe('Backbone taxon key for the class. May be absent.'),
    order: z.string().optional().describe('Order classification.'),
    family: z.string().optional().describe('Family classification.'),
    genus: z.string().optional().describe('Genus classification.'),
    species: z.string().optional().describe('Species canonical name.'),
    taxonRank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
    taxonomicStatus: z
      .string()
      .optional()
      .describe(
        'Status of the identification carried on this record — ACCEPTED, PROVISIONALLY_ACCEPTED, SYNONYM, DOUBTFUL, and so on. Says whether the occurrence was filed under an accepted name or a synonym. May be absent.',
      ),
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
    gadm: z
      .object({
        level0: gadmLevel().optional().describe('GADM level 0 — country. May be absent.'),
        level1: gadmLevel().optional().describe('GADM level 1 — state/province. May be absent.'),
        level2: gadmLevel().optional().describe('GADM level 2 — county/district. May be absent.'),
        level3: gadmLevel()
          .optional()
          .describe(
            'GADM level 3 — municipality/ward, the finest level GBIF indexes. Absent where the country does not subdivide that far.',
          ),
      })
      .optional()
      .describe(
        'GADM administrative geography — stable GIDs and names at levels 0–3. May be absent.',
      ),
    publishingCountry: z
      .string()
      .optional()
      .describe('Country code of the publishing organization.'),
    eventDate: z
      .string()
      .optional()
      .describe('Observation date as ISO 8601 string. May be absent.'),
    eventTime: z
      .string()
      .optional()
      .describe(
        'Time of day of the observation, with seconds and UTC offset (e.g. 20:15:00+01:00) — the offset eventDate omits when it carries a local time. May be absent.',
      ),
    year: z.number().optional().describe('Observation year. May be absent.'),
    month: z.number().optional().describe('Observation month (1–12). May be absent.'),
    day: z.number().optional().describe('Observation day. May be absent.'),
    basisOfRecord: z.string().optional().describe('How the occurrence was recorded.'),
    occurrenceStatus: z
      .string()
      .optional()
      .describe(
        'PRESENT when the record asserts the taxon was there, ABSENT when it documents a survey that looked and did not find it. An ABSENT record is not a sighting — it carries coordinates, a date, and a recorder all the same. May be absent.',
      ),
    iucnRedListCategory: z
      .string()
      .optional()
      .describe(
        'IUCN Red List category of the taxon — CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. May be absent.',
      ),
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
    identifiers: z
      .array(
        z
          .object({
            type: z
              .string()
              .optional()
              .describe('Identifier type (e.g. URL, DOI, GBIF_PORTAL). May be absent.'),
            identifier: z.string().optional().describe('The identifier value. May be absent.'),
          })
          .describe('An alternative identifier for the occurrence record.'),
      )
      .optional()
      .describe('Alternative record identifiers from the source. May be absent.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The occurrenceKey does not exist in GBIF.',
      recovery: 'Use gbif_search_occurrences to find valid occurrence keys.',
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'GBIF rejected the occurrenceKey as unparseable — a fraction, or a value past the largest integer the endpoint accepts.',
      recovery:
        'Occurrence keys are whole numbers; take one from the key field of a gbif_search_occurrences result rather than constructing it.',
      thrownBy: 'service',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence record', { occurrenceKey: input.occurrenceKey });
    let raw: RawOccurrenceRecord;
    try {
      raw = await getGbifService().getOccurrence(input.occurrenceKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === -32001) {
        throw ctx.fail('not_found', `Occurrence key ${input.occurrenceKey} not found in GBIF.`, {
          ...ctx.recoveryFor('not_found'),
        });
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Occurrence key ${input.occurrenceKey} not found in GBIF.`, {
        ...ctx.recoveryFor('not_found'),
      });
    }

    return {
      key: raw.key,
      datasetKey: raw.datasetKey,
      occurrenceID: raw.occurrenceID,
      taxonKey: raw.taxonKey,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      kingdom: raw.kingdom,
      phylum: raw.phylum,
      class: raw.class,
      classKey: raw.classKey,
      order: raw.order,
      family: raw.family,
      genus: raw.genus,
      species: raw.species,
      taxonRank: raw.taxonRank,
      taxonomicStatus: raw.taxonomicStatus,
      decimalLatitude: raw.decimalLatitude,
      decimalLongitude: raw.decimalLongitude,
      coordinateUncertaintyInMeters: raw.coordinateUncertaintyInMeters,
      continent: raw.continent,
      country: raw.country,
      countryCode: raw.countryCode,
      stateProvince: raw.stateProvince,
      locality: raw.locality,
      gadm: compactGadm(raw.gadm),
      publishingCountry: raw.publishingCountry,
      eventDate: raw.eventDate,
      eventTime: raw.eventTime,
      year: raw.year,
      month: raw.month,
      day: raw.day,
      basisOfRecord: raw.basisOfRecord,
      occurrenceStatus: raw.occurrenceStatus,
      iucnRedListCategory: raw.iucnRedListCategory,
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
      identifiers: raw.identifiers?.length
        ? raw.identifiers.map((id) => ({ type: id.type, identifier: id.identifier }))
        : undefined,
    };
  },

  format: (result) => {
    const lines: string[] = [];
    const canonical = result.canonicalName ?? result.scientificName ?? 'Unknown taxon';
    const sci =
      result.scientificName && result.scientificName !== canonical
        ? ` [${result.scientificName}]`
        : '';
    lines.push(`## ${canonical}${sci}`);
    if (result.key != null) lines.push(`**Occurrence key:** ${result.key}`);
    if (result.taxonKey != null) lines.push(`**Taxon key:** ${result.taxonKey}`);
    if (result.taxonRank) lines.push(`**Rank:** ${result.taxonRank}`);
    if (result.taxonomicStatus) lines.push(`**Taxonomic status:** ${result.taxonomicStatus}`);
    if (result.basisOfRecord) lines.push(`**Basis of record:** ${result.basisOfRecord}`);
    /**
     * Rendered whenever GBIF supplies it, PRESENT included. An absence record is
     * otherwise indistinguishable from a sighting for a `content[]`-only client,
     * which has no `structuredContent` to fall back on.
     */
    if (result.occurrenceStatus) lines.push(`**Occurrence status:** ${result.occurrenceStatus}`);
    if (result.iucnRedListCategory)
      lines.push(`**IUCN Red List category:** ${result.iucnRedListCategory}`);
    // Taxonomy
    const taxParts: string[] = [];
    if (result.kingdom) taxParts.push(`Kingdom: ${result.kingdom}`);
    if (result.phylum) taxParts.push(`Phylum: ${result.phylum}`);
    if (result.class)
      taxParts.push(
        `Class: ${result.class}${result.classKey != null ? ` (${result.classKey})` : ''}`,
      );
    else if (result.classKey != null) taxParts.push(`Class key: ${result.classKey}`);
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
    if (result.eventTime) lines.push(`**Time:** ${result.eventTime}`);
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
    if (result.gadm) {
      const gadmParts: string[] = [];
      for (const lvl of [
        result.gadm.level0,
        result.gadm.level1,
        result.gadm.level2,
        result.gadm.level3,
      ]) {
        if (lvl?.name || lvl?.gid) {
          gadmParts.push(`${lvl.name ?? ''}${lvl.gid ? ` (${lvl.gid})` : ''}`.trim());
        }
      }
      if (gadmParts.length > 0) lines.push(`**GADM:** ${gadmParts.join(' › ')}`);
    }
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
    if (result.occurrenceID) lines.push(`**Occurrence ID:** ${result.occurrenceID}`);
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
    if (result.identifiers?.length) {
      lines.push(`\n**Identifiers:** ${result.identifiers.length} item(s)`);
      for (const id of result.identifiers) {
        const idType = id.type ? `[${id.type}] ` : '';
        lines.push(`  - ${idType}${id.identifier ?? '(no value)'}`);
      }
    }
    if (result.issues?.length) lines.push(`\n**Quality issues:** ${result.issues.join(', ')}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
