import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getBlock, upsertBlock, getPassportBlock, getPublicKeys } from '../db.js';
import { deriveKeypair, formatPublicKeys, keysMatch } from '../crypto.js';
import { writeAt, type Block } from '../bsp.js';

// ── Handler ──

export async function handleKeyPublish(
  { agent_id, secret }: { agent_id: string; secret: string },
) {
  // 1. Derive keypair
  const keys = await deriveKeypair(secret, agent_id);
  const pubKeys = formatPublicKeys(keys);

  // 2. Check passport exists (in pscale_blocks)
  const row = await getBlock(agent_id, 'passport');
  if (!row) {
    return {
      content: [{
        type: 'text' as const,
        text: 'No passport found. Run pscale_passport_publish first.',
      }],
    };
  }

  // 3. If keys already published (at address 9), verify match
  const existingKeys = await getPublicKeys(agent_id);
  if (existingKeys) {
    if (keysMatch(existingKeys, pubKeys)) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'keys_verified',
            agent_id,
            match: true,
            note: 'Your secret derives the same keypair. Ready to send and open grays.',
          }, null, 2),
        }],
      };
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'error',
            message: 'Keys already published with a different secret. Key rotation not yet supported.',
          }, null, 2),
        }],
      };
    }
  }

  // 4. Write public keys to passport block at address 9
  const block = row.block as Block;
  writeAt(block, '9', pubKeys as any);
  await upsertBlock(agent_id, 'passport', row.block_type, block);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        status: 'keys_published',
        agent_id,
        public_keys: pubKeys,
        note: 'Your secret was used to derive these keys and has been discarded. Use the same secret when sending or opening grays.',
      }, null, 2),
    }],
  };
}

// ── Registration ──

export function registerCryptoOps(server: McpServer) {
  server.tool(
    'pscale_key_publish',
    `Derive a cryptographic keypair from your secret and publish the public half to your passport. The private half is never stored — it is re-derived when needed. Use a passphrase (HITL) or local block content hash (NHITL). Same secret always produces the same keys. Run once to publish, run again with the same secret to verify.`,
    {
      agent_id: z.string().describe('Your agent identifier. Must match an existing passport. Also used as derivation salt.'),
      secret: z.string().describe('Your passphrase (HITL) or local block hash (NHITL). Combined with agent_id to derive the keypair. Never stored. Never logged.'),
    },
    handleKeyPublish,
  );
}
