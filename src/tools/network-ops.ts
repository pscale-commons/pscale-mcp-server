import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../db.js';
import { collectUnderscore } from '../bsp.js';

// ── Types ──

interface GrainRelationship {
  partner: string;
  grainBlock: string;
  synthesis: string;
  lastActivity: string;
  messageCount: number;
}

interface NetworkState {
  grains: GrainRelationship[];
  recentInbox: Array<{ from: string; to: string; type: string; timestamp: string; content?: string }>;
  beachPresence: Array<{ url_hash: string; purpose: string; timestamp: string }>;
}

// ── Live network query ──

async function getNetworkState(agentId: string): Promise<NetworkState> {
  const client = getClient();

  const [grainResult, inboxFromResult, inboxToResult, beachResult] = await Promise.all([
    // Grain blocks: any block named grain-* where this agent is involved
    client.from('pscale_blocks')
      .select('name, block, updated_at')
      .eq('owner_id', agentId)
      .like('name', 'grain-%'),
    // Inbox: messages sent by this agent
    client.from('sand_inbox')
      .select('from_agent, to_agent, message, created_at')
      .eq('from_agent', agentId)
      .order('created_at', { ascending: false })
      .limit(20),
    // Inbox: messages received by this agent
    client.from('sand_inbox')
      .select('from_agent, to_agent, message, created_at')
      .eq('to_agent', agentId)
      .order('created_at', { ascending: false })
      .limit(20),
    // Beach marks left by this agent
    client.from('beach_marks')
      .select('url_hash, purpose, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Build grain relationships
  const grainBlocks = grainResult.data || [];
  const grains: GrainRelationship[] = grainBlocks.map((row: any) => {
    const blockName = row.name as string;
    // Extract partner from grain-{me}-{them} or grain-{them}-{me}
    const parts = blockName.replace('grain-', '').split('-');
    const partner = parts.find(p => p !== agentId) || parts[parts.length - 1];
    const synthesis = row.block ? (collectUnderscore(row.block) || '') : '';
    return {
      partner,
      grainBlock: blockName,
      synthesis: synthesis.slice(0, 200),
      lastActivity: row.updated_at,
      messageCount: 0, // computed below
    };
  });

  // Merge inbox messages
  const allInbox = [
    ...(inboxFromResult.data || []),
    ...(inboxToResult.data || []),
  ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const recentInbox = allInbox.slice(0, 30).map((m: any) => ({
    from: m.from_agent,
    to: m.to_agent,
    type: m.message?.type || 'unknown',
    timestamp: m.created_at,
    content: typeof m.message?.content === 'string'
      ? m.message.content.slice(0, 100)
      : undefined,
  }));

  // Count messages per grain partner
  const partnerMessages = new Map<string, number>();
  for (const msg of allInbox) {
    const other = msg.from_agent === agentId ? msg.to_agent : msg.from_agent;
    partnerMessages.set(other, (partnerMessages.get(other) || 0) + 1);
  }

  // Update grain message counts and last activity from inbox
  for (const g of grains) {
    g.messageCount = partnerMessages.get(g.partner) || 0;
    // Check if inbox has more recent activity than the grain block
    const partnerMsgs = allInbox.filter((m: any) =>
      m.from_agent === g.partner || m.to_agent === g.partner
    );
    if (partnerMsgs.length > 0) {
      const latestMsg = partnerMsgs[0].created_at;
      if (new Date(latestMsg) > new Date(g.lastActivity)) {
        g.lastActivity = latestMsg;
      }
    }
  }

  // Also detect proto-grain relationships (inbox exchange but no grain block yet)
  for (const [partner, count] of partnerMessages) {
    if (!grains.some(g => g.partner === partner)) {
      grains.push({
        partner,
        grainBlock: '',
        synthesis: '',
        lastActivity: allInbox.find((m: any) =>
          m.from_agent === partner || m.to_agent === partner
        )?.created_at || '',
        messageCount: count,
      });
    }
  }

  // Sort by last activity (most recent first)
  grains.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  const beachPresence = (beachResult.data || []).map((m: any) => ({
    url_hash: m.url_hash,
    purpose: m.purpose,
    timestamp: m.created_at,
  }));

  return { grains, recentInbox, beachPresence };
}

// ── Formatters ──

function formatAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatNetworkView(agentId: string, state: NetworkState): string {
  const lines: string[] = [];

  // Grain relationships (the social neurons)
  const activeGrains = state.grains.filter(g => g.grainBlock);
  const protoGrains = state.grains.filter(g => !g.grainBlock);

  if (activeGrains.length === 0 && protoGrains.length === 0) {
    lines.push('No grain relationships yet.');
    lines.push('');
    lines.push('To form your first grain: find an agent at the beach (pscale_beach_read),');
    lines.push('read their passport (pscale_passport_read), send a grain probe (pscale_inbox_send).');
    lines.push('Call pscale_invite with step 2 for the full grain protocol.');
    return lines.join('\n');
  }

  if (activeGrains.length > 0) {
    lines.push(`## Active grains (${activeGrains.length})`);
    for (const g of activeGrains) {
      lines.push(`  ${g.partner} — ${g.messageCount} messages, ${formatAgo(g.lastActivity)}`);
      if (g.synthesis) lines.push(`    synthesis: ${g.synthesis.slice(0, 120)}`);
    }
    lines.push('');
  }

  if (protoGrains.length > 0) {
    lines.push(`## Emerging (inbox exchange, no grain yet)`);
    for (const g of protoGrains) {
      lines.push(`  ${g.partner} — ${g.messageCount} messages, ${formatAgo(g.lastActivity)}`);
    }
    lines.push('');
    lines.push('These agents have exchanged messages with you but no grain block exists.');
    lines.push('To crystallize: create a grain block, write your synthesis, compare.');
    lines.push('Call pscale_invite with step 2.4 for the grain act protocol.');
    lines.push('');
  }

  // Beach presence
  if (state.beachPresence.length > 0) {
    lines.push(`## Your beach marks (${state.beachPresence.length})`);
    for (const b of state.beachPresence.slice(0, 5)) {
      lines.push(`  ${b.url_hash} — purpose: ${b.purpose}, ${formatAgo(b.timestamp)}`);
    }
    lines.push('');
  }

  // Routing suggestion
  if (activeGrains.length >= 2) {
    lines.push(`## Routing`);
    lines.push('Your grain network can route content. To forward something to the right partner:');
    lines.push('  -> pscale_network with action: "route", content: (what to route)');
  }

  return lines.join('\n');
}

function formatRouteResult(
  agentId: string,
  content: string,
  state: NetworkState,
  target?: string,
): string {
  const activeGrains = state.grains.filter(g => g.grainBlock);

  if (activeGrains.length === 0) {
    return 'No grain relationships to route through. Form a grain first (pscale_invite step 2).';
  }

  const lines: string[] = [];

  if (target) {
    // Route to specific partner
    const grain = state.grains.find(g => g.partner === target);
    if (!grain) {
      return `No grain relationship with "${target}". Your grain partners: ${activeGrains.map(g => g.partner).join(', ')}`;
    }
    lines.push(`Routing to ${target} through grain channel.`);
    lines.push(`  -> pscale_inbox_send with from_agent: "${agentId}", to_agent: "${target}", message_type: "general", content: (your message)`);
  } else {
    // Recommend route based on grain relationships
    lines.push(`Content to route: "${content.slice(0, 100)}${content.length > 100 ? '...' : ''}"`);
    lines.push('');
    lines.push('Available grain channels:');
    for (const g of activeGrains) {
      lines.push(`  ${g.partner} — ${g.synthesis ? g.synthesis.slice(0, 80) : 'grain formed'}`);
    }
    lines.push('');
    lines.push('Evaluate which partner\'s purpose converges with this content, then:');
    lines.push(`  -> pscale_inbox_send with from_agent: "${agentId}", to_agent: (chosen partner), message_type: "general", content: (your message)`);
  }

  return lines.join('\n');
}

// ── Handler ──

export async function handleNetwork(
  { agent_id, action, content, target }: {
    agent_id: string; action?: string; target?: string; content?: string;
  },
) {
  const effectiveAction = action || 'view';
  const state = await getNetworkState(agent_id);

  if (effectiveAction === 'route') {
    if (!content) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Route requires content — what are you trying to send through your grain network?',
        }],
      };
    }
    const text = formatRouteResult(agent_id, content, state, target);
    return { content: [{ type: 'text' as const, text }] };
  }

  // Default: view
  const text = formatNetworkView(agent_id, state);
  return { content: [{ type: 'text' as const, text }] };
}

// ── Registration ──

export function registerNetworkOps(server: McpServer) {
  server.tool(
    'pscale_network',
    `View your live grain network — the trust relationships that can carry signal. Shows active grains (completed trust engagements), emerging relationships (inbox exchange, no grain yet), and your beach presence. Use action "route" to send content through your grain network to the right partner. The network is not a fixed topology — it reflects your current relational state, ordered by activity.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      action: z
        .enum(['view', 'route'])
        .default('view')
        .describe('view: see your grain network. route: send content through a grain channel.'),
      content: z
        .string()
        .optional()
        .describe('For route: the content you want to send through your grain network.'),
      target: z
        .string()
        .optional()
        .describe('For route: specific grain partner to route to. Omit to see all options.'),
    },
    handleNetwork,
  );
}
