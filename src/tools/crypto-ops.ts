import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getBlock, upsertBlock, getPublicKeys } from '../db.js';
import {
  deriveKeypair,
  formatPublicKeys,
  keysMatch,
  signKeyRotation,
  verifyKeyRotation,
} from '../crypto.js';
import { writeAt, type Block } from '../bsp.js';

// ── Handler ──

export async function handleKeyPublish(
  { agent_id, secret, prior_secret, signature }: {
    agent_id: string;
    secret: string;
    prior_secret?: string;
    signature?: string;
  },
) {
  // 1. Derive new keypair from the (current) secret.
  const newKeys = await deriveKeypair(secret, agent_id);
  const newPubKeys = formatPublicKeys(newKeys);

  // 2. Passport must exist before keys can land at position 9.
  const row = await getBlock(agent_id, 'passport');
  if (!row) {
    return {
      content: [{
        type: 'text' as const,
        text: 'No passport found. Run pscale_passport_publish first.',
      }],
    };
  }

  // 3. Decide which path applies: first publish / idempotent re-publish / rotation.
  const existingKeys = await getPublicKeys(agent_id);

  if (existingKeys && keysMatch(existingKeys, newPubKeys)) {
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
  }

  // 4. Rotation gate — required when overwriting a different key.
  //    Caller must prove possession of the PRIOR Ed25519 private key by either:
  //      (a) supplying prior_secret (server derives + signs), or
  //      (b) supplying a precomputed signature over the canonical rotation message.
  //    First publish (existingKeys === null) is unauthenticated by design — anyone
  //    can claim an unclaimed slot. Subsequent rotations require proof.
  if (existingKeys) {
    let validProof = false;
    let proofError: string | undefined;

    if (prior_secret) {
      // Derive prior keypair, confirm it matches the stored Ed25519 pubkey,
      // then sign + verify (server-side round-trip — equivalent to verifying
      // an externally-supplied signature, but more ergonomic for HITL callers).
      const priorKeys = await deriveKeypair(prior_secret, agent_id);
      const priorPubKeys = formatPublicKeys(priorKeys);
      if (priorPubKeys.ed25519 !== existingKeys.ed25519) {
        proofError = 'prior_secret does not derive the currently published Ed25519 key. Rotation rejected.';
      } else {
        const sig = signKeyRotation(agent_id, newPubKeys, priorKeys.ed25519.secretKey);
        validProof = verifyKeyRotation(agent_id, newPubKeys, sig, existingKeys.ed25519);
      }
    } else if (signature) {
      validProof = verifyKeyRotation(agent_id, newPubKeys, signature, existingKeys.ed25519);
      if (!validProof) {
        proofError = 'Signature did not verify against the currently published Ed25519 key. Rotation rejected.';
      }
    } else {
      proofError =
        'Key rotation requires proof of prior key ownership. Pass prior_secret (the previous passphrase) ' +
        'or signature (Ed25519 sig of "pscale_key_rotation:{agent_id}:{new_x25519_b64}:{new_ed25519_b64}" ' +
        'made with the prior secret key, base64-encoded).';
    }

    if (!validProof) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: 'error', message: proofError }, null, 2),
        }],
      };
    }
  }

  // 5. Authorised — write the new public keys to passport position 9.
  const block = row.block as Block;
  writeAt(block, '9', newPubKeys as any);
  await upsertBlock(agent_id, 'passport', row.block_type, block);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        status: existingKeys ? 'keys_rotated' : 'keys_published',
        agent_id,
        public_keys: newPubKeys,
        note: existingKeys
          ? 'Prior key proof verified; passport position 9 updated to the new public keys.'
          : 'Your secret was used to derive these keys and has been discarded. Use the same secret when sending or opening grays.',
      }, null, 2),
    }],
  };
}

// ── Registration ──

export function registerCryptoOps(server: McpServer) {
  server.tool(
    'pscale_key_publish',
    `Derive a cryptographic keypair from your secret and publish the public half to your passport (position 9). The private half is never stored — it is re-derived when needed. Use a passphrase (HITL) or local block content hash (NHITL). Same secret always produces the same keys. Run once to publish, run again with the same secret to verify.

Key rotation: passport position 9 is the gate that protects gray-encrypted traffic — anyone who overwrites it intercepts encrypted inbound until the legitimate owner re-publishes. To rotate, supply BOTH 'secret' (the new passphrase) AND either 'prior_secret' (the previous passphrase — server signs internally) or 'signature' (Ed25519 base64 over "pscale_key_rotation:{agent_id}:{new_x25519_b64}:{new_ed25519_b64}", made with the prior secret key). First publish is unauthenticated; rotation requires proof of prior key ownership.`,
    {
      agent_id: z.string().describe('Your agent identifier. Must match an existing passport. Also used as derivation salt.'),
      secret: z.string().describe('Your passphrase (HITL) or local block hash (NHITL). Combined with agent_id to derive the keypair. Never stored. Never logged.'),
      prior_secret: z.string().optional().describe('Only for rotation: your previous passphrase. Server derives the prior keypair and signs the rotation message internally. Equivalent to passing a precomputed signature, but ergonomic. Never stored. Never logged.'),
      signature: z.string().optional().describe('Only for rotation: precomputed base64 Ed25519 signature over "pscale_key_rotation:{agent_id}:{new_x25519_b64}:{new_ed25519_b64}", made with the prior secret key. Use this when you do not want to send the prior secret to the server.'),
    },
    handleKeyPublish,
  );
}
