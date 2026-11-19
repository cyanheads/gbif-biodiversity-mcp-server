/**
 * @fileoverview Shared utilities for tool definitions.
 * @module mcp-server/tools/utils
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import { markdownLink } from '@cyanheads/mcp-ts-core/utils';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  BASIS_OF_RECORD_VALUES,
  CHECKLIST_KEY_VALUES,
  type ChecklistKey,
  COL_XR_CHECKLIST_KEY,
  ESTABLISHMENT_MEANS_VALUES,
  LICENSE_VALUES,
  MEDIA_TYPE_VALUES,
  OCCURRENCE_FILTER_KEYS,
  type OccurrenceFilters,
  type OccurrenceStatusFilter,
  type RawChecklistSpeciesMatch,
  type RawContact,
  type RawDatasetRecord,
  type RawGeographicCoverage,
  type RawSpeciesMatch,
  type RawTemporalCoverage,
  TYPE_STATUS_VALUES,
} from '@/services/gbif/types.js';

/**
 * The biological filters as an occurrence tool parses them: GBIF's own filter set,
 * with `occurrenceStatus` widened to this server's `ANY` sentinel, and `typeStatus`
 * and `establishmentMeans` as the caller wrote them, before each is matched to its
 * concept.
 */
export type OccurrenceFilterInput = Omit<
  OccurrenceFilters,
  'occurrenceStatus' | 'typeStatus' | 'establishmentMeans'
> & {
  occurrenceStatus: OccurrenceStatusFilter;
  typeStatus?: string | undefined;
  establishmentMeans?: string | undefined;
};

/** Filter echo shared by occurrence search, count and facets on both response surfaces. */
export const occurrenceScopeSchema = z
  .record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.array(z.number())]),
  )
  .describe(
    'Effective supplied biological filters, with occurrenceStatus always included; excludes pagination and facet controls. A filter supplied as an array echoes as that array.',
  );

/**
 * Preserve supplied filter bytes and false/zero values; controls never enter the
 * scope. The one exception is `typeStatus` and `establishmentMeans`: each echoes
 * the concept it was matched to, in GBIF's spelling, because that concept is what
 * was sent and what the scope has to describe — `" holotype "` echoes `Holotype`.
 */
export function occurrenceScope(input: OccurrenceFilterInput) {
  const sent = { ...input, ...occurrenceConcepts(input) };
  return Object.fromEntries(
    OCCURRENCE_FILTER_KEYS.flatMap((key) => (sent[key] === undefined ? [] : [[key, sent[key]]])),
  );
}

/**
 * The filter set to send upstream for a tool's parsed filter fields. GBIF has no
 * term meaning "either", so `ANY` resolves to sending no `occurrenceStatus` at all,
 * and `typeStatus` and `establishmentMeans` go out as their concepts' own spelling.
 * Callers pass their filter fields with the controls (limit, facet, …) already
 * destructured off; the service forwards only filter keys regardless. Run
 * `occurrenceFilterViolation` first: a concept value it would reject throws here.
 */
export function occurrenceFilters({
  occurrenceStatus,
  typeStatus,
  establishmentMeans,
  ...filters
}: OccurrenceFilterInput): OccurrenceFilters {
  return {
    ...filters,
    ...occurrenceConcepts({ typeStatus, establishmentMeans }),
    ...(occurrenceStatus !== 'ANY' && { occurrenceStatus }),
  };
}

/**
 * Each concept vocabulary keyed by its concepts' lowercased names. No two concepts
 * in either vocabulary lowercase to the same name, so a match is never ambiguous.
 */
const foldConcepts = <T extends string>(concepts: readonly T[]): ReadonlyMap<string, T> =>
  new Map(concepts.map((concept) => [concept.toLowerCase(), concept]));
const TYPE_STATUS_CONCEPTS = foldConcepts(TYPE_STATUS_VALUES);
const ESTABLISHMENT_MEANS_CONCEPTS = foldConcepts(ESTABLISHMENT_MEANS_VALUES);

/**
 * The concept a caller's value names: matched ignoring case and surrounding
 * whitespace, since GBIF matches only the exact concept name and answers `holotype`
 * or `Introduced` with zero records, though neither can mean anything else.
 */
const conceptOf = <T extends string>(concepts: ReadonlyMap<string, T>, value: string) =>
  concepts.get(value.trim().toLowerCase());

/**
 * `conceptOf` for a value `occurrenceFilterViolation` already passed. Dropping an
 * unmatched one would send no filter and widen the query, so it throws instead.
 */
function knownConcept<T extends string>(
  concepts: ReadonlyMap<string, T>,
  field: string,
  value: string,
): T {
  const concept = conceptOf(concepts, value);
  if (concept === undefined)
    throw new Error(`${field} "${value}" reached the filter set unchecked.`);
  return concept;
}

/** The supplied `typeStatus` and `establishmentMeans`, each as the concept it names. */
function occurrenceConcepts({
  typeStatus,
  establishmentMeans,
}: Pick<OccurrenceFilterInput, 'typeStatus' | 'establishmentMeans'>): Pick<
  OccurrenceFilters,
  'typeStatus' | 'establishmentMeans'
> {
  return {
    ...(typeStatus !== undefined && {
      typeStatus: knownConcept(TYPE_STATUS_CONCEPTS, 'typeStatus', typeStatus),
    }),
    ...(establishmentMeans !== undefined && {
      establishmentMeans: knownConcept(
        ESTABLISHMENT_MEANS_CONCEPTS,
        'establishmentMeans',
        establishmentMeans,
      ),
    }),
  };
}

/**
 * The position filters — horizontal, its uncertainty, and vertical — GBIF reads as a
 * range only when the value holds a comma, and otherwise as one exact value.
 */
const EXACT_MATCH_FILTERS = [
  'decimalLatitude',
  'decimalLongitude',
  'coordinateUncertaintyInMeters',
  'elevation',
  'depth',
] as const;

/**
 * A range example per `EXACT_MATCH_FILTERS` field, in that field's own unit: sent as
 * elevation, the uncertainty example "0,1000" would be a 0–1,000 m band, not "within
 * 1 km".
 */
const EXACT_MATCH_RANGE_EXAMPLES = {
  decimalLatitude: '"38,39"',
  decimalLongitude: '"-4,-3"',
  coordinateUncertaintyInMeters: '"0,1000" for within 1 km',
  elevation: '"2000,*" for 2,000 m and above',
  depth: '"200,*" for 200 m and deeper',
} as const satisfies Record<(typeof EXACT_MATCH_FILTERS)[number], string>;

/**
 * The range filters GBIF answers a bare `*` on with HTTP 404 and an empty body, which
 * reaches the caller as a not-found with no reason — eventDate with a 400 naming it,
 * refused here beside the others. Each maps to the open-ended range it does take,
 * where `*` stands for one end, or to `undefined` where no such form is offered.
 * Separate from `EXACT_MATCH_FILTERS`: a single year, month, or eventDate is a whole
 * period, not an exact match to warn about.
 */
const BARE_STAR_FILTERS = {
  decimalLatitude: undefined,
  decimalLongitude: undefined,
  coordinateUncertaintyInMeters: '"*,1000"',
  year: '"*,1990" or "2020,*"',
  month: '"*,5" or "9,*"',
  eventDate: '"*,2020-06-30" or "2026-01-01,*"',
  elevation: '"2000,*"',
  depth: '"200,*"',
} as const satisfies Partial<Record<keyof OccurrenceFilters, string | undefined>>;

type BareStarFilter = keyof typeof BARE_STAR_FILTERS;
const BARE_STAR_FIELDS = Object.keys(BARE_STAR_FILTERS) as BareStarFilter[];

/** Message for `value` as `field` when it is a bare `*`, padded or not, else `undefined`. */
function bareStarViolation(field: BareStarFilter, value: string): string | undefined {
  if (value.trim() !== '*') return;
  const open = BARE_STAR_FILTERS[field];
  const openEnd = open === undefined ? '' : `, where "*" may stand for one open end, as in ${open}`;
  return `${field} "${value}" is not a range: GBIF needs both ends, written "min,max" with each end inclusive${openEnd}. Omit the field to leave it unfiltered.`;
}

/**
 * The open-ended range filters GBIF answers with the same empty-body 404 when
 * whitespace sits between a `*` end and the comma — year `* ,1990` or `2020, *` —
 * though it ignores padding on the outer side (` *,1990`) and beside a number end
 * (`*, 1990`). eventDate answers that spacing with a 400 naming it, so it goes to GBIF.
 */
const SPACED_STAR_FILTERS = [
  'coordinateUncertaintyInMeters',
  'year',
  'month',
  'elevation',
  'depth',
] as const satisfies readonly BareStarFilter[];

/** Message for `value` as `field` when a `*` end meets the comma through whitespace, else `undefined`. */
function spacedStarViolation(field: string, value: string): string | undefined {
  const comma = value.indexOf(',');
  if (comma === -1) return;
  const min = value.slice(0, comma);
  const max = value.slice(comma + 1);
  const spaced =
    (min.trim() === '*' && min.trimEnd() !== min) ||
    (max.trim() === '*' && max.trimStart() !== max);
  if (!spaced) return;
  return `${field} "${value}" has whitespace between "*" and the comma, which GBIF answers with an empty HTTP 404 rather than a range: write it "${min.trim()},${max.trim()}". Omit the field to leave it unfiltered.`;
}

/** The geoDistance units accepted here, `km` first so a kilometer distance is not read as `m`. */
const GEO_DISTANCE_UNITS = ['km', 'm'] as const;

/** True when `text`, ignoring surrounding whitespace as GBIF does, is one finite number. */
const isNumber = (text: string) => text.trim() !== '' && Number.isFinite(Number(text));

/**
 * Message for a geoDistance that is not `latitude,longitude,distance` with the distance
 * a number ending in a lowercase `km` or `m`, else `undefined`. GBIF reads a distance
 * with no unit as meters — around 38.17,-3.95 on Lynx pardinus `25` counts 0 where
 * `25km` and `25000` each count 256 — and nothing in its answer says so, so the unit
 * is required here. GBIF ignores whitespace around each part, so this does too.
 * Out-of-range coordinates and a zero distance are left to GBIF, whose 400 names them.
 * Split once and read part by part, so the check is linear in the value.
 */
function geoDistanceViolation(value: string): string | undefined {
  const parts = value.split(',', 4);
  if (parts.length === 3) {
    const [latitude, longitude, distance] = parts as [string, string, string];
    const trimmed = distance.trim();
    const unit = GEO_DISTANCE_UNITS.find((u) => trimmed.endsWith(u));
    if (
      unit !== undefined &&
      isNumber(latitude) &&
      isNumber(longitude) &&
      isNumber(trimmed.slice(0, -unit.length))
    )
      return;
  }
  return `geoDistance "${value}" is not latitude,longitude,distance with the distance in a lowercase km or m unit: write it as "38.17,-3.95,25km" or "38.17,-3.95,25000m", latitude first. GBIF reads a distance with no unit as meters, so "38.17,-3.95,25" would be a 25 m circle. Omit the field to leave it unfiltered.`;
}

/**
 * The characters a GADM GID is built from — `ESP`, `ESP.1_1`, `ESP.1.6.3_1`, and
 * irregular real ones like `Z01`, `CHN.HKG`, and `GHA7_2`, which is why only the
 * alphabet is checked and not a grammar. One anchored character class, so the scan
 * is linear in the input.
 */
const GADM_GID = /^[A-Z0-9._]+$/;

/**
 * The characters a Catalogue of Life key is built from — `3WSJV`, `N`, `8288` — which
 * GBIF matches case-sensitively. One anchored character class, so the scan is linear
 * in the input.
 */
const COL_TAXON_KEY = /^[0-9A-Z]+$/;

/** True when `value` has the shape of a Catalogue of Life taxon key. */
export function isColTaxonKey(value: string): boolean {
  return COL_TAXON_KEY.test(value);
}

/**
 * Message for the first unusable filter among the free-text and key-shaped ones
 * the occurrence tools forward, or `undefined` when all are usable. Search, count,
 * and facets each throw it as their own `invalid_filter`, so the tool's recovery
 * hint rides along, and one check serves all three so no tool guards a filter the
 * others let through.
 *
 * Checked on presence, not on a non-blank value: `/occurrence/search` ignores a
 * parameter given with no value and answers the unfiltered scope, so a blank or
 * whitespace-only filter is rejected rather than silently widening the query.
 *
 * datasetKey is checked whenever present. A malformed key fails here instead of as
 * a bare upstream 400 that costs a round trip and the retry budget, and the empty
 * string — which draws no error at all, `?datasetKey=` answering with the whole
 * unfiltered scope — fails the same way. Letter case stays unchecked: this route
 * resolves a key either way, unlike `/dataset/search`'s two organization filters.
 *
 * gadmGid is checked against the GID alphabet because GBIF matches a GID exactly
 * and case-sensitively and answers any other form — `esp.1_1`, a place name, a
 * padded value — with 200 and zero records rather than an error.
 *
 * A bare `*` on a range filter in `BARE_STAR_FILTERS` is refused, naming the
 * open-ended form that filter takes, because GBIF answers it with an empty-body 404,
 * as it does a `*` end with whitespace between it and the comma (`SPACED_STAR_FILTERS`).
 * geoDistance must carry its distance unit (`geoDistanceViolation`). Every other
 * malformed range or date goes to GBIF, whose 400 names it.
 *
 * publishingOrg is checked like datasetKey. typeStatus and establishmentMeans must
 * name a concept of their vocabulary, ignoring case and surrounding whitespace,
 * because GBIF answers any other string with 200 and zero records.
 *
 * Each taxon key must match its checklist: GBIF reads `taxonKey` against the
 * checklist `checklistKey` selects, and answers a key from the other one with 200
 * and zero records — or, for a digit-only key both checklists hold, with an
 * unrelated taxon (8288 is the Catalogue of Life genus Tringa and the Backbone family
 * Lagenismataceae). So taxonKey is refused under the Catalogue of Life, and
 * checklistTaxonKey, whose alphabet is checked first, anywhere else.
 *
 * Each member of a checklistTaxonKey array passes the blank and alphabet checks a
 * single key does — GBIF ORs the members, and a bad one adds nothing to the union
 * rather than erroring. A blank member is named by its position (`checklistTaxonKey[1]`),
 * any other by its value, and the pairing names the first member of either key
 * filter. The members of the other array filters are checked by the schema.
 */
export function occurrenceFilterViolation(
  input: Omit<OccurrenceFilterInput, 'occurrenceStatus'>,
): string | undefined {
  const colKeys = [input.checklistTaxonKey ?? []].flat();
  const blank = firstBlankFilter({
    scientificName: input.scientificName,
    stateProvince: input.stateProvince,
    decimalLatitude: input.decimalLatitude,
    decimalLongitude: input.decimalLongitude,
    geometry: input.geometry,
    geoDistance: input.geoDistance,
    year: input.year,
    month: typeof input.month === 'string' ? input.month : undefined,
    eventDate: input.eventDate,
    coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
    elevation: input.elevation,
    depth: input.depth,
    gadmGid: input.gadmGid,
    catalogNumber: input.catalogNumber,
    institutionCode: input.institutionCode,
    recordedBy: input.recordedBy,
    typeStatus: input.typeStatus,
    establishmentMeans: input.establishmentMeans,
    ...(Array.isArray(input.checklistTaxonKey)
      ? Object.fromEntries(
          input.checklistTaxonKey.map((key, i) => [`checklistTaxonKey[${i}]`, key]),
        )
      : { checklistTaxonKey: input.checklistTaxonKey }),
  });
  if (blank)
    return `${blank} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`;
  for (const field of BARE_STAR_FIELDS) {
    const value = input[field];
    const star = typeof value === 'string' ? bareStarViolation(field, value) : undefined;
    if (star) return star;
  }
  for (const field of SPACED_STAR_FILTERS) {
    const value = input[field];
    const spaced = typeof value === 'string' ? spacedStarViolation(field, value) : undefined;
    if (spaced) return spaced;
  }
  if (input.geoDistance !== undefined) {
    const violation = geoDistanceViolation(input.geoDistance);
    if (violation) return violation;
  }
  if (input.datasetKey !== undefined && !isGbifUuid(input.datasetKey))
    return `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`;
  if (input.publishingOrg !== undefined && !isGbifUuid(input.publishingOrg))
    return `publishingOrg "${input.publishingOrg}" is not a GBIF organization UUID.`;
  if (input.gadmGid !== undefined && !GADM_GID.test(input.gadmGid))
    return `gadmGid "${input.gadmGid}" is not a GADM GID: a GID holds only uppercase letters, digits, dots, and underscores (ESP, ESP.1_1, ESP.1.5_1), and GBIF matches any other form against nothing.`;
  const badColKey = colKeys.find((key) => !isColTaxonKey(key));
  if (badColKey !== undefined)
    return `checklistTaxonKey "${badColKey}" is not a Catalogue of Life key: a key holds only uppercase letters and digits (3WSJV, 8288), and GBIF matches it case-sensitively, so a lowercase form matches nothing.`;
  const colChecklist = input.checklistKey === COL_XR_CHECKLIST_KEY;
  const [taxonKey] = [input.taxonKey ?? []].flat();
  if (colChecklist && taxonKey !== undefined)
    return `taxonKey ${taxonKey} is a Backbone key, but checklistKey ${COL_XR_CHECKLIST_KEY} makes GBIF read taxonKey as a Catalogue of Life key, where a Backbone key matches nothing or an unrelated taxon. Pass the Catalogue of Life key as checklistTaxonKey instead, or omit checklistKey to scope by the Backbone taxonKey.`;
  if (!colChecklist && colKeys[0] !== undefined)
    return `checklistTaxonKey "${colKeys[0]}" is a Catalogue of Life key, so it needs checklistKey ${COL_XR_CHECKLIST_KEY}: under the Backbone, the default, GBIF reads it as a Backbone key and matches nothing or an unrelated taxon. Set checklistKey to ${COL_XR_CHECKLIST_KEY}, or pass a Backbone key as taxonKey instead.`;
  if (input.typeStatus !== undefined && !conceptOf(TYPE_STATUS_CONCEPTS, input.typeStatus))
    return `typeStatus "${input.typeStatus}" names no concept in GBIF's TypeStatus vocabulary, and GBIF would match it against nothing. Use one of ${TYPE_STATUS_VALUES.join(', ')} — letter case does not matter.`;
  if (
    input.establishmentMeans !== undefined &&
    !conceptOf(ESTABLISHMENT_MEANS_CONCEPTS, input.establishmentMeans)
  )
    return `establishmentMeans "${input.establishmentMeans}" names no concept in GBIF's EstablishmentMeans vocabulary, and GBIF would match it against nothing. Use one of ${ESTABLISHMENT_MEANS_VALUES.join(', ')} — letter case does not matter.`;
  return;
}

/**
 * One value, or a non-empty array of them, for an occurrence filter sent as a
 * repeated parameter, which GBIF ORs: `["ES", "PT"]` covers both countries. Each
 * member passes the check a single value passes. An empty array is refused, since
 * it would send no parameter and GBIF would answer the unfiltered scope. `maxItems`
 * bounds a filter whose members could reach GBIF's URL ceiling, past which it answers
 * HTTP 400 (218 seven-digit taxon keys fit, 219 do not). A fresh member per use keeps
 * the emitted JSON Schema inline.
 */
function oneOrMany<T extends z.ZodType>(member: () => T, maxItems?: number) {
  const many = z.array(member()).min(1);
  return z.union([
    member().describe('One value.'),
    (maxItems === undefined ? many : many.max(maxItems)).describe(
      'Several values, OR-ed: a record matching any one of them matches.',
    ),
  ]);
}

/**
 * The uppercase ISO 3166-1 alpha-2 form, the only one `/occurrence/search` matches a
 * country filter by: `gb`, `USA`, and `Sweden` (GBIF's own name for the country)
 * answer 200 with zero records, and any other name draws HTTP 400 `Cannot parse
 * Britain into a known Country`.
 */
export const alpha2CountryCode = (field: 'country' | 'publishingCountry') =>
  z
    .string()
    .regex(
      /^[A-Z]{2}$/,
      `${field} must be an uppercase ISO 3166-1 alpha-2 code such as GB, US, or SE: GBIF matches no records for a lowercase ("gb") or alpha-3 ("USA") form or for its own name for a country ("Sweden"), and rejects any other name ("Britain").`,
    );

/** `country` on the occurrence tools: one code, or any non-empty array of them — all 253 GBIF knows fit its URL ceiling. */
export const countryFilter = () => oneOrMany(() => alpha2CountryCode('country'));

/** `basisOfRecord` on the occurrence tools: one term, or a non-empty array of them. */
export const basisOfRecordFilter = () => oneOrMany(() => z.enum(BASIS_OF_RECORD_VALUES));

/**
 * A string that spells a number, read as that number; any other value is returned as
 * sent. The rule is the one the framework repairs a spelled number with: only when
 * `String(n)` gives the trimmed string back, so "15" and " 15 " convert while "01",
 * "1e3", and a blank stay strings. That repair stops at a union that also takes an
 * array or a string, so `taxonKey` and `month` apply the rule themselves, and a client
 * that sends a number as text is answered as one that sends the number.
 */
function spelledNumber(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const number = Number(trimmed);
  return Number.isFinite(number) && String(number) === trimmed ? number : value;
}

/**
 * `taxonKey` on the occurrence tools: one Backbone key, or an array of 1–100 of them.
 * A key spelled as text, alone or as a member, is read as the key.
 */
export const taxonKeyFilter = () =>
  z.preprocess(
    (value) => (Array.isArray(value) ? value.map(spelledNumber) : spelledNumber(value)),
    oneOrMany(() => z.number().int().nonnegative(), 100),
  );

/**
 * Input fields search, count, and facets declare from one definition, so the
 * three accept and describe them identically. A fresh set per call keeps each
 * tool's emitted JSON Schema inline.
 */
export function sharedOccurrenceFilterFields() {
  return {
    checklistKey: z
      .enum(CHECKLIST_KEY_VALUES)
      .optional()
      .describe(
        'Taxonomy taxon keys are read in, both in this scope and in KINGDOM_KEY through SPECIES_KEY facet buckets. Omitted, or d7dddbf4-2cf0-4f39-9b2a-bb099caae36c, is the GBIF Backbone, whose integer keys taxonKey takes; GBIF no longer updates it. 7ddf754f-d193-4cc9-b351-99906754a03b is the Catalogue of Life eXtended Release, the taxonomy GBIF now maintains: scope by one of its keys with checklistTaxonKey, which requires this value, and taxonKey is rejected under it. Supplying either value also leaves out the records GBIF has not matched to a taxon in that checklist, which a call with no checklistKey keeps. Records keep their Backbone taxonKey either way.',
      ),
    checklistTaxonKey: oneOrMany(() => z.string(), 100)
      .optional()
      .describe(
        'Catalogue of Life taxon key, such as 3WSJV (Lynx pardinus), to scope to that taxon and every descendant, or an array of up to 100 keys to scope to any of them — the checklistTaxonKey gbif_match_species or gbif_bulk_match_species returns under the same checklistKey, or a KINGDOM_KEY through SPECIES_KEY bucket of gbif_occurrence_facets under it. Requires checklistKey 7ddf754f-d193-4cc9-b351-99906754a03b, and goes to GBIF as its taxonKey. Uppercase letters and digits only, matched case-sensitively; a digit-only key such as 8288 (the genus Tringa) is not the Backbone taxonKey of the same spelling, which names an unrelated taxon. Omit the field to leave it unfiltered — a blank or whitespace-only value, alone or as a member, and an empty array are rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    decimalLatitude: z
      .string()
      .optional()
      .describe(
        'Latitude in decimal degrees (WGS84) as a range "min,max", both ends inclusive (e.g. "47.0,48.5"); pair it with a decimalLongitude range for a bounding box. A value without a comma is not a range: GBIF matches only records at exactly that latitude, so "38" is not "around 38". All supplied spatial filters intersect, geometry included. Omit the field to leave latitude unbounded — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    decimalLongitude: z
      .string()
      .optional()
      .describe(
        'Longitude in decimal degrees (WGS84) as a range "min,max", both ends inclusive (e.g. "8.0,9.5"); pair it with a decimalLatitude range for a bounding box. A value without a comma is not a range: GBIF matches only records at exactly that longitude, so "-3" is not "around -3". All supplied spatial filters intersect, geometry included. Omit the field to leave longitude unbounded — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    coordinateUncertaintyInMeters: z
      .string()
      .optional()
      .describe(
        'Coordinate uncertainty in meters as a range "min,max", both ends inclusive, where "*" may stand for one open end: "0,1000" or "*,1000" keeps records placed to within 1 km. A value without a comma is not an upper bound: GBIF matches only records whose uncertainty is exactly that value, so "1000" is not "within 1 km". Omit the field to accept any uncertainty — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    geoDistance: z
      .string()
      .optional()
      .describe(
        'Circle around a point as "latitude,longitude,distance": latitude first, both in decimal degrees (WGS84), then a distance ending in a lowercase km or m ("38.17,-3.95,25km" keeps records within 25 km; "38.17,-3.95,25000m" is the same circle). The unit is required, because GBIF reads a distance with no unit as meters, so "38.17,-3.95,25" would be a 25 m circle; any other form is rejected. All supplied spatial filters intersect, geometry and the latitude and longitude ranges included. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    elevation: z
      .string()
      .optional()
      .describe(
        'Elevation in meters as a range "min,max", both ends inclusive, where "*" may stand for one open end ("2000,*" keeps 2,000 m and above); negatives and decimals are accepted. A value without a comma is not a bound: GBIF matches only records at exactly that elevation, so "2000" is not "2,000 m and above". Any value, "*,*" included, drops records that carry no elevation. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    depth: z
      .string()
      .optional()
      .describe(
        'Depth in meters below the local surface as a range "min,max", both ends inclusive, where "*" may stand for one open end ("200,*" keeps 200 m and deeper); negatives and decimals are accepted. A value without a comma is not a bound: GBIF matches only records at exactly that depth, so "200" is not "200 m and deeper". Any value, "*,*" included, drops records that carry no depth. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    year: z
      .string()
      .optional()
      .describe(
        'Observation year as one year ("2024") or a range "min,max", both ends inclusive ("2020,2024"), where "*" may stand for one open end: "*,1990" keeps 1990 and earlier, "2020,*" 2020 and later. Any value, "*,*" included, drops records that carry no year. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    month: z
      .preprocess(
        spelledNumber,
        z.union([
          z
            .number()
            .int()
            .min(1)
            .max(12)
            .describe('One calendar month, 1 (January) to 12 (December).'),
          z.string().describe('One month or a "min,max" month range, as text GBIF reads.'),
        ]),
      )
      .optional()
      .describe(
        'Calendar month: an integer 1–12, or a string holding one month ("3", zero padding optional) or an ascending range "min,max", both ends inclusive ("3,5" for March through May), where "*" may stand for one open end ("*,5", "9,*"). A range cannot wrap past December, so a winter span such as November through February takes two calls, "11,12" and "1,2". Any value, "*,*" included, drops records that carry no month. GBIF reads the string form and rejects a month outside 1–12 or a descending range by name. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    eventDate: z
      .string()
      .optional()
      .describe(
        'Event date as "YYYY", "YYYY-MM", or "YYYY-MM-DD", each covering its whole period ("2026-03" is all of March 2026), or a range "min,max" of any mix of those, both ends inclusive ("2026-01-01,2026-06-30"; "2025,2026-03"), where "*" may stand for one open end ("2026-01-01,*"). Dates only: GBIF rejects a time of day, a "/" interval, a space beside the comma, an impossible date, and a descending range by name. Any value, "*,*" included, drops records that carry no event date. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    gadmGid: z
      .string()
      .optional()
      .describe(
        "GADM administrative-area GID at any level: country (ESP), state or province (ESP.1_1), county or district (ESP.1.5_1), or municipality (ESP.1.6.3_1). GBIF derives a record's GIDs from its coordinates, so records without coordinates match none, and the unit can differ from the verbatim stateProvince the record carries. Matched exactly and case-sensitively, and a GID holds only uppercase letters, digits, dots, and underscores — any other character is rejected. Take one from a GADM_LEVEL_0_GID, GADM_LEVEL_1_GID, GADM_LEVEL_2_GID, or GADM_LEVEL_3_GID facet on gbif_occurrence_facets, or from the gadm field of gbif_get_occurrence; a well-formed GID GBIF does not hold matches zero records rather than erroring. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.",
      ),
    catalogNumber: z
      .string()
      .optional()
      .describe(
        'Catalog number a collection assigned to the specimen or record (e.g. "L.1592880"), matched as the whole value, case-insensitively. Not unique across collections — one number can name records in several datasets, so pair it with institutionCode or datasetKey to single one out. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    institutionCode: z
      .string()
      .optional()
      .describe(
        'Code of the institution holding the record (e.g. "K", "CLO"), matched as the whole value, case-insensitively — part of a code or of a multi-word code matches nothing. An INSTITUTION_CODE facet on gbif_occurrence_facets lists the codes in a scope, lowercased, and this filter takes them unchanged. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    recordedBy: z
      .string()
      .optional()
      .describe(
        'Collector or observer, matched against each name in the record\'s recordedBy list (GBIF splits it on "|") exactly and case-sensitively: "Charles Darwin" and "charles darwin" differ, and one person written two ways ("Charles Darwin", "Darwin, C.") is two values. Take a value from a RECORDED_BY facet on gbif_occurrence_facets scoped the same way and pass it back unchanged; an unmatched value matches zero records rather than erroring. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.',
      ),
    mediaType: z
      .enum(MEDIA_TYPE_VALUES)
      .optional()
      .describe(
        'Only records carrying at least one media item of this type: StillImage (photographs, scans), MovingImage (video), Sound (audio), or InteractiveResource. Records without media are excluded when this is set.',
      ),
    publishingOrg: z
      .string()
      .optional()
      .describe(
        'UUID (8-4-4-4-12 hex) of the GBIF organization that published the records, to scope to what it shares across all its datasets — not the organization whose installation hosts them, and not publishingCountry. Take one from gbif_search_publishers, the publishingOrganizationKey of gbif_get_dataset, a gbif_search_datasets row, gbif_get_occurrence, or a gbif_search_occurrences row, or a PUBLISHING_ORG facet on gbif_occurrence_facets; a well-formed key GBIF does not hold matches zero records. Omit the field to leave it unfiltered — an empty string is rejected rather than read as no filter, because GBIF answers a blank publishingOrg with the unfiltered scope.',
      ),
    hasGeospatialIssue: z
      .boolean()
      .optional()
      .describe(
        'True keeps only records GBIF flagged with a spatial issue when interpreting them — zero coordinates, coordinates out of range, or coordinates outside the stated country, for example; false keeps only records with no such flag. GBIF often drops the coordinates of a flagged record, and a record without coordinates can carry either value, so for records to map pair false with hasCoordinate true. Omit for both.',
      ),
    typeStatus: z
      .string()
      .optional()
      .describe(
        "Nomenclatural type status of a specimen — a concept from GBIF's TypeStatus vocabulary such as Holotype, Isotype, Lectotype, Paratype, Syntype, Neotype, Type, or NotAType. Matched ignoring case and surrounding whitespace, then sent and echoed in scope in GBIF's own spelling; a value naming no concept is rejected with the full list. A concept also matches every narrower one — Type covers every kind of type, Lectotype covers Isolectotype — and a TYPE_STATUS facet on gbif_occurrence_facets lists the concepts in a scope. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.",
      ),
    establishmentMeans: z
      .string()
      .optional()
      .describe(
        "How the organism came to be where it was recorded — a concept from GBIF's EstablishmentMeans vocabulary: native, nativeEndemic, nativeReintroduced, introduced, introducedAssistedColonisation, uncertain, or vagrant. Matched ignoring case and surrounding whitespace, then sent and echoed in scope in GBIF's own spelling; any other value is rejected. A concept also matches its narrower ones: native covers nativeEndemic and nativeReintroduced, and introduced covers introducedAssistedColonisation. Most records state none and match no value. Omit the field to leave it unfiltered — a blank or whitespace-only value is rejected rather than dropped, because GBIF answers one with the unfiltered scope.",
      ),
    license: z
      .enum(LICENSE_VALUES)
      .optional()
      .describe(
        'License the record is published under, as its GBIF code: CC0_1_0, CC_BY_4_0, or CC_BY_NC_4_0 — every record carries one of the three. A record states its license as a Creative Commons URL instead (http://creativecommons.org/licenses/by/4.0/legalcode for CC_BY_4_0), which this filter does not take.',
      ),
  };
}

/** Canonical 8-4-4-4-12 hex UUID — the form every GBIF dataset and organization key takes. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when `value` is a well-formed GBIF registry key (dataset, organization).
 *
 * Callers check before issuing a request because GBIF handles a malformed key two
 * incompatible ways: most endpoints answer HTTP 400 `Invalid UUID string`, while
 * `/occurrence/count` answers 200 with a count of 0 — a wrong answer rather than
 * an error. Rejecting locally makes both cases one explicit failure carrying the
 * tool's own recovery hint, and spends no retry budget on a deterministic 400.
 *
 * Matched without trimming, because callers forward the value they were given
 * rather than a normalized copy: a padded key is a caller-side defect, and
 * surfacing it beats silently normalizing a value the caller believes it sent.
 */
export function isGbifUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Name of the first filter in `filters` supplied with no non-whitespace content,
 * or `undefined` when every supplied value carries some. Keys are checked in
 * declaration order, so the reported field is stable for a given input.
 *
 * A blank value is named here rather than dropped, because GBIF answers a dropped
 * filter with the unfiltered scope: the caller that supplied a filter would get the
 * answer to a wider question with nothing in the response saying so. Every other
 * value is forwarded byte-identically — untrimmed, since GBIF trims a padded value
 * itself and normalizing one here would hide a caller-side defect.
 *
 * A blank is rejected rather than dropped even where the upstream answer is not
 * the unfiltered scope. `/dataset/search?q=` returns all 123,527 datasets while
 * `?q=%20%20` returns none: one space flips the answer between the whole index
 * and nothing, and no caller can predict which they will get. Neither is the
 * search that was asked for.
 */
export function firstBlankFilter(
  filters: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && value.trim() === '') return field;
  }
  return;
}

/**
 * Largest `offset + limit` GBIF's `/occurrence/search` serves. A request at exactly
 * this sum answers 200; one past it answers HTTP 400 `Max offset of 100001 exceeded`.
 * Checked locally so an over-cap request fails immediately instead of spending the
 * retry budget on a rejection that can never change.
 */
export const PAGINATION_CAP = 100_001;

/**
 * Agent-facing guidance when a result set runs past the deepest page GBIF serves,
 * or `undefined` when it fits inside one.
 *
 * `/occurrence/search` carries no cursor, scroll, or search-after parameter, and it
 * ignores names it does not recognize rather than rejecting them — a caller probing
 * for a continuation token gets 200 and the unchanged first page, not an error. So
 * offset/limit under the cap is the whole pagination surface, and splitting the query
 * is the only way to reach the remainder from here. `DATASET_KEY` is the facet to split
 * on: every occurrence carries exactly one datasetKey, so its buckets cover the scope
 * with nothing dropped and nothing double-counted, and its cardinality is high enough
 * to cut a large scope into pageable pieces. `BASIS_OF_RECORD` and `PUBLISHING_COUNTRY`
 * are gap-free as well and both have a matching filter on the occurrence tools, so
 * either can cut a bucket that is still over the ceiling. Their lower cardinality
 * makes DATASET_KEY the first cut.
 *
 * The buckets sum to the caller's own total only when the facet call and each
 * per-datasetKey search repeat the same biological filters.
 *
 * Emitted as soon as the total is known rather than only once paging hits the wall,
 * because the caller's decision — page or partition — is made on the first response.
 */
export function overPaginationCapNotice(totalCount: number): string | undefined {
  if (totalCount <= PAGINATION_CAP) return;
  return (
    `${totalCount.toLocaleString('en-US')} records match, past the offset+limit ceiling of ${PAGINATION_CAP.toLocaleString('en-US')} that GBIF's search API serves; it offers no cursor or scroll, so records deeper than that cannot be paged to. ` +
    'To cover the whole set, partition it: gbif_occurrence_facets with facet DATASET_KEY splits a scope with no gap and no overlap, and each datasetKey is then searchable as its own result set; a bucket still over the ceiling cuts further on basisOfRecord or publishingCountry, which leave no record out either and have a matching filter on the occurrence tools. ' +
    "Repeat this query's filters on the facet call, or its buckets will not add up to this total — all three occurrence tools accept the same biological filters, so repeat them on the facet call and each per-datasetKey search. " +
    'Bucket sums also reconcile only against the occurrenceStatus this query applied. ' +
    "A bulk download is not available here — GBIF's Download API needs a GBIF.org account and returns an archive asynchronously, and GBIF's monthly Parquet snapshot on AWS Open Data is a bulk dataset; both are routes to take outside this server."
  );
}

/**
 * Agent-facing guidance when a query that carried `stateProvince` matched nothing,
 * or `undefined` otherwise.
 *
 * `stateProvince` is the one occurrence filter with no vocabulary behind it. GBIF
 * matches the verbatim string each dataset recorded — exactly, case-sensitively,
 * with only surrounding whitespace trimmed — and answers a value it does not hold
 * with 200 and zero records rather than an error. So a zero here is ambiguous in a
 * way no other filter's is: on one measured scope `England` matches 47,672,439
 * records while `england` and `ENGLAND` each match none, and nothing in the
 * response separates the typo from a region that genuinely holds nothing. Naming
 * the filter on an empty result is what lets the caller tell the two apart.
 *
 * Scoped to an empty result on purpose. A value that matched is self-evidently
 * recognized, and repeating the caveat on every non-empty response would be noise.
 *
 * It also names `gadmGid`, the normalized alternative: a GADM unit GBIF assigns
 * from coordinates covers every record placed inside it, whatever each dataset
 * spelled the region, where the verbatim string matches one spelling at a time.
 */
export function stateProvinceNoMatchNotice(
  stateProvince: string | undefined,
  matched: number,
): string | undefined {
  if (!stateProvince?.trim() || matched > 0) return;
  return `Nothing matched, and stateProvince "${stateProvince}" was applied. GBIF matches that value verbatim — exactly and case-sensitively — and answers a value it does not hold with zero records instead of an error, so this result does not distinguish a misspelling from a region that holds nothing. Confirm the string with a STATE_PROVINCE facet from gbif_occurrence_facets over the same scope, which lists the exact values the records carry, and pass one back unchanged. To match a region however datasets spell it, filter on gadmGid instead: a GADM GID GBIF derives from each record's coordinates (records without coordinates carry none), listed for states and provinces by a GADM_LEVEL_1_GID facet.`;
}

/**
 * Agent-facing guidance when a query that carried `gadmGid` matched nothing, or
 * `undefined` otherwise.
 *
 * The alphabet check rejects most malformed GIDs before the request, but GBIF also
 * answers a well-formed GID it does not hold — `ESP.99_1`, or a level written
 * without its version suffix, `ESP.1` — with 200 and zero records. That zero
 * cannot be told apart from a real unit with no records in scope, so the notice
 * names where the GIDs that do match come from.
 */
export function gadmGidNoMatchNotice(
  gadmGid: string | undefined,
  matched: number,
): string | undefined {
  if (!gadmGid?.trim() || matched > 0) return;
  return `Nothing matched, and gadmGid "${gadmGid}" was applied. GBIF matches a GID exactly and answers one it does not hold with zero records instead of an error, so this result does not distinguish a GID that names no GADM unit from a unit with no records in this scope; GIDs come from each record's coordinates, so records without coordinates never match. Take a GID from a GADM_LEVEL_0_GID, GADM_LEVEL_1_GID, GADM_LEVEL_2_GID, or GADM_LEVEL_3_GID facet from gbif_occurrence_facets over the same scope without gadmGid, or from the gadm field of gbif_get_occurrence, and pass it back unchanged.`;
}

/**
 * Agent-facing guidance when a query that carried `recordedBy` matched nothing, or
 * `undefined` otherwise.
 *
 * GBIF splits a record's recordedBy on `|` and matches the filter against each
 * name exactly and case-sensitively, answering a spelling no record carries with
 * 200 and zero records: `Charles Darwin` matches 137, `charles darwin` none, and
 * `Darwin, C.` a different 725. The facet is where the accepted spellings live.
 */
export function recordedByNoMatchNotice(
  recordedBy: string | undefined,
  matched: number,
): string | undefined {
  if (!recordedBy?.trim() || matched > 0) return;
  return `Nothing matched, and recordedBy "${recordedBy}" was applied. GBIF matches it against each collector in a record's recordedBy list exactly and case-sensitively, and answers a spelling no record carries with zero records instead of an error, so this result does not distinguish a misspelling from a collector with no records in this scope — and one person written two ways ("Charles Darwin", "Darwin, C.") is two separate values. Confirm the spelling with a RECORDED_BY facet from gbif_occurrence_facets over the same scope without recordedBy, which lists the exact values records carry, and pass one back unchanged.`;
}

/**
 * Agent-facing guidance when a query that carried `scientificName` matched nothing,
 * or `undefined` otherwise.
 *
 * GBIF resolves the name against the Backbone, synonyms included, but answers a
 * name shared across kingdoms with 200 and zero records: `Oenanthe` (a bird genus
 * and a plant genus) counts none while `taxonKey` 2492483 counts millions. That
 * zero cannot be told apart from a taxon with no records in scope, so the notice
 * names the key route, where a kingdom picks one taxon.
 *
 * Under the Catalogue of Life `checklistKey` the name answers the same zero, but
 * `taxonKey` is refused beside that checklist, so the route is a `checklistTaxonKey`
 * matched under it instead.
 *
 * `keyed` says the query also carried `taxonKey` or `checklistTaxonKey`. GBIF ORs the
 * name with the key, yet a name it cannot resolve empties the whole query: `taxonKey`
 * 2435261 counts 2,269, with "Lynx lynx" beside it 122,551, with "Zzzz zzzz" beside it
 * 0, and `checklistTaxonKey` 3WSJV behaves the same under the Catalogue of Life. The
 * zero then says nothing about the key's own records, so that notice names dropping
 * the name as the way to count them, and adding the name's resolved key to the key
 * array as the way to keep the union: [2435261, 2492483] counts 2,834,266 where the
 * resolved Oenanthe key 2492483 alone, replacing the call's own key, counts 2,831,997.
 */
export function scientificNameNoMatchNotice(
  scientificName: string | undefined,
  matched: number,
  checklistKey?: ChecklistKey,
  keyed = false,
): string | undefined {
  if (!scientificName?.trim() || matched > 0) return;
  const col = checklistKey === COL_XR_CHECKLIST_KEY;
  if (keyed) {
    const key = col ? 'checklistTaxonKey' : 'taxonKey';
    const resolve = col
      ? `resolve the name with gbif_match_species under the same checklistKey, setting kingdom for a shared name, and add the returned checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}, to this call's checklistTaxonKey, which takes an array, in place of the name`
      : "resolve the name with gbif_match_species, setting kingdom for a shared name, and add the returned taxonKey to this call's taxonKey, which takes an array, in place of the name";
    return `Nothing matched, and scientificName "${scientificName}" was applied beside ${key}. GBIF combines the two as a union, but a name it cannot resolve, such as one shared across kingdoms (Oenanthe is a bird genus and a plant genus) or one it does not know, matches nothing and empties the whole query, the ${key} records included, so this zero does not show that ${key} has no records in this scope. Drop scientificName to count the ${key} records alone, or ${resolve}.`;
  }
  const route = col
    ? `Resolve the name with gbif_match_species under the same checklistKey, setting kingdom for a shared name, and pass the returned checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}, instead.`
    : 'Resolve the name with gbif_match_species, setting kingdom for a shared name, and pass the returned taxonKey instead.';
  return `Nothing matched, and scientificName "${scientificName}" was applied. GBIF resolves the name${col ? '' : ' against the Backbone'}, synonyms included, but answers a name shared across kingdoms (Oenanthe is a bird genus and a plant genus) with zero records instead of an error, so this result does not distinguish such a name from a taxon with no records in this scope. ${route}`;
}

/**
 * Every exact-match no-result notice that applies to an occurrence query — one
 * call per tool, in a fixed order, so search, count, and facets explain an empty
 * result identically. Entries that do not apply are `undefined`.
 */
export function occurrenceNoMatchNotices(
  input: Pick<
    OccurrenceFilters,
    | 'scientificName'
    | 'checklistKey'
    | 'taxonKey'
    | 'checklistTaxonKey'
    | 'stateProvince'
    | 'gadmGid'
    | 'recordedBy'
  >,
  matched: number,
): (string | undefined)[] {
  return [
    scientificNameNoMatchNotice(
      input.scientificName,
      matched,
      input.checklistKey,
      // Key 0 is a valid taxon, so presence is tested, never truthiness.
      input.taxonKey !== undefined || input.checklistTaxonKey !== undefined,
    ),
    stateProvinceNoMatchNotice(input.stateProvince, matched),
    gadmGidNoMatchNotice(input.gadmGid, matched),
    recordedByNoMatchNotice(input.recordedBy, matched),
  ];
}

/**
 * Agent-facing note naming each position filter supplied without a comma, or
 * `undefined` when there is none. Search, count, and facets each add it to every
 * result they return.
 *
 * GBIF reads the `EXACT_MATCH_FILTERS` as a range only when the value holds a comma,
 * and anything else as one exact value: on one measured scope `decimalLatitude: "38"`
 * matches 0 records where `"38,39"` matches 504, and
 * `coordinateUncertaintyInMeters: "1000"` matches 1 where `"0,1000"` matches 615;
 * `elevation: "2000"` counts the 784 Quercus records `"2000,2000"` does. A single
 * value reads as "near", "within", or "above" and is none of them. It is still
 * forwarded unchanged — the exact match is a filter GBIF answers and a caller can
 * mean it — so the note rides every result, not only an empty one.
 *
 * The comma alone decides. Padding does not change the reading (GBIF trims it), and
 * every comma form either ranges or fails upstream before any result exists.
 */
export function exactCoordinateMatchNotice(
  input: Pick<OccurrenceFilters, (typeof EXACT_MATCH_FILTERS)[number]>,
): string | undefined {
  const exact = EXACT_MATCH_FILTERS.filter((field) => {
    const value = input[field];
    return value !== undefined && !value.includes(',');
  });
  if (exact.length === 0) return;
  const fields = new Intl.ListFormat('en', { type: 'conjunction' }).format(exact);
  const [verb, pronoun] = exact.length === 1 ? ['has', 'it'] : ['have', 'each'];
  const examples = exact.map((field) => `${field} ${EXACT_MATCH_RANGE_EXAMPLES[field]}`).join('; ');
  return `${fields} ${verb} no comma, so GBIF matched ${pronoun} as one exact value — only records at exactly that value, not a range around it. Send a range as "min,max", both ends inclusive (${examples}).`;
}

/**
 * Agent-facing announcement of the presence/absence filter an occurrence query
 * applied, or `undefined` when no filter was applied.
 *
 * The occurrence tools default to `PRESENT` because an `ABSENT` record documents
 * a survey that looked and did not find the taxon — counting one as a sighting
 * inverts what the record asserts. The default must never be silent, so every
 * tool that applies it emits this alongside its results. `DETECTED` and
 * `NOT_DETECTED` select the same records as `PRESENT` and `ABSENT` and announce
 * the same way.
 */
export function occurrenceStatusNotice(status: OccurrenceStatusFilter): string | undefined {
  switch (status) {
    case 'ANY':
      return;
    case 'PRESENT':
    case 'DETECTED':
      return 'Absence records — occurrenceStatus ABSENT, meaning a survey looked for the taxon and did not find it — are excluded from these figures. Pass occurrenceStatus "ANY" to include them, or "ABSENT" for absences alone.';
    case 'ABSENT':
    case 'NOT_DETECTED':
      return 'Only absence records are included — occurrenceStatus ABSENT means a survey looked for the taxon and did not find it, so these are not sightings. Pass occurrenceStatus "ANY" for both, or "PRESENT" for sightings alone.';
  }
}

const CLASSIFICATION_RANKS = [
  'kingdom',
  'phylum',
  'class',
  'order',
  'family',
  'genus',
  'species',
] as const;
type ClassificationRank = (typeof CLASSIFICATION_RANKS)[number];

/** The flat Backbone classification of a `/species/match` answer; GBIF sends JSON null for absent fields. */
type BackboneClassification = { [R in ClassificationRank]?: string | null } & {
  [R in ClassificationRank as `${R}Key`]?: number | null;
};

/**
 * The key a match tool hands downstream, in the field its checklist owns: a Backbone
 * integer in `taxonKey`, or a Catalogue of Life string in `checklistTaxonKey`. The two
 * never share a field — a digit-only COL key (`8288`, the genus Tringa) parses as an
 * unrelated Backbone key (`8288`, the family Lagenismataceae). `matched` is the key of
 * the name GBIF matched, present only when that name is a synonym of the taxon `value` is.
 */
export type MatchKey =
  | { field: 'taxonKey'; value: number; matched?: number }
  | { field: 'checklistTaxonKey'; value: string; matched?: string };

/** One matched name as both match tools read it, whichever checklist answered. */
export type MatchedTaxon = {
  key: MatchKey;
  matchType: string;
  confidence: number | undefined;
  /** The matched name, with authorship — the synonym itself when `key.matched` is set. */
  scientificName: string | undefined;
  canonicalName: string | undefined;
  rank: string | undefined;
  status: string | undefined;
  /** Canonical name of the accepted taxon a synonym resolves to, when the answer names it. */
  acceptedName?: string;
  /** The accepted taxon's classification at the seven principal ranks. */
  classification: { [R in ClassificationRank]?: string };
  /** Backbone rank keys; empty under the Catalogue of Life, whose rank keys are not surfaced. */
  classificationKeys: { [R in ClassificationRank as `${R}Key`]?: number };
};

/** A species-match answer: a matched taxon, or no usable match with GBIF's note when it gave one. */
export type SpeciesMatch = { kind: 'none'; note?: string } | { kind: 'match'; taxon: MatchedTaxon };

/**
 * Canonical name of the accepted taxon a Backbone synonym match resolves to, read from
 * the match itself. `/species/match` has no accepted-name field, `verbose=true`
 * included, but its classification fields are the accepted taxon's, so the rank field
 * whose key equals `acceptedKey` names it: `Parus caeruleus` carries species "Cyanistes
 * caeruleus" under speciesKey 2487879, its acceptedUsageKey. Identity is proven by that
 * key, never assumed from a rank — for `Chrysanthemum leucanthemum` the speciesKey
 * 8848598 names Leucanthemum vulgare while the accepted taxon, 7222149, is a subspecies
 * no rank field holds — so with no matching key the accepted taxon goes unnamed.
 */
export function backboneAcceptedName(
  match: BackboneClassification,
  acceptedKey: number,
): string | undefined {
  const rank = CLASSIFICATION_RANKS.find((r) => match[`${r}Key`] === acceptedKey);
  return rank ? (match[rank] ?? undefined) : undefined;
}

/** A `/v1/species/match` answer, read against the Backbone. */
export function fromBackboneMatch(raw: RawSpeciesMatch): SpeciesMatch {
  // Presence, not truthiness: usageKey 0 is the Backbone kingdom incertae sedis.
  if (raw.usageKey == null || raw.matchType == null || raw.matchType === 'NONE') {
    return { kind: 'none', ...(raw.note && { note: raw.note }) };
  }
  /**
   * `taxonKey` is the accepted taxon's key, which is what makes it safe to hand straight
   * to the occurrence tools: filtering on the synonym's own key returns only the records
   * filed under that name.
   */
  const matched = raw.usageKey;
  const value = raw.acceptedUsageKey ?? matched;
  const acceptedName = value === matched ? undefined : backboneAcceptedName(raw, value);
  return {
    kind: 'match',
    taxon: {
      key: { field: 'taxonKey', value, ...(value !== matched && { matched }) },
      matchType: raw.matchType,
      confidence: raw.confidence ?? undefined,
      scientificName: raw.scientificName ?? undefined,
      canonicalName: raw.canonicalName ?? undefined,
      rank: raw.rank ?? undefined,
      status: raw.status ?? undefined,
      ...(acceptedName !== undefined && { acceptedName }),
      classification: Object.fromEntries(
        CLASSIFICATION_RANKS.flatMap((r) => (raw[r] != null ? [[r, raw[r]]] : [])),
      ),
      classificationKeys: Object.fromEntries(
        CLASSIFICATION_RANKS.flatMap((r) => {
          const key = raw[`${r}Key`];
          return key != null ? [[`${r}Key`, key]] : [];
        }),
      ),
    },
  };
}

/**
 * A `/v2/species/match` answer, read against the Catalogue of Life. The fields v1 keeps
 * at the top level sit under `diagnostics`, the matched and accepted taxa under `usage`
 * and `acceptedUsage` with string keys, and the classification is a list over more ranks
 * than the seven read here. The accepted name is `acceptedUsage.canonicalName`, never
 * `.name`, which carries authorship.
 */
export function fromChecklistMatch(raw: RawChecklistSpeciesMatch): SpeciesMatch {
  const { usage, acceptedUsage, diagnostics } = raw;
  const matchType = diagnostics?.matchType;
  if (usage?.key == null || matchType == null || matchType === 'NONE') {
    return { kind: 'none', ...(diagnostics?.note && { note: diagnostics.note }) };
  }
  const matched = usage.key;
  const value = acceptedUsage?.key ?? matched;
  const acceptedName = value === matched ? undefined : (acceptedUsage?.canonicalName ?? undefined);
  return {
    kind: 'match',
    taxon: {
      key: { field: 'checklistTaxonKey', value, ...(value !== matched && { matched }) },
      matchType,
      confidence: diagnostics?.confidence ?? undefined,
      scientificName: usage.name ?? undefined,
      canonicalName: usage.canonicalName ?? undefined,
      rank: usage.rank ?? undefined,
      status: usage.status ?? undefined,
      ...(acceptedName !== undefined && { acceptedName }),
      classification: Object.fromEntries(
        CLASSIFICATION_RANKS.flatMap((r) => {
          const node = raw.classification?.find((n) => n.rank === r.toUpperCase());
          return node?.name ? [[r, node.name]] : [];
        }),
      ),
      classificationKeys: {},
    },
  };
}

/**
 * Match one name against the checklist `checklistKey` selects. Omitted, or the Backbone,
 * goes through `/v1/species/match`; the Catalogue of Life goes through
 * `/v2/species/match`, the only route that matches against it.
 */
export async function matchName(
  params: { name: string; strict: boolean; kingdom?: string; rank?: string },
  checklistKey: ChecklistKey | undefined,
  ctx: Context,
): Promise<SpeciesMatch> {
  const gbif = getGbifService();
  return checklistKey === COL_XR_CHECKLIST_KEY
    ? fromChecklistMatch(await gbif.matchChecklistSpecies({ ...params, checklistKey }, ctx))
    : fromBackboneMatch(await gbif.matchSpecies(params, ctx));
}

/** The output fields carrying a match's keys, named for the checklist that answered. */
export function matchKeyFields(key: MatchKey) {
  return key.field === 'taxonKey'
    ? {
        taxonKey: key.value,
        ...(key.matched !== undefined && { matchedTaxonKey: key.matched }),
      }
    : {
        checklistTaxonKey: key.value,
        ...(key.matched !== undefined && { checklistMatchedTaxonKey: key.matched }),
      };
}

/**
 * Disclosure for a HIGHERRANK match, shared by gbif_match_species and gbif_bulk_match_species.
 * GBIF answers a name it cannot place at its own rank with a taxon above it —
 * `Panthera xyzzyqq` comes back as the kingdom Animalia at confidence 92 — and says so
 * only through matchType, so the key reads like any other match. A bare genus (`Bombus`)
 * also comes back HIGHERRANK, at its own genus, which is why this discloses rather than
 * rejects. GBIF can omit rank or canonicalName (JSON null in practice); an omitted one is
 * named as missing, never filled in.
 *
 * The taxon GBIF falls back to can itself be a synonym — `Nyctea xyzzyqq` comes back as
 * the genus Nyctea, whose accepted genus is Bubo — and then the key is that accepted
 * taxon, not the one GBIF named, so the note names the accepted taxon when the answer
 * does. Only a Backbone key gets the gbif_get_species pointer, which takes integer
 * usage keys, and a Catalogue of Life key is a string; a Catalogue of Life key reaches
 * the occurrence tools only as checklistTaxonKey beside its own checklistKey, so its
 * pointer says so.
 */
export function higherRankNote(
  name: string,
  match: Pick<MatchedTaxon, 'key' | 'rank' | 'canonicalName' | 'acceptedName'>,
): string {
  const { key, rank, canonicalName, acceptedName } = match;
  const taxon =
    canonicalName && rank
      ? `${canonicalName}, rank ${rank}`
      : canonicalName
        ? `${canonicalName} (GBIF reported no rank)`
        : rank
          ? `a taxon of rank ${rank} (GBIF reported no name)`
          : 'a higher taxon GBIF did not name';
  const head = `GBIF returned a higher-rank match for "${name}" (matchType HIGHERRANK): ${taxon}`;
  const backbone = key.field === 'taxonKey';
  const reach = backbone
    ? ', so the occurrence tools given it count and return records across all of it.'
    : `, so the occurrence tools given it as checklistTaxonKey, with checklistKey ${COL_XR_CHECKLIST_KEY}, count and return records across all of it.`;
  const lookup = (which: string) =>
    backbone ? ` Call gbif_get_species with ${key.value} to see which${which}.` : '';
  if (key.matched === undefined) {
    return `${head}. ${key.field} ${key.value} covers that whole taxon${reach}${canonicalName ? '' : lookup('')}`;
  }
  return acceptedName
    ? `${head}, a synonym. ${key.field} ${key.value} is its accepted taxon, ${acceptedName}, and covers all of ${acceptedName}${reach}`
    : `${head}, a synonym. ${key.field} ${key.value} is its accepted taxon and covers all of that taxon${reach}${lookup(' taxon that is')}`;
}

/**
 * GBIF's `note` on a NONE when several candidates tie — `Oenanthe`, a bird genus and a
 * plant genus, answers "Multiple equal matches for Oenanthe". The note is the only signal
 * GBIF gives; it carries no list of the tied candidates.
 */
export const isAmbiguousMatchNote = (note: string | null | undefined): note is string =>
  note?.startsWith('Multiple equal matches') === true;

/**
 * Record count for a dataset detail response, shared by `gbif_get_dataset` and the
 * `gbif://dataset/{datasetKey}` resource.
 *
 * `/dataset/{key}` supplies neither `numRecords` nor `recordCount` for any dataset,
 * while `/dataset/search` supplies `recordCount` — so a detail lookup would report
 * less than the list tool it is meant to expand on. The indexed occurrence count
 * closes that gap, and it does so for every dataset type: `/dataset/search` reports
 * a figure for all four, and a SAMPLING_EVENT or METADATA dataset carries indexed
 * occurrences exactly as an OCCURRENCE one does — the largest SAMPLING_EVENT
 * datasets run to tens of millions. A CHECKLIST answers 0, which is also what
 * search reports for it. Keying the lookup on `type` is what left the detail
 * surfaces silent on the datasets the list surface counts.
 *
 * The figure spans every `occurrenceStatus`, absences included, so it is not the
 * number `gbif_count_occurrences` returns for the same key — every surface that
 * carries it says so. Operational lookup failures retain metadata with a notice;
 * cancellation and invalid responses propagate.
 */
export async function resolveDatasetRecordCount(
  raw: RawDatasetRecord,
  ctx: Context,
): Promise<{ recordCount?: number; recordCountNotice?: string }> {
  const declared = raw.numRecords ?? raw.recordCount;
  if (declared != null) return { recordCount: declared };
  if (!raw.key) return {};
  const recordCount = await getGbifService().getDatasetOccurrenceCount(raw.key, ctx);
  return recordCount === undefined
    ? {
        recordCountNotice:
          'The supplementary indexed occurrence count is unavailable. Other dataset metadata is retained; retry this dataset lookup to request the count again.',
      }
    : { recordCount };
}

/**
 * Project raw dataset contacts to a `limit`-capped, compact list plus total/returned counts.
 * Shared by `gbif_get_dataset` (caller-supplied `contactLimit`) and the `gbif://dataset/{key}`
 * resource (fixed cap). `contactsTotal`/`contactsReturned` are included only when the dataset
 * has any contacts, so callers can spread the result directly into their output object.
 */
export function projectContacts(raw: RawContact[] | undefined, limit: number) {
  const all = raw ?? [];
  const contacts = all.slice(0, limit).map((c) => ({
    type: c.type,
    firstName: c.firstName,
    lastName: c.lastName,
    organization: c.organization,
    email: c.email?.length ? c.email : undefined,
  }));
  return {
    contacts: contacts.length ? contacts : undefined,
    ...(all.length > 0 && { contactsTotal: all.length, contactsReturned: contacts.length }),
  };
}

/**
 * Preserve supported temporal variants in source order and disclose unusable entries.
 */
export function projectTemporalCoverages(raw: RawTemporalCoverage[] | undefined) {
  const temporalCoverages: RawTemporalCoverage[] = [];
  let unsupported = 0;
  for (const entry of raw ?? []) {
    const kind = entry?.['@type'];
    const usable =
      kind === 'single'
        ? entry.date
        : kind === 'verbatim'
          ? entry.period
          : kind === undefined || kind === 'range'
            ? entry?.start || entry?.end
            : false;
    if (!usable) {
      unsupported++;
      continue;
    }
    temporalCoverages.push({
      ...(kind !== undefined && { '@type': kind }),
      ...(entry.start !== undefined && { start: entry.start }),
      ...(entry.end !== undefined && { end: entry.end }),
      ...(entry.date !== undefined && { date: entry.date }),
      ...(entry.period !== undefined && { period: entry.period }),
      ...(entry.type !== undefined && { type: entry.type }),
    });
  }
  return {
    temporalCoverages: temporalCoverages.length ? temporalCoverages : undefined,
    temporalCoverageNotice: unsupported
      ? `${unsupported} temporal coverage entries have unsupported or unusable representations and are omitted. Returned temporal coverage is incomplete.`
      : undefined,
  };
}

/**
 * Project raw dataset geographic coverages to `{ description, boundingBox }` entries, keeping
 * each that carries a description, a bounding box, or both. The box's values pass through
 * as GBIF sends them — never validated or reordered, so a box crossing the antimeridian keeps
 * its `minLongitude` above `maxLongitude`. Returns undefined when nothing survives.
 */
export function compactGeographicCoverages(raw: RawGeographicCoverage[] | undefined) {
  const entries = (raw ?? []).flatMap(({ description, boundingBox: box }) =>
    description || box
      ? [
          {
            ...(description ? { description } : {}),
            ...(box
              ? {
                  boundingBox: {
                    minLatitude: box.minLatitude,
                    maxLatitude: box.maxLatitude,
                    minLongitude: box.minLongitude,
                    maxLongitude: box.maxLongitude,
                    globalCoverage: box.globalCoverage,
                  },
                }
              : {}),
          },
        ]
      : [],
  );
  return entries.length ? entries : undefined;
}

/**
 * Named references supported by the plain-text extractor.
 */
const CHARACTER_REFERENCES = new Map<string, string>([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&nbsp;', ' '],
  ['&#34;', '"'],
  ['&#39;', "'"],
  ['&#61;', '='],
  ['&#43;', '+'],
]);

/**
 * Decoding in a single pass is what keeps each reference decoded exactly once.
 * A chain of per-reference replacements decoded `&amp;` first and then re-read
 * the `&` it had just produced as the opening of the next one, so text that
 * literally contains an escaped reference lost a level of escaping: `&amp;lt;`
 * spells the four characters `&lt;`, and the second pass collapsed them to `<`
 * (#56, CodeQL `js/double-escaping`). A single pass consumes each match and
 * moves past its replacement, so no output is ever re-read as input.
 */
const CHARACTER_REFERENCE = /&(?:amp|lt|gt|quot|nbsp|#[0-9]+|#x[0-9a-f]+);/gi;

/** Strip HTML tags and decode the supported character references, each exactly once. */
export function stripHtml(html: string): string {
  const parts: string[] = [];
  let start = 0;
  while (start < html.length) {
    const opening = html.indexOf('<', start);
    if (opening === -1) break;
    const closing = html.indexOf('>', opening + 1);
    if (closing === -1) break;
    parts.push(html.slice(start, opening));
    const tag = html.slice(opening + 1, closing);
    parts.push(
      /^(?:br\b|\/(?:p|div|li|ul|ol|section|article|h[1-6]|blockquote|pre|tr)\b)/i.test(tag)
        ? '\n\n'
        : ' ',
    );
    start = closing + 1;
  }
  parts.push(html.slice(start));
  return parts
    .join('')
    .replace(CHARACTER_REFERENCE, (ref) => {
      const named = CHARACTER_REFERENCES.get(ref);
      if (named !== undefined) return named;
      if (!ref.startsWith('&#')) return ref;
      const hex = ref[2]?.toLowerCase() === 'x';
      const point = Number.parseInt(ref.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : ref;
    })
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Render publisher text literally in CommonMark; inline slots retain newlines as character references. */
export function escapeMarkdownText(text: string, inline = true): string {
  const punctuation = inline ? /[&<>\\`*_{}[\]()#!|~\r\n\t ]/g : /[&<>\\`*_{}[\]()#!|~.\-+\r\t ]/g;
  return text.replace(punctuation, (character, offset: number) => {
    // Boundary spaces must survive Markdown trimming and indentation; interior spaces stay readable.
    if (
      character === ' ' &&
      offset > 0 &&
      offset < text.length - 1 &&
      text[offset - 1] !== '\n' &&
      text[offset + 1] !== '\n'
    )
      return character;
    return `&#${character.charCodeAt(0)};`;
  });
}

/**
 * Render a publisher value that is usually a URL — a source-record link, an occurrenceID,
 * a media file — as a link to itself when `markdownLink` can carry it as one: an absolute
 * http(s) URL on one line. For any other value `markdownLink` returns escaped
 * `label (url)` text, which can never open with an unescaped `[`; that value is rendered
 * through `escapeMarkdownText` instead, like every other publisher string.
 */
export function linkOrEscapedText(value: string): string {
  const link = markdownLink(value, value);
  return link.startsWith('[') ? link : escapeMarkdownText(value);
}
