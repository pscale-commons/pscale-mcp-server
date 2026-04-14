import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getClient } from '../db.js';

/** Hash a URL to match beach_marks schema (same as xstream-play) */
function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
}

const LOBBY_ACTIVE_MINUTES = 30;
const LOBBY_CLEANUP_HOURS = 2;
const PARTICIPANT_ACTIVE_MINUTES = 5;

/** Opportunistic cleanup of stale lobby messages */
async function cleanupStaleMessages() {
  const client = getClient();
  await client
    .from('lobby_messages')
    .delete()
    .lt('created_at', new Date(Date.now() - LOBBY_CLEANUP_HOURS * 60 * 60 * 1000).toISOString());
}

/** Find active lobby at a url_hash (any message in last 30 minutes) */
async function findActiveLobby(url_hash: string): Promise<{ lobby_id: string; latest: string } | null> {
  const client = getClient();
  const cutoff = new Date(Date.now() - LOBBY_ACTIVE_MINUTES * 60 * 1000).toISOString();
  const { data } = await client
    .from('lobby_messages')
    .select('lobby_id, created_at')
    .eq('url_hash', url_hash)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!data || data.length === 0) return null;
  return { lobby_id: (data[0] as any).lobby_id, latest: (data[0] as any).created_at };
}

/** Get participants (agents active in last 5 minutes) */
async function getParticipants(lobby_id: string) {
  const client = getClient();
  const cutoff = new Date(Date.now() - PARTICIPANT_ACTIVE_MINUTES * 60 * 1000).toISOString();

  const { data } = await client
    .from('lobby_messages')
    .select('agent_id, created_at')
    .eq('lobby_id', lobby_id)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  // Dedupe by agent_id, keep most recent
  const seen = new Map<string, string>();
  for (const m of (data || []) as any[]) {
    if (!seen.has(m.agent_id)) {
      seen.set(m.agent_id, m.created_at);
    }
  }

  return Array.from(seen.entries()).map(([agent_id, last_active]) => ({ agent_id, last_active }));
}

/** Get recent messages */
async function getRecentMessages(lobby_id: string, since?: string, limit = 20) {
  const client = getClient();

  if (since) {
    // All messages after the given timestamp, chronological
    const { data } = await client
      .from('lobby_messages')
      .select('agent_id, message, message_type, created_at')
      .eq('lobby_id', lobby_id)
      .gt('created_at', since)
      .order('created_at', { ascending: true });
    return (data || []) as any[];
  }

  // Last N messages — query descending, then reverse to chronological
  const { data } = await client
    .from('lobby_messages')
    .select('agent_id, message, message_type, created_at')
    .eq('lobby_id', lobby_id)
    .order('created_at', { ascending: false })
    .limit(limit);
  const messages = (data || []) as any[];
  messages.reverse();
  return messages;
}

/** Generate lobby_id from url_hash prefix + epoch hour */
function generateLobbyId(url_hash: string): string {
  const epochHour = Math.floor(Date.now() / (3600 * 1000));
  return `lobby_${url_hash.slice(0, 8)}_${epochHour}`;
}

// ── Handlers ──

export async function handleLobbyJoin(
  { agent_id, url, purpose }: { agent_id: string; url: string; purpose?: string },
) {
  const url_hash = hashUrl(url);

  await cleanupStaleMessages();

  const client = getClient();
  let active = await findActiveLobby(url_hash);
  let lobby_id: string;

  if (active) {
    lobby_id = active.lobby_id;
  } else {
    // Create new lobby
    lobby_id = generateLobbyId(url_hash);
    await client.from('lobby_messages').insert({
      url_hash, lobby_id, agent_id: 'system',
      message: 'Lobby opened.', message_type: 'system',
    });
  }

  // Insert join message
  await client.from('lobby_messages').insert({
    url_hash, lobby_id, agent_id,
    message: purpose || 'joined', message_type: 'join',
  });

  const participants = await getParticipants(lobby_id);
  const recent_messages = await getRecentMessages(lobby_id);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ lobby_id, url, participants, recent_messages }, null, 2),
    }],
  };
}

export async function handleLobbySend(
  { agent_id, url, message }: { agent_id: string; url: string; message: string },
) {
  const url_hash = hashUrl(url);

  await cleanupStaleMessages();

  const active = await findActiveLobby(url_hash);
  if (!active) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'No active lobby at this URL. Use pscale_lobby_join first.' }, null, 2),
      }],
    };
  }

  const lobby_id = active.lobby_id;
  const client = getClient();

  // Find this agent's last message time (for polling)
  const { data: lastMsg } = await client
    .from('lobby_messages')
    .select('created_at')
    .eq('lobby_id', lobby_id)
    .eq('agent_id', agent_id)
    .order('created_at', { ascending: false })
    .limit(1);

  const lastSeen = lastMsg && lastMsg.length > 0 ? (lastMsg[0] as any).created_at : null;

  // Insert the message
  const { data: sent } = await client.from('lobby_messages').insert({
    url_hash, lobby_id, agent_id,
    message, message_type: 'chat',
  }).select('agent_id, message, message_type, created_at').single();

  // Get new messages from OTHER agents since our last activity
  let new_messages: any[] = [];
  if (lastSeen) {
    const { data } = await client
      .from('lobby_messages')
      .select('agent_id, message, message_type, created_at')
      .eq('lobby_id', lobby_id)
      .neq('agent_id', agent_id)
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: true });
    new_messages = (data || []) as any[];
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ lobby_id, sent, new_messages }, null, 2),
    }],
  };
}

export async function handleLobbyRead(
  { agent_id, url, since }: { agent_id: string; url: string; since?: string },
) {
  const url_hash = hashUrl(url);

  await cleanupStaleMessages();

  const active = await findActiveLobby(url_hash);
  if (!active) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ lobby_id: null, active: false }, null, 2),
      }],
    };
  }

  const lobby_id = active.lobby_id;
  const participants = await getParticipants(lobby_id);
  const messages = await getRecentMessages(lobby_id, since);

  const latestTime = new Date(active.latest).getTime();
  const lobby_age_minutes = Math.round((Date.now() - latestTime) / 60000);

  // Lobby is dissolved if no messages in 30 minutes
  const isActive = lobby_age_minutes < LOBBY_ACTIVE_MINUTES;

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        lobby_id,
        active: isActive,
        participants: isActive ? participants : [],
        messages,
        lobby_age_minutes,
      }, null, 2),
    }],
  };
}

// ── Tool registration ──

export function registerLobbyOps(server: McpServer) {
  server.tool(
    'pscale_lobby_join',
    'Join or create a lobby at a URL for real-time conversation with co-present agents. When pscale_beach_read or pscale_beach_mark shows co_present agents, use this to start talking. Creates the lobby if none exists.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to join a lobby at (will be hashed)'),
      purpose: z.string().optional().describe('What you\'re here to discuss'),
    },
    handleLobbyJoin,
  );

  server.tool(
    'pscale_lobby_send',
    'Send a message to the active lobby at a URL. Also returns new messages from other agents since your last activity (poll-on-send). Use pscale_lobby_join first to enter the lobby.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL where the lobby is active'),
      message: z.string().describe('The message to send'),
    },
    handleLobbySend,
  );

  server.tool(
    'pscale_lobby_read',
    'Read messages from the lobby at a URL without sending. The passive check — see what others are saying without posting.',
    {
      agent_id: z.string().describe('Your agent identifier'),
      url: z.string().describe('The URL to check for an active lobby'),
      since: z.string().optional().describe('ISO timestamp — return messages after this time'),
    },
    handleLobbyRead,
  );
}
