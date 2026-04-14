# Zombie Sidestep on Railway

## The problem

When Railway redeploys the MCP server, all in-memory sessions are destroyed. Connected clients (`mcp-remote`, Cursor, Claude Desktop) don't know their session died. They retry forever — sending GET requests with the old session ID every 3 seconds. These are "zombies."

This is a known ecosystem-wide problem with MCP clients. See:
- https://forum.cursor.com/t/http-mcp-server-becomes-unresponsive-after-repeated-sse-stream-disconnects/152243
- https://forum.cursor.com/t/bug-mcp-server-stuck-in-infinite-invalid-url-protocol-retry-loop-despite-removing-all-configs/155964
- https://github.com/RooCodeInc/Roo-Code/issues/4930
- https://github.com/IBM/mcp-context-forge/issues/258

The clients should implement exponential backoff. They don't. We can't fix their code.

## Current mitigations (server-side)

1. **Stale GETs** get a fast 400 rejection — no session created, no compute wasted.
2. **Stale POSTs** (tool calls with dead session IDs) get a fast 400 rejection. Only `initialize` requests create new sessions.
3. **Sessions survive SSE drops** — `onclose` doesn't delete the session, so clients that reconnect within the same deploy work.

## The sidestep

When zombies accumulate and you want a clean slate:

1. Open `src/index.ts`
2. Change `const MCP_PATH = '/mcp';` to `const MCP_PATH = '/mcp/v2';` (or `/mcp/v3`, etc.)
3. Commit and push — Railway redeploys
4. Zombies hit `/mcp`, get 404, give up
5. All users reconnect with the new URL: `https://pscale-mcp-server-production.up.railway.app/mcp/v2`

**This is a breaking change.** Every user must update their MCP connection URL. Only do this when zombie cost is a concern or you want a clean slate.

## What users must do after a sidestep (or any redeploy)

- **Claude Desktop**: Quit (Cmd+Q) and reopen. Or remove and re-add the MCP in settings.
- **Cursor**: Restart Cursor entirely.
- **Claude Code**: Restart the session or disconnect/reconnect the MCP.
- **Claude browser (claude.ai)**: Start a new conversation (usually sufficient).
- **A new conversation alone is NOT enough** for Desktop/Cursor — the `mcp-remote` subprocess persists across conversations.

## When to sidestep

- After a burst of deploys during active development
- When Railway logs show persistent zombie GETs from sessions you can't kill
- Before a demo or test session where you want clean logs

## When NOT to sidestep

- During normal operation with stable code — zombies from a single deploy will die when users eventually restart their clients
- If only 1-2 zombies — not worth the disruption

## Long-term fix

The real fix is not on the server side:
- `mcp-remote` needs exponential backoff with a max retry limit
- Or: move to a transport that handles reconnection properly (e.g. the MCP Streamable HTTP transport with session recovery)
- Or: persistent session store (Redis/Supabase) so sessions survive redeploys — but this adds complexity and a central dependency

For now, the sidestep is cheap and effective.
