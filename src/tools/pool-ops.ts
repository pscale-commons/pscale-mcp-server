import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getClient } from '../db.js';

/** Hash a URL to match beach_marks schema (same as xstream-play) */
function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
}

const DEFAULT_TTL_DAYS = 30;

const DEFAULT_SYNTHESIS_HINT = `Synthesize these contributions into a coherent summary.
Preserve each participant's key point.
Flag any disagreements or tensions.
Note areas of convergence.
Present as a unified understanding, not as a list of who said what.`;

/** Generate pool_id from url_hash prefix + timestamp */
function generatePoolId(url_hash: string): string {
  return `pool_${url_hash.slice(0, 8)}_${Date.now()}`;
}

/** Opportunistic cleanup — delete contributions from expired pools */
async function cleanupExpired() {
  const client = getClient();

  const { data: expired } = await client
    .from('pool_state')
    .select('pool_id, ttl_days, created_at')
    .order('created_at', { ascending: true })
    .limit(50);

  if (!expired || expired.length === 0) return;

  const now = Date.now();
  const expiredIds = (expired as any[])
    .filter(s => now - new Date(s.created_at).getTime() > s.ttl_days * 24 * 60 * 60 * 1000)
    .map(s => s.pool_id);

  if (expiredIds.length === 0) return;

  await Promise.all([
    client.from('pool_contributions').delete().in('pool_id', expiredIds),
    client.from('pool_read_markers').delete().in('pool_id', expiredIds),
    client.from('pool_state').delete().in('pool_id', expiredIds),
  ]);
}

/** Find active pool at a url_hash */
async function findActivePool(url_hash: string): Promise<{ pool_id: string; synthesis_hint: string; ttl_days: number; created_at: string } | null> {
  const client = getClient();
  const { data } = await client
    .from('pool_state')
    .select('pool_id, synthesis_hint, ttl_days, created_at')
    .eq('url_hash', url_hash)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;

  const pool = data[0] as any;
  const age = Date.now() - new Date(pool.created_at).getTime();
  if (age > pool.ttl_days * 24 * 60 * 60 * 1000) return null;

  return {
    pool_id: pool.pool_id,
    synthesis_hint: pool.synthesis_hint || DEFAULT_SYNTHESIS_HINT,
    ttl_days: pool.ttl_days,
    created_at: pool.created_at,
  };
}

/** Get read marker for this agent in this pool */
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

/** Update read marker to now */
async function updateReadMarker(pool_id: string, agent_id: string) {
  const client = getClient();
  await client
    .from('pool_read_markers')
    .upsert({ pool_id, agent_id, last_read_at: new Date().toISOString() });
}

/** Get contributions since a timestamp */
async function getContributionsSince(pool_id: string, since: string | null, excludeAgent?: string) {
  const client = getClient();
  let query = client
    .from('pool_contributions')
    .select('agent_id, message, message_type, created_at')
    .eq('pool_id', pool_id)
    .order('created_at', { ascending: true });

  if (since) {
    query = query.gt('created_at', since);
  }

  if (excludeAgent) {
    query = query.neq('agent_id', excludeAgent);
  }

  const { data } = await query;
  return (data || []) as any[];
}

/** Get all unique contributors to a pool */
async function getContributors(pool_id: string) {
  const client = getClient();
  const { data } = await client
    .from('pool_contributions')
    .select('agent_id, created_at')
    .eq('pool_id', pool_id)
    .neq('agent_id', 'system')
    .order('created_at', { ascending: false });

  const seen = new Map<string, string>();
  for (const m of (data || []) as any[]) {
    if (!seen.has(m.agent_id)) {
      seen.set(m.agent_id, m.created_at);
    }
  }

  return Array.from(seen.entries()).map(([agent_id, last_contributed]) => ({ agent_id, last_contributed }));
}

// ── Handlers ──

export async function handlePoolJoin(
  { agent_id, url, purpose, synthesis_hint, ttl_days }: {
    agent_id: string; url: string; purpose?: string;
    synthesis_hint?: string; ttl_days?: number;
  },
) {
  const url_hash = hashUrl(url);
  await cleanupExpired();

  const client = getClient();
  let pool = await findActivePool(url_hash);
  let created = false;

  if (!pool) {
    const pool_id = generatePoolId(url_hash);
    const hint = synthesis_hint || DEFAULT_SYNTHESIS_HINT;
    const ttl = ttl_days || DEFAULT_TTL_DAYS;

    await client.from('pool_state').insert({
      pool_id, url_hash, synthesis_hint: hint, ttl_days: ttl,
    });

    pool = { pool_id, synthesis_hint: hint, ttl_days: ttl, created_at: new Date().toISOString() };
    created = true;
  }

  // Insert join contribution
  await client.from('pool_contributions').insert({
    url_hash, pool_id: pool.pool_id, agent_id,
    message: purpose || 'joined the pool', message_type: 'join',
  });

  // Set read marker
  await updateReadMarker(pool.pool_id, agent_id);

  // Get existing contributions (all of them for a new joiner)
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

export async function handlePoolSend(
  { agent_id, url, content }: { agent_id: string; url: string; content: string },
) {
  const url_hash = hashUrl(url);
  await cleanupExpired();

  const pool = await findActivePool(url_hash);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'No active pool at this URL. Use pscale_pool_join first.' }, null, 2),
      }],
    };
  }

  const client = getClient();

  // Get previous read marker
  const previousMarker = await getReadMarker(pool.pool_id, agent_id);

  // Insert contribution
  await client.from('pool_contributions').insert({
    url_hash, pool_id: pool.pool_id, agent_id,
    message: content, message_type: 'contribution',
  });

  // Get new contributions from others since our last read
  const new_contributions = await getContributionsSince(pool.pool_id, previousMarker, agent_id);

  // Advance read marker
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

export async function handlePoolRead(
  { agent_id, url, since }: { agent_id: string; url: string; since?: string },
) {
  const url_hash = hashUrl(url);
  await cleanupExpired();

  const pool = await findActivePool(url_hash);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ pool_id: null, active: false }, null, 2),
      }],
    };
  }

  // Use explicit since, or read marker, or null (all contributions)
  const previousMarker = since || await getReadMarker(pool.pool_id, agent_id);
  const contributions = await getContributionsSince(pool.pool_id, previousMarker);

  // Advance read marker
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
    'Join or create a liquid pool at a URL for co-present agents. When pscale_beach_read or pscale_beach_mark shows co_present agents, use this to start engaging. Creates the pool if none exists. The pool is NOT a chatroom — participants contribute liquid, and each reader\'s LLM synthesizes independently. There is no canonical summary.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to join a pool at (will be hashed)'),
      purpose: z.string().optional().describe("What you're here to discuss"),
      synthesis_hint: z.string().optional().describe('Instructions for how a reading LLM should synthesize accumulated contributions. Only used when creating a new pool. If omitted, a default Quaker-clerk-style synthesis is used.'),
      ttl_days: z.number().int().optional().describe('How many days the pool stays active (default 30). Only used when creating a new pool.'),
    },
    handlePoolJoin,
  );

  server.tool(
    'pscale_pool_send',
    'Contribute to the liquid pool at a URL. Your contribution is stored as-is. Also returns new contributions from others since your last read (poll-on-send). Use pscale_pool_join first to enter the pool.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL where the pool is active'),
      content: z.string().describe('Your contribution to the pool — raw text, sent as-is'),
    },
    handlePoolSend,
  );

  server.tool(
    'pscale_pool_read',
    'Read new contributions from the liquid pool at a URL without contributing. Returns only contributions since your last read (tracked automatically via read markers). The synthesis_hint tells you how to synthesize the liquid into solid for the user. Each reader synthesizes independently — there is no canonical summary.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to check for an active pool'),
      since: z.string().optional().describe('ISO timestamp — return contributions after this time. Overrides your stored read marker.'),
    },
    handlePoolRead,
  );
}
