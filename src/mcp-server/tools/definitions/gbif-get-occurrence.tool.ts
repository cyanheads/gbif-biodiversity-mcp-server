/**
 * @fileoverview Fetch a single GBIF occurrence record by key.
 * @module mcp-server/tools/definitions/gbif-get-occurrence
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type { RawGadm, RawGadmLevel, RawOccurrenceRecord } from '@/services/gbif/types.js';
import { escapeMarkdownText, linkOrEscapedText } from '../utils.js';

/** Output schema for one GADM administrative level. A fresh instance per call keeps the emitted JSON Schema inline (no $ref). */
const gadmLevel = () =>
  z.object({
    gid: z
      .string()
      .optional()
      .describe(
        'GADM GID — stable administrative-unit identifier (e.g. SWE, SWE.2_1). Pass it as gadmGid to gbif_search_occurrences, gbif_count_occurrences, or gbif_occurrence_facets to filter on this unit. May be absent.',
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
    "Fetch a single occurrence record by its GBIF occurrence key. Returns the Darwin Core record — coordinates with what the publisher withheld or generalized about them (informationWithheld, dataGeneralizations), elevation and depth, administrative geography (GADM levels 0–3), dates, collections metadata, collector identifiers and record number, the identification date (dateIdentified), the recorder's remarks, habitat, sampling protocol and organism quantity, type status, establishment means, the backbone key at every rank, the accepted taxon behind a synonym, conservation status, license, rights holder, publishing organization, the source dataset's name, the link to the source record (references), media links with their rights holders, duplicate-cluster membership (isInCluster), and quality issue flags. Check occurrenceStatus before reading the record as a sighting: NOT_DETECTED (ABSENT or NOT_DETECTED in the occurrenceStatus filter) means a survey looked for the taxon and did not find it. Use the occurrence key from gbif_search_occurrences results.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    occurrenceKey: z
      .number()
      .int()
      .positive()
      .describe('GBIF occurrence key from gbif_search_occurrences results.'),
  }),
  output: z.object({
    key: z.number().optional().describe('GBIF occurrence key.'),
    datasetKey: z.string().optional().describe('UUID of the source dataset.'),
    datasetName: z
      .string()
      .optional()
      .describe(
        'Dataset name as the publisher wrote it on the record — not always the registry title gbif_get_dataset returns for datasetKey. May be absent.',
      ),
    occurrenceID: z
      .string()
      .optional()
      .describe(
        'Darwin Core occurrenceID — the source record identifier, often a URL back to the origin record. May be absent.',
      ),
    references: z
      .string()
      .optional()
      .describe(
        "Link to the source record as the publisher supplies it, usually an http(s) URL — on many specimens the record's only URL, distinct from occurrenceID. May be absent.",
      ),
    taxonKey: z.number().optional().describe('Backbone taxon key.'),
    scientificName: z.string().optional().describe('Scientific name from occurrence record.'),
    canonicalName: z.string().optional().describe('Canonical name without authorship.'),
    kingdom: z.string().optional().describe('Kingdom classification.'),
    kingdomKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the kingdom. May be absent.'),
    phylum: z.string().optional().describe('Phylum classification.'),
    phylumKey: z.number().optional().describe('Backbone taxon key for the phylum. May be absent.'),
    class: z.string().optional().describe('Class classification. May be absent.'),
    classKey: z.number().optional().describe('Backbone taxon key for the class. May be absent.'),
    order: z.string().optional().describe('Order classification.'),
    orderKey: z.number().optional().describe('Backbone taxon key for the order. May be absent.'),
    family: z.string().optional().describe('Family classification.'),
    familyKey: z.number().optional().describe('Backbone taxon key for the family. May be absent.'),
    genus: z.string().optional().describe('Genus classification.'),
    genusKey: z.number().optional().describe('Backbone taxon key for the genus. May be absent.'),
    species: z.string().optional().describe('Species canonical name.'),
    speciesKey: z
      .number()
      .optional()
      .describe('Backbone taxon key for the species. May be absent.'),
    taxonRank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
    taxonomicStatus: z
      .string()
      .optional()
      .describe(
        'Status of the identification carried on this record — ACCEPTED, PROVISIONALLY_ACCEPTED, SYNONYM, DOUBTFUL, and so on. Says whether the occurrence was filed under an accepted name or a synonym. May be absent.',
      ),
    acceptedTaxonKey: z
      .number()
      .optional()
      .describe(
        'Backbone taxon key of the accepted taxon. Equals taxonKey for a record filed under an accepted name; when taxonomicStatus is SYNONYM, taxonKey is the synonym and this is the taxon it resolves to. Passed as taxonKey to the occurrence tools, it covers the accepted taxon and every synonym. May be absent.',
      ),
    acceptedScientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name of the accepted taxon as GBIF writes it, with authorship where GBIF has one (e.g. "Quercus castanea Née") — the accepted counterpart of scientificName. May be absent.',
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
    informationWithheld: z
      .string()
      .optional()
      .describe(
        'What the publisher withheld from the record and why, as written (e.g. "Coordinate uncertainty increased to 28300m to protect threatened taxon") — the coordinates or other values are coarser than observed on purpose. May be absent.',
      ),
    dataGeneralizations: z
      .string()
      .optional()
      .describe(
        'How the publisher generalized the record, as written — the Darwin Core counterpart to informationWithheld for values deliberately coarsened, most often rounded coordinates (e.g. "WGS84 coordinates generalized with formula: …"). May be absent.',
      ),
    elevation: z
      .number()
      .optional()
      .describe('Elevation in meters above sea level. May be absent.'),
    depth: z
      .number()
      .optional()
      .describe('Depth in meters below the local surface, such as a water surface. May be absent.'),
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
    publishingOrganizationKey: z
      .string()
      .optional()
      .describe(
        "UUID of the organization that published the record — GBIF's publishingOrgKey. Pass it as publishingOrg to the occurrence tools or gbif_search_datasets. May be absent.",
      ),
    license: z
      .string()
      .optional()
      .describe(
        'License the record is published under, as the Creative Commons URL GBIF stores (e.g. http://creativecommons.org/licenses/by-nc/4.0/legalcode). The license filter on the occurrence tools takes the matching code instead — CC0_1_0, CC_BY_4_0, or CC_BY_NC_4_0 — not this URL. May be absent.',
      ),
    rightsHolder: z
      .string()
      .optional()
      .describe(
        'Person or organization that owns or manages rights over the record — the name to credit under a CC BY license. May be absent.',
      ),
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
    typeStatus: z
      .string()
      .optional()
      .describe(
        'Nomenclatural type status of the specimen (e.g. Holotype, Isolectotype), as the GBIF concept name the typeStatus filter takes unchanged. May be absent.',
      ),
    occurrenceStatus: z
      .string()
      .optional()
      .describe(
        'Whether the record asserts presence or absence: DETECTED when the taxon was there, NOT_DETECTED when it documents a survey that looked and did not find it. GBIF serves these spellings; the occurrenceStatus filter also takes the older PRESENT and ABSENT, which select the same records. A NOT_DETECTED record is not a sighting — it carries coordinates, a date, and a recorder all the same. May be absent.',
      ),
    establishmentMeans: z
      .string()
      .optional()
      .describe(
        'How the organism came to be at the location (e.g. native, introduced), as the GBIF concept name the establishmentMeans filter takes unchanged. May be absent.',
      ),
    iucnRedListCategory: z
      .string()
      .optional()
      .describe(
        'IUCN Red List category of the taxon — CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent, NE Not Evaluated. May be absent.',
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
    recordNumber: z
      .string()
      .optional()
      .describe(
        'Number the collector assigned when collecting (e.g. "JL 157") — how herbarium specimens are cited, beside recordedBy. Not the catalogNumber. May be absent.',
      ),
    recordedBy: z.string().optional().describe('Collector name(s). May be absent.'),
    identifiedBy: z.string().optional().describe('Identifier name(s). May be absent.'),
    dateIdentified: z
      .string()
      .optional()
      .describe(
        'When the identification was made, as GBIF sends it: YYYY-MM-DDTHH:MM:SS with no UTC offset. GBIF pads a date-only value to T00:00:00 and a year-only one to -01-01T00:00:00, so a midnight time or a 1 January date may be padding rather than recorded precision. May be absent.',
      ),
    individualCount: z.number().optional().describe('Number of individuals. May be absent.'),
    organismQuantity: z
      .number()
      .optional()
      .describe(
        'Quantity of organisms, in the unit organismQuantityType names — survey abundance where individualCount is often absent. May be absent.',
      ),
    organismQuantityType: z
      .string()
      .optional()
      .describe(
        'Unit organismQuantity is counted in, as the publisher wrote it (e.g. Individuals, % biomass). May be absent.',
      ),
    sex: z.string().optional().describe('Sex of the individual(s). May be absent.'),
    lifeStage: z.string().optional().describe('Life stage of the individual(s). May be absent.'),
    habitat: z
      .string()
      .optional()
      .describe('Habitat the publisher recorded for the occurrence. May be absent.'),
    samplingProtocol: z
      .string()
      .optional()
      .describe(
        'Method used to collect or observe the record (e.g. GOV Trawl, acoustic detection) — what separates a survey from an incidental sighting. May be absent.',
      ),
    occurrenceRemarks: z
      .string()
      .optional()
      .describe("The recorder's notes on the record, in full. May be absent."),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'True when GBIF flags the record as a likely duplicate of another — the flag the isInCluster filter on gbif_search_occurrences, gbif_count_occurrences, and gbif_occurrence_facets selects on. GBIF exposes membership only, with no cluster identifier. May be absent.',
      ),
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
            rightsHolder: z
              .string()
              .optional()
              .describe('Rights holder to credit for the media item. May be absent.'),
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
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching occurrence record', { occurrenceKey: input.occurrenceKey });
    let raw: RawOccurrenceRecord;
    try {
      raw = await getGbifService().getOccurrence(input.occurrenceKey, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === -32001) {
        throw ctx.fail('not_found', `Occurrence key ${input.occurrenceKey} not found in GBIF.`);
      }
      throw err;
    }

    if (!raw.key) {
      throw ctx.fail('not_found', `Occurrence key ${input.occurrenceKey} not found in GBIF.`);
    }

    return {
      key: raw.key,
      datasetKey: raw.datasetKey,
      datasetName: raw.datasetName,
      occurrenceID: raw.occurrenceID,
      references: raw.references,
      taxonKey: raw.taxonKey,
      scientificName: raw.scientificName,
      canonicalName: raw.canonicalName,
      kingdom: raw.kingdom,
      kingdomKey: raw.kingdomKey,
      phylum: raw.phylum,
      phylumKey: raw.phylumKey,
      class: raw.class,
      classKey: raw.classKey,
      order: raw.order,
      orderKey: raw.orderKey,
      family: raw.family,
      familyKey: raw.familyKey,
      genus: raw.genus,
      genusKey: raw.genusKey,
      species: raw.species,
      speciesKey: raw.speciesKey,
      taxonRank: raw.taxonRank,
      taxonomicStatus: raw.taxonomicStatus,
      acceptedTaxonKey: raw.acceptedTaxonKey,
      acceptedScientificName: raw.acceptedScientificName,
      decimalLatitude: raw.decimalLatitude,
      decimalLongitude: raw.decimalLongitude,
      coordinateUncertaintyInMeters: raw.coordinateUncertaintyInMeters,
      informationWithheld: raw.informationWithheld,
      dataGeneralizations: raw.dataGeneralizations,
      elevation: raw.elevation,
      depth: raw.depth,
      continent: raw.continent,
      country: raw.country,
      countryCode: raw.countryCode,
      stateProvince: raw.stateProvince,
      locality: raw.locality,
      gadm: compactGadm(raw.gadm),
      publishingCountry: raw.publishingCountry,
      publishingOrganizationKey: raw.publishingOrgKey,
      license: raw.license,
      rightsHolder: raw.rightsHolder,
      eventDate: raw.eventDate,
      eventTime: raw.eventTime,
      year: raw.year,
      month: raw.month,
      day: raw.day,
      basisOfRecord: raw.basisOfRecord,
      typeStatus: raw.typeStatus,
      occurrenceStatus: raw.occurrenceStatus,
      establishmentMeans: raw.establishmentMeans,
      iucnRedListCategory: raw.iucnRedListCategory,
      institutionCode: raw.institutionCode,
      collectionCode: raw.collectionCode,
      catalogNumber: raw.catalogNumber,
      recordNumber: raw.recordNumber,
      recordedBy: raw.recordedBy,
      identifiedBy: raw.identifiedBy,
      dateIdentified: raw.dateIdentified,
      individualCount: raw.individualCount,
      organismQuantity: raw.organismQuantity,
      organismQuantityType: raw.organismQuantityType,
      sex: raw.sex,
      lifeStage: raw.lifeStage,
      habitat: raw.habitat,
      samplingProtocol: raw.samplingProtocol,
      occurrenceRemarks: raw.occurrenceRemarks,
      isInCluster: raw.isInCluster,
      issues: raw.issues?.length ? raw.issues : undefined,
      media: raw.media?.length
        ? raw.media.map((m) => ({
            type: m.type,
            format: m.format,
            identifier: m.identifier,
            title: m.title,
            license: m.license,
            rightsHolder: m.rightsHolder,
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
    if (result.acceptedScientificName)
      lines.push(
        `**Accepted taxon:** ${escapeMarkdownText(result.acceptedScientificName)}${result.acceptedTaxonKey != null ? ` (key: ${result.acceptedTaxonKey})` : ''}`,
      );
    else if (result.acceptedTaxonKey != null)
      lines.push(`**Accepted taxon key:** ${result.acceptedTaxonKey}`);
    if (result.taxonRank) lines.push(`**Rank:** ${result.taxonRank}`);
    if (result.taxonomicStatus) lines.push(`**Taxonomic status:** ${result.taxonomicStatus}`);
    if (result.basisOfRecord) lines.push(`**Basis of record:** ${result.basisOfRecord}`);
    if (result.typeStatus) lines.push(`**Type status:** ${escapeMarkdownText(result.typeStatus)}`);
    /**
     * Rendered whenever GBIF supplies it, DETECTED included. An absence record is
     * otherwise indistinguishable from a sighting for a `content[]`-only client,
     * which has no `structuredContent` to fall back on.
     */
    if (result.occurrenceStatus) lines.push(`**Occurrence status:** ${result.occurrenceStatus}`);
    if (result.establishmentMeans)
      lines.push(`**Establishment means:** ${escapeMarkdownText(result.establishmentMeans)}`);
    if (result.iucnRedListCategory)
      lines.push(`**IUCN Red List category:** ${result.iucnRedListCategory}`);
    // Taxonomy: each rank's backbone key beside its name, or alone when the name is absent.
    const taxParts: string[] = [];
    for (const [rank, name, key] of [
      ['Kingdom', result.kingdom, result.kingdomKey],
      ['Phylum', result.phylum, result.phylumKey],
      ['Class', result.class, result.classKey],
      ['Order', result.order, result.orderKey],
      ['Family', result.family, result.familyKey],
      ['Genus', result.genus, result.genusKey],
      ['Species', result.species, result.speciesKey],
    ] as const) {
      if (name) taxParts.push(`${rank}: ${name}${key != null ? ` (${key})` : ''}`);
      else if (key != null) taxParts.push(`${rank} key: ${key}`);
    }
    if (taxParts.length > 0) lines.push(`**Taxonomy:** ${taxParts.join(' › ')}`);
    lines.push('');
    if (result.eventDate) {
      lines.push(`**Date:** ${result.eventDate}`);
    } else if (result.year == null) {
      lines.push('**Date:** Not available');
    }
    if (result.eventTime) lines.push(`**Time:** ${escapeMarkdownText(result.eventTime)}`);
    if (result.year != null) lines.push(`**Year:** ${result.year}`);
    if (result.month != null) lines.push(`**Month:** ${result.month}`);
    if (result.day != null) lines.push(`**Day:** ${result.day}`);
    if (result.decimalLatitude != null)
      lines.push(`**Latitude:** ${result.decimalLatitude} decimal degrees (WGS84)`);
    if (result.decimalLongitude != null)
      lines.push(`**Longitude:** ${result.decimalLongitude} decimal degrees (WGS84)`);
    if (result.coordinateUncertaintyInMeters != null)
      lines.push(`**Coordinate uncertainty:** ${result.coordinateUncertaintyInMeters} m`);
    if (result.decimalLatitude == null && result.decimalLongitude == null) {
      lines.push('**Coordinates:** Not available');
    }
    if (result.informationWithheld)
      lines.push(`**Information withheld:** ${escapeMarkdownText(result.informationWithheld)}`);
    if (result.dataGeneralizations)
      lines.push(`**Data generalizations:** ${escapeMarkdownText(result.dataGeneralizations)}`);
    if (result.elevation != null) lines.push(`**Elevation:** ${result.elevation} m`);
    if (result.depth != null) lines.push(`**Depth:** ${result.depth} m`);
    const geo: string[] = [];
    if (result.locality) geo.push(escapeMarkdownText(result.locality));
    if (result.stateProvince) geo.push(escapeMarkdownText(result.stateProvince));
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
    if (result.recordedBy) lines.push(`**Recorded by:** ${escapeMarkdownText(result.recordedBy)}`);
    if (result.identifiedBy)
      lines.push(`**Identified by:** ${escapeMarkdownText(result.identifiedBy)}`);
    if (result.dateIdentified) lines.push(`**Date identified:** ${result.dateIdentified}`);
    if (result.individualCount != null)
      lines.push(`**Individual count:** ${result.individualCount}`);
    const quantityType =
      result.organismQuantityType && escapeMarkdownText(result.organismQuantityType);
    if (result.organismQuantity != null)
      lines.push(
        `**Organism quantity:** ${result.organismQuantity}${quantityType ? ` ${quantityType}` : ''}`,
      );
    else if (quantityType) lines.push(`**Organism quantity type:** ${quantityType}`);
    if (result.sex) lines.push(`**Sex:** ${result.sex}`);
    if (result.lifeStage) lines.push(`**Life stage:** ${result.lifeStage}`);
    if (result.habitat) lines.push(`**Habitat:** ${escapeMarkdownText(result.habitat)}`);
    if (result.samplingProtocol)
      lines.push(`**Sampling protocol:** ${escapeMarkdownText(result.samplingProtocol)}`);
    if (result.occurrenceRemarks)
      lines.push(`**Remarks:** ${escapeMarkdownText(result.occurrenceRemarks)}`);
    lines.push('');
    if (result.institutionCode)
      lines.push(`**Institution:** ${escapeMarkdownText(result.institutionCode)}`);
    if (result.collectionCode)
      lines.push(`**Collection:** ${escapeMarkdownText(result.collectionCode)}`);
    if (result.catalogNumber)
      lines.push(`**Catalog number:** ${escapeMarkdownText(result.catalogNumber)}`);
    if (result.recordNumber)
      lines.push(`**Record number:** ${escapeMarkdownText(result.recordNumber)}`);
    if (result.occurrenceID)
      lines.push(`**Occurrence ID:** ${linkOrEscapedText(result.occurrenceID)}`);
    if (result.references) lines.push(`**References:** ${linkOrEscapedText(result.references)}`);
    if (result.datasetKey) lines.push(`**Dataset key:** ${result.datasetKey}`);
    if (result.datasetName)
      lines.push(`**Dataset name:** ${escapeMarkdownText(result.datasetName)}`);
    if (result.isInCluster != null) lines.push(`**In cluster:** ${result.isInCluster}`);
    if (result.publishingCountry) lines.push(`**Publishing country:** ${result.publishingCountry}`);
    if (result.publishingOrganizationKey)
      lines.push(
        `**Publishing organization key:** ${escapeMarkdownText(result.publishingOrganizationKey)}`,
      );
    if (result.license) lines.push(`**License:** ${escapeMarkdownText(result.license)}`);
    if (result.rightsHolder)
      lines.push(`**Rights holder:** ${escapeMarkdownText(result.rightsHolder)}`);
    if (result.media?.length) {
      lines.push(`\n**Media:** ${result.media.length} item(s)`);
      for (const m of result.media) {
        const mediaType = m.type ?? 'Media';
        const mediaTitle = m.title ? ` — ${escapeMarkdownText(m.title)}` : '';
        const mediaFmt = m.format ? ` (${escapeMarkdownText(m.format)})` : '';
        const mediaLicense = m.license ? ` [${escapeMarkdownText(m.license)}]` : '';
        const mediaRights = m.rightsHolder
          ? ` (rights holder: ${escapeMarkdownText(m.rightsHolder)})`
          : '';
        const mediaLink = m.identifier ? `: ${linkOrEscapedText(m.identifier)}` : '';
        lines.push(
          `  - ${mediaType}${mediaTitle}${mediaFmt}${mediaLicense}${mediaRights}${mediaLink}`,
        );
      }
    }
    if (result.identifiers?.length) {
      lines.push(`\n**Identifiers:** ${result.identifiers.length} item(s)`);
      for (const id of result.identifiers) {
        const idType = id.type ? `[${escapeMarkdownText(id.type)}] ` : '';
        lines.push(
          `  - ${idType}${id.identifier === undefined ? '(no value)' : linkOrEscapedText(id.identifier)}`,
        );
      }
    }
    if (result.issues?.length) lines.push(`\n**Quality issues:** ${result.issues.join(', ')}`);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
