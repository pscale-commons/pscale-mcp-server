import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

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
  if (url.pathname !== '/mcp') {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found. MCP endpoint is at /mcp' }));
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

  // POST without session or with unknown session — create new session
  // Strip any stale session ID so the new transport doesn't reject it
  if (req.method === 'POST') {
    if (sessionId) {
      console.log(`Stripping stale session ID ${sessionId} from POST`);
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
