/**
 * @fileoverview Shared utilities for tool definitions.
 * @module mcp-server/tools/utils
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import {
  MEDIA_TYPE_VALUES,
  OCCURRENCE_FILTER_KEYS,
  type OccurrenceFilters,
  type OccurrenceStatusFilter,
  type RawContact,
  type RawDatasetRecord,
  type RawGeographicCoverage,
  type RawTemporalCoverage,
} from '@/services/gbif/types.js';

/**
 * The biological filters as an occurrence tool parses them: GBIF's own filter set,
 * with `occurrenceStatus` widened to this server's `ANY` sentinel.
 */
export type OccurrenceFilterInput = Omit<OccurrenceFilters, 'occurrenceStatus'> & {
  occurrenceStatus: OccurrenceStatusFilter;
};

/** Filter echo shared by occurrence search, count and facets on both response surfaces. */
export const occurrenceScopeSchema = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .describe(
    'Effective supplied biological filters, with occurrenceStatus always included; excludes pagination and facet controls.',
  );

/** Preserve supplied filter bytes and false/zero values; controls never enter the scope. */
export function occurrenceScope(input: OccurrenceFilterInput) {
  return Object.fromEntries(
    OCCURRENCE_FILTER_KEYS.flatMap((key) => (input[key] === undefined ? [] : [[key, input[key]]])),
  );
}

/**
 * The filter set to send upstream for a tool's parsed filter fields. GBIF has no
 * term meaning "either", so `ANY` resolves to sending no `occurrenceStatus` at all.
 * Callers pass their filter fields with the controls (limit, facet, …) already
 * destructured off; the service forwards only filter keys regardless.
 */
export function occurrenceFilters({
  occurrenceStatus,
  ...filters
}: OccurrenceFilterInput): OccurrenceFilters {
  return { ...filters, ...(occurrenceStatus !== 'ANY' && { occurrenceStatus }) };
}

/**
 * The characters a GADM GID is built from — `ESP`, `ESP.1_1`, `ESP.1.6.3_1`, and
 * irregular real ones like `Z01`, `CHN.HKG`, and `GHA7_2`, which is why only the
 * alphabet is checked and not a grammar. One anchored character class, so the scan
 * is linear in the input.
 */
const GADM_GID = /^[A-Z0-9._]+$/;

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
 */
export function occurrenceFilterViolation(
  input: Omit<OccurrenceFilters, 'occurrenceStatus'>,
): string | undefined {
  const blank = firstBlankFilter({
    scientificName: input.scientificName,
    stateProvince: input.stateProvince,
    decimalLatitude: input.decimalLatitude,
    decimalLongitude: input.decimalLongitude,
    geometry: input.geometry,
    year: input.year,
    coordinateUncertaintyInMeters: input.coordinateUncertaintyInMeters,
    gadmGid: input.gadmGid,
    catalogNumber: input.catalogNumber,
    institutionCode: input.institutionCode,
    recordedBy: input.recordedBy,
  });
  if (blank)
    return `${blank} was supplied blank. Omit the field to leave it unfiltered — a blank value is not a way to skip a filter.`;
  if (input.datasetKey !== undefined && !isGbifUuid(input.datasetKey))
    return `datasetKey "${input.datasetKey}" is not a GBIF dataset UUID.`;
  if (input.gadmGid !== undefined && !GADM_GID.test(input.gadmGid))
    return `gadmGid "${input.gadmGid}" is not a GADM GID: a GID holds only uppercase letters, digits, dots, and underscores (ESP, ESP.1_1, ESP.1.5_1), and GBIF matches any other form against nothing.`;
  return;
}

/**
 * Input fields search, count, and facets declare from one definition, so the
 * three accept and describe them identically. A fresh set per call keeps each
 * tool's emitted JSON Schema inline.
 */
export function sharedOccurrenceFilterFields() {
  return {
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
 * Every filter this server forwards used to be spread behind a `?.trim()` test,
 * which dropped a blank value instead of sending it — and GBIF answers a dropped
 * filter with the unfiltered scope. The caller that supplied a filter got the
 * answer to a wider question with nothing in the response saying so. This
 * inverts that test: the values the old guard dropped
 * are exactly the values it now names, and every value it forwarded is still
 * forwarded byte-identically — untrimmed, since GBIF trims a padded value itself
 * and normalizing one here would hide a caller-side defect.
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
 * Every exact-match no-result notice that applies to an occurrence query — one
 * call per tool, in a fixed order, so search, count, and facets explain an empty
 * result identically. Entries that do not apply are `undefined`.
 */
export function occurrenceNoMatchNotices(
  input: Pick<OccurrenceFilters, 'stateProvince' | 'gadmGid' | 'recordedBy'>,
  matched: number,
): (string | undefined)[] {
  return [
    stateProvinceNoMatchNotice(input.stateProvince, matched),
    gadmGidNoMatchNotice(input.gadmGid, matched),
    recordedByNoMatchNotice(input.recordedBy, matched),
  ];
}

/**
 * Agent-facing announcement of the presence/absence filter an occurrence query
 * applied, or `undefined` when no filter was applied.
 *
 * The occurrence tools default to `PRESENT` because an `ABSENT` record documents
 * a survey that looked and did not find the taxon — counting one as a sighting
 * inverts what the record asserts. The default must never be silent, so every
 * tool that applies it emits this alongside its results.
 */
export function occurrenceStatusNotice(status: OccurrenceStatusFilter): string | undefined {
  if (status === 'ANY') return;
  return status === 'PRESENT'
    ? 'Absence records — occurrenceStatus ABSENT, meaning a survey looked for the taxon and did not find it — are excluded from these figures. Pass occurrenceStatus "ANY" to include them, or "ABSENT" for absences alone.'
    : 'Only absence records are included — occurrenceStatus ABSENT means a survey looked for the taxon and did not find it, so these are not sightings. Pass occurrenceStatus "ANY" for both, or "PRESENT" for sightings alone.';
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

/** The `/species/match` fields a HIGHERRANK disclosure reads; GBIF sends JSON null for absent ones. */
type HigherRankMatch = {
  usageKey?: number | null;
  rank?: string | null;
  canonicalName?: string | null;
} & { [R in ClassificationRank]?: string | null } & {
  [R in ClassificationRank as `${R}Key`]?: number | null;
};

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
 * the genus Nyctea, whose accepted genus is Bubo — and then taxonKey is that accepted
 * taxon, not the one GBIF named. `/species/match` carries no accepted-name field, but its
 * classification is the accepted taxon's: the rank field whose key equals taxonKey names
 * it (genus "Bubo" under genusKey 5959091). Identity is proven by that key, never assumed
 * from the rank — for `Chrysanthemum leucanthemum` the speciesKey 8848598 names
 * Leucanthemum vulgare while the accepted taxon is 7222149 — so with no matching key the
 * accepted taxon goes unnamed.
 */
export function higherRankNote(name: string, taxonKey: number, match: HigherRankMatch): string {
  const { rank, canonicalName } = match;
  const taxon =
    canonicalName && rank
      ? `${canonicalName}, rank ${rank}`
      : canonicalName
        ? `${canonicalName} (GBIF reported no rank)`
        : rank
          ? `a taxon of rank ${rank} (GBIF reported no name)`
          : 'a higher taxon GBIF did not name';
  const head = `GBIF returned a higher-rank match for "${name}" (matchType HIGHERRANK): ${taxon}`;
  const reach = 'so the occurrence tools given it count and return records across all of it.';
  if (match.usageKey == null || match.usageKey === taxonKey) {
    const lookup = canonicalName ? '' : ` Call gbif_get_species with ${taxonKey} to see which.`;
    return `${head}. taxonKey ${taxonKey} covers that whole taxon, ${reach}${lookup}`;
  }
  const acceptedRank = CLASSIFICATION_RANKS.find((r) => match[`${r}Key`] === taxonKey);
  const accepted = acceptedRank ? match[acceptedRank] : undefined;
  return accepted
    ? `${head}, a synonym. taxonKey ${taxonKey} is its accepted taxon, ${accepted}, and covers all of ${accepted}, ${reach}`
    : `${head}, a synonym. taxonKey ${taxonKey} is its accepted taxon and covers all of that taxon, ${reach} Call gbif_get_species with ${taxonKey} to see which taxon that is.`;
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
 * Project raw dataset geographic coverages to compact `{ description }` entries, keeping only
 * those that carry a description. Returns undefined when nothing survives.
 */
export function compactGeographicCoverages(raw: RawGeographicCoverage[] | undefined) {
  const entries = (raw ?? [])
    .map((g) => ({ description: g.description }))
    .filter((g) => g.description);
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
