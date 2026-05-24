/**
 * @fileoverview GBIF API v1 service — wraps api.gbif.org/v1 with retry, auth, and response parsing.
 * @module services/gbif/gbif-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import type {
  BasisOfRecord,
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

// ─── Service class ─────────────────────────────────────────────────────────────

export class GbifService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authHeader: string | undefined;

  constructor(
    _config: AppConfig,
    _storage: StorageService,
    opts: { baseUrl: string; timeoutMs: number; apiKey?: string },
  ) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.timeoutMs = opts.timeoutMs;
    if (opts.apiKey) {
      // GBIF auth: Basic base64(apiKey + ':')
      this.authHeader = `Basic ${btoa(`${opts.apiKey}:`)}`;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;
    return headers;
  }

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

  private getJson<T>(url: string, ctx: Context): Promise<T> {
    return withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        // Propagate ctx.signal if the outer request was cancelled
        ctx.signal.addEventListener('abort', () => controller.abort());
        try {
          const response = await fetch(url, {
            headers: this.buildHeaders(),
            signal: controller.signal,
          });
          if (!response.ok) {
            throw await httpErrorFromResponse(response, { service: 'GBIF API', data: { url } });
          }
          const text = await response.text();
          if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
            throw serviceUnavailable(
              'GBIF API returned HTML — likely rate-limited or unavailable.',
            );
          }
          return JSON.parse(text) as T;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        operation: 'GbifService.getJson',
        baseDelayMs: 1000,
        signal: ctx.signal,
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

  searchSpecies(
    params: {
      q?: string;
      rank?: string;
      kingdom?: string;
      family?: string;
      genus?: string;
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
    if (params.kingdom) queryParams.kingdom = params.kingdom;
    if (params.family) queryParams.family = params.family;
    if (params.genus) queryParams.genus = params.genus;
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
      decimalLatitude?: string;
      decimalLongitude?: string;
      geometry?: string;
      year?: string;
      month?: number;
      basisOfRecord?: BasisOfRecord;
      hasCoordinate?: boolean;
      isInCluster?: boolean;
      datasetKey?: string;
      limit?: number;
      offset?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const queryParams: Record<string, unknown> = {};
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.scientificName) queryParams.scientificName = params.scientificName;
    if (params.country) queryParams.country = params.country;
    if (params.decimalLatitude) queryParams.decimalLatitude = params.decimalLatitude;
    if (params.decimalLongitude) queryParams.decimalLongitude = params.decimalLongitude;
    if (params.geometry) queryParams.geometry = params.geometry;
    if (params.year) queryParams.year = params.year;
    if (params.month !== undefined) queryParams.month = params.month;
    if (params.basisOfRecord) queryParams.basisOfRecord = params.basisOfRecord;
    if (params.hasCoordinate !== undefined) queryParams.hasCoordinate = params.hasCoordinate;
    if (params.isInCluster !== undefined) queryParams.isInCluster = params.isInCluster;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.limit !== undefined) queryParams.limit = params.limit;
    if (params.offset !== undefined) queryParams.offset = params.offset;
    const url = this.buildUrl('/occurrence/search', queryParams);
    ctx.log.debug('Searching occurrences', { taxonKey: params.taxonKey, country: params.country });
    return this.getJson<RawOccurrenceSearchResponse>(url, ctx);
  }

  countOccurrences(
    params: {
      taxonKey?: number;
      country?: string;
      isGeoreferenced?: boolean;
      datasetKey?: string;
      year?: string;
    },
    ctx: Context,
  ): Promise<number> {
    const queryParams: Record<string, unknown> = {};
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.country) queryParams.country = params.country;
    if (params.isGeoreferenced !== undefined) queryParams.isGeoreferenced = params.isGeoreferenced;
    if (params.datasetKey) queryParams.datasetKey = params.datasetKey;
    if (params.year) queryParams.year = params.year;
    const url = this.buildUrl('/occurrence/count', queryParams);
    ctx.log.debug('Counting occurrences', { taxonKey: params.taxonKey });
    return this.getJson<number>(url, ctx);
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
      year?: string;
      basisOfRecord?: BasisOfRecord;
      geometry?: string;
      facet: string;
      facetLimit?: number;
    },
    ctx: Context,
  ): Promise<RawOccurrenceSearchResponse> {
    const queryParams: Record<string, unknown> = { limit: 0, facet: params.facet };
    if (params.taxonKey !== undefined) queryParams.taxonKey = params.taxonKey;
    if (params.country) queryParams.country = params.country;
    if (params.year) queryParams.year = params.year;
    if (params.basisOfRecord) queryParams.basisOfRecord = params.basisOfRecord;
    if (params.geometry) queryParams.geometry = params.geometry;
    if (params.facetLimit !== undefined) queryParams.facetLimit = params.facetLimit;
    const url = this.buildUrl('/occurrence/search', queryParams);
    ctx.log.debug('Fetching occurrence facets', { facet: params.facet });
    return this.getJson<RawOccurrenceSearchResponse>(url, ctx);
  }

  // ─── Datasets ─────────────────────────────────────────────────────────────────

  searchDatasets(
    params: {
      q?: string;
      type?: string;
      publishingCountry?: string;
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
  opts: { baseUrl: string; timeoutMs: number; apiKey?: string },
): void {
  _service = new GbifService(config, storage, opts);
}

export function getGbifService(): GbifService {
  if (!_service) {
    throw new Error('GbifService not initialized — call initGbifService() in setup()');
  }
  return _service;
}
