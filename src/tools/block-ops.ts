import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { bsp, writeAt, fmtResult, fmtDir, type Block, type BspResult } from '../bsp.js';
import { getBlock, upsertBlock, listBlocks, setTarget, updatePositionHashes } from '../db.js';
import { selfEncrypt, decryptBlockNodes } from '../crypto.js';
import { verifySedWrite } from './collective-ops.js';

const TARGET_DESC = 'Storage target. Filesystem path for local storage, or "supabase" for the relay. Sticky — once set, persists for the session until changed.';

// ── Ordinary-block write-lock (parallel to sed:/grain: substrates) ──
//
// An ordinary block becomes write-locked when position_hashes contains a
// whole-block marker at key '_'. The marker is the SHA-256 of:
//   passphrase + "block:" + agent_id + ":" + name + ":_"
// Distinct salt namespace from sed: ("collective+position") and grain:
// ("grain:pair_id:side"), so the same passphrase never produces collisions
// across substrates.
//
// Per-position locks within an ordinary block are not enforced in V1 —
// the whole-block lock is sufficient for shell sovereignty. If finer-grained
// locking becomes useful, the sed: per-position pattern is the template.

export function hashBlockPassphrase(
  passphrase: string,
  agentId: string,
  name: string,
  position: string,
): string {
  const data = passphrase + 'block:' + agentId + ':' + name + ':' + position;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify the write-lock on an ordinary (non-sed, non-grain) block.
 *
 *   - Block has no whole-block lock → write allowed (unlocked).
 *   - Block has a whole-block lock at position_hashes['_'] → secret required
 *     and must hash to the stored value.
 */
export function verifyOrdinaryBlockWrite(
  positionHashes: Record<string, string> | undefined,
  agentId: string,
  name: string,
  secret: string | undefined,
): { allowed: boolean; locked: boolean; error?: string } {
  const storedHash = positionHashes?.['_'];
  if (!storedHash) return { allowed: true, locked: false };
  if (!secret) {
    return {
      allowed: false,
      locked: true,
      error: `Block "${name}" is write-locked. Provide secret to write.`,
    };
  }
  const computed = hashBlockPassphrase(secret, agentId, name, '_');
  if (computed !== storedHash) {
    return {
      allowed: false,
      locked: true,
      error: `Write denied — incorrect secret for block "${name}".`,
    };
  }
  return { allowed: true, locked: true };
}

/**
 * Identity-lock check for bare agent_ids (non-sed:, non-grain:).
 *
 * The agent's PASSPORT block is the canonical identity assertion. If the
 * passport is locked (position_hashes['_'] set), every "post-as-me" action
 * (pool_send, pool_join, etc.) must prove ownership of the lock. If the
 * passport is unlocked or absent, no check — open behaviour preserved.
 *
 * Skips structured addresses (sed:, grain:) — those have their own ownership
 * dispatchers (verifySedOwnership, verifyGrainOwnership) and are checked
 * upstream by callers that handle them.
 *
 * Returns {allowed: true, locked: false} when no gate applies.
 * Returns {allowed: true, locked: true} when secret verifies.
 * Returns {allowed: false, locked: true, error} when gate applies and check fails.
 */
export async function verifyBareAgentIdentity(
  agentId: string,
  secret: string | undefined,
): Promise<{ allowed: boolean; locked: boolean; error?: string }> {
  if (agentId.startsWith('sed:') || agentId.startsWith('grain:')) {
    return { allowed: true, locked: false };
  }
  const row = await getBlock(agentId, 'passport');
  if (!row) return { allowed: true, locked: false };
  const check = verifyOrdinaryBlockWrite(row.position_hashes, agentId, 'passport', secret);
  if (!check.allowed && check.error) {
    // Re-frame so the caller sees identity-lock semantics, not block-lock.
    const friendlier = check.error.includes('incorrect')
      ? `Identity check failed for "${agentId}" — incorrect secret.`
      : `Agent "${agentId}" has a locked passport. Provide secret to post under this identity.`;
    return { allowed: false, locked: true, error: friendlier };
  }
  return check;
}

// ── Exported handler functions (used by kernel + legacy registration) ──

export async function handleCreateBlock(
  { agent_id, name, initial_content, block_type, secret, target }: {
    agent_id: string; name: string; initial_content?: string; block_type?: string; secret?: string; target?: string;
  },
) {
  if (target) setTarget(target);

  // Reject reserved-prefix names — sed:/grain: have their own lifecycle tools.
  if (agent_id.startsWith('sed:') || agent_id.startsWith('grain:') ||
      name.startsWith('sed:') || name.startsWith('grain:')) {
    return {
      content: [{
        type: 'text' as const,
        text: `Block names and agent_ids with prefixes "sed:" or "grain:" are reserved. Use pscale_create_collective or pscale_grain_reach instead.`,
      }],
    };
  }

  const existing = await getBlock(agent_id, name);
  if (existing) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block "${name}" already exists for ${agent_id}. Use pscale_write to modify it, or pscale_walk to navigate it. To lock an existing block, use pscale_lock_block.`,
        },
      ],
    };
  }

  const block: Block = { _: initial_content || '' };
  await upsertBlock(agent_id, name, block_type || 'general', block);

  // Optional whole-block write-lock: hash the secret and store at position_hashes['_'].
  // From this point, every pscale_write to this block requires the same secret.
  let lockNote = '';
  if (secret) {
    const hashes = { '_': hashBlockPassphrase(secret, agent_id, name, '_') };
    await updatePositionHashes(agent_id, name, hashes);
    lockNote = '\n\nBlock is write-locked. Keep the secret safe — every write to this block requires it.';
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ created: true, name, locked: !!secret, block }, null, 2) + lockNote,
      },
    ],
  };
}

export async function handleLockBlock(
  { agent_id, name, secret, current_secret, target }: {
    agent_id: string; name: string; secret: string; current_secret?: string; target?: string;
  },
) {
  if (target) setTarget(target);

  if (agent_id.startsWith('sed:') || agent_id.startsWith('grain:') ||
      name.startsWith('sed:') || name.startsWith('grain:')) {
    return {
      content: [{
        type: 'text' as const,
        text: `Locking is only for ordinary blocks. sed:/grain: blocks are locked by their own lifecycle tools.`,
      }],
    };
  }

  const row = await getBlock(agent_id, name);
  if (!row) {
    return {
      content: [{ type: 'text' as const, text: `Block "${name}" not found for ${agent_id}.` }],
    };
  }

  // If already locked, require the current secret to rotate.
  const existingHash = row.position_hashes?.['_'];
  if (existingHash) {
    if (!current_secret) {
      return {
        content: [{
          type: 'text' as const,
          text: `Block "${name}" is already locked. To rotate the lock, provide current_secret along with the new secret.`,
        }],
      };
    }
    const computed = hashBlockPassphrase(current_secret, agent_id, name, '_');
    if (computed !== existingHash) {
      return {
        content: [{ type: 'text' as const, text: `Lock rotation denied — incorrect current_secret.` }],
      };
    }
  }

  const hashes = { ...(row.position_hashes || {}), '_': hashBlockPassphrase(secret, agent_id, name, '_') };
  await updatePositionHashes(agent_id, name, hashes);

  return {
    content: [{
      type: 'text' as const,
      text: `Block "${name}" is now write-locked${existingHash ? ' (rotated)' : ''}. Every write requires the secret.`,
    }],
  };
}

export async function handleWrite(
  { agent_id, name, address, content, secret, passphrase, target }: {
    agent_id: string; name: string; address: string; content: string; secret?: string; passphrase?: string; target?: string;
  },
) {
  if (target) setTarget(target);

  // Is this a sedimentary block? Determines parameter semantics below.
  const isSedBlock = name.startsWith('sed:') || agent_id.startsWith('sed:');
  const isGrainBlock = agent_id.startsWith('grain:');

  // Sedimentary write-lock proof. Accept either `secret` (unified naming,
  // matches inbox tools) or `passphrase` (legacy alias). Either field works.
  const lockProof = passphrase ?? secret;
  if (isSedBlock) {
    const collective = name.startsWith('sed:') ? name.slice(4) : agent_id.slice(4);
    const check = await verifySedWrite(collective, address, lockProof);
    if (!check.allowed) {
      return {
        content: [{ type: 'text' as const, text: check.error || 'Write denied.' }],
      };
    }
  }

  const row = await getBlock(agent_id, name);
  if (!row) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block "${name}" not found. Create it first with pscale_create_block.`,
        },
      ],
    };
  }

  // Ordinary-block write-lock check. Parallels sed:/grain: but at the
  // whole-block granularity. If position_hashes['_'] exists, this block
  // is locked and every write requires the secret. Reading is unaffected
  // (privacy is gray-encryption's job, not the lock's).
  const isOrdinaryBlock = !isSedBlock && !isGrainBlock;
  if (isOrdinaryBlock) {
    const lockCheck = verifyOrdinaryBlockWrite(row.position_hashes, agent_id, name, lockProof);
    if (!lockCheck.allowed) {
      return {
        content: [{ type: 'text' as const, text: lockCheck.error || 'Write denied.' }],
      };
    }
    // Stash for the encryption decision below.
    (row as any).__locked = lockCheck.locked;
  }

  // Position 9 of a passport block holds cryptographic public keys (the
  // gray-encryption gate). The wiki philosophy applies to descriptive content
  // (offers, needs, lineage, narrative) but NOT to crypto material — anyone
  // overwriting position 9 with their own key intercepts gray-encrypted
  // inbound until the legitimate owner re-publishes. pscale_key_publish has
  // a rotation-signature gate; pscale_write does not, so route callers there.
  if (name === 'passport' && (address === '9' || address.startsWith('9.'))) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Position 9 of a passport is reserved for cryptographic public keys. Direct writes are refused; use pscale_key_publish (which enforces a rotation-signature gate) to publish or rotate keys.',
        },
      ],
    };
  }

  const block = row.block as Block;
  const writeAddress = address === '0' ? '_' : address;

  // Encryption seed. Three regimes:
  //   sed: blocks       → secret is lock-proof; content stays plaintext
  //                       (conventions / shared declarations are public).
  //   grain: blocks     → secret is lock-proof; content stays plaintext
  //                       (the partner needs to read your side).
  //   ordinary, locked  → secret is lock-proof; content stays plaintext.
  //                       (shells often want public-readable but auth-write —
  //                       e.g. visitors reading happyseaurchin's purpose).
  //                       Use gray-encryption explicitly via a separate write
  //                       cycle if you also want privacy on top.
  //   ordinary, unlock  → secret is the encryption seed (legacy behaviour).
  const encryptionSeed = (isSedBlock || isGrainBlock || (row as any).__locked)
    ? undefined
    : secret;

  const valueToWrite = encryptionSeed
    ? await selfEncrypt(content, encryptionSeed, agent_id)
    : content;

  writeAt(block, writeAddress, valueToWrite);

  await upsertBlock(agent_id, name, row.block_type, block);

  // Confirm — show decrypted view if encryption was used
  const viewBlock = encryptionSeed ? await decryptBlockNodes(block, encryptionSeed, agent_id) : block;
  const confirmation = bsp(viewBlock, address);
  return {
    content: [
      {
        type: 'text' as const,
        text: `Written to ${name} at ${address}.${encryptionSeed ? ' (encrypted)' : ''}\n${fmtResult(confirmation)}`,
      },
    ],
  };
}

export async function handleWalk(
  { agent_id, name, address, mode, secret, target }: {
    agent_id: string; name: string; address?: string; mode?: string; secret?: string; target?: string;
  },
) {
  if (target) setTarget(target);
  const row = await getBlock(agent_id, name);
  if (!row) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block "${name}" not found for ${agent_id}.`,
        },
      ],
    };
  }

  // Decrypt _gray nodes if secret provided, before BSP walks the tree
  const block = secret
    ? await decryptBlockNodes(row.block as Block, secret, agent_id)
    : row.block as Block;
  const effectiveMode = mode || 'dir';
  let result;

  if (!address && effectiveMode === 'dir') {
    result = bsp(block);
  } else if (!address && effectiveMode === 'disc') {
    result = bsp(block, null, 1, 'disc');
  } else if (!address) {
    result = bsp(block);
  } else {
    switch (effectiveMode) {
      case 'spindle':
        result = bsp(block, address);
        break;
      case 'ring':
        result = bsp(block, address, 'ring');
        break;
      case 'dir':
        result = bsp(block, address, 'dir');
        break;
      case 'point':
        result = bsp(block, address, 0, 'point');
        break;
      case 'disc':
        result = bsp(block, null, parseInt(address, 10), 'disc');
        break;
      case 'star':
        result = bsp(block, address, '*');
        break;
    }
  }

  const label = address
    ? `[${name} ${address} ${effectiveMode}]`
    : `[${name} ${effectiveMode}]`;

  return {
    content: [
      { type: 'text' as const, text: `${label}\n${fmtResult(result!)}` },
    ],
  };
}

// ── Legacy registration (kept for backward compat) ──

export function registerBlockOps(server: McpServer) {
  server.tool(
    'pscale_create_block',
    `Create a new pscale block — a structured JSON tree that compacts gracefully over time. The block starts with an underscore (the summary/spine) and numbered entries branch from it. Use for project context, research, or any information you want to navigate later.

Optional 'secret' applies a whole-block write-lock at creation. From then on, every pscale_write to this block requires the same secret. Reads remain public (use gray encryption separately if you want private content). This is the same write-lock primitive sed: and grain: use, applied to ordinary blocks — the way to make a sovereign shell on the commons beach.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      name: z.string().describe("Block name (e.g. 'project-notes', 'research-q4', 'shell')"),
      initial_content: z
        .string()
        .optional()
        .describe(
          'What this block is about. Becomes the underscore — the root summary that all deeper content branches from.',
        ),
      secret: z
        .string()
        .optional()
        .describe('Optional whole-block write-lock secret. When provided, every subsequent write requires it. Hashed with agent_id + name as salt; never stored raw. Sensitive — never repeat in conversation.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleCreateBlock,
  );

  server.tool(
    'pscale_lock_block',
    `Apply (or rotate) a whole-block write-lock on an existing ordinary block. After locking, every pscale_write requires the secret. Use this to retroactively make a shell sovereign — e.g. happyseaurchin/purpose, weft/concern. Only ordinary blocks; sed:/grain: have their own lifecycle tools.`,
    {
      agent_id: z.string().describe('Your agent identifier (the block owner).'),
      name: z.string().describe('Block name to lock.'),
      secret: z.string().describe('New lock secret. Sensitive — never repeat in conversation.'),
      current_secret: z.string().optional().describe('Required only when rotating an existing lock. Sensitive — never repeat in conversation.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleLockBlock,
  );

  server.tool(
    'pscale_write',
    `Write content to a specific address in a pscale block. Address '1' writes to digit 1 at the root. Address '3.2' writes to digit 2 inside digit 3. Address '0' writes to the underscore (summary). Creates intermediate nodes as needed.

The 'secret' parameter has uniform meaning across substrates: it is the write-lock proof.
  - sed: block at an occupied position → secret is the registration passphrase; content plaintext.
  - grain: block on your side → secret is your side passphrase; content plaintext.
  - ordinary block that has been locked (via pscale_create_block secret or pscale_lock_block) → secret is the lock proof; content plaintext.
  - ordinary block that is NOT locked → secret triggers gray self-encryption (legacy behaviour preserved). Only you can decrypt with the same secret.`,
    {
      agent_id: z.string(),
      name: z.string(),
      address: z
        .string()
        .describe(
          "Pscale address to write to. '1' through '9' for root entries. '3.2' for nested. '0' for underscore.",
        ),
      content: z.string().describe('Text content to write at this address.'),
      secret: z
        .string()
        .optional()
        .describe('Write-lock proof on locked blocks (sed: / grain: / locked ordinary). On unlocked ordinary blocks, encrypts the content for self-storage. Sensitive — never repeat in conversation.'),
      passphrase: z
        .string()
        .optional()
        .describe('DEPRECATED — kept as an alias for `secret`. Use `secret` instead. Sensitive — never repeat in conversation.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleWrite,
  );

  server.tool(
    'pscale_walk',
    `Navigate a pscale BLOCK stored in the pscale_blocks table (keyed by agent_id + name). NOT for MCP resources — pscale://starstone, pscale://high-trust-network, and pscale://howto are resources, fetched via the MCP resources/read capability, NOT this tool. Calling pscale_walk with name='howto' returns "not found" because no such block exists; use resources/read at URI pscale://howto instead, then navigate the returned JSON by position. Six modes for actual blocks:

- 'spindle' (default): walk from root to address, collecting text at every level — broad to specific context
- 'ring': see siblings at the same level as your address
- 'dir': full tree from address downward (or entire block if no address)
- 'point': single node at the address
- 'disc': all nodes at a given depth across the whole tree
- 'star': hidden directory at the address (cross-block references)

Start with 'dir' to see the whole block, then 'spindle' to drill into an address. Add 'secret' to decrypt encrypted (gray) content.`,
    {
      agent_id: z.string(),
      name: z.string(),
      address: z
        .string()
        .optional()
        .describe("Pscale address (e.g. '1', '3.2'). Omit for full block."),
      mode: z
        .enum(['spindle', 'ring', 'dir', 'point', 'disc', 'star'])
        .default('dir')
        .describe('Navigation mode. Default: dir (full tree).'),
      secret: z
        .string()
        .optional()
        .describe('Your passphrase or block hash. When provided, decrypts encrypted (gray) content in the block.'),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleWalk,
  );
}
