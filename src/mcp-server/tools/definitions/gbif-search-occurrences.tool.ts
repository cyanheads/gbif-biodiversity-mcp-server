/**
 * @fileoverview Search GBIF occurrence records with Darwin Core filters.
 * @module mcp-server/tools/definitions/gbif-search-occurrences
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  BASIS_OF_RECORD_VALUES,
  IUCN_RED_LIST_CATEGORY_VALUES,
  OCCURRENCE_STATUS_VALUES,
} from '@/services/gbif/types.js';
import { clampReadLimit, readLimitSchema } from '../read-limits.js';
import {
  escapeMarkdownText,
  exactCoordinateMatchNotice,
  occurrenceFilters,
  occurrenceFilterViolation,
  occurrenceNoMatchNotices,
  occurrenceScope,
  occurrenceScopeSchema,
  occurrenceStatusNotice,
  overPaginationCapNotice,
  PAGINATION_CAP,
  sharedOccurrenceFilterFields,
} from '../utils.js';

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

export const gbifSearchOccurrences = tool('gbif_search_occurrences', {
  title: 'Search Occurrences',
  description:
    "Search GBIF occurrence records with Darwin Core filters. Use taxonKey from gbif_match_species for reliable results — a key names exactly one taxon, where a scientificName shared across kingdoms matches nothing; a Catalogue of Life key goes in checklistTaxonKey with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b. Accepts country (uppercase ISO 3166-1 alpha-2, where the record was observed), publishingCountry (the publishing organization's country — a different question), stateProvince, gadmGid (a GADM administrative-area code GBIF derives from coordinates), bounding box (decimalLatitude/decimalLongitude ranges), WKT polygon geometry, year range, month, basis of record, coordinate filter, hasGeospatialIssue, dataset key, publishingOrg (the publishing organization), catalogNumber, institutionCode, recordedBy (collector), mediaType, typeStatus, establishmentMeans, and license. Rows carry no media unless includeMedia is set. Returns sightings only by default — GBIF also indexes absence records (surveys that looked and found nothing), and occurrenceStatus controls whether they are included. Pagination is capped at offset+limit=100,001 and GBIF offers no cursor or scroll, so a larger result set is covered only by partitioning it — facet it by DATASET_KEY with gbif_occurrence_facets and search each datasetKey separately. BASIS_OF_RECORD and PUBLISHING_COUNTRY are gap-free second cuts for a dataset bucket still over the cap; YEAR, MONTH, STATE_PROVINCE, and SPECIES_KEY lose records lacking that dimension. Repeat every biological filter on the facet call and each partition search, including the same occurrenceStatus, and compare sub-split sums against the bucket total. Bulk retrieval is outside this server: use the asynchronous GBIF Download API with a GBIF.org account or the monthly GBIF Parquet snapshot on AWS Open Data.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    taxonKey: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe(
        'GBIF backbone taxon key from gbif_match_species. Preferred over scientificName — a key names exactly one taxon, where a name can be shared across kingdoms. Matches the given taxon and all descendant taxa (subspecies, varieties, etc.). Rejected under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b — pass a Catalogue of Life key as checklistTaxonKey there.',
      ),
    scientificName: z
      .string()
      .optional()
      .describe(
        'Scientific name filter, which GBIF resolves to its accepted taxon, so a synonym returns the records of that taxon. Less precise than taxonKey: a name shared across kingdoms, such as Oenanthe (a bird genus and a plant genus), matches nothing, so use taxonKey from gbif_match_species with kingdom set for one. Supplying both does not narrow the search: GBIF combines the two taxon filters with OR, so the result is the union of the two, not their intersection. Omit the field to search every name — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered result set.',
      ),
    country: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'country must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("gb"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of where the occurrence was recorded (e.g., "GB", "US", "DE", "SE"). Not the publisher\'s country — that is publishingCountry, and the two disagree on most records. Lowercase and alpha-3 forms ("gb", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here. Take a value from a COUNTRY facet on gbif_occurrence_facets; an uppercase pair GBIF does not know ("XX") is rejected upstream by name.',
      ),
    publishingCountry: z
      .string()
      .regex(
        /^[A-Z]{2}$/,
        'publishingCountry must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE. Lowercase ("us"), alpha-3 ("USA"), and country names ("Britain") match no records upstream.',
      )
      .optional()
      .describe(
        'ISO 3166-1 alpha-2 code, uppercase, of the organization that published the record — distinct from where the occurrence was observed, which is country. Take a value from a PUBLISHING_COUNTRY facet on gbif_occurrence_facets. Lowercase and alpha-3 forms ("us", "USA") match nothing upstream, which is why only the uppercase two-letter form is accepted here.',
      ),
    stateProvince: z
      .string()
      .optional()
      .describe(
        'State, province, or first-level administrative division, matched as a verbatim string — exact and case-sensitive. GBIF stores what each dataset recorded without normalizing it, so there is no vocabulary to guess from: "England", "England - Greater London", and "Greater London" are three distinct values, and "england" is none of them. Take one from a STATE_PROVINCE facet on gbif_occurrence_facets scoped the same way and pass it back unchanged — an unmatched value returns zero records rather than an error. Omit the field to search every state or province — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered result set. Records carrying no stateProvince match no value, so this cannot partition a scope.',
      ),
    geometry: z
      .string()
      .optional()
      .describe(
        'WKT polygon for geographic filtering (e.g., POLYGON((8 47, 9 47, 9 48, 8 48, 8 47))). Coordinates are longitude latitude. All supplied spatial filters intersect: decimalLatitude and decimalLongitude remain active and restrict results to the overlap. Omit the field to search everywhere — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered result set.',
      ),
    year: z
      .string()
      .optional()
      .describe(
        'Year or year range. Single year: "2024". Range: "2020,2024". Filters by observation year. Both endpoints inclusive. Omit the field to search every year — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered result set.',
      ),
    month: z
      .number()
      .int()
      .min(1)
      .max(12)
      .optional()
      .describe('Calendar month (1–12). Useful for seasonal distribution queries.'),
    basisOfRecord: z
      .enum(BASIS_OF_RECORD_VALUES)
      .optional()
      .describe(
        'Filter by how the occurrence was recorded. HUMAN_OBSERVATION covers citizen science. PRESERVED_SPECIMEN covers natural history collections.',
      ),
    hasCoordinate: z
      .boolean()
      .optional()
      .describe(
        'When true, return only georeferenced records (those with coordinates). When false, return ONLY records without coordinates. Omit the parameter entirely to include all records regardless of coordinate presence.',
      ),
    isInCluster: z
      .boolean()
      .optional()
      .describe(
        'Filter to records flagged as likely duplicates (true) or exclude them (false). Omit to include all. ' +
          'Note: GBIF does not expose a cluster identifier — only the membership flag. To de-duplicate, set ' +
          'isInCluster: false to exclude all clustered records.',
      ),
    datasetKey: z
      .string()
      .optional()
      .describe(
        'Restrict results to a single dataset by its GBIF dataset UUID (8-4-4-4-12 hex). Obtain one from gbif_search_datasets, gbif_get_dataset, a DATASET_KEY facet (gbif_occurrence_facets), or the datasetKey field on an occurrence record. Omit the field to search every dataset — an empty string is rejected rather than read as no filter, because GBIF answers a blank datasetKey with the unfiltered result set.',
      ),
    occurrenceStatus: z
      .enum(OCCURRENCE_STATUS_VALUES)
      .default('PRESENT')
      .describe(
        "Presence/absence filter. Defaults to PRESENT: an ABSENT record documents a survey that looked for the taxon and did not find it, so including one would read as a sighting of the opposite. Use ANY for both (GBIF's own default), or ABSENT for non-observations alone. DETECTED and NOT_DETECTED, the spelling records and OCCURRENCE_STATUS facet buckets carry, select the same records as PRESENT and ABSENT and are sent as given.",
      ),
    iucnRedListCategory: z
      .enum(IUCN_RED_LIST_CATEGORY_VALUES)
      .optional()
      .describe(
        'Restrict to records whose taxon carries this IUCN Red List category: CR Critically Endangered, EN Endangered, VU Vulnerable, NT Near Threatened, LC Least Concern, DD Data Deficient, EX Extinct, EW Extinct in the Wild, CD Conservation Dependent. Records with no category are excluded when this is set.',
      ),
    ...sharedOccurrenceFilterFields(),
    includeMedia: z
      .boolean()
      .default(false)
      .describe(
        "Add each record's media items to its row as media — type, identifier URL, license, and rightsHolder for each, in the record's own order. Every item on a matched record is returned, whatever mediaType selected: that filter picks records carrying the type, not items. Off by default because each item adds to both response surfaces; gbif_get_occurrence returns one record's media with title and format.",
      ),
    limit: readLimitSchema(z.number().int().min(1), 300)
      .default(20)
      .describe('Number of records to return (default 20, max 300).'),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe(
        'Pagination offset. GBIF serves offset+limit up to 100,001 and rejects anything past it, with no cursor or scroll to continue from. To reach a result set larger than that, split it into per-datasetKey searches using a DATASET_KEY facet from gbif_occurrence_facets — gap-free and high-cardinality, unlike YEAR, which leaves undated records in no bucket — rather than paging deeper.',
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
            taxonKey: z
              .number()
              .optional()
              .describe(
                'Backbone taxon key — also when checklistKey scoped the search by a Catalogue of Life key.',
              ),
            scientificName: z
              .string()
              .optional()
              .describe('Scientific name from occurrence record.'),
            canonicalName: z.string().optional().describe('Canonical name without authorship.'),
            rank: z.string().optional().describe('Taxonomic rank of the identified taxon.'),
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
                'Backbone taxon key of the accepted taxon. Equals taxonKey for a record filed under an accepted name; when taxonomicStatus is SYNONYM, taxonKey is the synonym and this is the taxon it resolves to. Passed as taxonKey, it covers the accepted taxon and every synonym. May be absent.',
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
            elevation: z
              .number()
              .optional()
              .describe('Elevation in meters above sea level. May be absent.'),
            depth: z
              .number()
              .optional()
              .describe(
                'Depth in meters below the local surface, such as a water surface. May be absent.',
              ),
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
                'Whether the record asserts presence or absence: DETECTED when the taxon was there, NOT_DETECTED when it documents a survey that looked and did not find it. GBIF serves these spellings; the occurrenceStatus filter also takes the older PRESENT and ABSENT, which select the same records. A NOT_DETECTED record is not a sighting. May be absent.',
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
                'IUCN Red List category of the taxon — CR, EN, VU, NT, LC, DD, EX, EW, or CD. May be absent.',
              ),
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
                'License the record is published under, as the Creative Commons URL GBIF stores (e.g. http://creativecommons.org/licenses/by-nc/4.0/legalcode). The license filter takes the matching code instead — CC0_1_0, CC_BY_4_0, or CC_BY_NC_4_0 — not this URL. May be absent.',
              ),
            rightsHolder: z
              .string()
              .optional()
              .describe(
                'Person or organization that owns or manages rights over the record — the name to credit under a CC BY license. May be absent.',
              ),
            recordedBy: z.string().optional().describe('Collector name(s). May be absent.'),
            institutionCode: z
              .string()
              .optional()
              .describe(
                'Code of the institution holding the record — the value the institutionCode filter matches. May be absent.',
              ),
            catalogNumber: z
              .string()
              .optional()
              .describe(
                'Catalog number the holding collection assigned — the value the catalogNumber filter matches. May be absent.',
              ),
            recordNumber: z
              .string()
              .optional()
              .describe(
                'Number the collector assigned when collecting (e.g. "JL 157") — how herbarium specimens are cited, beside recordedBy. Not the catalogNumber. May be absent.',
              ),
            issues: z
              .array(z.string())
              .optional()
              .describe('GBIF data quality issue flags for this record.'),
            media: z
              .array(
                z
                  .object({
                    type: z
                      .string()
                      .optional()
                      .describe('Media type (StillImage, Sound, MovingImage, …). May be absent.'),
                    identifier: z
                      .string()
                      .optional()
                      .describe('URL of the media file. May be absent.'),
                    license: z
                      .string()
                      .optional()
                      .describe(
                        "License of the item as its source states it — a URL or free text, which can differ from the record's license. May be absent.",
                      ),
                    rightsHolder: z
                      .string()
                      .optional()
                      .describe('Rights holder to credit for the item. May be absent.'),
                  })
                  .describe('A media item (image, sound, video) attached to the record.'),
              )
              .optional()
              .describe(
                "Every media item on the record, in the record's order, whatever mediaType selected. Present only when includeMedia is true and the record has media.",
              ),
          })
          .describe(
            'A single occurrence record with location, taxon, date, and provenance fields.',
          ),
      )
      .describe('Occurrence records matching the filters.'),
  }),

  // Pagination context and recovery guidance — reaches both structuredContent and content[].
  enrichment: {
    scope: occurrenceScopeSchema,
    totalCount: z.number().describe('Total matching occurrences before pagination.'),
    offset: z.number().describe('Current pagination offset.'),
    limit: z.number().describe('Records returned in this page.'),
    endOfRecords: z.boolean().describe('True when there are no more results after this page.'),
    occurrenceStatus: z
      .string()
      .describe(
        'The presence/absence filter applied upstream, as sent — PRESENT or DETECTED for sightings, ABSENT or NOT_DETECTED for absences, or ANY when no filter was sent. Says what totalCount and the returned records cover.',
      ),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance when results are empty, paging overshot, a read limit was clamped, a scientificName or an exact-match stateProvince, gadmGid, or recordedBy filter matched nothing, a decimalLatitude, decimalLongitude, or coordinateUncertaintyInMeters without a comma matched only that exact value, the match is larger than the pagination cap can reach, or a presence/absence filter narrowed the result. Absent only when none applies.',
      ),
  },

  enrichmentTrailer: { scope: { render: (scope) => `**scope:** ${JSON.stringify(scope)}` } },

  errors: [
    {
      reason: 'pagination_cap_exceeded',
      code: JsonRpcErrorCode.ValidationError,
      when: 'offset + limit exceeds 100,001, the deepest page GBIF serves.',
      recovery:
        "Reduce offset or limit so their sum is at most 100,001; GBIF exposes no cursor or scroll, so no parameter continues past it. To cover a result set larger than the cap, partition it instead of paging deeper: call gbif_occurrence_facets with facet DATASET_KEY, repeating this search's filters (every occurrence carries exactly one datasetKey, so the buckets cover the scope with no gaps or overlap, and facetOffset pages through them), then re-run this search once per datasetKey. A bucket still over the cap cuts further on BASIS_OF_RECORD or PUBLISHING_COUNTRY — gap-free dimensions that split a PRESENT-scoped bucket further (OCCURRENCE_STATUS is gap-free too, but yields a single bucket under the PRESENT default), both with a matching filter here (basisOfRecord, publishingCountry). Do not take YEAR as the first cut — records without a year fall outside every year bucket, and MONTH, STATE_PROVINCE, and SPECIES_KEY lose records the same way, stateProvince included even though this tool can filter on it. Either second cut can also return a single bucket inside one dataset, so compare any sub-split's sum against the bucket total before relying on it. gbif_occurrence_facets accepts the same biological filters: repeat all of them on the facet call and each per-datasetKey search to preserve the population. Bucket counts reconcile against the occurrenceStatus in force, PRESENT by default here. Retrieving the set in one piece is not possible through this server: the GBIF Download API requires a GBIF.org account, runs asynchronously, and returns a ZIP archive, and the monthly GBIF Parquet snapshot on AWS Open Data is a bulk dataset — both are routes for the caller to take directly.",
    },
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'A filter value is unusable — a string filter other than country and publishingCountry supplied blank or whitespace-only (a blank country or publishingCountry fails earlier, at its uppercase pattern, as -32602 invalid_arguments), a bare "*" as decimalLatitude, decimalLongitude, or coordinateUncertaintyInMeters, a datasetKey or publishingOrg that is not an 8-4-4-4-12 hex UUID, a gadmGid holding a character other than an uppercase letter, digit, dot, or underscore, a checklistTaxonKey holding a character other than an uppercase letter or digit, a taxonKey under checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b or a checklistTaxonKey without it, a typeStatus or establishmentMeans naming no concept in its GBIF vocabulary, a two-letter country or publishingCountry code GBIF does not know, or a WKT geometry or range GBIF rejects.',
      recovery:
        'The message names the rejected value. A blank filter is not a way to skip one — omit the field instead. Otherwise correct that one filter: geometry is a closed WKT ring in longitude latitude order, ranges are "min,max", datasetKey is a UUID from gbif_search_datasets, publishingOrg is an organization UUID from gbif_search_publishers, gadmGid is an uppercase GADM GID such as ESP.1_1 taken from a GADM_LEVEL_0_GID through GADM_LEVEL_3_GID facet or the gadm field of gbif_get_occurrence, taxonKey takes a Backbone key and checklistTaxonKey a Catalogue of Life key such as 3WSJV from gbif_match_species, the second only with checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b and the first only without it, typeStatus and establishmentMeans take a concept the message lists, and country and publishingCountry are codes GBIF assigns, so take one from a COUNTRY or PUBLISHING_COUNTRY facet on gbif_occurrence_facets.',
    },
  ],

  async handler(input, ctx) {
    const clamp = clampReadLimit(input.limit, 300, 'gbif_search_occurrences', 'limit', ctx);
    input = { ...input, limit: clamp.applied };
    ctx.log.info('Searching occurrences', {
      taxonKey: input.taxonKey,
      country: input.country,
      limit: input.limit,
      offset: input.offset,
    });

    if (input.offset + input.limit > PAGINATION_CAP) {
      throw ctx.fail(
        'pagination_cap_exceeded',
        `offset + limit (${input.offset + input.limit}) exceeds ${PAGINATION_CAP.toLocaleString('en-US')}, the deepest page GBIF serves. Reduce offset/limit, or partition the query by datasetKey and page each part separately.`,
      );
    }

    const violation = occurrenceFilterViolation(input);
    if (violation) throw ctx.fail('invalid_filter', violation);

    const { limit: requestedLimit, offset: requestedOffset, includeMedia, ...filters } = input;
    const raw = await getGbifService().searchOccurrences(
      { ...occurrenceFilters(filters), limit: requestedLimit, offset: requestedOffset },
      ctx,
    );

    const occurrences = (raw.results ?? []).map((r) => ({
      key: r.key,
      taxonKey: r.taxonKey,
      scientificName: r.scientificName,
      canonicalName: r.canonicalName,
      rank: r.taxonRank,
      taxonomicStatus: r.taxonomicStatus,
      acceptedTaxonKey: r.acceptedTaxonKey,
      acceptedScientificName: r.acceptedScientificName,
      decimalLatitude: r.decimalLatitude,
      decimalLongitude: r.decimalLongitude,
      coordinateUncertaintyInMeters: r.coordinateUncertaintyInMeters,
      elevation: r.elevation,
      depth: r.depth,
      country: r.country,
      countryCode: r.countryCode,
      stateProvince: r.stateProvince,
      locality: r.locality,
      eventDate: r.eventDate,
      eventTime: r.eventTime,
      year: r.year,
      month: r.month,
      day: r.day,
      basisOfRecord: r.basisOfRecord,
      typeStatus: r.typeStatus,
      occurrenceStatus: r.occurrenceStatus,
      establishmentMeans: r.establishmentMeans,
      iucnRedListCategory: r.iucnRedListCategory,
      individualCount: r.individualCount,
      datasetKey: r.datasetKey,
      datasetName: r.datasetName,
      publishingCountry: r.publishingCountry,
      publishingOrganizationKey: r.publishingOrgKey,
      license: r.license,
      rightsHolder: r.rightsHolder,
      recordedBy: r.recordedBy,
      institutionCode: r.institutionCode,
      catalogNumber: r.catalogNumber,
      recordNumber: r.recordNumber,
      issues: r.issues?.length ? r.issues : undefined,
      media:
        includeMedia && r.media?.length
          ? r.media.map((m) => ({
              type: m.type,
              identifier: m.identifier,
              license: m.license,
              rightsHolder: m.rightsHolder,
            }))
          : undefined,
    }));

    const totalCount = raw.count ?? 0;
    const offset = raw.offset ?? input.offset;
    const limit = raw.limit ?? input.limit;
    const endOfRecords = raw.endOfRecords ?? true;

    ctx.enrich({
      totalCount,
      offset,
      limit,
      endOfRecords,
      occurrenceStatus: input.occurrenceStatus,
      scope: occurrenceScope(input),
    });
    const notice = [
      clamp.notice,
      buildNotice({ totalCount, occurrenceCount: occurrences.length, offset }),
      ...occurrenceNoMatchNotices(input, totalCount),
      exactCoordinateMatchNotice(input),
      overPaginationCapNotice(totalCount),
      occurrenceStatusNotice(input.occurrenceStatus),
    ]
      .filter(Boolean)
      .join(' ');
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
      if (occ.acceptedScientificName)
        lines.push(
          `**Accepted taxon:** ${escapeMarkdownText(occ.acceptedScientificName)}${occ.acceptedTaxonKey != null ? ` (key: ${occ.acceptedTaxonKey})` : ''}`,
        );
      else if (occ.acceptedTaxonKey != null)
        lines.push(`**Accepted taxon key:** ${occ.acceptedTaxonKey}`);
      if (occ.rank) lines.push(`**Rank:** ${occ.rank}`);
      if (occ.taxonomicStatus) lines.push(`**Taxonomic status:** ${occ.taxonomicStatus}`);
      if (occ.basisOfRecord) lines.push(`**Basis of record:** ${occ.basisOfRecord}`);
      if (occ.typeStatus) lines.push(`**Type status:** ${escapeMarkdownText(occ.typeStatus)}`);
      /**
       * Rendered for every record that carries it, DETECTED included. An absence
       * is only distinguishable from a sighting if the status is on the record
       * itself — a `content[]`-only client has no other place to read it.
       */
      if (occ.occurrenceStatus) lines.push(`**Occurrence status:** ${occ.occurrenceStatus}`);
      if (occ.establishmentMeans)
        lines.push(`**Establishment means:** ${escapeMarkdownText(occ.establishmentMeans)}`);
      if (occ.iucnRedListCategory)
        lines.push(`**IUCN Red List category:** ${occ.iucnRedListCategory}`);
      if (occ.eventDate) {
        lines.push(`**Date:** ${occ.eventDate}`);
      }
      if (occ.eventTime) lines.push(`**Time:** ${occ.eventTime}`);
      if (occ.year != null) lines.push(`**Year:** ${occ.year}`);
      if (occ.month != null) lines.push(`**Month:** ${occ.month}`);
      if (occ.day != null) lines.push(`**Day:** ${occ.day}`);
      if (occ.decimalLatitude != null)
        lines.push(`**Latitude:** ${occ.decimalLatitude} decimal degrees (WGS84)`);
      if (occ.decimalLongitude != null)
        lines.push(`**Longitude:** ${occ.decimalLongitude} decimal degrees (WGS84)`);
      if (occ.coordinateUncertaintyInMeters != null)
        lines.push(`**Coordinate uncertainty:** ${occ.coordinateUncertaintyInMeters} m`);
      if (occ.decimalLatitude == null && occ.decimalLongitude == null) {
        lines.push('**Coordinates:** Not available');
      }
      if (occ.elevation != null) lines.push(`**Elevation:** ${occ.elevation} m`);
      if (occ.depth != null) lines.push(`**Depth:** ${occ.depth} m`);
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
      if (occ.publishingOrganizationKey)
        lines.push(
          `**Publishing organization key:** ${escapeMarkdownText(occ.publishingOrganizationKey)}`,
        );
      if (occ.license) lines.push(`**License:** ${escapeMarkdownText(occ.license)}`);
      if (occ.rightsHolder)
        lines.push(`**Rights holder:** ${escapeMarkdownText(occ.rightsHolder)}`);
      if (occ.recordedBy) lines.push(`**Recorded by:** ${occ.recordedBy}`);
      if (occ.institutionCode)
        lines.push(`**Institution:** ${escapeMarkdownText(occ.institutionCode)}`);
      if (occ.catalogNumber)
        lines.push(`**Catalog number:** ${escapeMarkdownText(occ.catalogNumber)}`);
      if (occ.recordNumber)
        lines.push(`**Record number:** ${escapeMarkdownText(occ.recordNumber)}`);
      if (occ.individualCount != null) lines.push(`**Count:** ${occ.individualCount}`);
      if (occ.datasetKey)
        lines.push(`**Dataset:** ${occ.datasetName ?? occ.datasetKey} (key: ${occ.datasetKey})`);
      if (occ.issues?.length) lines.push(`**Issues:** ${occ.issues.join(', ')}`);
      if (occ.media?.length) {
        lines.push(`**Media:** ${occ.media.length} item(s)`);
        for (const m of occ.media) {
          const license = m.license ? ` [${escapeMarkdownText(m.license)}]` : '';
          const rights = m.rightsHolder
            ? ` (rights holder: ${escapeMarkdownText(m.rightsHolder)})`
            : '';
          lines.push(
            `  - ${m.type ?? 'Media'}${license}${rights}${m.identifier ? `: ${m.identifier}` : ''}`,
          );
        }
      }
    }
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
