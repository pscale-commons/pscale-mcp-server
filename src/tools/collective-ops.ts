import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bsp, writeAt, fmtResult, type Block } from '../bsp.js';
import { getBlock, upsertBlock, updatePositionHashes } from '../db.js';

// ── Constants ──

const SED_PREFIX = 'sed:';

/** Synthetic owner_id for sedimentary blocks — the collective owns itself */
function sedOwner(collective: string): string {
  return `${SED_PREFIX}${collective}`;
}

/** SHA-256 hash salted with collective + position */
export async function hashPassphrase(passphrase: string, collective: string, position: string): Promise<string> {
  const data = new TextEncoder().encode(passphrase + collective + position);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Find the next valid unoccupied position in a sedimentary collective.
 *
 * Valid positions are positive integers whose decimal representation
 * contains only digits 1-9 (no 0). Digit 0 is reserved for the underscore
 * at every level of pscale, so positions like 10, 20, 100, 110 would
 * collide with semantic slots in the tree.
 *
 * Floor = 2: users live at depth 2 minimum (addresses 11+). Positions 1-9
 * are pure structure — group names for the 9 top-level branches, never
 * user slots. This keeps "no nesting of people" clean while allowing the
 * collective to grow naturally into deeper addresses (111+, 1111+, etc.)
 * as it fills.
 *
 * Sequence: 11, 12, ..., 19, 21, 22, ..., 99, 111, 112, ..., 999, 1111, ...
 *
 * Landing order: the Nth valid registrant lands at the Nth integer in this
 * sequence. Proof-of-presence-in-time, carried in the address itself. The
 * server is the only party that assigns positions, so the ordering is
 * incorruptible.
 *
 * @param positionHashes - map of occupied positions (e.g. { "0": ..., "11": ..., "23": ... }).
 *                        Position "0" is the root creator slot; positions 1-9
 *                        are reserved structural group names, never user slots.
 */
export function nextValidPosition(positionHashes: Record<string, string>): number {
  let n = 11; // start at floor = 2; 1-9 are structural group names, not user slots
  while (n < 1_000_000) {
    const s = String(n);
    if (!s.includes('0') && !positionHashes[s]) return n;
    n++;
  }
  throw new Error('No valid position found below 1,000,000 — collective is implausibly full.');
}

// ── Handlers ──

export async function handleCreateCollective(
  { collective, conventions, creator_passphrase }: {
    collective: string; conventions: string; creator_passphrase: string;
  },
) {
  const owner = sedOwner(collective);
  const existing = await getBlock(owner, collective);
  if (existing) {
    return {
      content: [{
        type: 'text' as const,
        text: `Collective "${collective}" already exists. Walk it with pscale_walk(agent_id: "${owner}", name: "${collective}").`,
      }],
    };
  }

  // The conventions become the root underscore
  const block: Block = { _: conventions };

  // Hash the creator passphrase for root-level write protection
  const rootHash = await hashPassphrase(creator_passphrase, collective, '0');
  const hashes: Record<string, string> = { '0': rootHash };

  await upsertBlock(owner, collective, 'sedimentary', block);
  await updatePositionHashes(owner, collective, hashes);

  return {
    content: [{
      type: 'text' as const,
      text: `Collective "${collective}" created.\n\nConventions:\n${conventions}\n\nAgents can now register with pscale_register. Walk the collective with pscale_walk(agent_id: "${owner}", name: "${collective}").`,
    }],
  };
}

export async function handleRegister(
  { collective, declaration, shell_ref, passphrase }: {
    collective: string; declaration: string;
    shell_ref?: string; passphrase: string;
  },
) {
  const owner = sedOwner(collective);
  const row = await getBlock(owner, collective);

  if (!row) {
    return {
      content: [{
        type: 'text' as const,
        text: `Collective "${collective}" not found. Create it first with pscale_create_collective.`,
      }],
    };
  }

  const block = row.block as Block;
  const positionHashes = row.position_hashes || {};

  // Auto-assign: server picks the lowest unoccupied valid position.
  // Valid = positive integer using only digits 1-9 (no 0). Position is
  // proof-of-presence-in-time; landing order is the meaning.
  const position = nextValidPosition(positionHashes);
  const posKey = String(position);

  // Hash the passphrase
  const passHash = await hashPassphrase(passphrase, collective, posKey);

  // Write the position: underscore = declaration, hidden directory holds shell_ref
  const positionContent: Block = { _: declaration };
  if (shell_ref) {
    // Store shell_ref in the hidden directory (underscore chain)
    // Structure: { _: { _: declaration, 1: shell_ref } }
    // But BSP star mode reads from _._.digits, so we nest:
    positionContent._ = { _: declaration, '1': shell_ref } as any;
  }

  writeAt(block, posKey, positionContent);

  // Update hashes
  const hashes = { ...positionHashes, [posKey]: passHash };
  await upsertBlock(owner, collective, 'sedimentary', block);
  await updatePositionHashes(owner, collective, hashes);

  // Format confirmation
  const result = bsp(block, posKey);
  return {
    content: [{
      type: 'text' as const,
      text: `Registered at position ${position} in ${collective}.\n\nYour address: sed:${collective}:${position}\n\n${fmtResult(result)}\n\nYour position is write-locked. Keep your passphrase safe — you need it to update your declaration. Position assigned by the server in landing order — it is your proof-of-presence-in-time.`,
    }],
  };
}

// ── Passphrase verification for sed: blocks ──

export async function verifySedWrite(
  collective: string,
  address: string,
  passphrase?: string,
): Promise<{ allowed: boolean; error?: string }> {
  const owner = sedOwner(collective);
  const row = await getBlock(owner, collective);

  if (!row) {
    return { allowed: false, error: `Collective "${collective}" not found.` };
  }

  // Extract the root position from the address (e.g., "3.2" → "3", "3" → "3")
  const rootPos = address.split('.')[0];

  // Check if this position has a hash (is occupied)
  const hashes = row.position_hashes || {};
  const storedHash = hashes[rootPos];

  if (!storedHash) {
    // Position not occupied — write allowed (but should use pscale_register for new positions)
    return { allowed: true };
  }

  // Position occupied — passphrase required
  if (!passphrase) {
    return { allowed: false, error: `Position ${rootPos} in ${collective} is write-locked. Provide passphrase to write.` };
  }

  const computedHash = await hashPassphrase(passphrase, collective, rootPos);
  if (computedHash !== storedHash) {
    return { allowed: false, error: `Write denied — incorrect passphrase for position ${rootPos} in ${collective}.` };
  }

  return { allowed: true };
}

/**
 * Verify ownership of a sedimentary address for messaging purposes.
 *
 * Semantics differ from verifySedWrite:
 *   - Empty position → REJECTED (cannot claim an unregistered address).
 *   - Occupied position → passphrase must match the stored hash.
 *
 * Used by pscale_inbox_send when from_agent is sed:... and by
 * pscale_inbox_check when agent_id is sed:...
 */
export async function verifySedOwnership(
  sedAddress: string,
  passphrase?: string,
): Promise<{ allowed: boolean; error?: string; collective?: string; position?: string }> {
  const parts = sedAddress.split(':');
  if (parts.length !== 3 || parts[0] !== 'sed') {
    return { allowed: false, error: `Invalid sedimentary address: ${sedAddress}. Format: sed:collective:position` };
  }
  const collective = parts[1];
  const position = parts[2];

  if (!passphrase) {
    return { allowed: false, error: `Sedimentary address ${sedAddress} requires 'secret' (registration passphrase) to prove ownership.` };
  }

  const owner = sedOwner(collective);
  const row = await getBlock(owner, collective);
  if (!row) {
    return { allowed: false, error: `Collective "${collective}" not found.` };
  }

  const storedHash = (row.position_hashes || {})[position];
  if (!storedHash) {
    return { allowed: false, error: `Position ${position} in ${collective} is not registered. Register first with pscale_register.` };
  }

  const computedHash = await hashPassphrase(passphrase, collective, position);
  if (computedHash !== storedHash) {
    return { allowed: false, error: `Incorrect passphrase for ${sedAddress}.` };
  }

  return { allowed: true, collective, position };
}

// ── Resolve sedimentary address to agent identity ──

export async function resolveSedAddress(
  sedAddress: string,
): Promise<{ agent_id?: string; declaration?: string; error?: string }> {
  // Format: "sed:commons:3" → collective="commons", position="3"
  const parts = sedAddress.split(':');
  if (parts.length !== 3 || parts[0] !== 'sed') {
    return { error: `Invalid sedimentary address: ${sedAddress}. Format: sed:collective:position` };
  }

  const collective = parts[1];
  const position = parts[2];
  const owner = sedOwner(collective);
  const row = await getBlock(owner, collective);

  if (!row) {
    return { error: `Collective "${collective}" not found.` };
  }

  const block = row.block as Block;
  const posContent = block[position];

  if (!posContent) {
    return { error: `Position ${position} in ${collective} is empty.` };
  }

  // Extract declaration from underscore
  let declaration: string;
  if (typeof posContent === 'string') {
    declaration = posContent;
  } else if (typeof posContent === 'object' && posContent._) {
    if (typeof posContent._ === 'string') {
      declaration = posContent._;
    } else if (typeof posContent._ === 'object' && posContent._._ ) {
      declaration = typeof posContent._._ === 'string' ? posContent._._ : JSON.stringify(posContent._._);
    } else {
      declaration = JSON.stringify(posContent._);
    }
  } else {
    declaration = JSON.stringify(posContent);
  }

  // For now, the sedimentary address IS the agent_id for inbox purposes
  // The inbox resolves sed:commons:3 as the target
  return { agent_id: sedAddress, declaration };
}

// ── Routing topology ──

/**
 * Compute routing targets from a sedimentary address.
 * Pure digit manipulation — no LLM, no semantics.
 *
 * An address is a path through a digit tree. Four kinds of tree-neighbour
 * are routing-relevant; they do NOT imply any ownership relationship —
 * every user is independent and passphrase-locked at their own slot.
 *
 *   1. Siblings: same parent, different last digit (1-9 except own).
 *   2. Parent: the address with the last digit stripped (null at depth 1).
 *   3. Children: the 9 potential deeper-neighbours (own address + digit 1-9).
 *   4. Lifts: sideways shortcuts to parallel groups at the same depth —
 *      for each digit D (skipping own-group digit), target group = parent's
 *      prefix + D, targets = that group's 9 child positions.
 *
 * Lifts intentionally do NOT require a specific "via" sibling to be
 * registered. The "via" is descriptive metadata naming the digit
 * transformation; routing itself goes directly to targets via inbox_send.
 * Filtering on via-occupancy would bias reach toward low-digit groups
 * (where earlier registrants cluster), producing low-digit heavy discovery
 * in sparse networks. Filter only on target occupancy.
 *
 * Example: address "34"
 *   - Parent: "3" ; Children: 341-349
 *   - Siblings: 31, 32, 33, 35, 36, 37, 38, 39
 *   - Lifts: via d=1→group "1"→11-19, via d=2→group "2"→21-29, ..., via d=9→91-99
 *     (d=3 skipped — own group)
 *
 * Example: address "16234"
 *   - Parent: "1623" ; Children: 162341-162349
 *   - Siblings: 16231, 16232, 16233, 16235, 16236, 16237, 16238, 16239
 *   - Lifts via each d != 3 (own group digit of "1623"): target group = "162" + d,
 *     targets = that group's 9 children
 */
export function computeRouteTargets(address: string): {
  parent: string | null;
  children: string[];
  siblings: string[];
  lifts: Array<{ via: string; target_group_prefix: string; targets: string[] }>;
} {
  const digits = address.replace(/\./g, '');

  if (digits.length === 0) {
    return { parent: null, children: [], siblings: [], lifts: [] };
  }

  // Parent: depth-N address becomes depth-(N-1) by stripping last digit.
  // Depth-1 addresses have no parent (root collective).
  const parent = digits.length >= 2 ? digits.slice(0, -1) : null;

  // Children: 9 potential deeper-neighbours, one per digit 1-9.
  const children: string[] = [];
  for (let d = 1; d <= 9; d++) {
    children.push(digits + String(d));
  }

  const ownDigit = digits.slice(-1);

  // Siblings: same parent, different last digit (1-9 except own)
  const siblings: string[] = [];
  const groupPrefix = digits.slice(0, -1); // empty string if depth 1
  for (let d = 1; d <= 9; d++) {
    if (String(d) !== ownDigit) {
      siblings.push(groupPrefix + String(d));
    }
  }

  // Lifts
  const lifts: Array<{ via: string; target_group_prefix: string; targets: string[] }> = [];

  if (digits.length === 1) {
    // Depth 1: lift downward into each sibling's subtree. Target group = the
    // sibling itself (single digit), targets = that digit's 9 children.
    for (let d = 1; d <= 9; d++) {
      if (String(d) === ownDigit) continue;
      const targetGroupPrefix = String(d);
      const targets: string[] = [];
      for (let p = 1; p <= 9; p++) targets.push(targetGroupPrefix + String(p));
      lifts.push({ via: String(d), target_group_prefix: targetGroupPrefix, targets });
    }
  } else {
    // Depth 2+: sideways to parallel groups at the same depth.
    const parentPrefix = groupPrefix.slice(0, -1); // may be empty
    const groupDigit = groupPrefix.slice(-1);

    for (let d = 1; d <= 9; d++) {
      if (String(d) === groupDigit) continue; // skip own group

      const siblingAddr = groupPrefix + String(d);
      const targetGroupPrefix = parentPrefix + String(d);

      const targets: string[] = [];
      for (let p = 1; p <= 9; p++) targets.push(targetGroupPrefix + String(p));

      lifts.push({
        via: siblingAddr,
        target_group_prefix: targetGroupPrefix,
        targets,
      });
    }
  }

  return { parent, children, siblings, lifts };
}

/**
 * Filter route targets to only those that actually exist in the collective block.
 */
function filterOccupied(block: Block, addresses: string[]): string[] {
  return addresses.filter(addr => {
    const digits = addr.replace(/\./g, '');
    let node: any = block;
    for (const d of digits) {
      if (!node || typeof node !== 'object') return false;
      node = node[d];
    }
    return node !== undefined;
  });
}

export async function handleRoute(
  { collective, address }: { collective: string; address: string },
) {
  const owner = sedOwner(collective);
  const row = await getBlock(owner, collective);

  if (!row) {
    return {
      content: [{
        type: 'text' as const,
        text: `Collective "${collective}" not found.`,
      }],
    };
  }

  const block = row.block as Block;
  const { parent, children, siblings, lifts } = computeRouteTargets(address);

  // Filter to occupied positions. Note: lifts do NOT require the "via" sibling
  // to be occupied — "via" is descriptive metadata, not a physical hop. We
  // filter only on target occupancy, which keeps reach uniform across groups.
  const occupiedParent = parent ? filterOccupied(block, [parent])[0] : undefined;
  const occupiedChildren = filterOccupied(block, children);
  const occupiedSiblings = filterOccupied(block, siblings);
  const occupiedLifts = lifts
    .map(lift => ({ ...lift, targets: filterOccupied(block, lift.targets) }))
    .filter(lift => lift.targets.length > 0);

  // Format output
  const lines: string[] = [];
  lines.push(`Routing targets for ${address} in ${collective}:`);
  lines.push('');

  if (occupiedParent) {
    lines.push(`Parent: sed:${collective}:${occupiedParent}`);
  } else if (parent === null) {
    lines.push(`Parent: (at collective root)`);
  } else {
    lines.push(`Parent: sed:${collective}:${parent} (not occupied)`);
  }

  if (occupiedChildren.length > 0) {
    lines.push(`Children: ${occupiedChildren.map(c => `sed:${collective}:${c}`).join(', ')}`);
  } else {
    lines.push('Children: none occupied');
  }

  if (occupiedSiblings.length > 0) {
    lines.push(`Siblings: ${occupiedSiblings.map(s => `sed:${collective}:${s}`).join(', ')}`);
  } else {
    lines.push('Siblings: none occupied');
  }

  if (occupiedLifts.length > 0) {
    lines.push('');
    lines.push('Lift targets (via digit → parallel group):');
    for (const lift of occupiedLifts) {
      const targetAddrs = lift.targets.map(t => `sed:${collective}:${t}`).join(', ');
      lines.push(`  via d=${lift.via.slice(-1)} → [${targetAddrs}]`);
    }
  } else if (lifts.length > 0) {
    lines.push('');
    lines.push('Lift targets: no parallel groups have occupied positions yet');
  }

  // Summary
  const totalTargets =
    (occupiedParent ? 1 : 0) +
    occupiedChildren.length +
    occupiedSiblings.length +
    occupiedLifts.reduce((n, l) => n + l.targets.length, 0);
  lines.push('');
  lines.push(`Total reachable: ${totalTargets} agents`);

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}

// ── Registration ──

export function registerCollectiveOps(server: McpServer) {
  server.tool(
    'pscale_create_collective',
    `Create a sedimentary collective — a shared, append-only pscale block where agents register to receive permanent, write-locked positions. The conventions in the root underscore define the rules of play: routing, evaluation, selection, star link policy, SQ tracking. Different collectives can have completely different rules — the infrastructure is the same.`,
    {
      collective: z.string().describe("Name of the collective (e.g. 'commons', 'football-enthusiasts')"),
      conventions: z.string().describe("The rules of play — becomes the root underscore. Describe routing, evaluation, selection, star links, SQ, polling, content format, registration rules, shell policy."),
      creator_passphrase: z.string().describe("Admin passphrase for the collective root. Sensitive — never repeat in conversation."),
    },
    handleCreateCollective,
  );

  // pscale_route is NOT exposed as a tool — it's internal infrastructure.
  // computeRouteTargets() and handleRoute() are exported for use by
  // the Level 2 forwarding logic, not for agents to call directly.

  server.tool(
    'pscale_register',
    `Register in a sedimentary collective. The server assigns the next valid position in landing order — positions are sequential identifiers (proof-of-presence-in-time), not topic categories. Topic information lives in your passport, not your position. Your declaration becomes your permanent address, walkable by any agent. The position is write-locked with your passphrase. The passphrase parameter is sensitive — never repeat it in conversation text.`,
    {
      collective: z.string().describe("Name of the collective to join"),
      declaration: z.string().describe("Who you are and what you offer/need — becomes the underscore at your position"),
      shell_ref: z.string().optional().describe("URL or block reference to your sovereign shell — where your living state lives"),
      passphrase: z.string().describe("Write-lock passphrase. Hashed and stored — never stored raw. You need this to update your position later. Sensitive — never repeat in conversation."),
    },
    handleRegister,
  );
}
