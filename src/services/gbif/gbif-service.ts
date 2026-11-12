/**
 * @fileoverview GBIF API service — wraps api.gbif.org/v1, plus the /v2/species/match route derived from it, with retry and response parsing.
 * @module services/gbif/gbif-service
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  configurationError,
  JsonRpcErrorCode,
  McpError,
  serviceUnavailable,
  timeout,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createPacer, httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import {
  type ChecklistKey,
  COL_XR_CHECKLIST_KEY,
  type FacetLabelKind,
  OCCURRENCE_FILTER_PARAMS,
  type OccurrenceFilters,
  type RawChecklistSpeciesMatch,
  type RawChildrenResponse,
  type RawDatasetRecord,
  type RawDatasetSearchResponse,
  type RawOccurrenceRecord,
  type RawOccurrenceSearchResponse,
  type RawOrganizationSearchResponse,
  type RawParentNode,
  type RawSpeciesMatch,
  type RawSpeciesRecord,
  type RawSpeciesSearchResponse,
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
 * Label lookups in flight at once, shared by every concurrent facet call. A labeled
 * page costs one request per bucket — up to 100 — so the lookups queue rather than
 * leave as one burst. Measured live, 100 `/species` lookups at this bound finish in
 * about 3 s, well inside the label deadline.
 */
const FACET_LABEL_CONCURRENCY = 8;

/** Per-request bounds for `getJson` and `getBody`. */
type RequestOptions = { maxRetries?: number; timeoutMs?: number; deadline?: AbortSignal };

/**
 * How `getFacetLabels` names one kind of bucket key: the path of the record that
 * holds the name, and how the name is read from that record's 200 body. `label`
 * returns `undefined` when the body names nothing, which leaves the bucket
 * unlabeled, and throws on a body the kind never serves (malformed JSON), which
 * fails the call as a defect rather than passing for a missing name. A non-2xx
 * answer — 404 for a key GBIF does not hold — never reaches `label`; the lookup
 * leaves that key unlabeled.
 *
 * `label` reads the body text rather than parsed JSON, so a kind whose upstream
 * answers a key it does not hold with an empty 200 can read that as no name. The
 * caller checks each key's shape before it becomes a path segment or parameter.
 *
 * `path` is under the configured v1 root, or under the v2 root when `root` is
 * `v2`; `params` adds a query string.
 */
type FacetLabelLookup = {
  root?: 'v2';
  path: (key: string) => string;
  params?: (key: string) => Record<string, string>;
  label: (body: string) => string | undefined;
};

/** The one field each kind of label lookup reads from the record it fetches. */
const TAXON_LABEL = z.object({ canonicalName: z.string().min(1) });
const TITLE_LABEL = z.object({ title: z.string().min(1) });
const NAME_LABEL = z.object({ name: z.string().min(1) });
const USAGE_LABEL = z.object({ usage: TAXON_LABEL });

/** One entry per `FacetLabelKind`: a new kind is one entry here. */
const FACET_LABEL_LOOKUPS = {
  taxon: {
    path: (key) => `/species/${key}`,
    label: (body) => TAXON_LABEL.safeParse(JSON.parse(body)).data?.canonicalName,
  },
  /**
   * A Catalogue of Life key read by usage key alone, so no name is matched. A key the
   * checklist does not hold answers 200 with matchType NONE and no `usage`.
   */
  colTaxon: {
    root: 'v2',
    path: () => '/species/match',
    params: (key) => ({ checklistKey: COL_XR_CHECKLIST_KEY, usageKey: key }),
    label: (body) => USAGE_LABEL.safeParse(JSON.parse(body)).data?.usage.canonicalName,
  },
  dataset: {
    path: (key) => `/dataset/${key}`,
    label: (body) => TITLE_LABEL.safeParse(JSON.parse(body)).data?.title,
  },
  organization: {
    path: (key) => `/organization/${key}`,
    label: (body) => TITLE_LABEL.safeParse(JSON.parse(body)).data?.title,
  },
  /**
   * GADM answers a GID it does not hold with HTTP 200 and an empty body rather than
   * a 404, so the empty body is its not-found; any other unparseable body still fails.
   */
  gadm: {
    path: (key) => `/geocode/gadm/${key}`,
    label: (body) => (body === '' ? undefined : NAME_LABEL.safeParse(JSON.parse(body)).data?.name),
  },
} satisfies Record<FacetLabelKind, FacetLabelLookup>;

/**
 * Converts a non-2xx GBIF response into an `McpError`.
 *
 * One departure from the raw framework helper: **GBIF's explanation is folded
 * into the message.** The body `httpErrorFromResponse` captures stays on the
 * server — `data.body` reads it here and the failure log records it, but a
 * tool's `structuredContent.error.data` and a resource read's JSON-RPC
 * `error.data` leave it out — so without the fold neither `structuredContent`
 * nor `content[]` would say why GBIF refused the request. An HTML body (a
 * rate-limit or outage page) is left out of the message.
 *
 * The rebuilt error spreads `error.data`, which carries the helper's server-only
 * marker for the body along with it, so the body stays off the wire here too.
 * The request URL never reaches `error.data` — a GBIF query string carries the
 * caller's own filter values, and `httpErrorFromResponse` omits `data.url`
 * unless asked for it with `includeUrl: true`, which nothing here passes.
 * `status` and `retryAfter` reach the caller, and `withRetry` honors
 * `retryAfter` between attempts.
 *
 * A 400 is a rejected input value rather than an outage, so it also carries the
 * `invalid_filter` contract reason. Every definition that lets this error reach
 * the caller declares `invalid_filter`, and the framework fills that entry's
 * recovery hint onto the wire.
 */
async function gbifHttpError(response: Response): Promise<McpError> {
  const error = await httpErrorFromResponse(response, { service: 'GBIF API' });
  const data: Record<string, unknown> = { ...error.data };

  const body = typeof data.body === 'string' ? data.body.trim() : '';
  const explanation = body && !HTML_RESPONSE.test(body) ? body : '';

  return new McpError(
    error.code,
    explanation ? `${error.message} ${explanation}` : error.message,
    response.status === 400 ? { ...data, reason: 'invalid_filter' } : data,
    { cause: error },
  );
}

/**
 * `/occurrence/search` parameters for one filter set — the single table search,
 * count, and facets forward through, so the three send the same query for the
 * same filters. Every supplied value goes out byte-identically, `0` and `false`
 * included; an `undefined` one is not sent. Blank strings never arrive: the tools
 * reject them first, because the endpoint reads a parameter with no value as no
 * filter and answers the unfiltered scope.
 *
 * Each goes out under the parameter `OCCURRENCE_FILTER_PARAMS` names, so
 * `checklistTaxonKey` is sent as `taxonKey`. The tools never pass it beside a
 * Backbone `taxonKey`: `occurrenceFilterViolation` admits each only under its own
 * checklist.
 */
function occurrenceParams(filters: OccurrenceFilters): Record<string, unknown> {
  return Object.fromEntries(
    OCCURRENCE_FILTER_PARAMS.flatMap(([key, param]) =>
      filters[key] === undefined ? [] : [[param, filters[key]]],
    ),
  );
}

// ─── Service class ─────────────────────────────────────────────────────────────

export class GbifService {
  private readonly baseUrl: string;
  /**
   * GBIF's v2 root, the configured root with its trailing `/v1` segment replaced by
   * `/v2`. Undefined when the configured root does not end in `/v1`: no rule recovers
   * a v2 root from an arbitrary one, so the v2 routes fail rather than guess.
   */
  private readonly v2BaseUrl: string | undefined;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  /**
   * One per service, and the service is one per process, so the concurrency bound
   * holds across concurrent facet calls. Concurrency alone binds, so the pacer
   * never arms a dispatch timer and needs no disposal.
   */
  private readonly labelPacer = createPacer({
    name: 'gbif-facet-labels',
    maxConcurrent: FACET_LABEL_CONCURRENCY,
  });

  constructor(
    config: AppConfig,
    _storage: StorageService,
    opts: { baseUrl: string; timeoutMs: number; userAgent?: string | undefined },
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.v2BaseUrl = this.baseUrl.endsWith('/v1') ? `${this.baseUrl.slice(0, -3)}/v2` : undefined;
    this.timeoutMs = opts.timeoutMs;
    this.userAgent =
      opts.userAgent ?? `${config.mcpServerName}/${config.mcpServerVersion} (+${REPOSITORY_URL})`;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildUrl(
    path: string,
    params: Record<string, unknown> = {},
    root: string = this.baseUrl,
  ): string {
    const url = new URL(`${root}${path}`);
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

  private getJson<T>(url: string, ctx: Context, opts: RequestOptions = {}): Promise<T> {
    return this.getBody(url, ctx, opts, (body) => JSON.parse(body) as T);
  }

  /**
   * `read` turns the text of a 2xx, non-HTML response into the result, inside the
   * attempt, so what it throws fails that attempt as a parse failure in `getJson`
   * does.
   *
   * `deadline` is a caller-owned signal that ends the attempt the way `ctx.signal`
   * does: aborting it aborts the fetch, and the attempt rejects with its reason, by
   * identity. It bounds attempts only — the retry loop between them watches
   * `ctx.signal` alone — so it is for single-attempt (`maxRetries: 0`) requests.
   */
  private getBody<T>(
    url: string,
    ctx: Context,
    opts: RequestOptions,
    read: (body: string) => T,
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const { deadline } = opts;
    const request = async () => {
      ctx.signal.throwIfAborted();
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
      const onAbort = () => controller.abort(ctx.signal.reason);
      ctx.signal.addEventListener('abort', onAbort, { once: true });
      const onDeadline = () => controller.abort(deadline?.reason);
      deadline?.addEventListener('abort', onDeadline, { once: true });
      const rethrowTransportError = (error: unknown): never => {
        if (opts.maxRetries === 0 && error instanceof TypeError && !controller.signal.aborted) {
          throw serviceUnavailable('GBIF API transport failed.', undefined, { cause: error });
        }
        throw error;
      };
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json', 'User-Agent': this.userAgent },
          signal: controller.signal,
        }).catch(rethrowTransportError);
        if (!response.ok) {
          throw await gbifHttpError(response);
        }
        const text = await response.text().catch(rethrowTransportError);
        if (HTML_RESPONSE.test(text)) {
          throw serviceUnavailable('GBIF API returned HTML — likely rate-limited or unavailable.');
        }
        return read(text);
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
        // By identity too: what `fetch` rejects with on an abort varies by runtime.
        if (deadline?.aborted && controller.signal.reason === deadline.reason)
          throw deadline.reason;
        throw err;
      } finally {
        clearTimeout(timeoutId);
        ctx.signal.removeEventListener('abort', onAbort);
        deadline?.removeEventListener('abort', onDeadline);
      }
    };
    if (opts.maxRetries === 0) return request();
    return withRetry(request, {
      operation: 'GbifService.getJson',
      baseDelayMs: 1000,
      signal: ctx.signal,
      ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    });
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

  /**
   * `/v2/species/match` against one checklist. The v2 contract renames two
   * parameters: the name goes as `scientificName` and the rank as `taxonRank`.
   * `kingdom` and `strict` keep their v1 names and meaning.
   *
   * Rejects with a ConfigurationError, before any request, when the configured base
   * URL does not end in `/v1`, so no v2 root can be derived from it.
   */
  matchChecklistSpecies(
    params: {
      name: string;
      checklistKey: ChecklistKey;
      strict?: boolean;
      kingdom?: string;
      rank?: string;
    },
    ctx: Context,
  ): Promise<RawChecklistSpeciesMatch> {
    if (this.v2BaseUrl === undefined) {
      return Promise.reject(
        configurationError(
          'This server is configured with a GBIF_BASE_URL that does not end in /v1, so the /v2/species/match route a Catalogue of Life match needs cannot be derived from it. Omit checklistKey to match against the GBIF Backbone, or have the operator set GBIF_BASE_URL to a root ending in /v1.',
        ),
      );
    }
    const queryParams: Record<string, unknown> = {
      checklistKey: params.checklistKey,
      scientificName: params.name,
    };
    if (params.strict !== undefined) queryParams.strict = params.strict;
    if (params.kingdom) queryParams.kingdom = params.kingdom;
    if (params.rank) queryParams.taxonRank = params.rank;
    const url = this.buildUrl('/species/match', queryParams, this.v2BaseUrl);
    ctx.log.debug('Matching species against a checklist', {
      name: params.name,
      checklistKey: params.checklistKey,
    });
    return this.getJson<RawChecklistSpeciesMatch>(url, ctx);
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
    params: OccurrenceFilters & {
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const url = this.buildUrl('/occurrence/search', {
      ...occurrenceParams(params),
      limit: params.limit,
      offset: params.offset,
    });
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
    params: OccurrenceFilters & {
      isGeoreferenced?: boolean;
    },
    ctx: Context,
  ): Promise<number> {
    ctx.log.debug('Counting occurrences', { taxonKey: params.taxonKey });
    const hasCoordinate = params.hasCoordinate ?? params.isGeoreferenced;
    const raw = await this.searchOccurrences(
      { ...params, ...(hasCoordinate !== undefined && { hasCoordinate }), limit: 0 },
      ctx,
    );
    return raw.count ?? 0;
  }

  getOccurrence(occurrenceKey: number, ctx: Context): Promise<RawOccurrenceRecord> {
    const url = this.buildUrl(`/occurrence/${occurrenceKey}`);
    ctx.log.debug('Fetching occurrence record', { occurrenceKey });
    return this.getJson<RawOccurrenceRecord>(url, ctx);
  }

  getOccurrenceFacets(
    params: OccurrenceFilters & {
      facet: string;
      facetLimit?: number;
      facetOffset?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const url = this.buildUrl('/occurrence/search', {
      limit: 0,
      facet: params.facet,
      ...occurrenceParams(params),
      facetLimit: params.facetLimit,
      facetOffset: params.facetOffset,
    });
    ctx.log.debug('Fetching occurrence facets', { facet: params.facet });
    return this.getJson<RawOccurrenceSearchResponse>(url, ctx);
  }

  /**
   * The root `kind`'s label lookups are read from. Throws a ConfigurationError,
   * without a request, when the kind needs the v2 root and the configured base URL
   * does not end in `/v1`, so a caller can check it before the aggregation the
   * labels follow.
   */
  facetLabelRoot(kind: FacetLabelKind): string {
    const lookup: FacetLabelLookup = FACET_LABEL_LOOKUPS[kind];
    if (lookup.root !== 'v2') return this.baseUrl;
    if (this.v2BaseUrl === undefined) {
      throw configurationError(
        'This server is configured with a GBIF_BASE_URL that does not end in /v1, so the /v2/species/match route Catalogue of Life labels are read from cannot be derived from it. Omit includeLabels to aggregate without labels, or have the operator set GBIF_BASE_URL to a root ending in /v1.',
      );
    }
    return this.v2BaseUrl;
  }

  /**
   * Names for facet bucket keys, keyed by bucket key, read the way
   * `FACET_LABEL_LOOKUPS` says for `kind`: a taxon key's `canonicalName` from
   * `/species/{key}`, a Catalogue of Life key's from `/v2/species/match`, a dataset
   * or organization UUID's `title` from `/dataset/{key}` or `/organization/{key}`, a
   * GADM GID's `name` from `/geocode/gadm/{gid}`. Each key becomes a path segment or
   * parameter, so the caller passes only keys in the kind's own shape.
   *
   * Supplementary to counts already in hand, and one request per key, so bounded:
   * one attempt per key with no retry; at most `FACET_LABEL_CONCURRENCY` lookups in
   * flight across every concurrent call; and one `deadlineMs` over the whole set,
   * queue time included, which ends lookups still queued or in flight when it
   * passes.
   *
   * A key is absent from the result when its lookup fails upstream (404, 5xx, 429,
   * transport, timeout), misses the deadline, or returns a record without the
   * field. Caller cancellation rejects with `ctx.signal.reason`; any other failure —
   * a malformed body, a programming error — propagates. A v2 kind rejects with a
   * ConfigurationError, before any request, when the configured base URL does not
   * end in `/v1`.
   */
  async getFacetLabels(
    params: { kind: FacetLabelKind; keys: readonly string[]; deadlineMs: number },
    ctx: Context,
  ): Promise<Map<string, string>> {
    const { kind, keys, deadlineMs } = params;
    const lookup: FacetLabelLookup = FACET_LABEL_LOOKUPS[kind];
    const root = this.facetLabelRoot(kind);
    const labels = new Map<string, string>();
    const deadline = new AbortController();
    const timer = setTimeout(
      () =>
        deadline.abort(
          timeout(`GBIF facet label lookups reached their ${deadlineMs}ms deadline.`, {
            timeoutMs: deadlineMs,
          }),
        ),
      deadlineMs,
    );
    // A queued lookup leaves the line on either signal; getBody watches both in flight.
    const queueSignal = AbortSignal.any([ctx.signal, deadline.signal]);
    try {
      await Promise.all(
        keys.map(async (key) => {
          try {
            const label = await this.labelPacer.run(
              () =>
                this.getBody(
                  this.buildUrl(lookup.path(key), lookup.params?.(key), root),
                  ctx,
                  { maxRetries: 0, deadline: deadline.signal },
                  lookup.label,
                ),
              { signal: queueSignal },
            );
            if (label !== undefined) labels.set(key, label);
          } catch (err) {
            ctx.signal.throwIfAborted();
            if (!(err instanceof McpError)) throw err;
            ctx.log.debug('Facet label lookup failed', { kind, key, code: err.code });
          }
        }),
      );
    } finally {
      clearTimeout(timer);
      // Ends lookups still queued or in flight when one of them threw.
      deadline.abort();
    }
    // A cancellation landing after the last lookup settled still ends the call.
    ctx.signal.throwIfAborted();
    return labels;
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
   * retries, short deadline). Operational failures leave the count unavailable;
   * cancellation, invalid responses and programming failures still propagate.
   */
  async getDatasetOccurrenceCount(datasetKey: string, ctx: Context): Promise<number | undefined> {
    const url = this.buildUrl('/occurrence/count', { datasetKey });
    try {
      const value = await this.getJson<unknown>(url, ctx, {
        maxRetries: 0,
        timeoutMs: RECORD_COUNT_TIMEOUT_MS,
      });
      return z.number().int().nonnegative().parse(value);
    } catch (err) {
      ctx.signal.throwIfAborted();
      if (
        !(
          err instanceof McpError &&
          [
            JsonRpcErrorCode.ServiceUnavailable,
            JsonRpcErrorCode.Timeout,
            JsonRpcErrorCode.RateLimited,
          ].includes(err.code)
        )
      )
        throw err;
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
