/** @fileoverview Read-cap schemas, clamp disclosure, and bounded clamp telemetry. */
import type { Context, z } from '@cyanheads/mcp-ts-core';
import { createCounter } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '@/config/server-config.js';

type ReadTool =
  | 'gbif_search_occurrences'
  | 'gbif_occurrence_facets'
  | 'gbif_get_dataset'
  | 'gbif_search_species'
  | 'gbif_search_datasets'
  | 'gbif_search_publishers'
  | 'gbif_get_species_children'
  | 'gbif_bulk_match_species';
type ReadParameter = 'limit' | 'facetLimit' | 'contactLimit' | 'names';

/** Keep the supplied numeric constraints; strict mode also advertises the workload maximum. */
export function readLimitSchema(schema: z.ZodNumber, maximum: number): z.ZodNumber {
  return getServerConfig().clampReadLimits ? schema : schema.max(maximum);
}

let clampCounter: ReturnType<typeof createCounter> | undefined;

/** Apply the workload cap and record each overshoot; callers compose the notice with existing guidance. */
export function clampReadLimit(
  requested: number,
  maximum: number,
  tool: ReadTool,
  parameter: ReadParameter,
  ctx: Context,
) {
  const applied = Math.min(requested, maximum);
  if (requested <= maximum) return { applied, notice: undefined };
  const notice = `${parameter} requested ${requested}; applied ${applied}.`;
  ctx.log.notice('Read limit clamped', { tool, parameter, requested, applied });
  clampCounter ??= createCounter(
    'gbif.read_limit.clamps',
    'Read requests clamped to their workload cap',
    '{clamps}',
  );
  clampCounter.add(1, { tool, parameter });
  return { applied, notice };
}
