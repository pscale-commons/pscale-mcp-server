/**
 * crypto.ts — shared crypto module for gray (encrypted) engagement.
 *
 * Deterministic key derivation: Argon2id(secret, salt=agent_id) → X25519 + Ed25519 keypairs.
 * The secret is a passphrase (HITL) or local block hash (NHITL). Never stored.
 *
 * Dependencies: tweetnacl (X25519/Ed25519/XSalsa20-Poly1305), hash-wasm (Argon2id).
 */

import nacl from 'tweetnacl';
import { argon2id } from 'hash-wasm';

// ── Types ──

export interface DerivedKeys {
  x25519: { publicKey: Uint8Array; secretKey: Uint8Array };
  ed25519: { publicKey: Uint8Array; secretKey: Uint8Array };
}

export interface EncryptedPayload {
  ciphertext: string;  // base64
  nonce: string;       // base64
  sender_x25519_public: string;  // base64 — needed for decryption
  signature: string;   // base64
  sender_ed25519_public: string; // base64 — needed for verification
}

export interface SelfEncryptedPayload {
  _gray: true;
  ciphertext: string;  // base64
  nonce: string;       // base64
}

// ── Encoding helpers ──

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// ── Key derivation ──

/**
 * Derive X25519 + Ed25519 keypairs from a secret and agent_id.
 * Argon2id: memory-hard, brute-force resistant. Same inputs → same keys.
 */
export async function deriveKeypair(secret: string, agentId: string): Promise<DerivedKeys> {
  // Salt must be at least 8 bytes for Argon2
  const saltStr = agentId.length >= 8 ? agentId : agentId.padEnd(8, '\0');

  const hash = await argon2id({
    password: secret,
    salt: saltStr,
    parallelism: 1,
    iterations: 3,
    memorySize: 65536, // 64 MB
    hashLength: 64,
    outputType: 'binary',
  });

  const seed = new Uint8Array(hash);

  // First 32 bytes → X25519 keypair
  const x25519Seed = seed.slice(0, 32);
  const x25519 = nacl.box.keyPair.fromSecretKey(x25519Seed);

  // Last 32 bytes → Ed25519 keypair
  const ed25519Seed = seed.slice(32, 64);
  const ed25519 = nacl.sign.keyPair.fromSeed(ed25519Seed);

  return { x25519, ed25519 };
}

/**
 * Format public keys as base64 strings for DB storage.
 */
export function formatPublicKeys(keys: DerivedKeys): { x25519: string; ed25519: string } {
  return {
    x25519: toBase64(keys.x25519.publicKey),
    ed25519: toBase64(keys.ed25519.publicKey),
  };
}

/**
 * Parse stored public keys from base64.
 */
export function parsePublicKeys(stored: { x25519: string; ed25519: string }): {
  x25519: Uint8Array;
  ed25519: Uint8Array;
} {
  return {
    x25519: fromBase64(stored.x25519),
    ed25519: fromBase64(stored.ed25519),
  };
}

/**
 * Check if two public key sets match.
 */
export function keysMatch(
  a: { x25519: string; ed25519: string },
  b: { x25519: string; ed25519: string },
): boolean {
  return a.x25519 === b.x25519 && a.ed25519 === b.ed25519;
}

// ── Key rotation signing (proof-of-prior-key for passport position 9) ──

/**
 * Canonical message for a key rotation. Binds the agent_id and the new
 * public keys together so the signature commits to a specific rotation.
 * Replay-safe: the only state an attacker could rewind to is one the
 * legitimate owner had previously authorised, which is recovery, not attack.
 */
export function keyRotationMessage(
  agentId: string,
  newPubKeys: { x25519: string; ed25519: string },
): Uint8Array {
  return encoder.encode(
    `pscale_key_rotation:${agentId}:${newPubKeys.x25519}:${newPubKeys.ed25519}`,
  );
}

/** Sign a key rotation with the prior Ed25519 secret key. Returns base64. */
export function signKeyRotation(
  agentId: string,
  newPubKeys: { x25519: string; ed25519: string },
  priorEd25519SecretKey: Uint8Array,
): string {
  const msg = keyRotationMessage(agentId, newPubKeys);
  const sig = nacl.sign.detached(msg, priorEd25519SecretKey);
  return toBase64(sig);
}

/** Verify a base64 rotation signature against the prior Ed25519 public key. */
export function verifyKeyRotation(
  agentId: string,
  newPubKeys: { x25519: string; ed25519: string },
  signatureBase64: string,
  priorEd25519PublicKeyBase64: string,
): boolean {
  try {
    const msg = keyRotationMessage(agentId, newPubKeys);
    const sig = fromBase64(signatureBase64);
    const pub = fromBase64(priorEd25519PublicKeyBase64);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

// ── Bilateral encryption (for inbox: sender → recipient) ──

/**
 * Encrypt plaintext for a specific recipient. Signs with sender's Ed25519 key.
 */
export function encryptForRecipient(
  plaintext: string,
  senderKeys: DerivedKeys,
  recipientX25519Public: Uint8Array,
): EncryptedPayload {
  const message = encoder.encode(plaintext);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const ciphertext = nacl.box(
    message,
    nonce,
    recipientX25519Public,
    senderKeys.x25519.secretKey,
  );

  if (!ciphertext) throw new Error('Encryption failed');

  // Sign the ciphertext for tamper detection
  const signature = nacl.sign.detached(ciphertext, senderKeys.ed25519.secretKey);

  return {
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
    sender_x25519_public: toBase64(senderKeys.x25519.publicKey),
    signature: toBase64(signature),
    sender_ed25519_public: toBase64(senderKeys.ed25519.publicKey),
  };
}

/**
 * Decrypt a message from a sender. Verifies signature first.
 * Returns null if decryption or verification fails.
 */
export function decryptFromSender(
  payload: EncryptedPayload,
  recipientKeys: DerivedKeys,
): { plaintext: string; verified: boolean } | null {
  const ciphertext = fromBase64(payload.ciphertext);
  const nonce = fromBase64(payload.nonce);
  const senderX25519Public = fromBase64(payload.sender_x25519_public);
  const senderEd25519Public = fromBase64(payload.sender_ed25519_public);
  const signature = fromBase64(payload.signature);

  // Verify signature
  const verified = nacl.sign.detached.verify(ciphertext, signature, senderEd25519Public);

  // Decrypt
  const plaintext = nacl.box.open(
    ciphertext,
    nonce,
    senderX25519Public,
    recipientKeys.x25519.secretKey,
  );

  if (!plaintext) return null;

  return {
    plaintext: decoder.decode(plaintext),
    verified,
  };
}

// ── Self-encryption (for private blocks: owner only) ──

/**
 * Encrypt content for self-storage. Uses symmetric encryption with derived key.
 */
export async function selfEncrypt(
  plaintext: string,
  secret: string,
  agentId: string,
): Promise<SelfEncryptedPayload> {
  const keys = await deriveKeypair(secret, agentId);
  // Use the X25519 secret key as the symmetric key (first 32 bytes of derivation)
  const key = keys.x25519.secretKey;
  const message = encoder.encode(plaintext);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);

  const ciphertext = nacl.secretbox(message, nonce, key);
  if (!ciphertext) throw new Error('Self-encryption failed');

  return {
    _gray: true,
    ciphertext: toBase64(ciphertext),
    nonce: toBase64(nonce),
  };
}

/**
 * Decrypt self-encrypted content.
 * Returns null if decryption fails (wrong secret).
 */
export async function selfDecrypt(
  payload: SelfEncryptedPayload,
  secret: string,
  agentId: string,
): Promise<string | null> {
  const keys = await deriveKeypair(secret, agentId);
  const key = keys.x25519.secretKey;
  const ciphertext = fromBase64(payload.ciphertext);
  const nonce = fromBase64(payload.nonce);

  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) return null;

  return decoder.decode(plaintext);
}

// ── Block-level decryption (for walk) ──

/**
 * Recursively walk a block and decrypt any _gray nodes.
 * Returns a new object — does not mutate the original.
 */
export async function decryptBlockNodes(
  node: any,
  secret: string,
  agentId: string,
): Promise<any> {
  if (node === null || node === undefined) return node;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return node;

  if (typeof node === 'object' && node._gray === true && node.ciphertext && node.nonce) {
    const result = await selfDecrypt(node as SelfEncryptedPayload, secret, agentId);
    return result !== null ? result : '[encrypted]';
  }

  if (typeof node === 'object') {
    const result: Record<string, any> = {};
    for (const key of Object.keys(node)) {
      result[key] = await decryptBlockNodes(node[key], secret, agentId);
    }
    return result;
  }

  return node;
}
