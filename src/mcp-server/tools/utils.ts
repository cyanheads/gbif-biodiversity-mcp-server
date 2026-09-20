/**
 * @fileoverview Shared utilities for tool definitions.
 * @module mcp-server/tools/utils
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { getGbifService } from '@/services/gbif/gbif-service.js';
import type {
  OccurrenceStatusFilter,
  RawContact,
  RawDatasetRecord,
  RawGeographicCoverage,
  RawTemporalCoverage,
} from '@/services/gbif/types.js';

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
 * filter with the unfiltered scope. `stateProvince: ""` returned all 60,290,950
 * records of a `taxonKey=212` + `country=GB` scope where `England` returns
 * 47,672,439, and `""` matched the omitted-field figure exactly. So the caller
 * that supplied a filter got the answer to a wider question with nothing in the
 * response saying so. This inverts that test: the values the old guard dropped
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
 * either can cut a bucket that is still over the ceiling — but on the measured scope
 * they return 9 and 41 buckets against `DATASET_KEY`'s 550, so neither replaces it as
 * the first cut.
 *
 * The buckets sum to the caller's own total only when the facet call repeats the same
 * filters, and `gbif_occurrence_facets` accepts a narrower filter set than either tool
 * that emits this: whatever it cannot take has to be re-applied on each per-datasetKey
 * search instead.
 *
 * Emitted as soon as the total is known rather than only once paging hits the wall,
 * because the caller's decision — page or partition — is made on the first response.
 */
export function overPaginationCapNotice(totalCount: number): string | undefined {
  if (totalCount <= PAGINATION_CAP) return;
  return (
    `${totalCount.toLocaleString('en-US')} records match, past the offset+limit ceiling of ${PAGINATION_CAP.toLocaleString('en-US')} that GBIF's search API serves; it offers no cursor or scroll, so records deeper than that cannot be paged to. ` +
    'To cover the whole set, partition it: gbif_occurrence_facets with facet DATASET_KEY splits a scope with no gap and no overlap, and each datasetKey is then searchable as its own result set; a bucket still over the ceiling cuts further on basisOfRecord or publishingCountry, the other two dimensions whose buckets leave no record out. ' +
    "Repeat this query's filters on the facet call, or its buckets will not add up to this total — gbif_occurrence_facets does not accept scientificName, month, latitude/longitude ranges, or the coordinate, georeference, cluster, and coordinate-uncertainty filters, so carry any of those onto each per-datasetKey search instead. " +
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
 */
export function stateProvinceNoMatchNotice(
  stateProvince: string | undefined,
  matched: number,
): string | undefined {
  if (!stateProvince?.trim() || matched > 0) return;
  return (
    `Nothing matched, and stateProvince "${stateProvince}" was applied. GBIF matches that value verbatim — exactly and case-sensitively — and answers a value it does not hold with zero records instead of an error, so this result does not distinguish a misspelling from a region that holds nothing. ` +
    'Confirm the string with a STATE_PROVINCE facet from gbif_occurrence_facets over the same scope, which lists the exact values the records carry, and pass one back unchanged.'
  );
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
 * carries it says so. The lookup is supplementary and best-effort, so the field
 * stays absent rather than blocking or failing the record.
 */
export function resolveDatasetRecordCount(
  raw: RawDatasetRecord,
  ctx: Context,
): Promise<number | undefined> {
  const declared = raw.numRecords ?? raw.recordCount;
  if (declared != null) return Promise.resolve(declared);
  if (!raw.key) return Promise.resolve(undefined);
  return getGbifService().getDatasetOccurrenceCount(raw.key, ctx);
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
 * Project raw dataset temporal coverages to compact `{ start, end }` ranges, keeping only
 * entries that carry at least one bound (GBIF also emits verbatim/single-date shapes we skip).
 * Returns undefined when nothing survives, so the field is omitted rather than empty.
 */
export function compactTemporalCoverages(raw: RawTemporalCoverage[] | undefined) {
  const ranges = (raw ?? [])
    .map((t) => ({ start: t.start, end: t.end }))
    .filter((t) => t.start || t.end);
  return ranges.length ? ranges : undefined;
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
 * The character references `stripHtml` decodes. Everything else a publisher
 * wrote — `&#169;`, `&nbsp;`, a hex reference — is left verbatim rather than
 * resolved, so the extractor never invents a character the source did not name.
 */
const CHARACTER_REFERENCES = new Map<string, string>([
  ['&amp;', '&'],
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#34;', '"'],
  ['&#39;', "'"],
  ['&#61;', '='],
  ['&#43;', '+'],
]);

/**
 * One alternation over exactly the keys above — none of which carries a regex
 * metacharacter, so joining them is the whole pattern.
 *
 * Decoding in a single pass is what keeps each reference decoded exactly once.
 * A chain of per-reference replacements decoded `&amp;` first and then re-read
 * the `&` it had just produced as the opening of the next one, so text that
 * literally contains an escaped reference lost a level of escaping: `&amp;lt;`
 * spells the four characters `&lt;`, and the second pass collapsed them to `<`
 * (#56, CodeQL `js/double-escaping`). A single pass consumes each match and
 * moves past its replacement, so no output is ever re-read as input.
 */
const CHARACTER_REFERENCE = new RegExp([...CHARACTER_REFERENCES.keys()].join('|'), 'g');

/** Strip HTML tags and decode the supported character references, each exactly once. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(CHARACTER_REFERENCE, (ref) => CHARACTER_REFERENCES.get(ref) ?? ref)
    .replace(/\s+/g, ' ')
    .trim();
}
