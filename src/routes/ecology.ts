/**
 * ecology.ts — Read-only HTTP endpoints for the live ecology map.
 *
 *   GET /ecology/pulse   → counts across the network
 *   GET /ecology/agents  → every agent with passport + recent activity
 *
 * Reads only. No writes, no auth. Open-beta RLS applies.
 * Part of Phase A in docs/ecology-map-spec.md.
 *
 * Consumed by the static frontend at evolution.hermitcrab.me/ecology/.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getClient } from '../db.js';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=30',
  });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, message: string) {
  json(res, status, { error: message });
}

/** Count rows matching an optional filter. */
async function countRows(
  table: string,
  filter?: (q: any) => any,
): Promise<number> {
  let q: any = getClient().from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ecology/pulse — the heartbeat. Small, cheap, pollable every 30s.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleEcologyPulse(_req: IncomingMessage, res: ServerResponse) {
  try {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      passports,
      totalMarks,
      marks24h,
      grains,
      inbox24h,
      collectives,
    ] = await Promise.all([
      // passports = blocks named 'passport' owned by real agents — exclude
      // substrate owners (sed: collectives and grain: pair blocks don't have
      // passports of their own; credits/SQ live on the underlying agent).
      countRows('pscale_blocks', (q: any) =>
        q.eq('name', 'passport').not('owner_id', 'like', 'sed:%').not('owner_id', 'like', 'grain:%'),
      ),
      countRows('beach_marks'),
      countRows('beach_marks', (q: any) => q.gte('created_at', dayAgo)),
      // grain blocks: new substrate format — owner_id='grain:{pair_id}', name='grain'.
      // One row per formed grain (pair of agents).
      countRows('pscale_blocks', (q: any) => q.like('owner_id', 'grain:%').eq('name', 'grain')),
      countRows('sand_inbox', (q: any) => q.gte('created_at', dayAgo)),
      // sed: collectives — blocks owned by sed:* addresses. This over-counts:
      // both the collective itself and registrant position writes share the
      // sed:* owner prefix. Real count would need deduplication by name.
      // Acceptable for Phase A; refine in Phase B.
      countRows('pscale_blocks', (q: any) => q.like('owner_id', 'sed:%')),
    ]);

    json(res, 200, {
      timestamp: new Date().toISOString(),
      passports,
      total_marks: totalMarks,
      marks_24h: marks24h,
      grains,
      inbox_24h: inbox24h,
      collectives,
    });
  } catch (err: any) {
    console.error('[ecology/pulse]', err);
    jsonError(res, 500, err.message || 'internal error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /ecology/agents — every agent with passport + recent activity.
// ─────────────────────────────────────────────────────────────────────────────
export async function handleEcologyAgents(_req: IncomingMessage, res: ServerResponse) {
  try {
    const client = getClient();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Pull passport blocks for real agents — exclude substrate owners
    // (sed: collectives, grain: pair blocks).
    const { data: passports, error: passError } = await client
      .from('pscale_blocks')
      .select('owner_id, block, updated_at, created_at')
      .eq('name', 'passport')
      .not('owner_id', 'like', 'sed:%')
      .not('owner_id', 'like', 'grain:%')
      .order('updated_at', { ascending: false });
    if (passError) throw passError;

    // Weekly activity by agent — marks + inbox (from OR to).
    const [{ data: recentMarks }, { data: recentInbox }] = await Promise.all([
      client
        .from('beach_marks')
        .select('agent_id')
        .gte('created_at', weekAgo),
      client
        .from('sand_inbox')
        .select('from_agent, to_agent')
        .gte('created_at', weekAgo),
    ]);

    const markCounts: Record<string, number> = {};
    for (const m of (recentMarks || [])) {
      const a = (m as any).agent_id;
      if (a) markCounts[a] = (markCounts[a] || 0) + 1;
    }

    const inboxCounts: Record<string, number> = {};
    for (const m of (recentInbox || [])) {
      const from = (m as any).from_agent;
      const to = (m as any).to_agent;
      if (from) inboxCounts[from] = (inboxCounts[from] || 0) + 1;
      if (to)   inboxCounts[to]   = (inboxCounts[to]   || 0) + 1;
    }

    // Coerce passport block shape into a flat agent record.
    const agents = (passports || []).map((row: any) => {
      const block = (row.block || {}) as Record<string, any>;
      const agentId = row.owner_id as string;
      const marks  = markCounts[agentId]  || 0;
      const inbox  = inboxCounts[agentId] || 0;
      // Log-scaled opacity so small counts still show up clearly.
      const activity = Math.min(1, Math.log2(marks + inbox + 1) / 5);
      return {
        agent_id: agentId,
        description: block['_'] ?? null,
        offers:      block['1'] ?? null,
        needs:       block['2'] ?? null,
        lineage:     block['3'] ?? null,
        has_keys:    !!(block['9'] && typeof block['9'] === 'object' && block['9'].x25519),
        passport_updated_at: row.updated_at,
        passport_created_at: row.created_at,
        recent_marks_7d:     marks,
        recent_inbox_7d:     inbox,
        activity_score:      activity,
      };
    });

    json(res, 200, {
      timestamp: new Date().toISOString(),
      window_days: 7,
      count: agents.length,
      agents,
    });
  } catch (err: any) {
    console.error('[ecology/agents]', err);
    jsonError(res, 500, err.message || 'internal error');
  }
}
