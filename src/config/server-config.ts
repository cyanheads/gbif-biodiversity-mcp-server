/**
 * @fileoverview Server-specific configuration for gbif-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  apiKey: z
    .string()
    .optional()
    .describe(
      'GBIF API key for higher rate limits. Sent as HTTP Basic Auth username with empty password.',
    ),
  baseUrl: z.string().default('https://api.gbif.org/v1').describe('GBIF API base URL.'),
  requestTimeoutMs: z.coerce
    .number()
    .default(10_000)
    .describe('HTTP request timeout in milliseconds.'),
});

type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  if (!_config) {
    _config = parseEnvConfig(ServerConfigSchema, {
      apiKey: 'GBIF_API_KEY',
      baseUrl: 'GBIF_BASE_URL',
      requestTimeoutMs: 'GBIF_REQUEST_TIMEOUT_MS',
    });
  }
  return _config;
}
