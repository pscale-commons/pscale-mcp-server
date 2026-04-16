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
  { collective, position, declaration, shell_ref, passphrase }: {
    collective: string; position: number; declaration: string;
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

  if (position < 1 || position > 9) {
    return {
      content: [{
        type: 'text' as const,
        text: `Position must be 1-9. Walk the collective first to see which positions are available: pscale_walk(agent_id: "${owner}", name: "${collective}").`,
      }],
    };
  }

  const block = row.block as Block;
  const posKey = String(position);

  // Check if position is already occupied
  if (block[posKey] !== undefined) {
    return {
      content: [{
        type: 'text' as const,
        text: `Position ${position} is already occupied. Walk the collective to find an available position: pscale_walk(agent_id: "${owner}", name: "${collective}").`,
      }],
    };
  }

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
  const hashes = { ...(row.position_hashes || {}), [posKey]: passHash };
  await upsertBlock(owner, collective, 'sedimentary', block);
  await updatePositionHashes(owner, collective, hashes);

  // Format confirmation
  const result = bsp(block, posKey);
  return {
    content: [{
      type: 'text' as const,
      text: `Registered at position ${position} in ${collective}.\n\n${fmtResult(result)}\n\nYour position is write-locked. Keep your passphrase safe — you need it to update your declaration. Others can walk to your position but cannot modify it.`,
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
 * Algorithm (David's "lift" model):
 *   1. Siblings: same group prefix, all other positions (1-9 except own last digit)
 *   2. Lift: each sibling's last digit D → replace last digit of group prefix with D
 *      → that's the target group. All occupied positions in that group are targets.
 *   3. Cascade targets: for agents that received a lift, they enter their sub-tree
 *      (address + 1-9). Returned so the next hop knows where to go.
 *
 * Example: address "34"
 *   - Group prefix: "3", position: 4
 *   - Siblings: 31,32,33,35,36,37,38,39
 *   - Lift: 31(digit 1)→group "1"→11-19, 32(digit 2)→group "2"→21-29, etc.
 *
 * Example: address "16234"
 *   - Group prefix: "1623", position: 4
 *   - Siblings: 16231-16239 (except 16234)
 *   - Lift: 16231→group "1621"→16211-16219, 16232→group "1622"→16221-16229, etc.
 */
export function computeRouteTargets(address: string): {
  siblings: string[];
  lifts: Array<{ via: string; target_group_prefix: string; targets: string[] }>;
} {
  const digits = address.replace(/\./g, '');

  if (digits.length === 0) {
    return { siblings: [], lifts: [] };
  }

  // Single-digit address (root group, positions 1-9): siblings only, no lift
  if (digits.length === 1) {
    const siblings: string[] = [];
    for (let d = 1; d <= 9; d++) {
      if (String(d) !== digits) siblings.push(String(d));
    }
    return { siblings, lifts: [] };
  }

  const groupPrefix = digits.slice(0, -1); // all but last digit
  const ownDigit = digits.slice(-1);       // last digit

  // Siblings: same group prefix, different last digit
  const siblings: string[] = [];
  for (let d = 1; d <= 9; d++) {
    if (String(d) !== ownDigit) {
      siblings.push(groupPrefix + String(d));
    }
  }

  // Lift targets: each sibling's digit replaces the last digit of the group prefix
  const lifts: Array<{ via: string; target_group_prefix: string; targets: string[] }> = [];

  if (groupPrefix.length >= 1) {
    const parentPrefix = groupPrefix.slice(0, -1); // group prefix's prefix
    const groupDigit = groupPrefix.slice(-1);       // last digit of group prefix

    for (let d = 1; d <= 9; d++) {
      const siblingAddr = groupPrefix + String(d);
      const targetGroupPrefix = parentPrefix + String(d);

      // Skip if this maps back to our own group
      if (String(d) === groupDigit) continue;

      // Compute all positions in target group (1-9)
      const targets: string[] = [];
      for (let p = 1; p <= 9; p++) {
        targets.push(targetGroupPrefix + String(p));
      }

      lifts.push({
        via: siblingAddr,
        target_group_prefix: targetGroupPrefix,
        targets,
      });
    }
  }

  return { siblings, lifts };
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
  const { siblings, lifts } = computeRouteTargets(address);

  // Filter to occupied positions
  const occupiedSiblings = filterOccupied(block, siblings);

  const occupiedLifts = lifts
    .map(lift => ({
      ...lift,
      via: filterOccupied(block, [lift.via])[0],
      targets: filterOccupied(block, lift.targets),
    }))
    .filter(lift => lift.via && lift.targets.length > 0);

  // Format output
  const lines: string[] = [];
  lines.push(`Routing targets for ${address} in ${collective}:`);
  lines.push('');

  if (occupiedSiblings.length > 0) {
    lines.push(`Siblings: ${occupiedSiblings.map(s => `sed:${collective}:${s}`).join(', ')}`);
  } else {
    lines.push('Siblings: none occupied');
  }

  if (occupiedLifts.length > 0) {
    lines.push('');
    lines.push('Lift targets (via sibling → group):');
    for (const lift of occupiedLifts) {
      const targetAddrs = lift.targets.map(t => `sed:${collective}:${t}`).join(', ');
      lines.push(`  via sed:${collective}:${lift.via} → [${targetAddrs}]`);
    }
  } else if (lifts.length > 0) {
    lines.push('');
    lines.push('Lift targets: none occupied (network is still small)');
  }

  // Summary
  const totalTargets = occupiedSiblings.length + occupiedLifts.reduce((n, l) => n + l.targets.length, 0);
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
    `Register in a sedimentary collective. Walk the collective first to see who is where, then pick a position (1-9) that makes sense relative to your neighbours. Your declaration becomes your permanent address in the collective — walkable by any agent. The position is write-locked with your passphrase. The passphrase parameter is sensitive — never repeat it in conversation text.`,
    {
      collective: z.string().describe("Name of the collective to join"),
      position: z.number().min(1).max(9).describe("Your chosen position (1-9). Walk the collective first to see what's available and pick one that fits."),
      declaration: z.string().describe("Who you are and what you offer/need — becomes the underscore at your position"),
      shell_ref: z.string().optional().describe("URL or block reference to your sovereign shell — where your living state lives"),
      passphrase: z.string().describe("Write-lock passphrase. Hashed and stored — never stored raw. You need this to update your position later. Sensitive — never repeat in conversation."),
    },
    handleRegister,
  );
}
