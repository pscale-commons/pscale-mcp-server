import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bsp, floorDepth, collectUnderscore, fmtResult, type Block } from '../bsp.js';
import { getBlock, upsertBlock, setTarget } from '../db.js';

const TARGET_DESC = 'Storage target. Filesystem path for local storage, or "supabase" for the relay. Sticky — once set, persists for the session until changed.';

/**
 * pscale memory compaction — the growth invariant.
 *
 * A memory block is a pscale tree that grows by deepening its floor as
 * memories accumulate. Each pscale level holds a different resolution of
 * the same history:
 *
 *   floor 1  (1..9 memories)      leaves at block["1"]..block["9"] as strings
 *   floor 2  (10..81 memories)    root digits hold batch objects; each batch is a closed floor-1 sub-tree with _ = summary of its 9 leaves
 *   floor 3  (82..729 memories)   root digits hold super-batch objects; each super-batch is a closed floor-2 sub-tree
 *   ...
 *
 * The growth rule: when a container's digits 1..9 are all full AND closed
 * (each child batch has its own _ summary), the container "closes" — its
 * own summary is computed and written to its underscore position. If the
 * container IS the root, closing triggers a floor growth: the old root
 * becomes block["1"] of a new floor-(K+1) block, and the next write opens
 * block["2"]["1"][...].
 *
 * Reading address XYZ as a spindle therefore gives: root summary →
 * super-batch summary → batch summary → specific leaf — the hierarchy is
 * structural, not a convention an agent has to maintain.
 *
 * Summary generation: beta implementation concatenates. Production would
 * use LLM summarisation or delegate to the agent (see pscale_evolution
 * for migration of existing blocks to new semantics).
 */

// ── Helpers ──

/** True if every digit 1..9 is present in node. */
function isFull(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  for (const d of '123456789') if (!(d in node)) return false;
  return true;
}

/**
 * A container is "closed" when the deepest string in its _ chain is a
 * non-empty summary. For floor-1: _ is a non-empty string. For floor K>=2:
 * the innermost string of the nested _ chain is non-empty.
 */
function isClosed(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  let cursor: any = node;
  while (cursor && typeof cursor === 'object') {
    if (typeof cursor._ === 'string') return cursor._.length > 0;
    if (cursor._ === undefined) return false;
    cursor = cursor._;
  }
  return false;
}

/**
 * Set a summary string at the DEEPEST underscore position in the chain.
 * For floor-1 (node._ missing or string), sets node._ = summary directly.
 * For floor K>=2, descends node._._._... until a string/missing position
 * and writes there, preserving the K-1 underscore objects above.
 */
function setDeepSummary(node: any, summary: string): void {
  if (!node || typeof node !== 'object') return;
  if (node._ === undefined || typeof node._ === 'string') {
    node._ = summary;
    return;
  }
  if (typeof node._ === 'object') {
    setDeepSummary(node._, summary);
  }
}

/** Compute a summary of a container's 9 digit children. Beta: concatenation. */
function summariseNine(node: any): string {
  const parts: string[] = [];
  for (const d of '123456789') {
    if (!(d in node)) continue;
    const v = node[d];
    if (typeof v === 'string') {
      parts.push(v);
    } else if (v && typeof v === 'object') {
      const text = typeof v._ === 'string' ? v._ : collectUnderscore(v);
      if (text) parts.push(text);
    }
  }
  return parts.join(' | ');
}

/**
 * Write entry into the sub-tree rooted at `node`, respecting the growth
 * invariant. Mutates `node` in place.
 *
 * If `closeSummary` is provided AND this write triggers the deepest-level
 * close in the recursion (typically the leaf-batch close), that string is
 * used as the batch's summary instead of the concat default. Outer levels
 * that cascade-close on the same write fall back to concat — agents can
 * update outer summaries later via pscale_write if they want.
 *
 * Returns true if the node is now FULLY CLOSED (all 9 children present,
 * all closed, _ summary written). The caller uses that to decide whether
 * ITS root needs to grow.
 */
function writeIntoSubtree(node: Block, entry: string, closeSummary?: string): boolean {
  const fl = floorDepth(node);

  if (fl <= 1) {
    // Leaf container — children are strings (memories).
    for (const d of '123456789') {
      if (!(d in node)) {
        node[d] = entry;
        if (d === '9') {
          // Just filled. Close — write summary at the deepest _ position so
          // the floor invariant is preserved (don't overwrite a _ chain).
          // Use LLM-supplied summary if provided; fall back to concat.
          setDeepSummary(node, closeSummary ?? summariseNine(node));
          return true;
        }
        return false;
      }
    }
    // Shouldn't be called on a full container.
    throw new Error('writeIntoSubtree called on full floor-1 node');
  }

  // floor >= 2: children are sub-trees (batches / super-batches).
  // Rightmost digit holds the current open sub-tree, if any.
  let rightmost: string | null = null;
  for (let i = 9; i >= 1; i--) {
    const d = String(i);
    if (d in node) { rightmost = d; break; }
  }

  if (rightmost !== null) {
    const sub = node[rightmost];
    if (sub && typeof sub === 'object' && !isClosed(sub)) {
      // Recurse into the currently-open sub-tree — pass closeSummary down
      // so it's consumed at the deepest close.
      const subClosed = writeIntoSubtree(sub as Block, entry, closeSummary);
      if (subClosed && rightmost === '9') {
        // Last slot's sub-tree just closed, meaning THIS level is now full
        // AND all children are closed. Cascade-close this level — always
        // via concat (deeper level already used closeSummary).
        setDeepSummary(node, summariseNine(node));
        return true;
      }
      return false;
    }
  }

  // No open sub-tree at the rightmost. Open a new one at the next empty slot.
  for (const d of '123456789') {
    if (!(d in node)) {
      // New sub-tree. Its own floor is fl - 1 (one level shallower than the parent).
      // For fl-1 == 1: sub is a leaf container starting with {1: entry}.
      // For fl-1 >= 2: sub is a batch container starting with {1: {1: entry}}.
      // Simpler: recursively create a minimal sub-tree of floor (fl-1).
      const newSub: Block = {};
      const subFloor = fl - 1;
      // Create an empty structure of the right floor, then write into it.
      // Floor-1 empty is {}. Floor-2 empty is {_: {}}... but isn't really empty. Use a different approach:
      // just write the entry at the deepest position it can reach in a new sub-tree.
      if (subFloor === 1) {
        newSub['1'] = entry;
      } else {
        // Build nested sub-tree of the right depth. writeIntoSubtree into an empty object
        // whose floor we pretend is (subFloor) by construction.
        let cursor: Block = newSub;
        for (let f = subFloor; f > 1; f--) {
          cursor['1'] = {};
          cursor = cursor['1'] as Block;
        }
        cursor['1'] = entry;
      }
      node[d] = newSub;
      return false;
    }
  }

  // All 9 digits full but rightmost wasn't "open" — means every child is closed
  // AND no room to open a new batch. This level is full-and-closed.
  // Caller handles the grow at the ROOT level (see handleRemember).
  // Should not reach here under normal flow because isClosed check above
  // catches the open case, and a full-closed container would have been closed
  // on the previous write. Keeping as a safety net:
  if (!isClosed(node)) {
    setDeepSummary(node, summariseNine(node));
  }
  return true;
}

/**
 * Grow the root: wrap the current block as child "1" of a new floor-(K+1)
 * block. Returns the new block. The caller must insert `entry` into it
 * via writeIntoSubtree.
 */
function growRoot(block: Block): Block {
  // Deep copy the current block (so mutations below don't affect the caller's reference).
  const old = JSON.parse(JSON.stringify(block));
  // New root: _ chain extended by one level (empty string at the bottom).
  return {
    _: { _: old._ ?? '' },
    '1': old,
  };
}

/** Find the most-recently-written leaf's address as a digit string. */
function currentLeafAddress(block: Block): string | null {
  const fl = floorDepth(block);
  if (fl === 0) return null;
  const addr: string[] = [];
  let cursor: any = block;
  for (let level = 0; level < fl; level++) {
    let picked: string | null = null;
    // Walk to the rightmost digit at this level. For the innermost level,
    // that's the latest leaf. For outer levels, that's the current-open batch.
    for (let i = 9; i >= 1; i--) {
      const d = String(i);
      if (cursor && typeof cursor === 'object' && d in cursor) {
        // If the child is an open (non-closed) object OR a string, it's the active one.
        // If it's a closed object, this is the rightmost closed batch — also fine to walk.
        picked = d;
        break;
      }
    }
    if (picked === null) return null;
    addr.push(picked);
    cursor = cursor[picked];
    if (typeof cursor === 'string') break;
  }
  return addr.join('');
}

// ── Exported handlers ──

export async function handleRemember(
  { agent_id, content, category, close_summary, target }: {
    agent_id: string; content: string; category?: string; close_summary?: string; target?: string;
  },
) {
  if (target) setTarget(target);

  const row = await getBlock(agent_id, 'history');
  let block: Block = row ? (row.block as Block) : {};

  const timestamp = new Date().toISOString();
  const entry = category
    ? `[${category}] ${content} (${timestamp})`
    : `${content} (${timestamp})`;

  // Empty block → initialise as floor-1 with entry at digit 1.
  if (!row || Object.keys(block).length === 0) {
    block = { _: '', '1': entry };
    await upsertBlock(agent_id, 'history', 'history', block);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ remembered: true, address: '1', floor: 1, closed: false, entry_preview: entry.slice(0, 100) }, null, 2) }],
    };
  }

  // Existing block: check if root is full-and-closed (needs to grow).
  const rootFullClosed = isFull(block) && [...'123456789'].every(d => {
    const v = block[d];
    return typeof v === 'string' || (typeof v === 'object' && isClosed(v));
  }) && isClosed(block);

  if (rootFullClosed) {
    block = growRoot(block);
  }

  const closed = writeIntoSubtree(block, entry, close_summary);

  // After writing, the root itself might have just closed (last leaf of last
  // batch of last super-batch). writeIntoSubtree returns true in that case,
  // but we don't grow until the NEXT write — the closed-full state is the
  // resting shape between growths.

  await upsertBlock(agent_id, 'history', 'history', block);

  const fl = floorDepth(block);
  const addr = currentLeafAddress(block) ?? '?';
  const summaryApplied = closed && close_summary !== undefined;
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        remembered: true,
        address: addr,
        floor: fl,
        closed,
        llm_summary_applied: summaryApplied,
        entry_preview: entry.slice(0, 100),
      }, null, 2),
    }],
  };
}

export async function handleRecall(
  { agent_id, level, position, search, target }: {
    agent_id: string; level?: number; position?: number; search?: string; target?: string;
  },
) {
  if (target) setTarget(target);

  const row = await getBlock(agent_id, 'history');
  if (!row) {
    return {
      content: [{
        type: 'text' as const,
        text: 'No history found. Use pscale_remember to start building memory.',
      }],
    };
  }

  const block = row.block as Block;
  const fl = floorDepth(block);

  // ── Search mode: keyword scan ──
  if (search) {
    const matches: { address: string; text: string }[] = [];
    function searchNode(node: any, path: string) {
      if (typeof node === 'string') {
        if (node.toLowerCase().includes(search!.toLowerCase())) matches.push({ address: path || '_', text: node });
        return;
      }
      if (node && typeof node === 'object') {
        if (typeof node._ === 'string' && node._.toLowerCase().includes(search!.toLowerCase())) {
          matches.push({ address: path || '_', text: node._ });
        }
        if (typeof node._ === 'object') searchNode(node._, path);
        for (const d of '123456789') if (d in node) searchNode(node[d], path ? `${path}.${d}` : d);
      }
    }
    searchNode(block, '');
    const lines = matches.slice(0, 20).map(m => `  [${m.address}] ${m.text}`);
    return {
      content: [{
        type: 'text' as const,
        text: `Search "${search}" — ${matches.length} matches across history:\n${lines.join('\n')}`,
      }],
    };
  }

  // ── Position mode: spindle at explicit address ──
  if (position !== undefined && position !== null) {
    const result = bsp(block, String(position));
    return {
      content: [{
        type: 'text' as const,
        text: `[history ${position}]\n${fmtResult(result)}`,
      }],
    };
  }

  // ── Level mode: disc at the corresponding depth ──
  // level N corresponds to depth (floor - N): level 0 = leaves, level (floor-1) = root summary.
  if (level !== undefined && level !== null) {
    const depth = Math.max(0, fl - level);
    const result = bsp(block, null, depth, 'disc');
    return {
      content: [{
        type: 'text' as const,
        text: `[history disc @ level ${level} / depth ${depth}]\n${fmtResult(result)}`,
      }],
    };
  }

  // ── Default: spindle through the most recent leaf — "where you are up to" ──
  const addr = currentLeafAddress(block);
  if (!addr) {
    return {
      content: [{ type: 'text' as const, text: `[history]\nfloor=${fl}; no memories yet.` }],
    };
  }
  const result = bsp(block, addr);
  return {
    content: [{
      type: 'text' as const,
      text: `[history — where you are up to: ${addr}, floor ${fl}]\n${fmtResult(result)}`,
    }],
  };
}

export async function handleConcern(
  { agent_id, action, purpose, perception, gap, target }: {
    agent_id: string; action: string; purpose?: string; perception?: string; gap?: string; target?: string;
  },
) {
  if (target) setTarget(target);
  if (action === 'read') {
    const row = await getBlock(agent_id, 'concern');
    if (!row) {
      return { content: [{ type: 'text' as const, text: 'No concern set. Use pscale_concern with action "set" to define your current focus.' }] };
    }
    const dir = bsp(row.block as Block);
    return { content: [{ type: 'text' as const, text: `[concern]\n${fmtResult(dir)}` }] };
  }
  const now = new Date().toISOString();
  const block: Block = {
    _: `Current concern — last updated ${now}`,
    '1': `Purpose: ${purpose || '(not set)'}`,
    '2': `Perception: ${perception || '(not set)'}`,
    '3': `Gap: ${gap || '(not set)'}`,
  };
  const existing = await getBlock(agent_id, 'concern');
  if (existing) {
    const prev = existing.block as Block;
    const prevSummary = collectUnderscore(prev) || '';
    block['4'] = `Previous: ${prevSummary}`;
  }
  await upsertBlock(agent_id, 'concern', 'concern', block);
  const dir = bsp(block);
  return { content: [{ type: 'text' as const, text: `Concern set.\n${fmtResult(dir)}` }] };
}

// ── Legacy registration ──

export function registerMemoryOps(server: McpServer) {
  server.tool(
    'pscale_remember',
    `Remember something — log an item into your personal history block (auto-compacting time-ordered log). For writing to a named block at a specific address, use pscale_write instead. Stores it in your history block with automatic pscale compaction — when 9 items accumulate at a level, they close into a summary and a new level opens. The tree deepens as history grows; nothing is destroyed. Address N reads as a spindle: root summary → batch summary → leaf.

If you are an LLM-in-the-loop caller (you have read access to your own history block), pass close_summary on every call: a 1-3 sentence synthesis of the 8 previous memories PLUS this one, ready to serve as the batch's summary if this write closes a batch. The server uses it when a batch closes; otherwise it's ignored (and you've lost nothing but a few tokens). This lifts summaries from pipe-concatenation to real semantic reductions without any server-side LLM cost. Stateless callers can omit it — concat is the fallback.

Response includes closed: boolean (did this write trigger a batch close?) and llm_summary_applied: boolean (was your close_summary used?).`,
    {
      agent_id: z.string(),
      content: z.string().describe('What to remember. Be specific — details survive through compaction via the spindle at this leaf.'),
      category: z.string().optional().describe("Optional tag like 'decision', 'event', 'learning'. Helps later recall."),
      close_summary: z.string().optional().describe('Optional LLM-crafted summary used IF this write closes a batch (9 digits full). A 1-3 sentence synthesis capturing essence of the 9 memories in the batch. Cheap to include on every call; server uses it only when a close actually fires. Without this, the server falls back to pipe-concatenating the 9 entries.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleRemember,
  );

  server.tool(
    'pscale_recall',
    `Recall from memory — reads your personal history block (the one pscale_remember writes to). For navigating other named blocks, use pscale_walk. Default (no args): returns a spindle through the most recent memory — root summary → batch summary → leaf — answering "where am I up to?" with the hierarchy of context automatically. Pass level to view all nodes at one resolution (level 0 = individual memories, level 1 = batch summaries, level 2 = super-batch summaries, higher = broader). Pass position for an explicit spindle at address N. Pass search for keyword scan.`,
    {
      agent_id: z.string(),
      level: z.number().int().optional().describe('Resolution level. 0 = individual items, 1 = batch summaries (9 items each), 2 = super-batch summaries (81 items). Omit for default "where am I up to" spindle.'),
      position: z.number().int().optional().describe('Explicit address. Reads as a spindle from root to that leaf.'),
      search: z.string().optional().describe('Keyword scan across the whole history block.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleRecall,
  );

  server.tool(
    'pscale_concern',
    `Read or set your current concern — what you're focused on and why. Three parts: purpose (what you're trying to achieve), perception (what you observe), gap (the difference driving your next action). Setting structures reasoning; reading at session start restores focus.`,
    {
      agent_id: z.string(),
      action: z.enum(['read', 'set']),
      purpose: z.string().optional().describe("For 'set': what you're trying to achieve"),
      perception: z.string().optional().describe("For 'set': what you currently observe"),
      gap: z.string().optional().describe("For 'set': the difference between purpose and perception"),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleConcern,
  );
}
