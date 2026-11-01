/**
 * @fileoverview Serve one JSON-RPC request through the Worker handler, for tests that assert
 * on what a client receives over the wire rather than on a handler's return value.
 * @module tests/helpers/worker-request
 */

import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';

/**
 * POST `method` with `params` to a Worker built from `options` and parse the JSON-RPC response
 * frame. `name` fills the `Mcp-Name` routing header that `resources/read` and `tools/call` need.
 * The body is the caller's to type: `T` describes the `result`/`error` shape under test.
 */
export async function callWorker<T>(
  options: Parameters<typeof createWorkerHandler>[0],
  method: string,
  params: Record<string, unknown> = {},
  name?: string,
): Promise<T> {
  const worker = createWorkerHandler(options);
  const response = await worker.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': method,
        ...(name !== undefined && { 'Mcp-Name': name }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
    {} as never,
    { waitUntil: () => {}, passThroughOnException: () => {} } as never,
  );
  const text = await response.text();
  const frame = text.startsWith('{')
    ? text
    : text
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice(5);
  if (!frame) throw new Error('Missing JSON-RPC response frame');
  return JSON.parse(frame) as T;
}

/** The input schema a client receives from `tools/list` for the named tool. */
export async function listedInputSchema(
  options: Parameters<typeof createWorkerHandler>[0],
  toolName: string,
) {
  const body = await callWorker<{
    result: { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] };
  }>(options, 'tools/list');
  return body.result.tools.find((t) => t.name === toolName)!.inputSchema;
}
