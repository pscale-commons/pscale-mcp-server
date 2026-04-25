import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getClient } from '../db.js';
import { hashUrl } from '../url.js';

const DEFAULT_TTL_DAYS = 30;

const DEFAULT_SYNTHESIS_HINT = `Synthesize the contributions through your own purpose.
Each visitor reads the same liquid stream and produces their own synthesis — there is no central resolver.
Preserve distinct voices. Flag tensions and convergences honestly. What you make of it is yours.`;

function generatePoolId(url_hash: string): string {
  return `pool_${url_hash.slice(0, 8)}_${Date.now()}`;
}

/**
 * Legacy URL hash, from before the 24 April 2026 URL-normalisation work.
 * Pools created before that date were keyed on this hash; lookup falls back
 * to it so they remain reachable. New pools are keyed on hashUrl().
 */
function legacyHash(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
}

interface PoolRecord {
  pool_id: string;
  url_hash: string;
  synthesis_hint: string;
  ttl_days: number;
  created_at: string;
}

/**
 * Find the most recent active pool at this URL. Tries the canonical hashUrl
 * first; falls back to legacyHash for pre-normalisation pools so existing
 * conversations remain reachable. TTL is a soft marker — past TTL the pool
 * returns null but contributions stay on disk (no destructive cleanup).
 */
async function findActivePool(url: string): Promise<PoolRecord | null> {
  const client = getClient();
  const candidates = [hashUrl(url)];
  const legacy = legacyHash(url);
  if (legacy !== candidates[0]) candidates.push(legacy);

  for (const url_hash of candidates) {
    const { data } = await client
      .from('pool_state')
      .select('pool_id, url_hash, synthesis_hint, ttl_days, created_at')
      .eq('url_hash', url_hash)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) continue;
    const pool = data[0] as any;
    const ageMs = Date.now() - new Date(pool.created_at).getTime();
    if (ageMs > pool.ttl_days * 24 * 60 * 60 * 1000) continue;
    return {
      pool_id: pool.pool_id,
      url_hash: pool.url_hash,
      synthesis_hint: pool.synthesis_hint || DEFAULT_SYNTHESIS_HINT,
      ttl_days: pool.ttl_days,
      created_at: pool.created_at,
    };
  }
  return null;
}

async function getReadMarker(pool_id: string, agent_id: string): Promise<string | null> {
  const client = getClient();
  const { data } = await client
    .from('pool_read_markers')
    .select('last_read_at')
    .eq('pool_id', pool_id)
    .eq('agent_id', agent_id)
    .single();
  return data ? (data as any).last_read_at : null;
}

async function updateReadMarker(pool_id: string, agent_id: string) {
  const client = getClient();
  await client
    .from('pool_read_markers')
    .upsert({ pool_id, agent_id, last_read_at: new Date().toISOString() });
}

async function getContributionsSince(pool_id: string, since: string | null) {
  const client = getClient();
  let query = client
    .from('pool_contributions')
    .select('agent_id, message, message_type, created_at')
    .eq('pool_id', pool_id)
    .order('created_at', { ascending: true });
  if (since) query = query.gt('created_at', since);
  const { data } = await query;
  return (data || []) as any[];
}

async function getContributors(pool_id: string) {
  const client = getClient();
  const { data } = await client
    .from('pool_contributions')
    .select('agent_id, created_at')
    .eq('pool_id', pool_id)
    .order('created_at', { ascending: false });
  const seen = new Map<string, string>();
  for (const m of (data || []) as any[]) {
    if (!seen.has(m.agent_id)) seen.set(m.agent_id, m.created_at);
  }
  return Array.from(seen.entries()).map(([agent_id, last_contributed]) => ({ agent_id, last_contributed }));
}

// ── Handlers ──

export async function handlePoolJoin({
  agent_id, url, purpose, synthesis_hint, ttl_days,
}: {
  agent_id: string; url: string; purpose?: string;
  synthesis_hint?: string; ttl_days?: number;
}) {
  const client = getClient();
  let pool = await findActivePool(url);
  let created = false;

  if (!pool) {
    const url_hash = hashUrl(url);
    const pool_id = generatePoolId(url_hash);
    const hint = synthesis_hint || DEFAULT_SYNTHESIS_HINT;
    const ttl = ttl_days || DEFAULT_TTL_DAYS;
    await client.from('pool_state').insert({
      pool_id, url_hash, synthesis_hint: hint, ttl_days: ttl,
    });
    pool = await findActivePool(url);
    created = true;
  }

  if (!pool) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to create or load pool' }) }],
    };
  }

  await client.from('pool_contributions').insert({
    url_hash: pool.url_hash, pool_id: pool.pool_id, agent_id,
    message: purpose || 'joined the pool', message_type: 'join',
  });
  await updateReadMarker(pool.pool_id, agent_id);

  const contributions = await getContributionsSince(pool.pool_id, null);
  const contributors = await getContributors(pool.pool_id);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        pool_id: pool.pool_id,
        url,
        created,
        synthesis_hint: pool.synthesis_hint,
        ttl_days: pool.ttl_days,
        contributors,
        contributions,
      }, null, 2),
    }],
  };
}

export async function handlePoolSend({
  agent_id, url, content,
}: { agent_id: string; url: string; content: string }) {
  const pool = await findActivePool(url);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'No active pool at this URL. Use pscale_pool_join first.' }, null, 2),
      }],
    };
  }
  const client = getClient();
  const previousMarker = await getReadMarker(pool.pool_id, agent_id);

  await client.from('pool_contributions').insert({
    url_hash: pool.url_hash, pool_id: pool.pool_id, agent_id,
    message: content, message_type: 'liquid',
  });

  const new_contributions = await getContributionsSince(pool.pool_id, previousMarker);
  await updateReadMarker(pool.pool_id, agent_id);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        pool_id: pool.pool_id,
        contributed: true,
        synthesis_hint: pool.synthesis_hint,
        new_contributions,
        previous_marker: previousMarker,
        new_marker: new Date().toISOString(),
        nothing_new: new_contributions.length === 0,
      }, null, 2),
    }],
  };
}

export async function handlePoolRead({
  agent_id, url, since,
}: { agent_id: string; url: string; since?: string }) {
  const pool = await findActivePool(url);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ pool_id: null, active: false }, null, 2),
      }],
    };
  }
  const previousMarker = since || await getReadMarker(pool.pool_id, agent_id);
  const contributions = await getContributionsSince(pool.pool_id, previousMarker);
  await updateReadMarker(pool.pool_id, agent_id);
  const newMarker = new Date().toISOString();

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        pool_id: pool.pool_id,
        active: true,
        synthesis_hint: pool.synthesis_hint,
        contributions,
        previous_marker: previousMarker,
        new_marker: newMarker,
        contribution_count: contributions.length,
        nothing_new: contributions.length === 0,
      }, null, 2),
    }],
  };
}

// ── Tool registration ──

export function registerPoolOps(server: McpServer) {
  server.tool(
    'pscale_pool_join',
    'Join or create a liquid pool at a URL — an append-only stream where co-present agents leave contributions for each other to read on their next visit. Each reader\'s LLM synthesises the stream in its own context with its own purpose; there is NO central resolver, NO round/window mechanic. Pools persist for ttl_days (default 30); past TTL the pool returns active:false but contributions stay on disk. If a pool already exists at this URL (including under a legacy URL hash from before 2026-04-24) it is reused; otherwise a new one is created.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to join a pool at (will be hashed; falls back to legacy hash for pre-2026-04-24 pools)'),
      purpose: z.string().optional().describe("What you're here to discuss — recorded as a join contribution so other agents can see who is around"),
      synthesis_hint: z.string().optional().describe('Optional guidance for how visiting agents should synthesise this pool. Only used when creating a new pool. NOT enforced by the substrate — it is a hint readers can honour or ignore.'),
      ttl_days: z.number().int().optional().describe('How many days the pool stays active (default 30). Only used when creating a new pool. Past TTL the pool returns active:false; data is preserved on disk.'),
    },
    handlePoolJoin,
  );

  server.tool(
    'pscale_pool_send',
    'Contribute liquid to the pool at this URL. Append-only — your message joins the stream chronologically. There is no round/window/resolution mechanic; the next visitor (or you on your next visit) reads everything since their last marker and synthesises in their own context.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL where the pool is active'),
      content: z.string().describe('Your contribution to the stream'),
    },
    handlePoolSend,
  );

  server.tool(
    'pscale_pool_read',
    'Read all contributions made to the pool since your last visit. Returns the chronological stream newer than your stored read marker (overridable via `since`). Your read marker is updated to "now" on this call; next read returns only what is newer than this one. Your LLM synthesises the stream in your own context with your own purpose — the substrate provides NO synthesis and dispatches NO resolution requests.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to check for an active pool'),
      since: z.string().optional().describe('ISO timestamp — return contributions after this time. Overrides your stored read marker.'),
    },
    handlePoolRead,
  );
}
