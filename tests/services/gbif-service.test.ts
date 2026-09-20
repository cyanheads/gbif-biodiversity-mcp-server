/**
 * @fileoverview Tests for GbifService transport behavior — the identifying
 * User-Agent GBIF asks integrators to send, the error payload a non-2xx response
 * produces, and how a request deadline is classified.
 * @module tests/services/gbif-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { GbifService } from '@/services/gbif/gbif-service.js';

const REPOSITORY_URL = 'https://github.com/cyanheads/gbif-biodiversity-mcp-server';

/**
 * Deliberately unlike the real package version: if the User-Agent ever goes
 * back to a literal baked into `src/`, these assertions fail instead of
 * silently passing on a string that will drift at the next release.
 */
const TEST_VERSION = '9.9.9-test';

const appConfig = {
  mcpServerName: 'gbif-biodiversity-mcp-server',
  mcpServerVersion: TEST_VERSION,
} as AppConfig;

const storage = {} as StorageService;

let fetchMock: ReturnType<typeof vi.fn>;

function makeService(userAgent?: string): GbifService {
  return new GbifService(appConfig, storage, {
    baseUrl: 'https://api.gbif.org/v1',
    timeoutMs: 1_000,
    userAgent,
  });
}

/** Headers of the single fetch the service issued. */
function sentHeaders(): Record<string, string> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return init.headers as Record<string, string>;
}

describe('GbifService request headers', () => {
  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ usageKey: 2435099 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('identifies the server by name, version, and repository URL', async () => {
    const ctx = createMockContext();
    await makeService().matchSpecies({ name: 'Puma concolor' }, ctx);

    expect(sentHeaders()['User-Agent']).toBe(
      `gbif-biodiversity-mcp-server/${TEST_VERSION} (+${REPOSITORY_URL})`,
    );
  });

  it('takes the version from config rather than a literal in src', async () => {
    const ctx = createMockContext();
    const service = new GbifService(
      { ...appConfig, mcpServerVersion: '1.2.3-other' } as AppConfig,
      storage,
      { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 },
    );
    await service.getSpecies(2435099, ctx);

    expect(sentHeaders()['User-Agent']).toContain('/1.2.3-other ');
    expect(sentHeaders()['User-Agent']).not.toContain(TEST_VERSION);
  });

  it('sends a configured User-Agent verbatim instead of the built-in one', async () => {
    const ctx = createMockContext();
    const override = 'acme-biodiversity-atlas/2.0 (+mailto:ops@acme.example)';
    await makeService(override).searchOccurrences({ taxonKey: 2435099 }, ctx);

    expect(sentHeaders()['User-Agent']).toBe(override);
  });

  it('still requests JSON', async () => {
    const ctx = createMockContext();
    await makeService().countOccurrences({ taxonKey: 2435099 }, ctx);

    expect(sentHeaders().Accept).toBe('application/json');
  });
});

/**
 * #38 — an upstream rejection has to arrive as one self-explanatory error: the
 * cause in the message (so `content[]` clients see it, not just
 * `structuredContent`), a recovery hint, and no trace of the outbound URL.
 */
describe('GbifService upstream error payload', () => {
  /** GBIF's verbatim body for an unclosed WKT ring. */
  const WKT_BODY =
    'Invalid shape in WKT: POLYGON((0 0, 1 1)) Points of LinearRing do not form a closed linestring';
  const REQUEST_URL =
    'https://api.gbif.org/v1/occurrence/search?taxonKey=1&geometry=POLYGON%28%280+0%2C+1+1%29%29&limit=1';

  /** Response the way `fetch` hands one back — `url` populated by the runtime. */
  function upstream(status: number, body: string, statusText: string): Response {
    const response = new Response(body, { status, statusText });
    Object.defineProperty(response, 'url', { value: REQUEST_URL });
    return response;
  }

  function makeService(): GbifService {
    return new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 1_000,
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Takes a factory rather than an instance: a 5xx is transient, so `withRetry`
   * issues several attempts and each one reads the body. A single `Response`
   * reused across them fails on the second read with "Body already used" — a
   * fixture artifact that would masquerade as a transport bug.
   */
  async function searchAndCatch(
    respond: () => Response,
    ctx = createMockContext(),
  ): Promise<McpError> {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(respond())),
    );
    const err = await makeService()
      .searchOccurrences({ geometry: 'POLYGON((0 0, 1 1))' }, ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    return err as McpError;
  }

  it('keeps the request URL out of the error payload', async () => {
    const err = await searchAndCatch(() => upstream(400, WKT_BODY, 'Bad Request'));

    expect(err.data).not.toHaveProperty('url');
    expect(JSON.stringify(err.data)).not.toContain('api.gbif.org');
    expect(JSON.stringify(err.data)).not.toContain('taxonKey=1');
    // The fields withRetry and the callers classify on survive the removal.
    expect(err.data).toMatchObject({ status: 400, body: WKT_BODY });
  });

  it("states GBIF's explanation in the message, not only in data.body", async () => {
    const err = await searchAndCatch(() => upstream(400, WKT_BODY, 'Bad Request'));

    expect(err.message).toContain('HTTP 400');
    expect(err.message).toContain('Points of LinearRing do not form a closed linestring');
  });

  it('carries the invalid_filter reason and a recovery hint on a 400', async () => {
    const err = await searchAndCatch(() => upstream(400, WKT_BODY, 'Bad Request'));
    const data = err.data as { reason?: string; recovery?: { hint?: string } };

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(data.reason).toBe('invalid_filter');
    expect(data.recovery?.hint).toBeTruthy();
  });

  it("prefers the calling definition's recovery wording over the service default", async () => {
    const ctx = createMockContext({ errors: gbifGetDataset.errors });
    const err = await searchAndCatch(
      () => upstream(400, 'Invalid UUID string: not-a-uuid', 'Bad Request'),
      ctx,
    );
    const data = err.data as { recovery?: { hint?: string } };

    expect(data.recovery?.hint).toBe(
      gbifGetDataset.errors?.find((e) => e.reason === 'invalid_filter')?.recovery,
    );
  });

  /**
   * #47 — the taxon-key tools reach the same 400 path (live: /species/999999999999
   * answers 400 "For input string"). Declaring the reason is what lets their own
   * wording replace the service fallback, so assert the wording actually swaps.
   */
  it("uses a taxon-key tool's own invalid_filter wording once it declares one", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(upstream(400, 'For input string: "999999999999"', 'Bad Request')),
    );
    const ctx = createMockContext({ errors: gbifGetSpecies.errors });
    const err = (await makeService()
      .getSpecies(999999999999, ctx)
      .catch((e: unknown) => e)) as McpError;
    const data = err.data as { reason?: string; recovery?: { hint?: string } };

    expect(data.reason).toBe('invalid_filter');
    expect(data.recovery?.hint).toBe(
      gbifGetSpecies.errors?.find((e) => e.reason === 'invalid_filter')?.recovery,
    );
  });

  /**
   * A 500 no longer classifies `InternalError` — that code asserts *this* server
   * failed, which a remote status cannot establish — so it joins the rest of the
   * 5xx range as a transient `ServiceUnavailable` and runs the full retry budget
   * before surfacing. The timeout covers that backoff; what the case pins is
   * unchanged: a non-400 carries no filter reason, no recovery hint, and no
   * trace of the outbound URL.
   */
  it('leaves a non-400 unclassified as a filter problem but still drops the URL', async () => {
    const err = await searchAndCatch(() => upstream(500, 'Internal Server Error', 'Server Error'));
    const data = err.data as { reason?: string; recovery?: unknown };

    expect(err.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(data.reason).toBeUndefined();
    expect(data.recovery).toBeUndefined();
    expect(err.data).not.toHaveProperty('url');
  }, 30_000);

  it('maps a 404 to NotFound so the not_found contracts still fire', async () => {
    const err = await searchAndCatch(() =>
      upstream(404, 'Entity not found for uri: /', 'Not Found'),
    );

    expect(err.code).toBe(JsonRpcErrorCode.NotFound);
  });

  it('keeps an HTML outage page out of the message', async () => {
    const page = '<!DOCTYPE html><html><body>429 Too Many Requests</body></html>';
    const err = await searchAndCatch(() => upstream(400, page, 'Bad Request'));

    expect(err.message).not.toContain('<html>');
    expect(err.message).not.toContain('<!DOCTYPE');
    expect(err.data).toMatchObject({ body: page });
  });
});

describe('GbifService request deadline', () => {
  /** A fetch that only settles when its signal aborts, rejecting with the reason. */
  function hangingFetch() {
    return vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * A bare `controller.abort()` produced a raw AbortError — no code, no data, and
   * a message ("The operation was aborted") naming neither GBIF nor the deadline.
   */
  it('classifies its own deadline as a Timeout naming GBIF and the limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const service = new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 10_000,
    });

    const pending = service.getSpecies(2435099, createMockContext()).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await pending;

    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.Timeout);
    expect((err as McpError).message).toContain('GBIF API request timed out after 10000ms');
    expect((err as McpError).data).toMatchObject({ timeoutMs: 10_000 });
  });

  /**
   * The dataset record count is supplementary, so it must not inherit the primary
   * client's retry budget or pacing — one attempt, then the field goes absent.
   */
  it('bounds the dataset occurrence count to a single attempt and degrades to undefined', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 10_000,
    });

    const count = await service.getDatasetOccurrenceCount(
      '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      createMockContext(),
    );

    expect(count).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * #36/#37 — `/occurrence/count` accepts a closed parameter set and answers
 * `Invalid parameter name` for both `occurrenceStatus` and
 * `iucnRedListCategory`, so the presence/absence default the occurrence tools
 * apply is unreachable through it. `countOccurrences` reads the total from
 * `/occurrence/search?limit=0` instead; these pin the two ways that migration
 * can silently produce a wrong number.
 */
describe('GbifService.countOccurrences endpoint', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ count: 19063, results: [] })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** URL of the single fetch the service issued. */
  function sentUrl(): URL {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return new URL(fetchMock.mock.calls[0]?.[0] as string);
  }

  function service(): GbifService {
    return new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 1_000,
    });
  }

  it('reads the total from the search endpoint at limit=0, not /occurrence/count', async () => {
    const count = await service().countOccurrences({ taxonKey: 5219404 }, createMockContext());

    const url = sentUrl();
    expect(url.pathname).toBe('/v1/occurrence/search');
    expect(url.searchParams.get('limit')).toBe('0');
    // The body is a search response, so the total comes from `count`, not the whole payload.
    expect(count).toBe(19063);
  });

  /**
   * `/occurrence/search` has no `isGeoreferenced` parameter and does not reject
   * one — it ignores it and answers with the unfiltered total. Forwarding the
   * name verbatim would drop the filter and report a number far too large, so
   * the service maps it to `hasCoordinate`, which returns identical figures.
   */
  it('maps isGeoreferenced to hasCoordinate rather than forwarding a name search ignores', async () => {
    await service().countOccurrences({ taxonKey: 212, isGeoreferenced: true }, createMockContext());

    const url = sentUrl();
    expect(url.searchParams.get('hasCoordinate')).toBe('true');
    expect(url.searchParams.has('isGeoreferenced')).toBe(false);
  });

  it('maps isGeoreferenced false, not just true', async () => {
    await service().countOccurrences({ isGeoreferenced: false }, createMockContext());

    expect(sentUrl().searchParams.get('hasCoordinate')).toBe('false');
  });

  it('sends the filters /occurrence/count rejects', async () => {
    await service().countOccurrences(
      { taxonKey: 5219404, occurrenceStatus: 'PRESENT', iucnRedListCategory: 'VU' },
      createMockContext(),
    );

    const url = sentUrl();
    expect(url.searchParams.get('occurrenceStatus')).toBe('PRESENT');
    expect(url.searchParams.get('iucnRedListCategory')).toBe('VU');
  });

  it('reports zero when the search response carries no count', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ results: [] })));

    const count = await service().countOccurrences({ taxonKey: 1 }, createMockContext());

    expect(count).toBe(0);
  });
});

/** #36/#37 — the same two filters have to reach the search and facet endpoints. */
describe('GbifService occurrence filter pass-through', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ count: 0, results: [] })));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sentParams(): URLSearchParams {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return new URL(fetchMock.mock.calls[0]?.[0] as string).searchParams;
  }

  function service(): GbifService {
    return new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 1_000,
    });
  }

  it('sends occurrenceStatus and iucnRedListCategory on searchOccurrences', async () => {
    await service().searchOccurrences(
      { taxonKey: 5219404, occurrenceStatus: 'ABSENT', iucnRedListCategory: 'EN' },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('occurrenceStatus')).toBe('ABSENT');
    expect(params.get('iucnRedListCategory')).toBe('EN');
  });

  it('sends occurrenceStatus and iucnRedListCategory on getOccurrenceFacets', async () => {
    await service().getOccurrenceFacets(
      { facet: 'COUNTRY', occurrenceStatus: 'PRESENT', iucnRedListCategory: 'CR' },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('facet')).toBe('COUNTRY');
    expect(params.get('occurrenceStatus')).toBe('PRESENT');
    expect(params.get('iucnRedListCategory')).toBe('CR');
  });

  it('omits both filters when the caller supplies neither', async () => {
    await service().searchOccurrences({ taxonKey: 1 }, createMockContext());

    const params = sentParams();
    expect(params.has('occurrenceStatus')).toBe(false);
    expect(params.has('iucnRedListCategory')).toBe(false);
  });

  /**
   * #49 — all three occurrence methods hit /occurrence/search, so a filter that
   * reaches one and not another silently answers a different question on inputs the
   * caller believes are identical. These assert the parameters leave this process;
   * that GBIF honors them is a live-API property, verified separately.
   */
  it('sends publishingCountry and stateProvince on searchOccurrences', async () => {
    await service().searchOccurrences(
      { taxonKey: 212, country: 'GB', publishingCountry: 'US', stateProvince: 'England' },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('country')).toBe('GB');
    expect(params.get('publishingCountry')).toBe('US');
    expect(params.get('stateProvince')).toBe('England');
  });

  it('sends publishingCountry and stateProvince on countOccurrences', async () => {
    await service().countOccurrences(
      { taxonKey: 212, publishingCountry: 'US', stateProvince: 'England' },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('publishingCountry')).toBe('US');
    expect(params.get('stateProvince')).toBe('England');
  });

  it('sends publishingCountry and stateProvince on getOccurrenceFacets', async () => {
    await service().getOccurrenceFacets(
      { facet: 'DATASET_KEY', publishingCountry: 'US', stateProvince: 'England' },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('publishingCountry')).toBe('US');
    expect(params.get('stateProvince')).toBe('England');
  });

  it('omits publishingCountry and stateProvince when the caller supplies neither', async () => {
    await service().searchOccurrences({ taxonKey: 1 }, createMockContext());

    const params = sentParams();
    expect(params.has('publishingCountry')).toBe(false);
    expect(params.has('stateProvince')).toBe(false);
  });

  /**
   * #52 — `/dataset/search` names two organization relationships and the two
   * parameters are one character apart in effect, so a mix-up here would answer a
   * different question under the caller's own vocabulary. Note that
   * `/dataset/search` ignores a parameter name it does not recognize and answers
   * 200 with the unfiltered total, so these assert only that both names leave this
   * process under the right spelling; that GBIF honors each is a live-API property,
   * verified separately.
   */
  it('sends publishingOrg and hostingOrg under their own names on searchDatasets', async () => {
    await service().searchDatasets(
      {
        publishingOrg: '0d72dd7f-6f05-46af-85c2-8b6e77ce5534',
        hostingOrg: '07f617d0-c688-11d8-bf62-b8a03c50a862',
      },
      createMockContext(),
    );

    const params = sentParams();
    expect(params.get('publishingOrg')).toBe('0d72dd7f-6f05-46af-85c2-8b6e77ce5534');
    expect(params.get('hostingOrg')).toBe('07f617d0-c688-11d8-bf62-b8a03c50a862');
  });

  it('omits both organization filters when the caller supplies neither', async () => {
    await service().searchDatasets({ q: 'moths' }, createMockContext());

    const params = sentParams();
    expect(params.has('publishingOrg')).toBe(false);
    expect(params.has('hostingOrg')).toBe(false);
  });

  /**
   * #55 — the defect was a parameter that never reached the wire under a name
   * `/species/search` recognizes, and that endpoint answers 200 with the unfiltered
   * index for a name it does not, so nothing downstream can tell. The tool tests
   * mock this service away, which leaves the forward itself covered nowhere else:
   * drop the `higherTaxonKey` line from `searchSpecies` and every one of them still
   * passes while the search silently widens back to the whole backbone. These assert
   * the name leaves the process; that GBIF honors it is a live-API property.
   */
  it('sends higherTaxonKey under its own name on searchSpecies', async () => {
    await service().searchSpecies({ higherTaxonKey: 9327, rank: 'GENUS' }, createMockContext());

    const params = sentParams();
    expect(params.get('higherTaxonKey')).toBe('9327');
    expect(params.get('rank')).toBe('GENUS');
  });

  it('omits higherTaxonKey when the caller supplies no taxon scope', async () => {
    await service().searchSpecies({ q: 'Aves' }, createMockContext());

    const params = sentParams();
    expect(params.has('higherTaxonKey')).toBe(false);
  });
});
