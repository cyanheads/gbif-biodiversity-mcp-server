/**
 * @fileoverview Tests for GbifService transport behavior — the identifying
 * User-Agent GBIF asks integrators to send, the error payload a non-2xx response
 * produces, and how a request deadline is classified.
 * @module tests/services/gbif-service.test
 */

import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createMockContext, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gbifDatasetResource } from '@/mcp-server/resources/definitions/gbif-dataset.resource.js';
import { gbifGetDataset } from '@/mcp-server/tools/definitions/gbif-get-dataset.tool.js';
import { gbifGetSpecies } from '@/mcp-server/tools/definitions/gbif-get-species.tool.js';
import { GbifService, initGbifService } from '@/services/gbif/gbif-service.js';
import type { OccurrenceFilters } from '@/services/gbif/types.js';
import { callWorker } from '../helpers/worker-request.js';

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
    // The status survives the removal, and the captured body stays readable on the server.
    expect(err.data).toMatchObject({ status: 400, body: WKT_BODY });
  });

  it("states GBIF's explanation in the message, not only in data.body", async () => {
    const err = await searchAndCatch(() => upstream(400, WKT_BODY, 'Bad Request'));

    expect(err.message).toContain('HTTP 400');
    expect(err.message).toContain('Points of LinearRing do not form a closed linestring');
  });

  /**
   * The service tags the reason and leaves the hint unset: the framework fills the
   * calling definition's declared `invalid_filter` recovery, which a throw-site
   * hint would override.
   */
  it('carries the invalid_filter reason on a 400 and leaves the hint to the contract', async () => {
    const err = await searchAndCatch(() => upstream(400, WKT_BODY, 'Bad Request'));
    const data = err.data as { reason?: string; recovery?: unknown };

    expect(err.code).toBe(JsonRpcErrorCode.InvalidParams);
    expect(data.reason).toBe('invalid_filter');
    expect(data.recovery).toBeUndefined();
  });

  it("reaches the caller with the calling definition's recovery wording", async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(upstream(400, 'Invalid UUID string: not-a-uuid', 'Bad Request')),
        ),
    );
    initGbifService(appConfig, storage, { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 });

    const result = await runToolContract(gbifGetDataset, {
      datasetKey: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_filter',
          recovery: {
            hint: "Supply the 8-4-4-4-12 hex UUID exactly as gbif_search_datasets returns it, or as it appears in an occurrence record's datasetKey field — a dataset title or DOI is not a key.",
          },
        },
      },
    });
  });

  /**
   * #47 — the taxon-key tools reach the same 400 path (live: /species/999999999999
   * answers 400 "For input string"). Declaring the reason is what puts their own
   * wording on the wire, so assert the declared hint is the one the caller reads.
   */
  it("uses a taxon-key tool's own invalid_filter wording once it declares one", async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(upstream(400, 'For input string: "999999999999"', 'Bad Request')),
        ),
    );
    initGbifService(appConfig, storage, { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 });

    const result = await runToolContract(gbifGetSpecies, { taxonKey: 999999999999 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        data: {
          reason: 'invalid_filter',
          recovery: {
            hint: 'Backbone taxon keys fit in a 32-bit signed integer; take one from gbif_match_species or gbif_search_species rather than constructing it.',
          },
        },
      },
    });
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

  /**
   * The framework keeps the body `httpErrorFromResponse` captures off every client
   * envelope, so the message the service folds GBIF's explanation into is the one
   * place a caller reads it — on `structuredContent` and `content[]` alike.
   */
  describe('on the wire', () => {
    const MISSING_DATASET = '00000000-0000-0000-0000-000000000000';
    const UUID_BODY = 'Invalid UUID string: not-a-uuid';

    function stubUpstream(status: number, body: string, statusText: string): void {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => Promise.resolve(upstream(status, body, statusText))),
      );
      initGbifService(appConfig, storage, {
        baseUrl: 'https://api.gbif.org/v1',
        timeoutMs: 1_000,
      });
    }

    async function callGetDataset() {
      const result = await runToolContract(gbifGetDataset, { datasetKey: MISSING_DATASET });
      expect(result.isError).toBe(true);
      const { error } = result.structuredContent as {
        error: { message: string; data: Record<string, unknown> };
      };
      const text = result.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
      return { error, text };
    }

    it("states GBIF's explanation in the tool error message on both surfaces", async () => {
      stubUpstream(400, UUID_BODY, 'Bad Request');

      const { error, text } = await callGetDataset();

      expect(error.message).toContain('HTTP 400');
      expect(error.message).toContain(UUID_BODY);
      expect(text).toContain(UUID_BODY);
    });

    it('leaves the captured body out of structuredContent.error.data', async () => {
      stubUpstream(400, UUID_BODY, 'Bad Request');

      const { error } = await callGetDataset();

      expect(error.data).not.toHaveProperty('body');
      expect(error.data).not.toHaveProperty('responseBody');
      // The classifying fields the body sat beside still reach the caller.
      expect(error.data).toMatchObject({ status: 400, reason: 'invalid_filter' });
    });

    it('keeps an HTML outage page off both tool surfaces', async () => {
      stubUpstream(400, '<!DOCTYPE html><html><body>Busy</body></html>', 'Bad Request');

      const { error, text } = await callGetDataset();

      expect(JSON.stringify(error)).not.toContain('<!DOCTYPE');
      expect(text).not.toContain('<!DOCTYPE');
      expect(error.message).toContain('HTTP 400');
    });

    it("leaves the captured body out of a resource read's JSON-RPC error data", async () => {
      stubUpstream(400, UUID_BODY, 'Bad Request');
      const uri = `gbif://dataset/${MISSING_DATASET}`;

      const response = await callWorker<{
        error: { code: number; message: string; data: Record<string, unknown> };
      }>(
        { name: 'gbif-service-wire-test', resources: [gbifDatasetResource] },
        'resources/read',
        { uri },
        uri,
      );

      expect(response.error.code).toBe(JsonRpcErrorCode.InvalidParams);
      expect(response.error.message).toContain(UUID_BODY);
      expect(response.error.data).not.toHaveProperty('body');
      expect(response.error.data).not.toHaveProperty('responseBody');
      expect(response.error.data).toMatchObject({ reason: 'invalid_filter' });
    });
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
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
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

  it('ends the supplementary count at three seconds without retrying', async () => {
    vi.useFakeTimers();
    const fetch = hangingFetch();
    vi.stubGlobal('fetch', fetch);
    const pending = makeService().getDatasetOccurrenceCount(
      '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
      createMockContext(),
    );
    await vi.advanceTimersByTimeAsync(2999);
    const request = fetch.mock.calls[0];
    if (!request) throw new Error('Count fetch did not start');
    expect(request[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeUndefined();
    expect(request[1].signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['not JSON', '{}', '-1', '1.5', 'null'])(
    'propagates invalid count payload %s',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(
        makeService().getDatasetOccurrenceCount(
          '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
          createMockContext(),
        ),
      ).rejects.toThrow();
    },
  );

  it('propagates programmer errors from the count request', async () => {
    const error = new Error('programmer defect');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(
      makeService().getDatasetOccurrenceCount(
        '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
        createMockContext(),
      ),
    ).rejects.toBe(error);
  });

  it.each([400, 401, 403, 404])('propagates rejected count request HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Rejected', { status })));
    await expect(
      makeService().getDatasetOccurrenceCount(
        '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
        createMockContext(),
      ),
    ).rejects.toBeInstanceOf(McpError);
  });

  it('discloses an unavailable count on the production tool contract', async () => {
    const key = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            url.includes('/dataset/')
              ? new Response(JSON.stringify({ key, title: 'eBird', type: 'METADATA' }))
              : new Response('Unavailable', { status: 503 }),
          ),
        ),
    );
    initGbifService(appConfig, storage, { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1000 });
    const result = await runToolContract(gbifGetDataset, { datasetKey: key });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      title: 'eBird',
      recordCountNotice: expect.stringContaining('retry'),
    });
    expect(JSON.stringify(result.content)).toContain(
      'supplementary indexed occurrence count is unavailable',
    );
  });

  it('preserves caller cancellation identity and aborts the count fetch', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped count');
    let aborted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                reject(init.signal?.reason);
              },
              { once: true },
            );
            controller.abort(reason);
          }),
      ),
    );
    await expect(
      makeService().getDatasetOccurrenceCount(
        '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
        createMockContext({ signal: controller.signal }),
      ),
    ).rejects.toBe(reason);
    expect(aborted).toBe(true);
  });
});

/**
 * #89 — `/v2/species/match` is the only route that matches against the Catalogue of
 * Life, and it renames two v1 parameters: a v2 `name` answers NONE "No name given" and
 * a v2 `rank` is ignored. Its root is derived from the configured v1 root.
 */
describe('GbifService.matchChecklistSpecies', () => {
  const COL_XR = '7ddf754f-d193-4cc9-b351-99906754a03b';
  const TREX = {
    usage: { key: 'TPJ7G', canonicalName: 'Tyrannosaurus mcraeensis', status: 'ACCEPTED' },
    diagnostics: { matchType: 'EXACT', confidence: 97 },
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(TREX))));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function service(baseUrl: string): GbifService {
    return new GbifService(appConfig, storage, { baseUrl, timeoutMs: 1_000 });
  }

  /** URL of the single fetch the service issued. */
  function sentUrl(): URL {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    return new URL(fetchMock.mock.calls[0]?.[0] as string);
  }

  it('sends scientificName and taxonRank on the v2 route, never name or rank', async () => {
    const body = await service('https://api.gbif.org/v1').matchChecklistSpecies(
      {
        name: 'Oenanthe oenanthe',
        checklistKey: COL_XR,
        strict: false,
        kingdom: 'Animalia',
        rank: 'SPECIES',
      },
      createMockContext(),
    );

    const url = sentUrl();
    expect(`${url.origin}${url.pathname}`).toBe('https://api.gbif.org/v2/species/match');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      checklistKey: COL_XR,
      scientificName: 'Oenanthe oenanthe',
      strict: 'false',
      kingdom: 'Animalia',
      taxonRank: 'SPECIES',
    });
    expect(body).toEqual(TREX);
  });

  it('omits the optional parameters it was not given', async () => {
    await service('https://api.gbif.org/v1').matchChecklistSpecies(
      { name: 'Tyrannosaurus mcraeensis', checklistKey: COL_XR },
      createMockContext(),
    );

    expect(Object.fromEntries(sentUrl().searchParams)).toEqual({
      checklistKey: COL_XR,
      scientificName: 'Tyrannosaurus mcraeensis',
    });
  });

  it.each([
    ['https://api.gbif.org/v1/', 'https://api.gbif.org/v2/species/match'],
    ['https://gbif.example.org/proxy/v1', 'https://gbif.example.org/proxy/v2/species/match'],
  ])('derives the v2 route from base URL %s', async (baseUrl, expected) => {
    await service(baseUrl).matchChecklistSpecies(
      { name: 'Lynx pardinus', checklistKey: COL_XR },
      createMockContext(),
    );

    const url = sentUrl();
    expect(`${url.origin}${url.pathname}`).toBe(expected);
  });

  /**
   * A root that does not end in `/v1` names no v2 root by any rule, so the v2 call fails
   * before a request while the v1 routes keep working from the same root.
   */
  it.each(['https://gbif.example.org/proxy', 'https://gbif.example.org/v1beta'])(
    'fails as a configuration error under base URL %s and still serves v1',
    async (baseUrl) => {
      const gbif = service(baseUrl);
      const err = await gbif
        .matchChecklistSpecies({ name: 'Lynx pardinus', checklistKey: COL_XR }, createMockContext())
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(McpError);
      expect((err as McpError).code).toBe(JsonRpcErrorCode.ConfigurationError);
      expect((err as McpError).message).toContain('GBIF_BASE_URL');
      expect((err as McpError).message).toContain('Omit checklistKey');
      expect((err as McpError).message).not.toContain(baseUrl);
      expect(fetchMock).not.toHaveBeenCalled();

      await gbif.matchSpecies({ name: 'Lynx pardinus' }, createMockContext());
      const url = sentUrl();
      expect(`${url.origin}${url.pathname}`).toBe(`${baseUrl}/species/match`);
    },
  );
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

/**
 * All three occurrence methods hit `/occurrence/search`, and the endpoint answers a
 * parameter it does not receive with the wider scope rather than an error. A filter
 * one method forwards and another drops therefore answers a different question on
 * inputs the caller believes identical — so every key is pinned at the wire, on
 * each method, under its own name and byte-for-byte as supplied (padding, `0`, and
 * `false` included).
 */
describe('GbifService occurrence filter table', () => {
  let requests: URL[];

  beforeEach(() => {
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (address: string) => {
        const url = new URL(address);
        requests.push(url);
        if (url.hostname !== 'api.gbif.org' || url.pathname !== '/v1/occurrence/search')
          throw new TypeError(`Unexpected request to ${url.hostname}${url.pathname}`);
        return new Response(JSON.stringify({ count: 0, results: [], facets: [] }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const filters = {
    taxonKey: 0,
    scientificName: ' Panthera leo ',
    country: 'ZA',
    publishingCountry: 'US',
    stateProvince: ' Limpopo ',
    decimalLatitude: '-35,-20',
    decimalLongitude: '15,35',
    geometry: 'POLYGON((15 -35,35 -35,35 -20,15 -20,15 -35))',
    year: '2020,2024',
    month: 12,
    basisOfRecord: 'FOSSIL_SPECIMEN',
    hasCoordinate: false,
    isInCluster: false,
    coordinateUncertaintyInMeters: '0,1000',
    datasetKey: '4fa7b334-ce0d-4e88-aaae-2e0c138d049e',
    occurrenceStatus: 'ABSENT',
    iucnRedListCategory: 'VU',
    gadmGid: 'ZAF.5_1',
    catalogNumber: 'l.1592880',
    institutionCode: 'clo',
    recordedBy: 'Darwin, C.',
    mediaType: 'Sound',
  } as const satisfies OccurrenceFilters;

  const wire = Object.fromEntries(Object.entries(filters).map(([key, value]) => [key, `${value}`]));

  it.each([
    {
      name: 'searchOccurrences',
      run: (service: GbifService) =>
        service.searchOccurrences({ ...filters, limit: 3, offset: 2 }, createMockContext()),
      controls: { limit: '3', offset: '2' },
    },
    {
      name: 'countOccurrences',
      run: (service: GbifService) => service.countOccurrences(filters, createMockContext()),
      controls: { limit: '0' },
    },
    {
      name: 'getOccurrenceFacets',
      run: (service: GbifService) =>
        service.getOccurrenceFacets(
          { ...filters, facet: 'COUNTRY', facetLimit: 3, facetOffset: 1 },
          createMockContext(),
        ),
      controls: { limit: '0', facet: 'COUNTRY', facetLimit: '3', facetOffset: '1' },
    },
  ])('$name forwards every filter and nothing else', async ({ run, controls }) => {
    await run(
      new GbifService(appConfig, storage, { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 }),
    );

    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({ ...wire, ...controls });
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

/**
 * #76 — naming facet bucket keys costs one lookup per bucket, since GBIF has no
 * multi-key read for species or datasets. The bounds live at this seam: one attempt
 * per key, a concurrency ceiling shared by every call on the service, and one
 * deadline over the whole set. The routed fakes answer by pathname and give any
 * path they do not know a 400.
 */
describe('GbifService.getFacetLabels (#76)', () => {
  const DATASET = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e';
  const DEADLINE_MS = 10_000;
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const taxonKeys = (count: number, from = 1000) =>
    Array.from({ length: count }, (_, i) => String(from + i));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Per-attempt timeout past the label deadline, so only the deadline ends a hanging lookup. */
  function labelService(): GbifService {
    return new GbifService(appConfig, storage, {
      baseUrl: 'https://api.gbif.org/v1',
      timeoutMs: 60_000,
    });
  }

  /** Answers each known pathname from `routes`; a throwing route rejects, as fetch does. */
  function routed(routes: Map<string, () => Response>) {
    return vi.fn((address: string, _init?: RequestInit) => {
      const url = new URL(address);
      return Promise.resolve().then(() =>
        url.hostname === 'api.gbif.org' && routes.has(url.pathname)
          ? routes.get(url.pathname)!()
          : new Response('Unexpected request', { status: 400 }),
      );
    });
  }

  /** A lookup that settles only when its signal aborts, rejecting with `rejectWith`. */
  function hanging(rejectWith: (signal: AbortSignal) => unknown) {
    return vi.fn(
      (_address: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          signal.addEventListener('abort', () => reject(rejectWith(signal)), { once: true });
        }),
    );
  }

  /** What some runtimes reject an aborted fetch with in place of the signal's reason. */
  const bareAbort = () => new DOMException('This operation was aborted', 'AbortError');

  it("reads a taxon key's canonicalName and a dataset key's title, one bare request per key", async () => {
    const fetch = routed(
      new Map([
        [
          '/v1/species/2495455',
          () =>
            json({
              key: 2495455,
              canonicalName: 'Columba palumbus',
              scientificName: 'Columba palumbus Linnaeus, 1758',
            }),
        ],
        ['/v1/species/0', () => json({ key: 0, canonicalName: 'incertae sedis' })],
        [
          `/v1/dataset/${DATASET}`,
          () => json({ key: DATASET, title: 'EOD – eBird Observation Dataset' }),
        ],
      ]),
    );
    vi.stubGlobal('fetch', fetch);
    const service = labelService();

    const taxa = await service.getFacetLabels(
      { kind: 'taxon', keys: ['2495455', '0'], deadlineMs: DEADLINE_MS },
      createMockContext(),
    );
    const datasets = await service.getFacetLabels(
      { kind: 'dataset', keys: [DATASET], deadlineMs: DEADLINE_MS },
      createMockContext(),
    );

    expect(taxa).toEqual(
      new Map([
        ['2495455', 'Columba palumbus'],
        ['0', 'incertae sedis'],
      ]),
    );
    expect(datasets).toEqual(new Map([[DATASET, 'EOD – eBird Observation Dataset']]));
    const sent = fetch.mock.calls.map(([address]) => new URL(address));
    expect(sent.map((url) => url.pathname)).toEqual([
      '/v1/species/2495455',
      '/v1/species/0',
      `/v1/dataset/${DATASET}`,
    ]);
    expect(sent.every((url) => url.search === '')).toBe(true);
  });

  /** #86 — live: Kew answers its record, an unknown UUID HTTP 404 text/plain. */
  it("reads an organization UUID's title from /organization/{key}, leaving a 404 unlabeled", async () => {
    const KEW = '061b4f20-f241-11da-a328-b8a03c50a862';
    const UNKNOWN = '00000000-0000-0000-0000-000000000000';
    const fetch = routed(
      new Map([
        [`/v1/organization/${KEW}`, () => json({ key: KEW, title: 'Royal Botanic Gardens, Kew' })],
        [
          `/v1/organization/${UNKNOWN}`,
          () => new Response(`Entity not found for uri: /organization/${UNKNOWN}`, { status: 404 }),
        ],
      ]),
    );
    vi.stubGlobal('fetch', fetch);

    const labels = await labelService().getFacetLabels(
      { kind: 'organization', keys: [KEW, UNKNOWN], deadlineMs: DEADLINE_MS },
      createMockContext(),
    );

    expect(labels).toEqual(new Map([[KEW, 'Royal Botanic Gardens, Kew']]));
    const sent = fetch.mock.calls.map(([address]) => new URL(address));
    expect(sent.map((url) => url.pathname)).toEqual([
      `/v1/organization/${KEW}`,
      `/v1/organization/${UNKNOWN}`,
    ]);
    expect(sent.every((url) => url.search === '')).toBe(true);
  });

  /** These kinds never answer a held key with an empty 200, so one is a defect, not a missing name. */
  it.each([
    { kind: 'taxon', key: '2495455', path: '/v1/species/2495455' },
    { kind: 'dataset', key: DATASET, path: `/v1/dataset/${DATASET}` },
    { kind: 'organization', key: DATASET, path: `/v1/organization/${DATASET}` },
  ] as const)('fails the call on an empty $kind body', async ({ kind, key, path }) => {
    vi.stubGlobal('fetch', routed(new Map([[path, () => new Response('')]])));

    await expect(
      labelService().getFacetLabels(
        { kind, keys: [key], deadlineMs: DEADLINE_MS },
        createMockContext(),
      ),
    ).rejects.toBeInstanceOf(SyntaxError);
  });

  it.each([
    { outcome: 'HTTP 404', respond: () => new Response('Entity not found', { status: 404 }) },
    { outcome: 'HTTP 500', respond: () => new Response('Server error', { status: 500 }) },
    { outcome: 'HTTP 503', respond: () => new Response('Unavailable', { status: 503 }) },
    { outcome: 'HTTP 429', respond: () => new Response('Slow down', { status: 429 }) },
    { outcome: 'an HTML outage page', respond: () => new Response('<!DOCTYPE html><p>Busy</p>') },
    {
      outcome: 'a transport failure',
      respond: (): Response => {
        throw new TypeError('fetch failed');
      },
    },
    { outcome: 'a record without the name', respond: () => json({ key: 2492462 }) },
    { outcome: 'an empty name', respond: () => json({ key: 2492462, canonicalName: '' }) },
    { outcome: 'a null body', respond: () => new Response('null') },
  ])('leaves a key unlabeled on $outcome, without retrying it', async ({ respond }) => {
    const fetch = routed(
      new Map([
        ['/v1/species/2495455', () => json({ canonicalName: 'Columba palumbus' })],
        ['/v1/species/2492462', respond],
      ]),
    );
    vi.stubGlobal('fetch', fetch);

    const labels = await labelService().getFacetLabels(
      { kind: 'taxon', keys: ['2495455', '2492462'], deadlineMs: DEADLINE_MS },
      createMockContext(),
    );

    expect(labels).toEqual(new Map([['2495455', 'Columba palumbus']]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  /** Not an upstream answer to disclose as a missing label, so the call fails loudly. */
  it.each([
    { failure: 'a malformed body', respond: () => new Response('not JSON'), expected: SyntaxError },
    {
      failure: 'a programming error',
      respond: (): Response => {
        throw new RangeError('programmer defect');
      },
      expected: RangeError,
    },
  ])('propagates $failure and ends the lookups still in flight', async ({ respond, expected }) => {
    const straggler = hanging((signal) => signal.reason);
    const answer = routed(new Map([['/v1/species/2495455', respond]]));
    vi.stubGlobal('fetch', (address: string, init?: RequestInit) =>
      new URL(address).pathname === '/v1/species/2492462'
        ? straggler(address, init)
        : answer(address, init),
    );

    await expect(
      labelService().getFacetLabels(
        { kind: 'taxon', keys: ['2495455', '2492462'], deadlineMs: DEADLINE_MS },
        createMockContext(),
      ),
    ).rejects.toBeInstanceOf(expected);
    expect(straggler.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  /**
   * Event-driven, no timers: each released lookup waits for the fetch that replaces
   * it, so the in-flight count is read at every point a slot changes hands.
   */
  it('keeps at most eight lookups in flight, across concurrent calls on the service', async () => {
    const held: (() => void)[] = [];
    let inFlight = 0;
    let peak = 0;
    let onStart: (() => void) | undefined;
    const fetch = vi.fn((address: string) => {
      expect(new URL(address).pathname).toMatch(/^\/v1\/species\/\d+$/);
      inFlight++;
      peak = Math.max(peak, inFlight);
      onStart?.();
      return new Promise<Response>((resolve) => {
        held.push(() => {
          inFlight--;
          resolve(json({ canonicalName: 'Parus major' }));
        });
      });
    });
    vi.stubGlobal('fetch', fetch);
    const service = labelService();

    const calls = [1000, 2000].map((from) =>
      service.getFacetLabels(
        { kind: 'taxon', keys: taxonKeys(10, from), deadlineMs: DEADLINE_MS },
        createMockContext(),
      ),
    );
    expect(inFlight).toBe(8);
    while (fetch.mock.calls.length < 20) {
      const started = new Promise<void>((resolve) => {
        onStart = resolve;
      });
      held.shift()?.();
      await started;
      expect(inFlight).toBeLessThanOrEqual(8);
    }
    for (const release of held.splice(0)) release();
    const [first, second] = await Promise.all(calls);

    expect(peak).toBe(8);
    expect(fetch).toHaveBeenCalledTimes(20);
    expect([...(first?.keys() ?? []), ...(second?.keys() ?? [])]).toHaveLength(20);
  });

  it.each([
    { rejection: 'the abort reason', rejectWith: (signal: AbortSignal) => signal.reason },
    { rejection: 'a bare AbortError', rejectWith: bareAbort },
  ])(
    'releases every lookup still queued or in flight at the deadline, when fetch rejects with $rejection',
    async ({ rejectWith }) => {
      vi.useFakeTimers();
      const fetch = hanging(rejectWith);
      vi.stubGlobal('fetch', fetch);
      let settled = false;

      const pending = labelService()
        .getFacetLabels(
          { kind: 'taxon', keys: taxonKeys(10), deadlineMs: DEADLINE_MS },
          createMockContext(),
        )
        .finally(() => {
          settled = true;
        });
      await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
      expect(settled).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual(new Map());
      // The two still queued at the deadline never started.
      expect(fetch).toHaveBeenCalledTimes(8);
      for (const [, init] of fetch.mock.calls) expect(init?.signal?.aborted).toBe(true);
    },
  );

  /**
   * Each lookup answers 6 s after it starts, so the first eight land at 6 s and the
   * next eight would at 12 s. A per-lookup 10 s deadline would let all sixteen
   * through; one deadline over the set stops the second wave.
   */
  it('spends one deadline across the whole set, not one per lookup', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_address: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(json({ canonicalName: 'Parus major' })), 6_000);
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(init.signal?.reason);
            },
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const keys = taxonKeys(16);

    const pending = labelService().getFacetLabels(
      { kind: 'taxon', keys, deadlineMs: DEADLINE_MS },
      createMockContext(),
    );
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    const labels = await pending;

    expect([...labels.keys()]).toEqual(keys.slice(0, 8));
    expect(fetch).toHaveBeenCalledTimes(16);
  });

  /**
   * Queued lookups leave the line with the caller's own reason, so the case with all
   * of them in flight and a bare AbortError is the one where only the lookup's own
   * cancellation check keeps the reason's identity.
   */
  it.each([
    {
      shape: 'lookups queued, fetch rejecting with the abort reason',
      keys: 10,
      rejectWith: (signal: AbortSignal) => signal.reason,
    },
    {
      shape: 'lookups queued, fetch rejecting with a bare AbortError',
      keys: 10,
      rejectWith: bareAbort,
    },
    {
      shape: 'every lookup in flight, fetch rejecting with a bare AbortError',
      keys: 3,
      rejectWith: bareAbort,
    },
  ])(
    "rejects with the caller's cancellation and ends every lookup, with $shape",
    async ({ keys, rejectWith }) => {
      const controller = new AbortController();
      const reason = new Error('caller stopped the labels');
      const fetch = hanging(rejectWith);
      vi.stubGlobal('fetch', fetch);
      const started = Math.min(keys, 8);

      const pending = labelService().getFacetLabels(
        { kind: 'taxon', keys: taxonKeys(keys), deadlineMs: DEADLINE_MS },
        createMockContext({ signal: controller.signal }),
      );
      expect(fetch).toHaveBeenCalledTimes(started);
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(fetch).toHaveBeenCalledTimes(started);
      for (const [, init] of fetch.mock.calls) expect(init?.signal?.aborted).toBe(true);
    },
  );

  /** The response is already in hand when the abort lands, so no lookup itself fails. */
  it('rejects with a cancellation that lands after every lookup has its answer', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped the labels');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort(reason);
        return Promise.resolve(json({ canonicalName: 'Columba palumbus' }));
      }),
    );

    await expect(
      labelService().getFacetLabels(
        { kind: 'taxon', keys: ['2495455'], deadlineMs: DEADLINE_MS },
        createMockContext({ signal: controller.signal }),
      ),
    ).rejects.toBe(reason);
  });
});

/**
 * #88, #90 — the two label kinds whose upstream answers a key it does not hold with
 * HTTP 200: `/geocode/gadm/{gid}` with an empty body, and `/v2/species/match` with a
 * NONE that carries no `usage`. Bodies are live answers.
 */
describe('GbifService.getFacetLabels GADM and Catalogue of Life kinds (#88, #90)', () => {
  const COL_XR = '7ddf754f-d193-4cc9-b351-99906754a03b';
  const DEADLINE_MS = 10_000;
  const json = (body: unknown) => new Response(JSON.stringify(body));
  const ANDALUCIA = {
    id: 'ESP.1_1',
    name: 'Andalucía',
    gadmLevel: 1,
    englishType: ['Autonomous Community'],
    higherRegions: [{ id: 'ESP', name: 'Spain' }],
  };
  const TRINGA = {
    usage: {
      key: '8288',
      name: 'Tringa Linnaeus, 1758',
      canonicalName: 'Tringa',
      rank: 'GENUS',
      status: 'ACCEPTED',
    },
    diagnostics: {
      matchType: 'EXACT',
      confidence: 100,
      note: 'All provided names were ignored since the usageKey was provided',
    },
    synonym: false,
  };
  const NONE = {
    diagnostics: {
      matchType: 'NONE',
      note: 'All provided names were ignored since the usageKey was provided',
    },
    synonym: false,
  };
  let sent: URL[];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Answers by `respond(url)`; a URL it returns nothing for draws a 400. */
  function stub(respond: (url: URL) => Response | undefined) {
    sent = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((address: string) => {
        const url = new URL(address);
        sent.push(url);
        return Promise.resolve(respond(url) ?? new Response('Unexpected request', { status: 400 }));
      }),
    );
  }

  function labels(kind: string, keys: string[], baseUrl = 'https://api.gbif.org/v1') {
    return new GbifService(appConfig, storage, { baseUrl, timeoutMs: 60_000 }).getFacetLabels(
      { kind: kind as never, keys, deadlineMs: DEADLINE_MS },
      createMockContext(),
    );
  }

  it('names a GID from /geocode/gadm/{gid}, leaving the empty 200 an unknown GID gets unlabeled', async () => {
    stub((url) =>
      url.pathname === '/v1/geocode/gadm/ESP.1_1'
        ? json(ANDALUCIA)
        : url.pathname === '/v1/geocode/gadm/ESP.99_1'
          ? new Response('')
          : url.pathname === '/v1/geocode/gadm/ESP'
            ? json({ id: 'ESP', name: 'Spain', gadmLevel: 0 })
            : undefined,
    );

    const result = await labels('gadm', ['ESP.1_1', 'ESP.99_1', 'ESP']);

    expect(result).toEqual(
      new Map([
        ['ESP.1_1', 'Andalucía'],
        ['ESP', 'Spain'],
      ]),
    );
    expect(sent.map((url) => url.pathname)).toEqual([
      '/v1/geocode/gadm/ESP.1_1',
      '/v1/geocode/gadm/ESP.99_1',
      '/v1/geocode/gadm/ESP',
    ]);
    expect(sent.every((url) => url.search === '')).toBe(true);
  });

  it.each([
    { outcome: 'a record without the name', body: '{"id":"ESP.1_1"}' },
    { outcome: 'an empty name', body: '{"id":"ESP.1_1","name":""}' },
    { outcome: 'a null body', body: 'null' },
  ])('leaves a GID unlabeled on $outcome', async ({ body }) => {
    stub(() => new Response(body));
    expect(await labels('gadm', ['ESP.1_1'])).toEqual(new Map());
  });

  /** Only the empty body is GADM's not-found answer; anything else unparseable is a defect. */
  it.each(['not JSON', '{"name":'])(
    'fails the call on the non-empty GADM body %j',
    async (body) => {
      stub(() => new Response(body));
      await expect(labels('gadm', ['ESP.1_1'])).rejects.toBeInstanceOf(SyntaxError);
    },
  );

  it('names a Catalogue of Life key from usage.canonicalName on the v2 match route', async () => {
    stub((url) =>
      `${url.origin}${url.pathname}` === 'https://api.gbif.org/v2/species/match' &&
      url.searchParams.get('checklistKey') === COL_XR
        ? url.searchParams.get('usageKey') === '8288'
          ? json(TRINGA)
          : json(NONE)
        : undefined,
    );

    const result = await labels('colTaxon', ['8288', 'ZZZQQ9']);

    expect(result).toEqual(new Map([['8288', 'Tringa']]));
    expect(sent.map((url) => Object.fromEntries(url.searchParams))).toEqual([
      { checklistKey: COL_XR, usageKey: '8288' },
      { checklistKey: COL_XR, usageKey: 'ZZZQQ9' },
    ]);
    // Never the Backbone route, where 8288 names an unrelated family.
    expect(sent.some((url) => url.pathname.startsWith('/v1/species'))).toBe(false);
  });

  it.each(['not JSON', ''])('fails the call on the Catalogue of Life body %j', async (body) => {
    stub(() => new Response(body));
    await expect(labels('colTaxon', ['8288'])).rejects.toBeInstanceOf(SyntaxError);
  });

  it('leaves a Catalogue of Life key unlabeled on a 404 or 503, without retrying it', async () => {
    stub((url) =>
      url.searchParams.get('usageKey') === '8288'
        ? new Response('Unavailable', { status: 503 })
        : new Response('Not found', { status: 404 }),
    );
    expect(await labels('colTaxon', ['8288', 'N'])).toEqual(new Map());
    expect(sent).toHaveLength(2);
  });

  it('derives the v2 route from the configured root, as the match route does', async () => {
    stub(() => json(TRINGA));
    await labels('colTaxon', ['8288'], 'https://gbif.example.org/proxy/v1/');
    expect(`${sent[0]!.origin}${sent[0]!.pathname}`).toBe(
      'https://gbif.example.org/proxy/v2/species/match',
    );
  });

  /** No rule recovers a v2 root from a root without `/v1`, so the labels fail before a request. */
  it('fails as a configuration error under a root that names no v2 route', async () => {
    stub(() => json(TRINGA));
    const err = await labels('colTaxon', ['8288'], 'https://gbif.example.org/proxy').catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe(JsonRpcErrorCode.ConfigurationError);
    expect((err as McpError).message).toContain('GBIF_BASE_URL');
    expect((err as McpError).message).toContain('includeLabels');
    expect(sent).toHaveLength(0);
  });
});

/**
 * #90 — a Catalogue of Life key goes upstream as `taxonKey`, beside `checklistKey`.
 * GBIF ignores an unknown parameter, so `checklistTaxonKey` under its own name would
 * scope nothing and answer the whole index.
 */
describe('GbifService checklist taxon key (#90)', () => {
  const COL_XR = '7ddf754f-d193-4cc9-b351-99906754a03b';
  let requests: URL[];

  beforeEach(() => {
    requests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (address: string) => {
        requests.push(new URL(address));
        return new Response(JSON.stringify({ count: 2268, results: [], facets: [] }));
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const service = () =>
    new GbifService(appConfig, storage, { baseUrl: 'https://api.gbif.org/v1', timeoutMs: 1_000 });
  const filters = {
    checklistTaxonKey: '3WSJV',
    checklistKey: COL_XR,
    occurrenceStatus: 'PRESENT',
  } as const satisfies OccurrenceFilters;

  it.each([
    {
      name: 'searchOccurrences',
      run: (gbif: GbifService) =>
        gbif.searchOccurrences({ ...filters, limit: 1 }, createMockContext()),
    },
    {
      name: 'countOccurrences',
      run: (gbif: GbifService) => gbif.countOccurrences(filters, createMockContext()),
    },
    {
      name: 'getOccurrenceFacets',
      run: (gbif: GbifService) =>
        gbif.getOccurrenceFacets({ ...filters, facet: 'COUNTRY' }, createMockContext()),
    },
  ])('$name sends checklistTaxonKey as taxonKey and checklistKey as itself', async ({ run }) => {
    await run(service());

    expect(requests).toHaveLength(1);
    const params = requests[0]!.searchParams;
    expect(params.getAll('taxonKey')).toEqual(['3WSJV']);
    expect(params.get('checklistKey')).toBe(COL_XR);
    expect(params.has('checklistTaxonKey')).toBe(false);
    expect(requests[0]!.search).toContain(`taxonKey=3WSJV&checklistKey=${COL_XR}`);
  });

  it('sends a Backbone taxonKey alone exactly as before', async () => {
    await service().countOccurrences({ taxonKey: 2435261 }, createMockContext());
    expect(requests[0]!.search).toBe('?taxonKey=2435261&limit=0');
  });
});
