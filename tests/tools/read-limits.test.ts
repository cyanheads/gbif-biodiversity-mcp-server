/** @fileoverview Shared clamp boundary and telemetry contracts. */
import { z } from '@cyanheads/mcp-ts-core';
import { createMockContext, type MockContextLogger } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { add } = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@cyanheads/mcp-ts-core/utils', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createCounter: vi.fn(() => ({ add })),
}));

import { clampReadLimit, readLimitSchema } from '@/mcp-server/tools/read-limits.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});
describe('shared read limits', () => {
  it.each([
    [0, 0],
    [1, 1],
    [99.5, 99.5],
    [100, 100],
    [100.5, 100],
    [101, 100],
    [Number.MAX_VALUE, 100],
  ])('applies cap to %s without changing smaller values', (requested, expected) => {
    const ctx = createMockContext();
    const result = clampReadLimit(requested, 100, 'gbif_get_dataset', 'contactLimit', ctx);
    expect(result.applied).toBe(expected);
    expect(result.notice).toBe(
      requested > 100 ? `contactLimit requested ${requested}; applied 100.` : undefined,
    );
    const calls = (ctx.log as MockContextLogger).calls;
    if (requested > 100) {
      expect(calls).toContainEqual(
        expect.objectContaining({ level: 'notice', msg: 'Read limit clamped' }),
      );
      expect(add).toHaveBeenCalledExactlyOnceWith(1, {
        tool: 'gbif_get_dataset',
        parameter: 'contactLimit',
      });
    } else {
      expect(calls).toHaveLength(0);
      expect(add).not.toHaveBeenCalled();
    }
  });
  it('records the bulk prefix clamp with bounded dimensions', () => {
    clampReadLimit(53, 50, 'gbif_bulk_match_species', 'names', createMockContext());
    expect(add).toHaveBeenCalledExactlyOnceWith(1, {
      tool: 'gbif_bulk_match_species',
      parameter: 'names',
    });
  });
  it('leaves numeric types and lower bounds to the supplied schema', () => {
    const schema = readLimitSchema(z.number().min(1), 100);
    for (const input of ['101', 0, Number.NaN, Infinity])
      expect(schema.safeParse(input).success).toBe(false);
    expect(schema.parse(100.5)).toBe(100.5);
  });
  it('restores real advertised maxima when disabled', async () => {
    vi.stubEnv('GBIF_CLAMP_READ_LIMITS', 'false');
    const { readLimitSchema: strictSchema } = await import('@/mcp-server/tools/read-limits.js');
    const schema = strictSchema(z.number().min(1), 100);
    expect(schema.safeParse(101).success).toBe(false);
    expect(z.toJSONSchema(schema)).toMatchObject({ maximum: 100, minimum: 1, type: 'number' });
    expect(schema.parse(99.5)).toBe(99.5);
  });
});
