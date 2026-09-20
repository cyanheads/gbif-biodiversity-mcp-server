/**
 * @fileoverview GBIF API v1 service — wraps api.gbif.org/v1 with retry and response parsing.
 * @module services/gbif/gbif-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { McpError, serviceUnavailable, timeout } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type {
  BasisOfRecord,
  IucnRedListCategory,
  OccurrenceStatus,
  RawChildrenResponse,
  RawDatasetRecord,
  RawDatasetSearchResponse,
  RawOccurrenceRecord,
  RawOccurrenceSearchResponse,
  RawOrganizationSearchResponse,
  RawParentNode,
  RawSpeciesMatch,
  RawSpeciesRecord,
  RawSpeciesSearchResponse,
} from './types.js';

/**
 * Contact point advertised in the default User-Agent. GBIF asks integrators to
 * identify themselves so it can reach the maintainer about problem traffic.
 */
const REPOSITORY_URL = 'https://github.com/cyanheads/gbif-biodiversity-mcp-server';

/** GBIF serves an HTML page instead of JSON when it rate-limits or falls over. */
const HTML_RESPONSE = /^\s*<(!DOCTYPE\s+html|html[\s>])/i;

/**
 * Deadline for the secondary occurrence count that fills a dataset's record
 * count. Shorter than the configured request timeout because the count is
 * supplementary — the dataset record is already in hand and must not wait long
 * for a field that is allowed to be absent.
 */
const RECORD_COUNT_TIMEOUT_MS = 3_000;

/**
 * Recovery guidance for a GBIF rejection of a supplied value. GBIF names the
 * offending value in its response body, so the hint points at that value and at
 * the tools that produce well-formed ones. A tool that declares an
 * `invalid_filter` contract overrides this with its own wording, since
 * `ctx.recoveryFor` resolves against the calling definition's contract.
 */
const INVALID_FILTER_RECOVERY =
  'GBIF rejected one of the supplied values and the quoted explanation names it. Correct that ' +
  'parameter and retry — dataset and organization keys are UUIDs from gbif_search_datasets or ' +
  'gbif_search_publishers, and taxonKey comes from gbif_match_species.';

/**
 * Converts a non-2xx GBIF response into an `McpError`.
 *
 * One departure from the raw framework helper: **GBIF's explanation is folded
 * into the message.** It otherwise reaches only
 * `structuredContent.error.data.body`, leaving `content[]` clients with the bare
 * status. An HTML body (a rate-limit or outage page) is left out of the message.
 *
 * The request URL never reaches `error.data` — a GBIF query string carries the
 * caller's own filter values, and `httpErrorFromResponse` omits `data.url`
 * unless asked for it with `includeUrl: true`, which nothing here passes.
 * `status`, `body`, and `retryAfter` stay, because `withRetry` and the callers
 * classify on them.
 *
 * A 400 is a rejected input value rather than an outage, so it also carries the
 * `invalid_filter` contract reason and a recovery hint.
 */
async function gbifHttpError(response: Response, ctx: Context): Promise<McpError> {
  const error = await httpErrorFromResponse(response, { service: 'GBIF API' });
  const data: Record<string, unknown> = { ...error.data };

  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const explanation = body && !HTML_RESPONSE.test(body) ? body : '';

  return new McpError(
    error.code,
    explanation ? `${error.message} ${explanation}` : error.message,
    response.status === 400
      ? {
          ...data,
          reason: 'invalid_filter',
          recovery: { hint: INVALID_FILTER_RECOVERY },
          ...ctx.recoveryFor('invalid_filter'),
        }
      : data,
    { cause: error },
  );
}

// ─── Service class ─────────────────────────────────────────────────────────────

export class GbifService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(
    config: AppConfig,
    _storage: StorageService,
    opts: { baseUrl: string; timeoutMs: number; userAgent?: string | undefined },
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs;
    this.userAgent =
      opts.userAgent ?? `${config.mcpServerName}/${config.mcpServerVersion} (+${REPOSITORY_URL})`;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildUrl(path: string, params: Record<string, unknown> = {}): string {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private getJson<T>(
    url: string,
    ctx: Context,
    opts: { maxRetries?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    return withRetry(
      async () => {
        const controller = new AbortController();
        /**
         * Abort with a `TimeoutError` DOMException rather than a bare `abort()`.
         * `fetch` rejects with the abort *reason*, so a bare abort surfaces a raw
         * `AbortError` that names neither GBIF nor the deadline and reaches the
         * client with no structured data. Holding the instance also keeps our own
         * deadline distinguishable from a caller cancellation on `ctx.signal`,
         * which aborts the same controller.
         */
        const timeoutReason = new DOMException(
          `GBIF API request timed out after ${timeoutMs}ms.`,
          'TimeoutError',
        );
        const timeoutId = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
        // Propagate ctx.signal cancellation; once:true cleans up after each attempt
        const onAbort = () => controller.abort();
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        try {
          const response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
            signal: controller.signal,
          });
          if (!response.ok) {
            throw await gbifHttpError(response, ctx);
          }
          const text = await response.text();
          if (HTML_RESPONSE.test(text)) {
            throw serviceUnavailable(
              'GBIF API returned HTML — likely rate-limited or unavailable.',
            );
          }
          return JSON.parse(text) as T;
        } catch (err) {
          // Identity-match the reason, not the rejection value: an abort reason may
          // be any type, so an `instanceof Error` gate would drop the timeout into
          // the unclassified path it is here to escape.
          if (controller.signal.reason === timeoutReason) {
            throw timeout(
              `GBIF API request timed out after ${timeoutMs}ms.`,
              { timeoutMs },
              { cause: err },
            );
          }
          throw err;
        } finally {
          clearTimeout(timeoutId);
          ctx.signal.removeEventListener('abort', onAbort);
        }
      },
      {
        operation: 'GbifService.getJson',
        baseDelayMs: 1000,
        signal: ctx.signal,
        ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
      },
    );
  }

  // ─── Species/Taxonomy ─────────────────────────────────────────────────────────

  matchSpecies(
    params: {
      name: string;
      strict?: boolean;
      kingdom?: string;
      rank?: string;
    },
    ctx: Context,
  ): Promise<RawSpeciesMatch> {
    const queryParams: Record<string, unknown> = { name: params.name };
    if (params.strict !== undefined) queryParams.strict = params.strict;
    if (params.kingdom) queryParams.kingdom = params.kingdom;
    if (params.rank) queryParams.rank = params.rank;
    const url = this.buildUrl('/species/match', queryParams);
    ctx.log.debug('Matching species', { name: params.name });
    return this.getJson<RawSpeciesMatch>(url, ctx);
  }

  getSpecies(taxonKey: number, ctx: Context): Promise<RawSpeciesRecord> {
    const url = this.buildUrl(`/species/${taxonKey}`);
    ctx.log.debug('Fetching species record', { taxonKey });
    return this.getJson<RawSpeciesRecord>(url, ctx);
  }

  /**
   * `/species/search` scopes to a higher taxon by key and by nothing else.
   *
   * It carries no `kingdom`, `family`, or `genus` parameter — nor `kingdomKey`,
   * `familyKey`, `genusKey`, `phylumKey`, `taxonKey`, or `parentKey`. Every one of
   * those names is unrecognized, and an unrecognized name is ignored rather than
   * rejected: each answers 200 with the same 46,623,754 names an invented
   * `bogusParam=zzz` returns, where the implemented `rank=FAMILY` returns 558,589.
   * `higherTaxonKey` is the one that scopes — `higherTaxonKey=6` (Plantae) returns
   * 2,101,916 and `higherTaxonKey=2877951` (Quercus) returns 6,059 — and it takes a
   * key, so a caller working from a name resolves it through `/species/match` first.
   *
   * The key is read within one checklist rather than across all of them, so a
   * backbone key scopes backbone names: `higherTaxonKey=9327` (Paridae) returns the
   * same 641 names with and without the backbone `datasetKey`, and 0 against another
   * checklist's. Repeated values are OR-ed, not intersected — `higherTaxonKey=1` and
   * `higherTaxonKey=6` together return 6,534,100, exactly their sum — so only one is
   * sent.
   */
  searchSpecies(
    params: {
      q?: string;
      rank?: string;
      higherTaxonKey?: number;
      isExtinct?: boolean;
      datasetKey?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawSpeciesSearchResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.q) queryParams.q = params.q;
    if (params.rank) queryParams.rank = params.rank;
    if (params.higherTaxonKey !== undefined) queryParams.higherTaxonKey = params.higherTaxonKey;
    if (params.isExtinct !== undefined) queryParams.isExtinct = params.isExtinct;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl('/species/search', queryParams);
    ctx.log.debug('Searching species', { q: params.q, rank: params.rank });
    return this.getJson<RawSpeciesSearchResponse>(url, ctx);
  }

  getSpeciesParents(taxonKey: number, ctx: Context): Promise<RawParentNode[]> {
    const url = this.buildUrl(`/species/${taxonKey}/parents`);
    ctx.log.debug('Fetching species parents', { taxonKey });
    return this.getJson<RawParentNode[]>(url, ctx);
  }

  getSpeciesChildren(
    taxonKey: number,
    params: { limit?: number; offset?: number },
    ctx: Context,
  ): Promise<RawChildrenResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl(`/species/${taxonKey}/children`, queryParams);
    ctx.log.debug('Fetching species children', { taxonKey });
    return this.getJson<RawChildrenResponse>(url, ctx);
  }

  // ─── Occurrences ─────────────────────────────────────────────────────────────

  searchOccurrences(
    params: {
      taxonKey?: number;
      scientificName?: string;
      country?: string;
      publishingCountry?: string;
      stateProvince?: string;
      decimalLatitude?: string;
      decimalLongitude?: string;
      geometry?: string;
      year?: string;
      month?: number;
      basisOfRecord?: BasisOfRecord;
      hasCoordinate?: boolean;
      isInCluster?: boolean;
      coordinateUncertaintyInMeters?: string;
      datasetKey?: string;
      occurrenceStatus?: OccurrenceStatus;
      iucnRedListCategory?: IucnRedListCategory;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.scientificName) queryParams.scientificName = params.scientificName;
    if (params.country) queryParams.country = params.country;
    if (params.publishingCountry) queryParams.publishingCountry = params.publishingCountry;
    if (params.stateProvince) queryParams.stateProvince = params.stateProvince;
    if (params.decimalLatitude) queryParams.decimalLatitude = params.decimalLatitude;
    if (params.decimalLongitude) queryParams.decimalLongitude = params.decimalLongitude;
    if (params.geometry) queryParams.geometry = params.geometry;
    if (params.year) queryParams.year = params.year;
    if (params.month !== undefined) queryParams.month = params.month;
    if (params.basisOfRecord) queryParams.basisOfRecord = params.basisOfRecord;
    if (params.hasCoordinate !== undefined) queryParams.hasCoordinate = params.hasCoordinate;
    if (params.isInCluster !== undefined) queryParams.isInCluster = params.isInCluster;
    if (params.coordinateUncertaintyInMeters)
      queryParams.coordinateUncertaintyInMeters = params.coordinateUncertaintyInMeters;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.occurrenceStatus) queryParams.occurrenceStatus = params.occurrenceStatus;
    if (params.iucnRedListCategory) queryParams.iucnRedListCategory = params.iucnRedListCategory;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl('/occurrence/search', queryParams);
    ctx.log.debug('Searching occurrences', { taxonKey: params.taxonKey, country: params.country });
    return this.getJson<RawOccurrenceSearchResponse>(url, ctx);
  }

  /**
   * Total occurrences matching a filter, read from `/occurrence/search?limit=0`
   * rather than `/occurrence/count`.
   *
   * `/occurrence/count` accepts a closed, undocumented parameter set — it
   * answers `Invalid parameter name` for `occurrenceStatus` and
   * `iucnRedListCategory`, so the presence/absence default this server applies
   * to occurrence queries is unreachable through it and the count tool would
   * contradict the search tool on the same question. The search endpoint takes
   * the full filter set and reports the same total. Where the two differ,
   * `/occurrence/count` is the stale side: its responses are edge-cached at
   * `max-age=600` and served well past it, so an entry hours old trails search
   * by a few thousand records until it refreshes, then matches exactly. Search
   * is also self-consistent — its own `OCCURRENCE_STATUS` facet counts sum to
   * its total.
   *
   * `isGeoreferenced` is the one parameter that does not carry over: the search
   * endpoint has no such name and **silently ignores it**, returning the
   * unfiltered total. Its equivalent there is `hasCoordinate`, which returns
   * identical figures in both directions, so the mapping happens here — the
   * caller keeps asking in the vocabulary `/occurrence/count` used.
   */
  async countOccurrences(
    params: {
      taxonKey?: number;
      country?: string;
      publishingCountry?: string;
      stateProvince?: string;
      isGeoreferenced?: boolean;
      datasetKey?: string;
      year?: string;
      occurrenceStatus?: OccurrenceStatus;
      iucnRedListCategory?: IucnRedListCategory;
    },
    ctx: Context,
  ): Promise<number> {
    const queryParams: Record<string, unknown> = { limit: 0 };
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.country) queryParams.country = params.country;
    if (params.publishingCountry) queryParams.publishingCountry = params.publishingCountry;
    if (params.stateProvince) queryParams.stateProvince = params.stateProvince;
    if (params.isGeoreferenced !== undefined) queryParams.hasCoordinate = params.isGeoreferenced;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.year) queryParams.year = params.year;
    if (params.occurrenceStatus) queryParams.occurrenceStatus = params.occurrenceStatus;
    if (params.iucnRedListCategory) queryParams.iucnRedListCategory = params.iucnRedListCategory;
    const url = this.buildUrl('/occurrence/search', queryParams);
    ctx.log.debug('Counting occurrences', { taxonKey: params.taxonKey });
    const raw = await this.getJson<RawOccurrenceSearchResponse>(url, ctx);
    return raw.count ?? 0;
  }

  getOccurrence(occurrenceKey: number, ctx: Context): Promise<RawOccurrenceRecord> {
    const url = this.buildUrl(`/occurrence/${occurrenceKey}`);
    ctx.log.debug('Fetching occurrence record', { occurrenceKey });
    return this.getJson<RawOccurrenceRecord>(url, ctx);
  }

  getOccurrenceFacets(
    params: {
      taxonKey?: number;
      country?: string;
      publishingCountry?: string;
      stateProvince?: string;
      year?: string;
      basisOfRecord?: BasisOfRecord;
      geometry?: string;
      datasetKey?: string;
      occurrenceStatus?: OccurrenceStatus;
      iucnRedListCategory?: IucnRedListCategory;
      facet: string;
      facetLimit?: number;
      facetOffset?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const queryParams: Record<string, unknown> = { limit: 0, facet: params.facet };
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.country) queryParams.country = params.country;
    if (params.publishingCountry) queryParams.publishingCountry = params.publishingCountry;
    if (params.stateProvince) queryParams.stateProvince = params.stateProvince;
    if (params.year) queryParams.year = params.year;
    if (params.basisOfRecord) queryParams.basisOfRecord = params.basisOfRecord;
    if (params.geometry) queryParams.geometry = params.geometry;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.occurrenceStatus) queryParams.occurrenceStatus = params.occurrenceStatus;
    if (params.iucnRedListCategory) queryParams.iucnRedListCategory = params.iucnRedListCategory;
    if (params.facetLimit !== undefined) queryParams.facetLimit = params.facetLimit;
    if (params.facetOffset !== undefined) queryParams.facetOffset = params.facetOffset;
    const url = this.buildUrl('/occurrence/search', queryParams);
    ctx.log.debug('Fetching occurrence facets', { facet: params.facet });
    return this.getJson<RawOccurrenceSearchResponse>(url, ctx);
  }

  // ─── Datasets ─────────────────────────────────────────────────────────────────

  /**
   * `/dataset/search` carries two organization filters for two different
   * relationships: `publishingOrg` matches the dataset's owner and `hostingOrg`
   * the organization whose installation serves it. Both are forwarded, and GBIF
   * intersects them when both are present.
   */
  searchDatasets(
    params: {
      q?: string;
      type?: string;
      publishingCountry?: string;
      publishingOrg?: string;
      hostingOrg?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawDatasetSearchResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.q) queryParams.q = params.q;
    if (params.type) queryParams.type = params.type;
    if (params.publishingCountry) queryParams.publishingCountry = params.publishingCountry;
    if (params.publishingOrg) queryParams.publishingOrg = params.publishingOrg;
    if (params.hostingOrg) queryParams.hostingOrg = params.hostingOrg;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl('/dataset/search', queryParams);
    ctx.log.debug('Searching datasets', { q: params.q, type: params.type });
    return this.getJson<RawDatasetSearchResponse>(url, ctx);
  }

  getDataset(datasetKey: string, ctx: Context): Promise<RawDatasetRecord> {
    const url = this.buildUrl(`/dataset/${datasetKey}`);
    ctx.log.debug('Fetching dataset record', { datasetKey });
    return this.getJson<RawDatasetRecord>(url, ctx);
  }

  /**
   * Indexed occurrence count for one dataset — the record count `/dataset/{key}`
   * never supplies but `/dataset/search` does, so a detail lookup can report the
   * same figure the list tool reports.
   *
   * Deliberately unfiltered: `/dataset/search` counts every indexed record for a
   * dataset, absences included, so this must too or the two would disagree. The
   * presence-scoped figure is a different question, answered by `countOccurrences`
   * against a different endpoint.
   *
   * Supplementary to the dataset record already in hand, so it is bounded (no
   * retries, short deadline) and degrades to `undefined` on any failure instead
   * of turning a successful dataset lookup into an error.
   */
  async getDatasetOccurrenceCount(datasetKey: string, ctx: Context): Promise<number | undefined> {
    const url = this.buildUrl('/occurrence/count', { datasetKey });
    try {
      return await this.getJson<number>(url, ctx, {
        maxRetries: 0,
        timeoutMs: RECORD_COUNT_TIMEOUT_MS,
      });
    } catch (err) {
      ctx.log.debug('Dataset occurrence count unavailable', {
        datasetKey,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  }

  // ─── Publishers/Organizations ─────────────────────────────────────────────────

  searchPublishers(
    params: {
      q?: string;
      country?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawOrganizationSearchResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.q) queryParams.q = params.q;
    if (params.country) queryParams.country = params.country;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl('/organization', queryParams);
    ctx.log.debug('Searching publishers', { q: params.q, country: params.country });
    return this.getJson<RawOrganizationSearchResponse>(url, ctx);
  }
}

// ─── Init/accessor pattern ────────────────────────────────────────────────────

let _service: GbifService | undefined;

export function initGbifService(
  config: AppConfig,
  storage: StorageService,
  opts: { baseUrl: string; timeoutMs: number; userAgent?: string | undefined },
): void {
  _service = new GbifService(config, storage, opts);
}

export function getGbifService(): GbifService {
  if (!_service) {
    throw new Error('GbifService not initialized — call initGbifService() in setup()');
  }
  return _service;
}
