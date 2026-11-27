#!/usr/bin/env node
/**
 * SKETCH3D — Local Stdio MCP Server (`sketch3d-mcp`)
 * ===================================================
 * Zero-dependency Node.js JSON-RPC 2.0 MCP server exposing the 6 typed
 * SKETCH3D CAD/printability tools over stdio with 1:1 Schema V2 parity.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFINITIONS, createMcpSession, executeMcpTool } from './toolHandlers.mjs';

const SERVER_INFO = { name: 'sketch3d-mcp', version: '1.0.0' };
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export function createMcpServer(session = createMcpSession()) {
  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return msg?.id !== undefined
        ? { jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' } }
        : null;
    }

    const { id, method, params = {} } = msg;
    const isNotification = id === undefined || id === null;

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return null;
    }

    if (method === 'initialize') {
      const reqVer = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(reqVer)
        ? reqVer
        : SUPPORTED_PROTOCOL_VERSIONS[SUPPORTED_PROTOCOL_VERSIONS.length - 1];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO
        }
      };
    }

    if (method === 'ping' || method === 'shutdown') {
      return isNotification ? null : { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOL_DEFINITIONS } };
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const exists = TOOL_DEFINITIONS.some(t => t.name === toolName);
      if (!exists) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: `Unknown MCP tool: ${String(toolName)}` }
        };
      }
      try {
        const result = await executeMcpTool(toolName, toolArgs, session);
        const isError = result?.ok === false;
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError
          }
        };
      } catch (err) {
        const errPayload = { ok: false, error: err?.message || 'Tool execution failed' };
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(errPayload, null, 2) }],
            structuredContent: errPayload,
            isError: true
          }
        };
      }
    }

    return isNotification
      ? null
      : { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  return { session, handleMessage };
}

function writeResponse(stdout, response, useContentLength = false) {
  if (!response) return;
  const payload = JSON.stringify(response);
  if (useContentLength) {
    const byteLen = Buffer.byteLength(payload, 'utf-8');
    stdout.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
  } else {
    stdout.write(`${payload}\n`);
  }
}

export function startStdioServer(stdin = process.stdin, stdout = process.stdout, stderr = process.stderr) {
  const { handleMessage } = createMcpServer(createMcpSession());
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();

  const processPayload = (rawJson, useContentLength) => {
    queue = queue.then(async () => {
      let msg;
      try {
        msg = JSON.parse(rawJson);
      } catch (err) {
        writeResponse(stdout, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: `Parse error: ${err.message}` }
        }, useContentLength);
        return;
      }
      const res = await handleMessage(msg);
      writeResponse(stdout, res, useContentLength);
    }).catch((err) => {
      stderr.write(`[sketch3d-mcp] Error: ${err?.stack || err}\n`);
    });
  };

  stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk]);

    while (buffer.length > 0) {
      const strPreview = buffer.slice(0, 64).toString('utf-8').trimStart();
      if (strPreview.toLowerCase().startsWith('content-length:')) {
        const leadingWs = buffer.slice(0, 64).toString('utf-8').length - strPreview.length;
        if (leadingWs > 0) buffer = buffer.slice(leadingWs);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        const sepLen = headerEnd !== -1 ? 4 : 2;
        const altEnd = headerEnd !== -1 ? headerEnd : buffer.indexOf('\n\n');
        if (altEnd === -1) break;
        const headerText = buffer.slice(0, altEnd).toString('utf-8');
        const m = headerText.match(/Content-Length:\s*(\d+)/i);
        if (!m) {
          buffer = buffer.slice(altEnd + sepLen);
          continue;
        }
        const len = parseInt(m[1], 10);
        const bodyStart = altEnd + sepLen;
        if (buffer.length < bodyStart + len) break;
        const body = buffer.slice(bodyStart, bodyStart + len).toString('utf-8');
        buffer = buffer.slice(bodyStart + len);
        processPayload(body, true);
      } else {
        const nlIdx = buffer.indexOf('\n');
        if (nlIdx === -1) break;
        const line = buffer.slice(0, nlIdx).toString('utf-8').trim();
        buffer = buffer.slice(nlIdx + 1);
        if (!line) continue;
        processPayload(line, false);
      }
    }
  });

  stdin.on('end', () => {
    queue.finally(() => process.exit(0));
  });
}

try {
  if (process.argv[1] && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1])) {
    startStdioServer();
  }
} catch (_) {
  if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    startStdioServer();
  }
}
