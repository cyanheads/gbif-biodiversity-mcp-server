/**
 * @fileoverview Server-specific configuration for gbif-biodiversity-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  baseUrl: z.string().default('https://api.gbif.org/v1').describe('GBIF API base URL.'),
  requestTimeoutMs: z.coerce
    .number()
    .default(10_000)
    .describe('HTTP request timeout in milliseconds.'),
});

type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    baseUrl: 'GBIF_BASE_URL',
    requestTimeoutMs: 'GBIF_REQUEST_TIMEOUT_MS',
  });
  return _config;
}
