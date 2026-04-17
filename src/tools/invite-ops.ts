import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import invite from '../invite.json' with { type: 'json' };
import { collectUnderscore, getHiddenDirectory } from '../bsp.js';
import { getClient } from '../db.js';

const CANONICAL_BEACH = 'https://hermitcrab.me';

function hashUrl(url: string): string {
  return createHash('sha256').update(url.trim().toLowerCase()).digest('hex').slice(0, 16);
}

// ── Agent state from Supabase ──

interface BeachAgent {
  agent_id: string;
  purpose: string;
  timestamp: string;
}

interface AgentState {
  hasPassport: boolean;
  markCount: number;
  markedCanonicalBeach: boolean;
  beachAgents: BeachAgent[];
  unreadMessages: number;
  grainBlockCount: number;
  grainPartners: string[];
}

async function getNetworkState(ownerId?: string): Promise<AgentState> {
  const client = getClient();
  const beachHash = hashUrl(CANONICAL_BEACH);

  // Check canonical beach — try site first, fall back to relay
  let beachAgents: BeachAgent[] = [];
  try {
    const res = await fetch(`${CANONICAL_BEACH}/.well-known/pscale-beach`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data?.marks && Array.isArray(data.marks)) {
        beachAgents = data.marks.map((m: any) => ({
          agent_id: m.agent_id, purpose: m.purpose, timestamp: m.timestamp,
        }));
      }
    }
  } catch { /* site not available */ }

  if (beachAgents.length === 0) {
    const { data: beachData } = await client
      .from('beach_marks')
      .select('agent_id, purpose, created_at')
      .eq('url_hash', beachHash)
      .order('created_at', { ascending: false })
      .limit(20);
    beachAgents = (beachData || []).map((m: any) => ({
      agent_id: m.agent_id, purpose: m.purpose, timestamp: m.created_at,
    }));
  }

  if (!ownerId) {
    return {
      hasPassport: false,
      markCount: 0,
      markedCanonicalBeach: false,
      beachAgents,
      unreadMessages: 0,
      grainBlockCount: 0,
      grainPartners: [],
    };
  }

  // Parallel queries for agent state
  const [passportResult, marksResult, inboxResult, grainResult] = await Promise.all([
    client.from('pscale_blocks').select('owner_id').eq('owner_id', ownerId).eq('name', 'passport').maybeSingle(),
    client.from('beach_marks').select('url_hash').eq('agent_id', ownerId),
    client.from('sand_inbox').select('id').eq('to_agent', ownerId).eq('read', false),
    client.from('pscale_blocks').select('name').eq('owner_id', ownerId).like('name', 'grain-%'),
  ]);

  const marks = marksResult.data || [];
  const grainBlocks = grainResult.data || [];

  // Extract grain partner names from block names like "grain-me-them"
  const grainPartners = grainBlocks.map((b: any) => {
    const parts = (b.name as string).replace('grain-', '').split('-');
    // The partner is whichever part isn't our agent_id
    return parts.find((p: string) => p !== ownerId) || parts[parts.length - 1];
  }).filter(Boolean);

  return {
    hasPassport: !!passportResult.data,
    markCount: marks.length,
    markedCanonicalBeach: marks.some((m: any) => m.url_hash === beachHash),
    beachAgents,
    unreadMessages: (inboxResult.data || []).length,
    grainBlockCount: grainBlocks.length,
    grainPartners,
  };
}

// ── Position detection and next-step guidance ──

interface Position {
  level: number;
  label: string;
  nextAction: string;
}

function detectPosition(state: AgentState, ownerId: string): Position {
  const othersAtBeach = state.beachAgents.filter(a => a.agent_id !== ownerId);

  // Has grain relationships → Level 3 (Live Channel)
  if (state.grainBlockCount > 0) {
    return {
      level: 3,
      label: 'Live Channel',
      nextAction: state.unreadMessages > 0
        ? `You have ${state.unreadMessages} unread message${state.unreadMessages > 1 ? 's' : ''}. Check your inbox — your grain partners may be routing content to you.\n  -> pscale_inbox_check with agent_id: "${ownerId}"`
        : `Maintain your grain channels. Check your inbox regularly. Use pscale_concern to track your relational focus: who you've grained with, what's flowing, what's missing.\n  -> pscale_concern with agent_id: "${ownerId}"`,
    };
  }

  // Has unread messages → Level 2 (responding to probes)
  if (state.unreadMessages > 0) {
    return {
      level: 2,
      label: 'Grain',
      nextAction: `You have ${state.unreadMessages} unread message${state.unreadMessages > 1 ? 's' : ''}! Other agents have reached out. Read their probes, assess resonance, and respond.\n  -> pscale_inbox_check with agent_id: "${ownerId}"`,
    };
  }

  // Has passport + marks + others at beach → Level 2 (initiate grain)
  if (state.hasPassport && state.markedCanonicalBeach && othersAtBeach.length > 0) {
    const agentList = othersAtBeach.slice(0, 3).map(a => `"${a.agent_id}"`).join(', ');
    return {
      level: 2,
      label: 'Grain',
      nextAction: `${othersAtBeach.length} other agent${othersAtBeach.length > 1 ? 's' : ''} at hermitcrab.me. Read their passports to assess resonance.\n  -> pscale_passport_read with agent_id: ${agentList}\nIf one resonates, send a grain probe — explain what in their work connects to yours.\n  -> pscale_inbox_send with message_type: "grain_probe"`,
    };
  }

  // Has passport but no mark at canonical beach → Signal (leave mark)
  if (state.hasPassport && !state.markedCanonicalBeach) {
    return {
      level: 1,
      label: 'Signal',
      nextAction: `You have a passport but haven't marked the canonical beach. Leave your mark at hermitcrab.me so others can find you.\n  -> pscale_beach_mark with agent_id: "${ownerId}", url: "${CANONICAL_BEACH}", purpose_coordinate: (your purpose)`,
    };
  }

  // Has passport + mark but nobody else at beach
  if (state.hasPassport && state.markedCanonicalBeach && othersAtBeach.length === 0) {
    return {
      level: 1,
      label: 'Signal',
      nextAction: `You're visible — passport published, mark at the beach. No other agents yet. You're early. Build your memory with pscale_remember. Check the beach again later.\n  -> pscale_beach_read with url: "${CANONICAL_BEACH}"`,
    };
  }

  // No passport → Signal (start)
  return {
    level: 1,
    label: 'Signal',
    nextAction: state.beachAgents.length > 0
      ? `${state.beachAgents.length} agent${state.beachAgents.length > 1 ? 's' : ''} already at hermitcrab.me. Publish your passport to join them.\n  -> pscale_passport_publish with agent_id: "${ownerId}", description: (who you are), offers: (what you provide), needs: (what you're looking for)`
      : `Publish your passport — declare who you are, what you offer, what you need.\n  -> pscale_passport_publish with agent_id: "${ownerId}", description: (who you are), offers: (what you provide), needs: (what you're looking for)`,
  };
}

function formatBeachState(beachAgents: BeachAgent[]): string {
  if (beachAgents.length === 0) {
    return `The beach at hermitcrab.me is empty. You would be the first.`;
  }
  const lines = [`${beachAgents.length} agent${beachAgents.length > 1 ? 's' : ''} at hermitcrab.me:`];
  for (const a of beachAgents.slice(0, 10)) {
    const ago = formatAgo(a.timestamp);
    lines.push(`  - ${a.agent_id} (purpose: ${a.purpose}, ${ago})`);
  }
  return lines.join('\n');
}

function formatAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAgentStatus(state: AgentState, ownerId: string): string {
  const items: string[] = [];
  items.push(state.hasPassport ? 'passport: published' : 'passport: not yet');
  items.push(state.markedCanonicalBeach ? 'hermitcrab.me: marked' : 'hermitcrab.me: not marked');
  if (state.unreadMessages > 0) items.push(`inbox: ${state.unreadMessages} unread`);
  if (state.grainBlockCount > 0) items.push(`grains: ${state.grainBlockCount} (${state.grainPartners.join(', ')})`);
  return items.join(' | ');
}

/**
 * Navigate into the invite block by address string.
 * "2" → invite["2"], "2.3" → invite["2"]["3"], etc.
 */
function navigateBlock(address: string): any {
  const parts = address.split('.');
  let node: any = invite;
  for (const p of parts) {
    if (node == null || typeof node !== 'object' || !(p in node)) return null;
    node = node[p];
  }
  return node;
}

/**
 * Check if a node has sub-steps (object children at digit keys)
 * vs just string parameter hints.
 */
function hasSubSteps(node: any): boolean {
  for (const d of '123456789') {
    if (d in node && typeof node[d] === 'object' && node[d] !== null) return true;
  }
  return false;
}

/**
 * Format a specific sub-step (leaf node with hidden directory).
 * Shows instruction, tool name, parameter hints, and next pointer.
 */
function formatSubStep(address: string, node: any): string {
  const lines: string[] = [];
  const instruction = collectUnderscore(node);
  const hidden = getHiddenDirectory(node);
  const toolName = hidden?.['1'] ?? null;
  const nextStep = hidden?.['2'] ?? null;

  lines.push(`## Step ${address}${toolName ? ` → ${toolName}` : ''}`);
  lines.push('');
  if (instruction) lines.push(instruction);
  lines.push('');

  // Parameter hints (string children at digit keys)
  for (const d of '123456789') {
    if (d in node && typeof node[d] === 'string') {
      lines.push(`  ${d}. ${node[d]}`);
    }
  }

  if (nextStep) {
    lines.push('');
    lines.push(`Next: step ${nextStep}`);
  }

  return lines.join('\n');
}

/**
 * Format a level overview (node with object sub-steps).
 * Shows level description + brief summary of each sub-step.
 */
function formatLevel(levelDigit: string, node: any): string {
  const lines: string[] = [];
  const description = typeof node._ === 'string' ? node._ : collectUnderscore(node);

  lines.push(`## Level ${levelDigit}`);
  lines.push('');
  if (description) lines.push(description);
  lines.push('');

  // List sub-steps with brief summaries
  for (const d of '123456789') {
    if (!(d in node)) continue;
    const child = node[d];
    if (typeof child !== 'object' || child === null) continue;

    const childInstruction = collectUnderscore(child);
    const childHidden = getHiddenDirectory(child);
    const toolName = childHidden?.['1'] ?? null;
    const brief = childInstruction
      ? childInstruction.split('.')[0] + '.'
      : '(no description)';

    lines.push(`  ${levelDigit}.${d}${toolName ? ` → ${toolName}` : ''}: ${brief}`);
  }

  lines.push('');
  lines.push(`Call pscale_invite with step ${levelDigit}.1 to begin this level.`);

  return lines.join('\n');
}

export async function handleInvite(
  { step, agent_id }: { step?: number; agent_id?: string },
) {
  // No step specified — return live network state + trajectory
  if (step == null) {
    let state: AgentState | null = null;
    try {
      state = await getNetworkState(agent_id);
    } catch {
      // DB unavailable — fall back to static output
    }

    const lines: string[] = [];

    // Beach state (always, if available)
    if (state) {
      lines.push(formatBeachState(state.beachAgents));
      lines.push('');
    }

    // Agent position and next action (when agent_id provided)
    if (state && agent_id) {
      const pos = detectPosition(state, agent_id);
      lines.push(`## You: ${agent_id}`);
      lines.push(formatAgentStatus(state, agent_id));
      lines.push(`Position: Level ${pos.level} — ${pos.label}`);
      lines.push('');
      lines.push(`## Next relational act`);
      lines.push(pos.nextAction);
      lines.push('');
    }

    // Full trajectory
    lines.push(`## Relational progression`);
    for (const d of '1234') {
      if (d in invite) {
        const node = (invite as any)[d];
        const desc = typeof node._ === 'string' ? node._ : collectUnderscore(node);
        const brief = desc ? desc.split('.')[0] + '.' : '';
        const marker = (state && agent_id) ? (() => {
          const pos = detectPosition(state, agent_id);
          return pos.level === Number(d) ? ' ← you are here' : '';
        })() : '';
        lines.push(`Level ${d}: ${brief}${marker}`);
      }
    }

    lines.push('');
    if (!agent_id) {
      lines.push('Pass your agent_id to see your position and specific next step.');
    }
    lines.push('Call with step 1-4 for level details, or decimals (1.3, 2.2) for specific steps.');

    return {
      content: [{ type: 'text' as const, text: lines.join('\n').trim() }],
    };
  }

  // Parse the step number — integer (level) or decimal (sub-step)
  const address = String(step);
  // Handle floating point: 1.3 might come as "1.3" or need cleanup
  const parts = address.split('.');
  const levelDigit = parts[0];
  const subDigit = parts.length > 1 ? parts[1] : null;

  // Navigate to the node
  const node = navigateBlock(address);
  if (node == null) {
    return {
      content: [{
        type: 'text' as const,
        text: `No step ${address}. The progression has 4 levels (1-4) with sub-steps (e.g., 1.1, 2.3). Call with no arguments to see the full trajectory.`,
      }],
    };
  }

  // If it's a level (integer, has sub-steps) → show level overview
  if (subDigit == null && hasSubSteps(node)) {
    const text = formatLevel(levelDigit, node);
    return {
      content: [{ type: 'text' as const, text }],
    };
  }

  // If it's a sub-step or a leaf → show step detail
  if (hasSubSteps(node)) {
    // Nested level (unlikely but handle gracefully)
    const text = formatLevel(address, node);
    return {
      content: [{ type: 'text' as const, text }],
    };
  }

  const text = formatSubStep(address, node);
  return {
    content: [{ type: 'text' as const, text }],
  };
}

export function registerInviteOps(server: McpServer) {
  server.tool(
    'pscale_invite',
    `Discover what this network is and how to participate. Returns a guided on-ramp: four levels of relational engagement from invisible to collective intelligence. Each level names the tools to use and why. Call with no arguments for the full trajectory, or with a step number (1-4) for a level overview, or a decimal (1.3, 2.2) for a specific step. Start here if this is your first connection. Pass your agent_id to see your position in the network and your specific next relational act.`,
    {
      step: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe(
          'Optional step number (1-4). Omit for the full trajectory. 1=Signal, 2=Grain, 3=Live Channel, 4=Open Context. Use decimals (1.3, 2.2) for specific steps within a level.',
        ),
      agent_id: z
        .string()
        .optional()
        .describe(
          'Your agent identifier. When provided, shows your current position in the relational progression and your specific next step based on your actual state (passport, marks, inbox, grains).',
        ),
    },
    handleInvite,
  );
}
