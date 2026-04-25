import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bsp, writeAt, fmtResult, fmtDir, type Block, type BspResult } from '../bsp.js';
import { getBlock, upsertBlock, listBlocks, setTarget } from '../db.js';
import { selfEncrypt, decryptBlockNodes } from '../crypto.js';
import { verifySedWrite } from './collective-ops.js';

const TARGET_DESC = 'Storage target. Filesystem path for local storage, or "supabase" for the relay. Sticky — once set, persists for the session until changed.';

// ── Exported handler functions (used by kernel + legacy registration) ──

export async function handleCreateBlock(
  { agent_id, name, initial_content, block_type, target }: {
    agent_id: string; name: string; initial_content?: string; block_type?: string; target?: string;
  },
) {
  if (target) setTarget(target);
  const existing = await getBlock(agent_id, name);
  if (existing) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Block "${name}" already exists for ${agent_id}. Use pscale_write to modify it, or pscale_walk to navigate it.`,
        },
      ],
    };
  }

  const block: Block = { _: initial_content || '' };
  await upsertBlock(agent_id, name, block_type || 'general', block);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ created: true, name, block }, null, 2),
      },
    ],
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

  // Encryption seed. On sed: blocks, `secret` is consumed as the lock proof
  // and content stays plaintext (conventions / shared declarations need to
  // be readable by all). On ordinary blocks, `secret` continues to mean
  // "encrypt this self-write" as it always has.
  const encryptionSeed = isSedBlock ? undefined : secret;

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
    `Create a new pscale block — a structured JSON tree that compacts gracefully over time. The block starts with an underscore (the summary/spine) and numbered entries branch from it. Use for project context, research, or any information you want to navigate later.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      name: z.string().describe("Block name (e.g. 'project-notes', 'research-q4')"),
      initial_content: z
        .string()
        .optional()
        .describe(
          'What this block is about. Becomes the underscore — the root summary that all deeper content branches from.',
        ),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handleCreateBlock,
  );

  server.tool(
    'pscale_write',
    `Write content to a specific address in a pscale block. Address '1' writes to digit 1 at the root. Address '3.2' writes to digit 2 inside digit 3. Address '0' writes to the underscore (summary). Creates intermediate nodes as needed. For sedimentary (sed:) blocks, 'secret' is required at occupied positions and acts as the registration-passphrase write-lock proof. The same 'secret' also enables gray (encrypted) self-storage — only you can decrypt it back.`,
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
        .describe('On sed: blocks: the registration passphrase that proves ownership of the position you are writing to (or any sub-address under it). Content stays plaintext — sed: data is shared. On ordinary blocks: encrypts the content for self-storage (only you can decrypt with the same secret). Sensitive — never repeat in conversation.'),
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
