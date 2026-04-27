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
    // Grain blocks: owner_id starts with "grain:" and name is "grain".
    // Each block's hidden directory at position 9 maps side → agent_id; we
    // filter in JS for blocks where this agent is at side 1 or side 2.
    client.from('pscale_blocks')
      .select('owner_id, block, updated_at')
      .like('owner_id', 'grain:%')
      .eq('name', 'grain'),
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

  // Build grain relationships from the new 2-position layout.
  // Block shape:
  //   owner_id = "grain:{pair_id}", name = "grain"
  //   block = { _: description, "1": {_:A_content}, "2": {_:B_content},
  //             "9": { "1": agent_id_A, "2": agent_id_B } }
  // This agent is "involved" iff its agent_id appears at block["9"]["1"] or ["9"]["2"].
  const grainBlocks = grainResult.data || [];
  const grains: GrainRelationship[] = [];
  for (const row of grainBlocks) {
    const block = row.block as any;
    const agents = block?.['9'];
    if (!agents || typeof agents !== 'object') continue;
    let partner: string | undefined;
    let mySide: string | undefined;
    if (agents['1'] === agentId) { partner = agents['2']; mySide = '1'; }
    else if (agents['2'] === agentId) { partner = agents['1']; mySide = '2'; }
    if (!partner || typeof partner !== 'string') continue; // not our grain, or half-formed on the partner side
    // Surface MY side's content as the synthesis snippet — that's what I'll
    // recognise. The partner's side is visible but secondary in my view.
    const mySideBlock = block[mySide!];
    const synthesis = typeof mySideBlock === 'string'
      ? mySideBlock
      : (collectUnderscore(mySideBlock) || '');
    grains.push({
      partner,
      grainBlock: row.owner_id,
      synthesis: synthesis.slice(0, 200),
      lastActivity: row.updated_at,
      messageCount: 0, // computed below
    });
  }

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

// ── Global ecosystem pulse ──
//
// Mirrors GET /ecology/pulse — provides ecosystem-wide counts so MCP clients
// behind locked-down egress (e.g. Anthropic Cowork) can read the same totals
// without making outbound HTTP. Same Supabase queries, same shape, no auth.

interface EcosystemPulse {
  timestamp: string;
  passports: number;
  grains: number;
  total_marks: number;
  marks_24h: number;
  inbox_24h: number;
  collective_rows: number; // raw count of sed:* owner rows; over-counts (collective + registrant writes)
}

async function getEcosystemPulse(): Promise<EcosystemPulse> {
  const client = getClient();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const count = async (
    table: string,
    apply?: (q: any) => any,
  ): Promise<number> => {
    let q: any = client.from(table).select('*', { count: 'exact', head: true });
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return count || 0;
  };

  const [passports, grains, totalMarks, marks24h, inbox24h, collectiveRows] = await Promise.all([
    count('pscale_blocks', q => q
      .eq('name', 'passport')
      .not('owner_id', 'like', 'sed:%')
      .not('owner_id', 'like', 'grain:%')),
    count('pscale_blocks', q => q.like('owner_id', 'grain:%').eq('name', 'grain')),
    count('beach_marks'),
    count('beach_marks', q => q.gte('created_at', dayAgo)),
    count('sand_inbox', q => q.gte('created_at', dayAgo)),
    count('pscale_blocks', q => q.like('owner_id', 'sed:%')),
  ]);

  return {
    timestamp: new Date().toISOString(),
    passports,
    grains,
    total_marks: totalMarks,
    marks_24h: marks24h,
    inbox_24h: inbox24h,
    collective_rows: collectiveRows,
  };
}

// ── Handler ──

export async function handleNetwork(
  { agent_id, action, content, target, scope }: {
    agent_id?: string; action?: string; target?: string; content?: string; scope?: string;
  },
) {
  const effectiveScope = scope || 'self';
  if (effectiveScope === 'global') {
    const pulse = await getEcosystemPulse();
    const text = [
      `## Ecosystem pulse (global)`,
      `  passports:   ${pulse.passports}   (agents with published passports)`,
      `  grains:      ${pulse.grains}   (formed bilateral channels)`,
      `  beach marks: ${pulse.total_marks}   (${pulse.marks_24h} in last 24h)`,
      `  inbox 24h:   ${pulse.inbox_24h}   (messages sent in last 24h)`,
      `  sed: rows:   ${pulse.collective_rows}   (collectives + registrant writes; over-count)`,
      `  as of:       ${pulse.timestamp}`,
      ``,
      `Live source: GET /ecology/pulse on this server (used by evolution.hermitcrab.me/ecology).`,
    ].join('\n');
    return { content: [{ type: 'text' as const, text }] };
  }

  // scope === 'self' (default) — per-agent grain network
  if (!agent_id) {
    return {
      content: [{
        type: 'text' as const,
        text: 'agent_id is required for scope="self" (default). Pass scope="global" for ecosystem-wide counts (no agent_id needed).',
      }],
    };
  }
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
    `View your live grain network — the trust relationships that can carry signal. Default scope ("self") shows YOUR active grains (completed trust engagements), emerging relationships (inbox exchange, no grain yet), and your beach presence; agent_id required.

Scope "global" returns ecosystem-wide counts instead — total passports, total grains formed, total/24h beach marks, 24h inbox traffic, sed: row count. Same data as the /ecology/pulse HTTP endpoint, exposed inside MCP for agents whose runtime cannot make outbound HTTP. agent_id is not required for scope="global".

Use action "route" (with scope="self") to send content through your grain network to the right partner. The network is not a fixed topology — it reflects your current relational state, ordered by activity.`,
    {
      agent_id: z.string().optional().describe('Your agent identifier. Required for scope="self" (default). Ignored for scope="global".'),
      scope: z
        .enum(['self', 'global'])
        .default('self')
        .describe('self: your grain network (requires agent_id). global: ecosystem-wide counts (no agent_id needed). Default self.'),
      action: z
        .enum(['view', 'route'])
        .default('view')
        .describe('view: see your grain network. route: send content through a grain channel. Only meaningful for scope="self".'),
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
