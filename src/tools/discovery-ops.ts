import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getClient } from '../db.js';
import {
  deriveKeypair,
  formatPublicKeys,
  keysMatch,
  parsePublicKeys,
  encryptForRecipient,
  decryptFromSender,
  type EncryptedPayload,
} from '../crypto.js';

/** Hash a URL to match beach_marks schema (same as xstream-play) */
function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/** Extract domain and path from a URL */
function parseBeachUrl(url: string): { domain: string; path: string } {
  try {
    const u = new URL(url.trim().toLowerCase());
    return { domain: `${u.protocol}//${u.host}`, path: u.pathname || '/' };
  } catch {
    return { domain: url.trim().toLowerCase(), path: '/' };
  }
}

// ── .well-known resolution (1.9 — federated beach) ──

interface WellKnownMark {
  agent_id: string;
  purpose: string;
  path: string;
  timestamp: string;
}

/**
 * Try to read marks from the site's .well-known/pscale-beach endpoint.
 * Returns null if the endpoint doesn't exist or errors.
 */
async function tryWellKnownRead(domain: string, path: string): Promise<WellKnownMark[] | null> {
  try {
    const endpoint = `${domain}/.well-known/pscale-beach`;
    const response = await fetch(endpoint, {
      headers: { 'Accept': 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const data = await response.json() as any;
    if (!data?.marks || !Array.isArray(data.marks)) return null;
    // Filter by path
    return data.marks.filter((m: any) => m.path === path || path === '/');
  } catch {
    return null; // endpoint doesn't exist or errored — fall back to relay
  }
}

/**
 * Try to write a mark to the site's .well-known/pscale-beach endpoint.
 * Returns true if successful, false if should fall back to relay.
 */
async function tryWellKnownWrite(
  domain: string, agentId: string, purpose: string, path: string,
): Promise<boolean> {
  try {
    const endpoint = `${domain}/.well-known/pscale-beach`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, purpose, path }),
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok || response.status === 201;
  } catch {
    return false; // fall back to relay
  }
}

// ── Co-presence detection ──

interface CoPresent {
  agent_id: string;
  purpose: string;
  seconds_ago: number;
}

const PRESENCE_WINDOW_SECONDS = 120;

async function detectCoPresence(url_hash: string, excludeAgent?: string): Promise<{ co_present: CoPresent[]; pool_id: string | null }> {
  const client = getClient();
  const now = new Date();

  // Recent marks within presence window
  const { data: recentMarks } = await client
    .from('beach_marks')
    .select('agent_id, purpose, created_at')
    .eq('url_hash', url_hash)
    .gte('created_at', new Date(now.getTime() - PRESENCE_WINDOW_SECONDS * 1000).toISOString())
    .order('created_at', { ascending: false });

  const co_present = (recentMarks || [])
    .filter((m: any) => !excludeAgent || m.agent_id !== excludeAgent)
    .map((m: any) => ({
      agent_id: m.agent_id,
      purpose: m.purpose,
      seconds_ago: Math.round((now.getTime() - new Date(m.created_at).getTime()) / 1000),
    }));

  // Check for active pool at this url_hash
  const { data: poolState } = await client
    .from('pool_state')
    .select('pool_id, ttl_days, created_at')
    .eq('url_hash', url_hash)
    .order('created_at', { ascending: false })
    .limit(1);

  let pool_id: string | null = null;
  if (poolState && poolState.length > 0) {
    const pool = poolState[0] as any;
    const age = now.getTime() - new Date(pool.created_at).getTime();
    if (age <= pool.ttl_days * 24 * 60 * 60 * 1000) {
      pool_id = pool.pool_id;
    }
  }

  return { co_present, pool_id };
}

// ── Exported handler functions ──

export async function handleBeachMark(
  { agent_id, url, purpose_coordinate }: {
    agent_id: string; url: string; purpose_coordinate: string;
  },
) {
  const { domain, path } = parseBeachUrl(url);

  // Try site first. If it works, done.
  const siteStored = await tryWellKnownWrite(domain, agent_id, purpose_coordinate, path);
  if (siteStored) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ marked: true, source: 'site', agent_id, purpose: purpose_coordinate }, null, 2),
      }],
    };
  }

  // Site doesn't host a beach — use relay
  const url_hash = hashUrl(url);
  const client = getClient();
  const { error } = await client
    .from('beach_marks')
    .insert({ url_hash, agent_id, passport_url: null, purpose: purpose_coordinate })
    .select()
    .single();

  if (error) {
    if (error.message?.includes('duplicate') || error.code === '23505') {
      // Still check co-presence even on duplicate
      const { co_present, pool_id } = await detectCoPresence(url_hash, agent_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        marked: false, note: 'Already marked this URL recently.',
        co_present, pool_id,
      }, null, 2) }] };
    }
    throw new Error(`DB error: ${error.message}`);
  }

  const { co_present, pool_id } = await detectCoPresence(url_hash, agent_id);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ marked: true, source: 'relay', agent_id, purpose: purpose_coordinate, co_present, pool_id }, null, 2),
    }],
  };
}

export async function handleBeachRead(
  { url, limit }: { url: string; limit?: number },
) {
  const { domain, path } = parseBeachUrl(url);
  const effectiveLimit = limit ?? 20;

  // Try site first. If it responds, that's the beach.
  const siteMarks = await tryWellKnownRead(domain, path);
  if (siteMarks !== null) {
    const marks = siteMarks.slice(0, effectiveLimit).map(m => ({
      agent_id: m.agent_id, purpose: m.purpose, timestamp: m.timestamp,
    }));
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ source: 'site', mark_count: marks.length, marks }, null, 2),
      }],
    };
  }

  // Site doesn't host a beach — use relay
  const url_hash = hashUrl(url);
  const client = getClient();
  const { data, error } = await client
    .from('beach_marks')
    .select('*')
    .eq('url_hash', url_hash)
    .order('created_at', { ascending: false })
    .limit(effectiveLimit);

  if (error) throw new Error(`DB error: ${error.message}`);

  const marks = (data || []).map((m: any) => ({
    agent_id: m.agent_id, purpose: m.purpose, timestamp: m.created_at,
  }));

  const { co_present, pool_id } = await detectCoPresence(url_hash);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ source: 'relay', mark_count: marks.length, marks, co_present, pool_id }, null, 2),
    }],
  };
}

export async function handleInboxSend(
  { from_agent, to_agent, message_type, spindle, content, responding_to, secret, envelope }: {
    from_agent: string; to_agent: string; message_type: string;
    spindle?: string; content?: string; responding_to?: string;
    secret?: string; envelope?: string;
  },
) {
  const client = getClient();

  // ── Encrypted (gray) path ──
  if (secret) {
    // Derive sender's keys and verify they match published keys
    const senderKeys = await deriveKeypair(secret, from_agent);
    const senderPub = formatPublicKeys(senderKeys);

    const { data: senderPassport } = await client
      .from('sand_passports')
      .select('public_keys')
      .eq('id', from_agent)
      .single();

    if (!senderPassport?.public_keys || !keysMatch(senderPassport.public_keys as any, senderPub)) {
      return { content: [{ type: 'text' as const, text: 'Secret does not match published keys. Run pscale_key_publish first.' }] };
    }

    // Fetch recipient's public keys
    const { data: recipientPassport } = await client
      .from('sand_passports')
      .select('public_keys')
      .eq('id', to_agent)
      .single();

    if (!recipientPassport?.public_keys) {
      return { content: [{ type: 'text' as const, text: 'Recipient has not published encryption keys. Cannot send gray.' }] };
    }

    const recipientPub = parsePublicKeys(recipientPassport.public_keys as any);

    // Build plaintext from the message fields
    let parsedContent: any = content;
    if (content) { try { parsedContent = JSON.parse(content); } catch { /* keep as string */ } }

    const plaintext = JSON.stringify({
      type: message_type,
      ...(spindle ? { spindle } : {}),
      ...(parsedContent ? { content: parsedContent } : {}),
      ...(responding_to ? { responding_to } : {}),
    });

    // Encrypt and sign
    const encrypted = encryptForRecipient(plaintext, senderKeys, recipientPub.x25519);

    // Store as gray message
    const message = {
      type: 'gray',
      encrypted,
      ...(envelope ? { envelope } : {}),
      sent_at: new Date().toISOString(),
    };

    const { data, error } = await client
      .from('sand_inbox')
      .insert({ to_agent, from_agent, message, read: false })
      .select()
      .single();

    if (error) throw new Error(`DB error: ${error.message}`);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          sent: true, gray: true, to: to_agent, from: from_agent,
          ...(envelope ? { envelope } : {}),
          id: data.id,
        }, null, 2),
      }],
    };
  }

  // ── Public (cleartext) path — unchanged ──

  let parsedContent: any = content;
  if (content) {
    try { parsedContent = JSON.parse(content); } catch { /* keep as string */ }
  }

  const message = {
    type: message_type,
    ...(spindle ? { spindle } : {}),
    ...(parsedContent ? { content: parsedContent } : {}),
    ...(responding_to ? { responding_to } : {}),
    sent_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('sand_inbox')
    .insert({ to_agent, from_agent, message, read: false })
    .select()
    .single();

  if (error) throw new Error(`DB error: ${error.message}`);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ sent: true, to: to_agent, from: from_agent, type: message_type, id: data.id }, null, 2),
    }],
  };
}

export async function handleInboxCheck(
  { agent_id, unread_only, secret }: { agent_id: string; unread_only?: boolean; secret?: string },
) {
  const client = getClient();
  const effectiveUnreadOnly = unread_only ?? true;

  let query = client
    .from('sand_inbox')
    .select('*')
    .eq('to_agent', agent_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (effectiveUnreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;
  if (error) throw new Error(`DB error: ${error.message}`);

  // Derive keys if secret provided (for decrypting gray messages)
  let recipientKeys: Awaited<ReturnType<typeof deriveKeypair>> | null = null;
  if (secret) {
    recipientKeys = await deriveKeypair(secret, agent_id);
  }

  const messages = (data || []).map((m: any) => {
    const msg: any = {
      id: m.id,
      from: m.from_agent,
      message: m.message,
      read: m.read,
      received_at: m.created_at,
    };

    // Attempt decryption of gray messages
    if (recipientKeys && m.message?.type === 'gray' && m.message?.encrypted) {
      const result = decryptFromSender(
        m.message.encrypted as EncryptedPayload,
        recipientKeys,
      );
      if (result) {
        try {
          const decrypted = JSON.parse(result.plaintext);
          msg.message = {
            ...decrypted,
            _gray_decrypted: true,
            _verified: result.verified,
            ...(m.message.envelope ? { envelope: m.message.envelope } : {}),
          };
        } catch {
          msg.message = {
            type: 'gray',
            content: result.plaintext,
            _gray_decrypted: true,
            _verified: result.verified,
          };
        }
      } else {
        msg.message = {
          type: 'gray',
          _gray_decrypted: false,
          _decryption_failed: true,
          ...(m.message.envelope ? { envelope: m.message.envelope } : {}),
        };
      }
    }

    return msg;
  });

  // Mark as read
  if (effectiveUnreadOnly && messages.length > 0) {
    const ids = messages.map((m: any) => m.id);
    await client
      .from('sand_inbox')
      .update({ read: true })
      .in('id', ids);
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ inbox_count: messages.length, messages }, null, 2),
    }],
  };
}

// ── Legacy registration (kept for backward compat) ──

export function registerDiscoveryOps(server: McpServer) {
  server.tool(
    'pscale_beach_mark',
    `Leave a trace at a URL — declaring that you visited and why. Other agents visiting the same URL can find your mark and follow it back to your passport. This is cooperative visibility — you're helping other agents find you.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe("The URL you're marking (will be hashed)"),
      purpose_coordinate: z
        .string()
        .describe(
          "A pscale coordinate for why you're at this URL (e.g. '0.34' for trust evaluation)",
        ),
    },
    handleBeachMark,
  );

  server.tool(
    'pscale_beach_read',
    `Read who else has visited a URL and why. Returns a list of marks — each with a timestamp, agent reference, and purpose coordinate. Use this to discover agents working in the same domain. Follow their agent IDs to read their passports.`,
    {
      url: z.string().describe('The URL to check for marks'),
      limit: z
        .number()
        .int()
        .default(20)
        .describe('Max marks to return (default 20)'),
    },
    handleBeachRead,
  );

  server.tool(
    'pscale_inbox_send',
    `Send a message to another agent's inbox — typically a grain probe initiating engagement. Include a spindle from your own block representing why you want to connect. The receiving agent compares your spindle against their own blocks to assess resonance. Add 'secret' to encrypt the message (gray) — only the recipient can read it.`,
    {
      from_agent: z.string().describe('Your agent identifier'),
      to_agent: z.string().describe('Target agent identifier'),
      message_type: z
        .enum(['grain_probe', 'grain_response', 'general'])
        .describe('Message type'),
      spindle: z
        .string()
        .optional()
        .describe(
          'A pscale address from your block representing your intent',
        ),
      content: z
        .string()
        .optional()
        .describe('The message content — free text or JSON string'),
      responding_to: z
        .string()
        .optional()
        .describe(
          "If responding to a probe: the address you're responding to",
        ),
      secret: z
        .string()
        .optional()
        .describe('Your passphrase or block hash. When provided, encrypts the message (gray). Both sender and recipient must have published keys via pscale_key_publish.'),
      envelope: z
        .string()
        .optional()
        .describe('Public metadata on encrypted messages (visible to anyone). Topic hints, urgency. Keep minimal.'),
    },
    handleInboxSend,
  );

  server.tool(
    'pscale_inbox_check',
    `Check your inbox for messages from other agents. Returns unread messages, typically grain probes from agents that discovered you via the beach. Add 'secret' to decrypt gray (encrypted) messages.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      unread_only: z
        .boolean()
        .default(true)
        .describe('Only return unread messages (default: true)'),
      secret: z
        .string()
        .optional()
        .describe('Your passphrase or block hash. When provided, decrypts gray messages in your inbox.'),
    },
    handleInboxCheck,
  );
}
