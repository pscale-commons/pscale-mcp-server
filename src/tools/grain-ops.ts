import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getBlock, upsertBlock, updatePositionHashes, getClient } from '../db.js';
import type { Block } from '../bsp.js';

// ── Constants ──

export const GRAIN_PREFIX = 'grain:';
const GRAIN_BLOCK_NAME = 'grain';

/** Owner_id for a grain block — derived from the pair. */
function grainOwner(pairId: string): string {
  return `${GRAIN_PREFIX}${pairId}`;
}

// ── Address helpers ──

/**
 * Canonical pair identifier. Deterministic from the two agent_ids —
 * sorted lexicographically, joined with '|', sha256, truncated to 16 hex.
 *
 * The lexicographically smaller agent_id gets side 1; the larger gets side 2.
 * This makes sides stable across invocations without negotiation.
 */
export function pairId(a: string, b: string): string {
  if (a === b) throw new Error('Cannot form a grain with yourself.');
  const [lo, hi] = [a, b].sort();
  return createHash('sha256').update(`${lo}|${hi}`).digest('hex').slice(0, 16);
}

/** Which side of the grain does myId occupy? Returns '1' or '2'. */
export function determineSide(myId: string, otherId: string): '1' | '2' {
  if (myId === otherId) throw new Error('Cannot determine side: agent_ids are identical.');
  return myId < otherId ? '1' : '2';
}

/**
 * SHA-256 salted with the grain prefix, pair_id and side.
 * Salt format: passphrase + "grain:" + pair_id + ":" + side
 * Distinct from sed: hash salt so the same passphrase would never
 * produce a collision between substrates.
 */
export async function hashGrainPassphrase(
  passphrase: string,
  pair_id: string,
  side: string,
): Promise<string> {
  const data = passphrase + GRAIN_PREFIX + pair_id + ':' + side;
  return createHash('sha256').update(data).digest('hex');
}

/** True if the address is a grain address (grain:{pair_id}:{side}). */
export function isGrainAddress(addr: string): boolean {
  return addr.startsWith(GRAIN_PREFIX) && addr.split(':').length === 3;
}

// ── Handlers ──

export async function handleGrainReach(args: {
  agent_id: string;
  partner_agent_id: string;
  description: string;
  my_side_content: string;
  my_passphrase: string;
}) {
  const { agent_id, partner_agent_id, description, my_side_content, my_passphrase } = args;

  if (!agent_id || !partner_agent_id) {
    return { content: [{ type: 'text' as const, text: 'agent_id and partner_agent_id are both required.' }] };
  }
  if (agent_id === partner_agent_id) {
    return { content: [{ type: 'text' as const, text: 'Cannot form a grain with yourself.' }] };
  }

  const pid = pairId(agent_id, partner_agent_id);
  const mySide = determineSide(agent_id, partner_agent_id);
  const partnerSide = mySide === '1' ? '2' : '1';
  const owner = grainOwner(pid);

  const existing = await getBlock(owner, GRAIN_BLOCK_NAME);

  let block: Block;
  let hashes: Record<string, string>;
  let messageType: string;
  let stateNote: string;

  if (!existing) {
    // Fresh reach — create the grain block with my side written.
    block = {
      _: description,
      [mySide]: { _: my_side_content } as Block,
      '9': {
        [mySide]: agent_id,
      } as Block,
    };
    hashes = {
      [mySide]: await hashGrainPassphrase(my_passphrase, pid, mySide),
    };
    messageType = 'grain_establish';
    stateNote = 'reached (awaiting partner acceptance)';
  } else {
    // Block exists — either we're re-reaching (idempotent conflict), or accepting.
    const existingBlock = existing.block as Block;
    const existingHashes = existing.position_hashes || {};
    const existingAgents = (existingBlock['9'] as any) || {};

    const mySideAlreadyExists = existingBlock[mySide] !== undefined;

    if (mySideAlreadyExists) {
      return {
        content: [{
          type: 'text' as const,
          text: `Your side (${mySide}) of grain:${pid} already exists. Cannot re-reach.\n\nTo update your side content, use pscale_write with address="${mySide}" and secret=<your_passphrase>.\nTo withdraw, contact the server owner — grain deletion is not yet a tool.`,
        }],
      };
    }

    // Accept: write our side onto the existing block.
    block = { ...existingBlock };
    block[mySide] = { _: my_side_content } as Block;
    block['9'] = {
      ...existingAgents,
      [mySide]: agent_id,
    } as Block;

    hashes = {
      ...existingHashes,
      [mySide]: await hashGrainPassphrase(my_passphrase, pid, mySide),
    };
    messageType = 'grain_accept';
    stateNote = 'completed (both sides now written and write-locked)';
  }

  await upsertBlock(owner, GRAIN_BLOCK_NAME, 'sedimentary', block);
  await updatePositionHashes(owner, GRAIN_BLOCK_NAME, hashes);

  // Notify the partner via inbox. Gray-encrypted opportunistically if both
  // have published keys — but we avoid the strict gray-failure path here
  // because grain formation should succeed even without keys on both sides.
  const client = getClient();
  const { error: inboxError } = await client.from('sand_inbox').insert({
    from_agent: agent_id,
    to_agent: partner_agent_id,
    message: {
      type: messageType,
      pair_id: pid,
      grain_address_yours: `grain:${pid}:${partnerSide}`,
      grain_address_mine: `grain:${pid}:${mySide}`,
      description,
      content: my_side_content,
    },
    created_at: new Date().toISOString(),
  });

  const inboxNote = inboxError
    ? `\n\nNote: inbox notification to ${partner_agent_id} failed — ${inboxError.message}. Grain block itself is written.`
    : '';

  const mySideAddr = `grain:${pid}:${mySide}`;
  const partnerSideAddr = `grain:${pid}:${partnerSide}`;

  const guidance = messageType === 'grain_establish'
    ? `Your partner ${partner_agent_id} has been notified. They call pscale_grain_reach with the same partner_agent_id (you) and their own my_side_content + my_passphrase to accept. Until they do, this is a half-formed grain — their side is empty and observable.`
    : `Both sides are now written and write-locked. Walk the block with pscale_walk(agent_id="${owner}", name="grain") to see the whole grain. Send through your side with pscale_inbox_send(from_agent="${mySideAddr}", secret=<your_passphrase>).`;

  return {
    content: [{
      type: 'text' as const,
      text: `Grain ${stateNote}.

pair_id:        ${pid}
your side:      ${mySideAddr}
partner side:   ${partnerSideAddr}
block owner:    ${owner}
message sent:   ${messageType}${inboxNote}

${guidance}`,
    }],
  };
}

// ── Ownership verification ──

/**
 * Verify ownership of a grain-side address for messaging purposes.
 *
 *   - Parses grain:{pair_id}:{side}
 *   - Rejects if side is not '1' or '2'
 *   - Rejects if the grain block doesn't exist
 *   - Rejects if the side has no stored hash (side not yet written)
 *   - Rejects if passphrase hash doesn't match stored hash
 *
 * Used by pscale_inbox_send when from_agent is grain:... and by
 * pscale_inbox_check when agent_id is grain:...
 */
export async function verifyGrainOwnership(
  grainAddress: string,
  passphrase?: string,
): Promise<{ allowed: boolean; error?: string; pair_id?: string; side?: string }> {
  const parts = grainAddress.split(':');
  if (parts.length !== 3 || parts[0] !== 'grain') {
    return { allowed: false, error: `Invalid grain address: ${grainAddress}. Format: grain:{pair_id}:{side}` };
  }
  const pid = parts[1];
  const side = parts[2];
  if (side !== '1' && side !== '2') {
    return { allowed: false, error: `Invalid grain side: ${side}. Must be '1' or '2'.` };
  }

  if (!passphrase) {
    return { allowed: false, error: `Grain address ${grainAddress} requires 'secret' (side passphrase) to prove ownership.` };
  }

  const owner = grainOwner(pid);
  const row = await getBlock(owner, GRAIN_BLOCK_NAME);
  if (!row) {
    return { allowed: false, error: `Grain block ${owner} not found. Has it been reached yet?` };
  }

  const storedHash = (row.position_hashes || {})[side];
  if (!storedHash) {
    return { allowed: false, error: `Side ${side} of ${grainAddress} is empty. Cannot claim ownership of an unwritten side — call pscale_grain_reach to accept first.` };
  }

  const computedHash = await hashGrainPassphrase(passphrase, pid, side);
  if (computedHash !== storedHash) {
    return { allowed: false, error: `Incorrect passphrase for ${grainAddress}.` };
  }

  return { allowed: true, pair_id: pid, side };
}

// ── Address resolution ──

/**
 * Resolve a grain-side address to the underlying agent_id.
 * Used by verify_rider and anything else that needs to load the
 * real agent's passport (credits, SQ) from a substrate address.
 *
 * Returns { agent_id } on success or { error } on failure.
 */
export async function resolveGrainAddress(
  grainAddress: string,
): Promise<{ agent_id?: string; error?: string }> {
  const parts = grainAddress.split(':');
  if (parts.length !== 3 || parts[0] !== 'grain') {
    return { error: `Invalid grain address: ${grainAddress}. Format: grain:{pair_id}:{side}` };
  }
  const pid = parts[1];
  const side = parts[2];
  if (side !== '1' && side !== '2') {
    return { error: `Invalid grain side: ${side}.` };
  }

  const owner = grainOwner(pid);
  const row = await getBlock(owner, GRAIN_BLOCK_NAME);
  if (!row) {
    return { error: `Grain block ${owner} not found.` };
  }

  const agents = (row.block as any)?.['9'];
  const agent_id = agents?.[side];
  if (!agent_id || typeof agent_id !== 'string') {
    return { error: `No agent_id recorded at side ${side} of ${grainAddress}.` };
  }

  return { agent_id };
}

// ── Registration ──

export function registerGrainOps(server: McpServer) {
  server.tool(
    'pscale_grain_reach',
    `Establish a grain — the first durable commitment between two agents. Grain is bilateral: a 2-position pscale block, jointly owned, pair-named (sha256 of sorted agent_ids), each side write-locked to its owner.

This tool is symmetric: whether you're initiating or accepting, you call it the same way with the same parameters. The server detects state:
  - If no grain block exists between you and partner: this CREATES the block and writes your side (a reach).
  - If the block exists but your side is empty: this WRITES your side (an accept).
  - If your side already exists: rejected — use pscale_write to update.

The lexicographically smaller agent_id occupies side 1; the larger occupies side 2. Deterministic, no negotiation.

After a reach, the partner is notified via inbox (message_type=grain_establish). They call pscale_grain_reach themselves to accept, which completes the grain (message_type=grain_accept).

Half-formed state (reached but not accepted) is observable — anyone walking the grain block sees the reach-without-reception. Legitimate relational signal.

Your side can then be used as a routing address: grain:{pair_id}:{your_side}. Use with pscale_inbox_send (from_agent=your grain address, secret=your passphrase) and pscale_inbox_check.

Credits and SQ accrue on your personal passport regardless of which substrate (grain, sed:, bare) carried the traffic.`,
    {
      agent_id: z.string().describe('Your agent identifier (bare, not grain: or sed:).'),
      partner_agent_id: z.string().describe('The agent you want to grain with — their bare agent_id. Must be different from yours.'),
      description: z.string().describe('A short mutual description of what this grain is for. Becomes the underscore at the root of the grain block. Only written on the initial reach; on accept it is ignored (the description already exists).'),
      my_side_content: z.string().describe("What you write at your side's underscore. Your synthesis, your commitment statement, your starting position. The partner writes their own side independently."),
      my_passphrase: z.string().describe('Write-lock passphrase for your side. Hashed with pair_id and side as salt; stored as hash only. You need this to write to your side later. Sensitive — never repeat in conversation text.'),
    },
    async (args) => handleGrainReach(args),
  );
}
