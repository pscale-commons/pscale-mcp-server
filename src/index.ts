import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { handleBeach, handleLifeguard, handleSuccess, handleCheckout, handleWebhook } from './routes/payment.js';
import { handleEcologyPulse, handleEcologyAgents } from './routes/ecology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3000', 10);

const transports = new Map<string, StreamableHTTPServerTransport>();

/** Create a new session: transport + MCP server, store in map. */
function createSession(): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });

  transport.onclose = () => {
    console.log(`Transport onclose fired for session: ${transport.sessionId}`);
    // Do NOT delete the session here — the SSE stream dropping doesn't mean
    // the session is dead. The client may reconnect. Sessions are only
    // removed on explicit DELETE or server restart.
  };

  const mcpServer = createServer();
  mcpServer.connect(transport);

  return transport;
}

const httpServer = createHttpServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // ── Payment / landing routes (before MCP) ──
  // ── Static assets ──
  if (url.pathname === '/widget.js' && req.method === 'GET') {
    try {
      // Try multiple locations: __dirname/public, src/public, cwd/src/public
      let js = '';
      const candidates = [
        join(__dirname, 'public', 'widget.js'),
        join(process.cwd(), 'src', 'public', 'widget.js'),
        join(process.cwd(), 'dist', 'public', 'widget.js'),
      ];
      for (const p of candidates) {
        try { js = readFileSync(p, 'utf-8'); break; } catch {}
      }
      if (!js) throw new Error('widget.js not found');
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  if (url.pathname === '/' && req.method === 'GET') {
    handleBeach(req, res);
    return;
  }
  if (url.pathname === '/lifeguard' && req.method === 'GET') {
    handleLifeguard(req, res);
    return;
  }
  if (url.pathname === '/success' && req.method === 'GET') {
    handleSuccess(req, res);
    return;
  }
  if (url.pathname === '/checkout' && req.method === 'POST') {
    await handleCheckout(req, res);
    return;
  }
  if (url.pathname === '/webhook' && req.method === 'POST') {
    await handleWebhook(req, res);
    return;
  }

  // ── Ecology map read-only API (Phase A) ──
  if (url.pathname === '/ecology/pulse' && req.method === 'GET') {
    await handleEcologyPulse(req, res);
    return;
  }
  if (url.pathname === '/ecology/agents' && req.method === 'GET') {
    await handleEcologyAgents(req, res);
    return;
  }

  // ── MCP endpoint ──
  const MCP_PATH = '/mcp/v2';
  if (url.pathname !== MCP_PATH) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: `Endpoint moved. Connect to ${MCP_PATH}. If you were previously connected, please disconnect and reconnect your MCP client.` }));
    return;
  }

  // Parse body for POST
  let body: unknown = undefined;
  if (req.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf-8');
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
    }
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  console.log(`${req.method} /mcp | session: ${sessionId || 'none'} | known: ${sessionId ? transports.has(sessionId) : 'n/a'} | sessions: ${transports.size}`);

  // Existing session — handle directly
  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, body);
    return;
  }

  // POST without session or with unknown session
  if (req.method === 'POST') {
    // Only create a new session for initialize requests
    // Reject stale tool calls — don't waste resources creating sessions that won't be used
    const isInitialize = body && typeof body === 'object' && 'method' in body && (body as any).method === 'initialize';
    if (sessionId && !isInitialize) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unknown session. Send an initialize request to start a new session.' },
        id: (body && typeof body === 'object' && 'id' in body) ? (body as any).id : null,
      }));
      return;
    }
    if (sessionId) {
      delete req.headers['mcp-session-id'];
    }
    const transport = createSession();
    await transport.handleRequest(req, res, body);
    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
    return;
  }

  // GET (SSE) with unknown/missing session — reject, client must reinitialize
  if (req.method === 'GET') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unknown or expired session. Send a POST initialize request first.' },
      id: null,
    }));
    return;
  }

  // DELETE — acknowledge even for unknown sessions
  if (req.method === 'DELETE') {
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, body);
      transports.delete(sessionId);
    } else {
      res.writeHead(200);
      res.end(JSON.stringify({ jsonrpc: '2.0', result: {} }));
    }
    return;
  }

  res.writeHead(405);
  res.end();
});

httpServer.listen(PORT, () => {
  console.log(`pscale-mcp-server running on http://localhost:${PORT}/mcp`);
  console.log('Streamable HTTP transport ready.');
});
