/**
 * @fileoverview Server-specific configuration for gbif-biodiversity-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { config, parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  clampReadLimits: z
    .stringbool()
    .default(true)
    .describe('Clamp oversized read requests to their workload caps.'),
  baseUrl: z.string().default('https://api.gbif.org/v1').describe('GBIF API base URL.'),
  requestTimeoutMs: z.coerce
    .number()
    .default(10_000)
    .describe('HTTP request timeout in milliseconds.'),
  /**
   * `.trim()` only. A blank value — and an unsubstituted `${…}` placeholder an
   * install UI forwarded verbatim — reaches `parseEnvConfig` as unset, so the
   * field stays undefined and the service composes its own identifier rather
   * than sending `User-Agent: ""`.
   */
  userAgent: z
    .string()
    .trim()
    .optional()
    .describe('User-Agent header sent on every GBIF API request.'),
});

type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  // Core config loads .env lazily. Read it before constructing env-dependent tool schemas.
  void config.mcpServerName;
  _config ??= parseEnvConfig(ServerConfigSchema, {
    clampReadLimits: 'GBIF_CLAMP_READ_LIMITS',
    baseUrl: 'GBIF_BASE_URL',
    requestTimeoutMs: 'GBIF_REQUEST_TIMEOUT_MS',
    userAgent: 'GBIF_USER_AGENT',
  });
  return _config;
}
