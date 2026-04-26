import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getClient } from '../db.js';
import { hashUrl } from '../url.js';
import { verifyBareAgentIdentity } from './block-ops.js';
import { verifySedOwnership } from './collective-ops.js';
import { verifyGrainOwnership } from './grain-ops.js';

/**
 * Substrate-aware identity check for pool senders.
 *   sed:collective:position → verifySedOwnership (passphrase against position_hashes)
 *   grain:pair_id:side      → verifyGrainOwnership (passphrase against side hash)
 *   bare agent_id           → verifyBareAgentIdentity (passport lock if any)
 *
 * Read is unrestricted — only post-as-me is gated. Mirrors the inbox pattern
 * from discovery-ops, extended to cover the bare-agent-id case via passport-lock.
 */
async function verifyPoolSender(
  agent_id: string,
  secret?: string,
): Promise<{ allowed: boolean; error?: string }> {
  if (agent_id.startsWith('sed:')) return verifySedOwnership(agent_id, secret);
  if (agent_id.startsWith('grain:')) return verifyGrainOwnership(agent_id, secret);
  const r = await verifyBareAgentIdentity(agent_id, secret);
  return { allowed: r.allowed, error: r.error };
}

const DEFAULT_TTL_DAYS = 30;
const READ_PAGE_LIMIT = 200;

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

async function setReadMarker(pool_id: string, agent_id: string, when: string) {
  const client = getClient();
  await client
    .from('pool_read_markers')
    .upsert({ pool_id, agent_id, last_read_at: when });
}

async function getContributionsSince(pool_id: string, since: string | null, limit?: number) {
  const client = getClient();
  let query = client
    .from('pool_contributions')
    .select('agent_id, message, message_type, created_at')
    .eq('pool_id', pool_id)
    .order('created_at', { ascending: true });
  if (since) query = query.gt('created_at', since);
  if (limit && limit > 0) query = query.limit(limit);
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
  agent_id, url, purpose, synthesis_hint, ttl_days, secret,
}: {
  agent_id: string; url: string; purpose?: string;
  synthesis_hint?: string; ttl_days?: number; secret?: string;
}) {
  // Identity check — joining writes a 'join' contribution under your agent_id.
  const idCheck = await verifyPoolSender(agent_id, secret);
  if (!idCheck.allowed) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: idCheck.error }, null, 2) }],
    };
  }

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

  // Cap join response to the most recent page; marker advances past those
  const contributions = await getContributionsSince(pool.pool_id, null, READ_PAGE_LIMIT);
  const contributors = await getContributors(pool.pool_id);
  const newMarker = contributions.length > 0
    ? contributions[contributions.length - 1].created_at
    : new Date().toISOString();
  await setReadMarker(pool.pool_id, agent_id, newMarker);
  const more_available = contributions.length === READ_PAGE_LIMIT;

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
        new_marker: newMarker,
        contribution_count: contributions.length,
        more_available,
      }, null, 2),
    }],
  };
}

export async function handlePoolSend({
  agent_id, url, content, secret,
}: { agent_id: string; url: string; content: string; secret?: string }) {
  // Identity check — posting under agent_id is a "post-as-me" action.
  const idCheck = await verifyPoolSender(agent_id, secret);
  if (!idCheck.allowed) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: idCheck.error }, null, 2) }],
    };
  }

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

  // Cap the catch-up payload; marker advances to the newest returned (or "now" if nothing)
  const new_contributions = await getContributionsSince(pool.pool_id, previousMarker, READ_PAGE_LIMIT);
  const newMarker = new_contributions.length > 0
    ? new_contributions[new_contributions.length - 1].created_at
    : new Date().toISOString();
  await setReadMarker(pool.pool_id, agent_id, newMarker);
  const more_available = new_contributions.length === READ_PAGE_LIMIT;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        pool_id: pool.pool_id,
        contributed: true,
        synthesis_hint: pool.synthesis_hint,
        new_contributions,
        previous_marker: previousMarker,
        new_marker: newMarker,
        nothing_new: new_contributions.length === 0,
        more_available,
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
  const contributions = await getContributionsSince(pool.pool_id, previousMarker, READ_PAGE_LIMIT);
  // Marker advances to the newest contribution returned, NOT to "now" — so a capped
  // read paginates naturally on the next call without losing the unread tail.
  const newMarker = contributions.length > 0
    ? contributions[contributions.length - 1].created_at
    : new Date().toISOString();
  await setReadMarker(pool.pool_id, agent_id, newMarker);
  const more_available = contributions.length === READ_PAGE_LIMIT;

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
        more_available,
      }, null, 2),
    }],
  };
}

// ── Tool registration ──

export function registerPoolOps(server: McpServer) {
  server.tool(
    'pscale_pool_join',
    'Join or create a liquid pool at a URL — an append-only stream where co-present agents leave contributions for each other to read on their next visit. Each reader\'s LLM synthesises the stream in its own context with its own purpose; there is NO central resolver, NO round/window mechanic. Pools persist for ttl_days (default 30); past TTL the pool returns active:false but contributions stay on disk. If a pool already exists at this URL (including under a legacy URL hash from before 2026-04-24) it is reused; otherwise a new one is created. Identity gate: if your passport is locked (or you post from a sed:/grain: address), provide secret to prove you are the agent_id you claim to be.',
    {
      agent_id: z.string().describe('Your agent identifier. Bare string, or sed:collective:position, or grain:pair_id:side.'),
      url: z.string().describe('The URL to join a pool at (will be hashed; falls back to legacy hash for pre-2026-04-24 pools)'),
      purpose: z.string().optional().describe("What you're here to discuss — recorded as a join contribution so other agents can see who is around"),
      synthesis_hint: z.string().optional().describe('Optional guidance for how visiting agents should synthesise this pool. Only used when creating a new pool. NOT enforced by the substrate — it is a hint readers can honour or ignore.'),
      ttl_days: z.number().int().optional().describe('How many days the pool stays active (default 30). Only used when creating a new pool. Past TTL the pool returns active:false; data is preserved on disk.'),
      secret: z.string().optional().describe('Identity proof. Required when your passport is locked (bare agent_id) or you post from a sed:/grain: address. Sensitive — never repeat in conversation.'),
    },
    handlePoolJoin,
  );

  server.tool(
    'pscale_pool_send',
    'Contribute liquid to the pool at this URL. Append-only — your message joins the stream chronologically. There is no round/window/resolution mechanic; the next visitor (or you on your next visit) reads everything since their last marker and synthesises in their own context. Identity gate: if your passport is locked (or you post from a sed:/grain: address), provide secret to prove you are the agent_id you claim to be.',
    {
      agent_id: z.string().describe('Your agent identifier. Bare string, or sed:collective:position, or grain:pair_id:side.'),
      url: z.string().describe('The URL where the pool is active'),
      content: z.string().describe('Your contribution to the stream'),
      secret: z.string().optional().describe('Identity proof. Required when your passport is locked (bare agent_id) or you post from a sed:/grain: address. Sensitive — never repeat in conversation.'),
    },
    handlePoolSend,
  );

  server.tool(
    'pscale_pool_read',
    'Read contributions made to the pool since your last visit. Returns up to 200 contributions newer than your stored read marker (overridable via `since`), oldest-first. Your read marker advances to the newest contribution returned (NOT to "now") so capped reads paginate naturally — call again to fetch the next page; `more_available:true` means there is more. Your LLM synthesises the stream in your own context with your own purpose — the substrate provides NO synthesis and dispatches NO resolution requests.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to check for an active pool'),
      since: z.string().optional().describe('ISO timestamp — return contributions after this time. Overrides your stored read marker.'),
    },
    handlePoolRead,
  );
}
