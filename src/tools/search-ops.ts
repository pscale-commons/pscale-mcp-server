import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../db.js';

// Fuzzy agent discovery. Surfaces anywhere a name might appear:
//   - passport blocks  (pscale_blocks where name='passport')
//   - beach marks      (beach_marks.agent_id)
//   - inbox senders    (sand_inbox.from_agent)
//   - sed declarations (pscale_blocks where owner_id LIKE 'sed:%', full-text on block JSON)
// Read-only, ILIKE '%query%', merges by canonical address.

type Hit = {
  address: string;        // bare agent_id, or sed:{collective}:{position}
  surfaces: string[];     // which tables mentioned it
  has_passport: boolean;  // standalone passport block exists
  hint?: string;          // first description snippet we could find
};

export async function handleAgentSearch(
  { query, limit }: { query: string; limit?: number },
) {
  const client = getClient();
  const effectiveLimit = limit ?? 25;
  const pattern = `%${query}%`;
  const hits = new Map<string, Hit>();

  const touch = (address: string, surface: string, hint?: string) => {
    const existing = hits.get(address);
    if (existing) {
      if (!existing.surfaces.includes(surface)) existing.surfaces.push(surface);
      if (!existing.hint && hint) existing.hint = hint;
    } else {
      hits.set(address, { address, surfaces: [surface], has_passport: false, hint });
    }
  };

  // Passport blocks — strongest signal (the agent published).
  const { data: passports } = await client
    .from('pscale_blocks')
    .select('owner_id, block')
    .eq('name', 'passport')
    .ilike('owner_id', pattern);
  for (const row of passports ?? []) {
    const hint = typeof (row as any).block?._ === 'string' ? (row as any).block._ : undefined;
    touch((row as any).owner_id, 'passport', hint);
    hits.get((row as any).owner_id)!.has_passport = true;
  }

  // Beach marks.
  const { data: marks } = await client
    .from('beach_marks')
    .select('agent_id, purpose')
    .ilike('agent_id', pattern)
    .limit(200);
  for (const row of marks ?? []) touch((row as any).agent_id, 'beach', (row as any).purpose);

  // Inbox senders.
  const { data: senders } = await client
    .from('sand_inbox')
    .select('from_agent')
    .ilike('from_agent', pattern)
    .limit(200);
  for (const row of senders ?? []) touch((row as any).from_agent, 'inbox');

  // Sed: collectives — full-text search on serialised block JSON.
  // Registrants live nested inside the collective block (e.g. Tuichan at
  // sed:commons:12 is block["1"]["2"]), so the owner_id doesn't contain the
  // query. We cast block to text and ILIKE, then walk matches to find which
  // positions mention the query.
  const { data: sedBlocks } = await client
    .from('pscale_blocks')
    .select('owner_id, name, block')
    .like('owner_id', 'sed:%');
  for (const row of sedBlocks ?? []) {
    const serialised = JSON.stringify((row as any).block).toLowerCase();
    if (!serialised.includes(query.toLowerCase())) continue;
    const collective = (row as any).owner_id.slice(4);
    const block = (row as any).block;
    // Walk positions at floor depth — collect any position whose subtree contains the query.
    const positions = findSedPositions(block, query.toLowerCase());
    if (positions.length === 0) {
      // Match was in the root underscore (conventions etc.) — surface collective itself.
      touch((row as any).owner_id, 'sed-root');
    } else {
      for (const { pos, hint } of positions) {
        touch(`sed:${collective}:${pos}`, 'sed', hint);
      }
    }
  }

  // Check passport existence for any hit we discovered only via beach/inbox/sed:
  // (passports table already set has_passport=true for its own matches).
  const bareUnknown = Array.from(hits.values()).filter(
    h => !h.has_passport && !h.address.includes(':'),
  ).map(h => h.address);
  if (bareUnknown.length > 0) {
    const { data: existing } = await client
      .from('pscale_blocks')
      .select('owner_id')
      .eq('name', 'passport')
      .in('owner_id', bareUnknown);
    for (const row of existing ?? []) {
      const h = hits.get((row as any).owner_id);
      if (h) h.has_passport = true;
    }
  }

  const ranked = Array.from(hits.values())
    .sort((a, b) => {
      // Passports first, then more surfaces, then alphabetical.
      if (a.has_passport !== b.has_passport) return a.has_passport ? -1 : 1;
      if (a.surfaces.length !== b.surfaces.length) return b.surfaces.length - a.surfaces.length;
      return a.address.localeCompare(b.address);
    })
    .slice(0, effectiveLimit);

  const body = {
    query,
    hit_count: ranked.length,
    hits: ranked,
    note: ranked.length === 0
      ? 'No matches. Try a shorter substring, or walk sed:{collective} directly if you suspect a registrant.'
      : undefined,
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
  };
}

/**
 * Walk a sed: block and return every digit-path whose node's LOCAL text
 * (the node itself when it's a string, or its `_` description) contains the
 * query. Reports specific positions regardless of collective floor: a hit
 * at block["1"]["2"] returns "12"; a hit at block["12"] returns "12".
 * The `_` chain is followed transparently (does not contribute to the path).
 */
function findSedPositions(
  block: any,
  queryLower: string,
): Array<{ pos: string; hint?: string }> {
  const results: Array<{ pos: string; hint?: string }> = [];

  function localText(node: any): string | null {
    if (typeof node === 'string') return node;
    if (node && typeof node === 'object') {
      let u = node._;
      while (u && typeof u === 'object') u = u._;
      return typeof u === 'string' ? u : null;
    }
    return null;
  }

  function recurse(node: any, digits: string[]): void {
    if (digits.length > 0) {
      const text = localText(node);
      if (text && text.toLowerCase().includes(queryLower)) {
        results.push({ pos: digits.join(''), hint: text.slice(0, 120) });
      }
    }
    if (!node || typeof node !== 'object') return;
    // Follow underscore chain transparently (does not extend digit path).
    if (node._ && typeof node._ === 'object') recurse(node._, digits);
    for (const d of '123456789') {
      if (d in node) recurse(node[d], [...digits, d]);
    }
  }

  recurse(block, []);
  return results;
}

export function registerSearchOps(server: McpServer) {
  server.tool(
    'pscale_agent_search',
    `Fuzzy-find agents anywhere they've left a trace. Searches passport blocks, beach marks, inbox senders, and sedimentary collective registrations (e.g. an agent registered at sed:commons:12 via pscale_register is findable by querying part of their declaration text). Returns canonical addresses — bare agent_ids for published passports, sed:{collective}:{position} for sedimentary registrants — with per-hit flags for which surface matched and whether a standalone passport block exists. Use this when you know a name or fragment but not the exact address. Read-only.`,
    {
      query: z.string().describe('Substring to match (case-insensitive). Matched against agent_ids on all surfaces and the full text of sed: collective blocks.'),
      limit: z.number().int().optional().describe('Max results (default 25).'),
    },
    handleAgentSearch,
  );
}
