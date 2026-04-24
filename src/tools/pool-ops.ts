import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../db.js';
import { hashUrl } from '../url.js';

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_ROUND_DURATION_SECONDS = 10;

const DEFAULT_SYNTHESIS_HINT = `Synthesize these contributions into a coherent summary.
Preserve each participant's key point.
Flag any disagreements or tensions.
Note areas of convergence.
Present as a unified understanding, not as a list of who said what.`;

/** Generate pool_id from url_hash prefix + timestamp */
function generatePoolId(url_hash: string): string {
  return `pool_${url_hash.slice(0, 8)}_${Date.now()}`;
}

/** Generate round_id from url_hash prefix + timestamp */
function generateRoundId(url_hash: string): string {
  return `round_${url_hash.slice(0, 8)}_${Date.now()}`;
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

interface PoolRecord {
  pool_id: string;
  url_hash: string;
  synthesis_hint: string;
  ttl_days: number;
  created_at: string;
  round_duration_seconds: number;
  current_round_id: string | null;
  current_round_state: string | null;         // 'OPEN' or null (null = QUIET)
  current_round_opened_at: string | null;
  last_confirmed_round_id: string | null;
  last_confirmed_at: string | null;
}

/** Find active pool at a url_hash, returning full round state */
async function findActivePool(url_hash: string): Promise<PoolRecord | null> {
  const client = getClient();
  const { data } = await client
    .from('pool_state')
    .select('*')
    .eq('url_hash', url_hash)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;

  const pool = data[0] as any;
  const age = Date.now() - new Date(pool.created_at).getTime();
  if (age > pool.ttl_days * 24 * 60 * 60 * 1000) return null;

  return {
    pool_id: pool.pool_id,
    url_hash: pool.url_hash,
    synthesis_hint: pool.synthesis_hint || DEFAULT_SYNTHESIS_HINT,
    ttl_days: pool.ttl_days,
    created_at: pool.created_at,
    round_duration_seconds: pool.round_duration_seconds ?? DEFAULT_ROUND_DURATION_SECONDS,
    current_round_id: pool.current_round_id ?? null,
    current_round_state: pool.current_round_state ?? null,
    current_round_opened_at: pool.current_round_opened_at ?? null,
    last_confirmed_round_id: pool.last_confirmed_round_id ?? null,
    last_confirmed_at: pool.last_confirmed_at ?? null,
  };
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

async function getContributionsSince(pool_id: string, since: string | null, excludeAgent?: string) {
  const client = getClient();
  let query = client
    .from('pool_contributions')
    .select('agent_id, message, message_type, round_id, created_at')
    .eq('pool_id', pool_id)
    .order('created_at', { ascending: true });

  if (since) query = query.gt('created_at', since);
  if (excludeAgent) query = query.neq('agent_id', excludeAgent);

  const { data } = await query;
  return (data || []) as any[];
}

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
    if (!seen.has(m.agent_id)) seen.set(m.agent_id, m.created_at);
  }
  return Array.from(seen.entries()).map(([agent_id, last_contributed]) => ({ agent_id, last_contributed }));
}

// ── GRIT round engine ──

/** Get contributions belonging to a specific round */
async function getRoundContributions(pool_id: string, round_id: string) {
  const client = getClient();
  const { data } = await client
    .from('pool_contributions')
    .select('agent_id, message, message_type, round_id, created_at')
    .eq('pool_id', pool_id)
    .eq('round_id', round_id)
    .order('created_at', { ascending: true });
  return (data || []) as any[];
}

/** Distinct agent_ids that contributed liquid to a round */
async function getRoundContributors(pool_id: string, round_id: string): Promise<string[]> {
  const rows = await getRoundContributions(pool_id, round_id);
  const contributors = new Set<string>();
  for (const r of rows) {
    if (r.message_type === 'liquid' || r.message_type === 'contribution') {
      contributors.add(r.agent_id);
    }
  }
  return Array.from(contributors);
}

/** Has this round already been confirmed (i.e. has an 'event' contribution)? */
async function isRoundConfirmed(pool_id: string, round_id: string): Promise<boolean> {
  const client = getClient();
  const { data } = await client
    .from('pool_contributions')
    .select('id')
    .eq('pool_id', pool_id)
    .eq('round_id', round_id)
    .eq('message_type', 'event')
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * Dispatch a resolution_request to every pool subscriber who is NOT a contributor
 * to the round being resolved. Inbox-based, so beach-crabs and late-arriving
 * players can pick it up whenever they check.
 */
async function dispatchResolutionRequests(pool: PoolRecord, round_id: string) {
  const client = getClient();

  // All pool subscribers (anyone with a read marker)
  const { data: markers } = await client
    .from('pool_read_markers')
    .select('agent_id')
    .eq('pool_id', pool.pool_id);

  const subscribers = new Set<string>((markers || []).map((r: any) => r.agent_id));

  // Remove round contributors — they can't resolve their own window
  const contributors = await getRoundContributors(pool.pool_id, round_id);
  for (const c of contributors) subscribers.delete(c);

  if (subscribers.size === 0) return; // nobody to ask; round will stay unconfirmed

  // Build the window payload once
  const windowRows = await getRoundContributions(pool.pool_id, round_id);
  const window_liquid = windowRows
    .filter((r) => r.message_type === 'liquid' || r.message_type === 'contribution')
    .map((r) => ({ agent_id: r.agent_id, message: r.message, created_at: r.created_at }));

  const payload = JSON.stringify({
    type: 'grit.resolution_request',
    round_id,
    pool_id: pool.pool_id,
    url_hash: pool.url_hash,
    round_opened_at: pool.current_round_opened_at,
    round_closed_at: new Date().toISOString(),
    contributors,
    window_liquid,
    synthesis_hint: pool.synthesis_hint,
  });

  const from_agent = `grit:${pool.url_hash.slice(0, 8)}`;
  const now = new Date().toISOString();

  const rows = Array.from(subscribers).map((to_agent) => ({
    from_agent,
    to_agent,
    message: {
      type: 'resolution_request',
      spindle: null,
      content: payload,
      responding_to: null,
      sent_at: now,
    },
    created_at: now,
  }));

  await client.from('sand_inbox').insert(rows);
}

/**
 * Notify every contributor of a round that their window resolved into an event.
 * Contributors pick this up via pscale_inbox_check.
 */
async function notifyContributorsOfResolution(
  pool: PoolRecord,
  round_id: string,
  resolver_agent_id: string,
  synthesis_text: string,
) {
  const client = getClient();
  const contributors = await getRoundContributors(pool.pool_id, round_id);
  if (contributors.length === 0) return;

  const payload = JSON.stringify({
    type: 'grit.resolution_confirmed',
    round_id,
    pool_id: pool.pool_id,
    url_hash: pool.url_hash,
    resolver_agent_id,
    synthesis_text,
    confirmed_at: new Date().toISOString(),
  });

  const from_agent = `grit:${pool.url_hash.slice(0, 8)}`;
  const now = new Date().toISOString();

  const rows = contributors.map((to_agent) => ({
    from_agent,
    to_agent,
    message: {
      type: 'resolution_confirmed',
      spindle: null,
      content: payload,
      responding_to: round_id,
      sent_at: now,
    },
    created_at: now,
  }));

  await client.from('sand_inbox').insert(rows);
}

/**
 * Lazy round state transition — called on every pool operation.
 *
 * If current round is OPEN and the timer has elapsed, close it:
 *   - dispatch resolution_requests to non-contributors
 *   - clear current_round_id/state (pool returns to QUIET)
 * The RIPE round is still resolvable via its round_id — but the pool can
 * now accept new liquid into a fresh OPEN round.
 *
 * Returns the updated PoolRecord (re-fetched after any state change).
 */
async function advanceRoundIfElapsed(pool: PoolRecord): Promise<PoolRecord> {
  if (pool.current_round_state !== 'OPEN' || !pool.current_round_id) return pool;
  if (!pool.current_round_opened_at) return pool;

  const elapsedMs = Date.now() - new Date(pool.current_round_opened_at).getTime();
  if (elapsedMs < pool.round_duration_seconds * 1000) return pool;

  // Round has elapsed — close it
  const closedRoundId = pool.current_round_id;
  const client = getClient();

  await client
    .from('pool_state')
    .update({
      current_round_id: null,
      current_round_state: null,
      current_round_opened_at: null,
    })
    .eq('pool_id', pool.pool_id);

  // Dispatch resolution_requests (inbox-based, non-blocking semantics — but await for correctness)
  await dispatchResolutionRequests(pool, closedRoundId);

  // Re-fetch with cleared round state
  const refreshed = await findActivePool(pool.url_hash);
  return refreshed ?? pool;
}

/**
 * Ensure the pool has an OPEN round ready for liquid. If QUIET, start a new round.
 * Returns the round_id to attach liquid to.
 */
async function ensureOpenRound(pool: PoolRecord): Promise<{ pool: PoolRecord; round_id: string }> {
  if (pool.current_round_state === 'OPEN' && pool.current_round_id) {
    return { pool, round_id: pool.current_round_id };
  }

  // QUIET → open a new round
  const round_id = generateRoundId(pool.url_hash);
  const now = new Date().toISOString();
  const client = getClient();

  await client
    .from('pool_state')
    .update({
      current_round_id: round_id,
      current_round_state: 'OPEN',
      current_round_opened_at: now,
    })
    .eq('pool_id', pool.pool_id);

  const refreshed = await findActivePool(pool.url_hash);
  return { pool: refreshed ?? pool, round_id };
}

/**
 * Attempt to confirm an event for a given round. Validates:
 *   - round_id exists in contributions
 *   - round not already confirmed
 *   - resolver is not a contributor to the round
 * On success, writes the event contribution, updates pool_state, notifies contributors.
 */
async function confirmEvent(
  pool: PoolRecord,
  resolver_agent_id: string,
  resolves_round_id: string,
  synthesis_text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Round existence check (did anyone contribute to it?)
  const roundRows = await getRoundContributions(pool.pool_id, resolves_round_id);
  if (roundRows.length === 0) {
    return { ok: false, reason: `round ${resolves_round_id} has no contributions or does not exist` };
  }

  // Already confirmed?
  if (await isRoundConfirmed(pool.pool_id, resolves_round_id)) {
    return { ok: false, reason: `round ${resolves_round_id} already resolved` };
  }

  // Non-self-resolution check
  const contributors = await getRoundContributors(pool.pool_id, resolves_round_id);
  if (contributors.includes(resolver_agent_id)) {
    return { ok: false, reason: `resolver ${resolver_agent_id} contributed to this round — fairness forbids self-resolution` };
  }

  const client = getClient();
  const now = new Date().toISOString();

  // Write the confirmed event
  const { error: insertError } = await client.from('pool_contributions').insert({
    url_hash: pool.url_hash,
    pool_id: pool.pool_id,
    agent_id: resolver_agent_id,
    message: synthesis_text,
    message_type: 'event',
    round_id: resolves_round_id,
  });
  if (insertError) return { ok: false, reason: `DB error on event insert: ${insertError.message}` };

  // Update pool_state's last_confirmed markers
  await client
    .from('pool_state')
    .update({
      last_confirmed_round_id: resolves_round_id,
      last_confirmed_at: now,
    })
    .eq('pool_id', pool.pool_id);

  // Notify contributors
  await notifyContributorsOfResolution(pool, resolves_round_id, resolver_agent_id, synthesis_text);

  return { ok: true };
}

// ── Handlers ──

export async function handlePoolJoin(
  { agent_id, url, purpose, synthesis_hint, ttl_days, round_duration_seconds }: {
    agent_id: string; url: string; purpose?: string;
    synthesis_hint?: string; ttl_days?: number; round_duration_seconds?: number;
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
    const rounds = round_duration_seconds ?? DEFAULT_ROUND_DURATION_SECONDS;

    await client.from('pool_state').insert({
      pool_id, url_hash, synthesis_hint: hint, ttl_days: ttl,
      round_duration_seconds: rounds,
    });
    pool = await findActivePool(url_hash);
    created = true;
  }

  if (!pool) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Failed to create or load pool' }) }],
    };
  }

  // Advance round state lazily (a join isn't liquid, but may still trigger a stale-round close)
  pool = await advanceRoundIfElapsed(pool);

  // Insert join contribution (not attached to any round — joins aren't liquid)
  await client.from('pool_contributions').insert({
    url_hash, pool_id: pool.pool_id, agent_id,
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
        round_duration_seconds: pool.round_duration_seconds,
        current_round_id: pool.current_round_id,
        current_round_state: pool.current_round_state,
        contributors,
        contributions,
      }, null, 2),
    }],
  };
}

export async function handlePoolSend(
  { agent_id, url, content, message_type, resolves_round_id }: {
    agent_id: string; url: string; content: string;
    message_type?: string; resolves_round_id?: string;
  },
) {
  const url_hash = hashUrl(url);
  await cleanupExpired();

  let pool = await findActivePool(url_hash);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'No active pool at this URL. Use pscale_pool_join first.' }, null, 2),
      }],
    };
  }

  // Lazy round transition first
  pool = await advanceRoundIfElapsed(pool);

  const msgType = message_type || 'liquid';

  // ── Event submission path ──
  if (msgType === 'event') {
    if (!resolves_round_id) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: "message_type='event' requires resolves_round_id" }, null, 2),
        }],
      };
    }
    const result = await confirmEvent(pool, agent_id, resolves_round_id, content);
    if (!result.ok) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: `event rejected: ${result.reason}` }, null, 2),
        }],
      };
    }
    await updateReadMarker(pool.pool_id, agent_id);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          confirmed: true,
          round_id: resolves_round_id,
          resolver_agent_id: agent_id,
          contributors_notified: await getRoundContributors(pool.pool_id, resolves_round_id),
        }, null, 2),
      }],
    };
  }

  // ── Liquid submission path (default) ──
  const { pool: poolWithRound, round_id } = await ensureOpenRound(pool);
  pool = poolWithRound;

  const client = getClient();
  const previousMarker = await getReadMarker(pool.pool_id, agent_id);

  await client.from('pool_contributions').insert({
    url_hash, pool_id: pool.pool_id, agent_id,
    message: content, message_type: msgType,
    round_id,
  });

  const new_contributions = await getContributionsSince(pool.pool_id, previousMarker, agent_id);
  await updateReadMarker(pool.pool_id, agent_id);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        pool_id: pool.pool_id,
        contributed: true,
        round_id,
        round_state: 'OPEN',
        round_opened_at: pool.current_round_opened_at,
        round_duration_seconds: pool.round_duration_seconds,
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

  let pool = await findActivePool(url_hash);
  if (!pool) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ pool_id: null, active: false }, null, 2),
      }],
    };
  }

  // Lazy round transition on read too — keeps rounds flowing even if no one is sending
  pool = await advanceRoundIfElapsed(pool);

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
        current_round_id: pool.current_round_id,
        current_round_state: pool.current_round_state,
        current_round_opened_at: pool.current_round_opened_at,
        round_duration_seconds: pool.round_duration_seconds,
        last_confirmed_round_id: pool.last_confirmed_round_id,
        last_confirmed_at: pool.last_confirmed_at,
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
    'Join or create a liquid pool at a URL for co-present agents. GRIT round engine is built in: liquid accumulates in time-bounded rounds (default 10s), rounds close and dispatch resolution_requests to non-contributors via inbox, first valid event wins and notifies all contributors. The pool is NOT a chatroom — each reader\'s LLM synthesizes independently. Set round_duration_seconds at pool creation to tune tempo (10s = conversational, 30s = slower/async, 3s = real-time-ish).',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to join a pool at (will be hashed)'),
      purpose: z.string().optional().describe("What you're here to discuss"),
      synthesis_hint: z.string().optional().describe('Instructions for how a reading LLM should synthesize accumulated contributions and (when acting as a resolver) how to resolve a round into an event. Only used when creating a new pool. For games, reference the rules/world blocks here.'),
      ttl_days: z.number().int().optional().describe('How many days the pool stays active (default 30). Only used when creating a new pool.'),
      round_duration_seconds: z.number().int().optional().describe('GRIT round duration in seconds (default 10). Only used when creating a new pool.'),
    },
    handlePoolJoin,
  );

  server.tool(
    'pscale_pool_send',
    'Contribute to the liquid pool at a URL. Default mode (message_type="liquid"): adds your contribution to the current round, which opens automatically if quiet and closes T seconds after it opens. Resolution mode (message_type="event"): confirms a round you were asked to resolve — only used when you received a resolution_request in your inbox and it contains the resolves_round_id. Events are rejected if you contributed to the round (fairness) or if the round is already confirmed (first-valid-event-wins).',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL where the pool is active'),
      content: z.string().describe('For message_type=liquid: your contribution. For message_type=event: the synthesis text that resolves the round into an event.'),
      message_type: z.enum(['liquid', 'event']).optional().describe('liquid (default) = normal pool contribution attached to current round; event = resolution of a round, requires resolves_round_id'),
      resolves_round_id: z.string().optional().describe('REQUIRED when message_type=event. The round_id this event resolves (comes from the resolution_request in your inbox).'),
    },
    handlePoolSend,
  );

  server.tool(
    'pscale_pool_read',
    'Read new contributions from the liquid pool at a URL without contributing. Returns contributions since your last read (tracked automatically), plus round state: current_round_id/state, last_confirmed_round_id. Resolvers: this call will also lazily close a stale OPEN round and dispatch resolution_requests — so simply reading can unblock a stuck pool.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to check for an active pool'),
      since: z.string().optional().describe('ISO timestamp — return contributions after this time. Overrides your stored read marker.'),
    },
    handlePoolRead,
  );
}
