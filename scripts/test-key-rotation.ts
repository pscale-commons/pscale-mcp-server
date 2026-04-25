/**
 * Smoke test for the key-rotation gate on pscale_key_publish (and the
 * complementary "no direct writes to passport position 9" gate on
 * pscale_write).
 *
 * Runs handlers directly against the configured Supabase. Creates a
 * throwaway agent, walks the rotation flow, then cleans up.
 *
 * Asserts:
 *   - First publish (no prior key) succeeds without any proof.
 *   - Idempotent re-publish of the SAME secret returns "keys_verified".
 *   - Rotation to a DIFFERENT secret with NO proof is rejected.
 *   - Rotation with WRONG prior_secret is rejected.
 *   - Rotation with CORRECT prior_secret succeeds and updates pubkey.
 *   - Rotation with valid externally-computed signature succeeds.
 *   - Direct pscale_write to passport position 9 is rejected.
 */

import { handleKeyPublish } from '../src/tools/crypto-ops.js';
import { handlePassportPublish } from '../src/tools/identity-ops.js';
import { handleWrite } from '../src/tools/block-ops.js';
import { deriveKeypair, formatPublicKeys, signKeyRotation } from '../src/crypto.js';
import { getPublicKeys } from '../src/db.js';
import { getClient } from '../src/db.js';

const A = `keyrot-smoke-${Date.now()}`;
const SEC1 = 'rotation-smoke-secret-one';
const SEC2 = 'rotation-smoke-secret-two';
const SEC3 = 'rotation-smoke-secret-three';

let pass = 0;
let fail = 0;

function assertContains(actual: string, expected: string, label: string) {
  if (actual.includes(expected)) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    console.log(`    expected to contain: ${expected}`);
    console.log(`    got: ${actual.slice(0, 200)}`);
    fail++;
  }
}

async function main() {
  console.log(`agent_id: ${A}\n`);

  console.log('══ SETUP — publish passport ══');
  const p = await handlePassportPublish({
    agent_id: A,
    description: 'key-rotation smoke test agent — disposable',
  });
  console.log(p.content[0].text.slice(0, 80) + '...\n');

  console.log('══ STEP 1: first publish (no prior key, no proof needed) ══');
  const r1 = await handleKeyPublish({ agent_id: A, secret: SEC1 });
  const t1 = r1.content[0].text;
  console.log(t1);
  assertContains(t1, '"keys_published"', 'first publish reports keys_published');

  console.log('\n══ STEP 2: idempotent re-publish (same secret) ══');
  const r2 = await handleKeyPublish({ agent_id: A, secret: SEC1 });
  const t2 = r2.content[0].text;
  console.log(t2);
  assertContains(t2, '"keys_verified"', 'same secret reports keys_verified');

  console.log('\n══ STEP 3: rotation attempt with NO proof — must reject ══');
  const r3 = await handleKeyPublish({ agent_id: A, secret: SEC2 });
  const t3 = r3.content[0].text;
  console.log(t3);
  assertContains(t3, 'requires proof', 'unsigned rotation rejected');
  // pubkey should still match SEC1
  const expected1 = formatPublicKeys(await deriveKeypair(SEC1, A));
  const live1 = await getPublicKeys(A);
  if (live1?.x25519 === expected1.x25519) { console.log('  ✓ stored key unchanged after rejected rotation'); pass++; }
  else { console.log('  ✗ stored key MUTATED despite rejection'); fail++; }

  console.log('\n══ STEP 4: rotation attempt with WRONG prior_secret — must reject ══');
  const r4 = await handleKeyPublish({ agent_id: A, secret: SEC2, prior_secret: 'not-the-prior-secret' });
  const t4 = r4.content[0].text;
  console.log(t4);
  assertContains(t4, 'does not derive', 'wrong prior_secret rejected');

  console.log('\n══ STEP 5: rotation with CORRECT prior_secret — must succeed ══');
  const r5 = await handleKeyPublish({ agent_id: A, secret: SEC2, prior_secret: SEC1 });
  const t5 = r5.content[0].text;
  console.log(t5);
  assertContains(t5, '"keys_rotated"', 'correct prior_secret rotates');
  const expected2 = formatPublicKeys(await deriveKeypair(SEC2, A));
  const live2 = await getPublicKeys(A);
  if (live2?.x25519 === expected2.x25519) { console.log('  ✓ stored key now matches SEC2 derivation'); pass++; }
  else { console.log('  ✗ stored key did NOT update to SEC2'); fail++; }

  console.log('\n══ STEP 6: rotation with externally-computed signature — must succeed ══');
  // Compute signature locally using the prior (SEC2) Ed25519 secret key
  const priorKeys = await deriveKeypair(SEC2, A);
  const newKeys = await deriveKeypair(SEC3, A);
  const newPub = formatPublicKeys(newKeys);
  const sig = signKeyRotation(A, newPub, priorKeys.ed25519.secretKey);
  const r6 = await handleKeyPublish({ agent_id: A, secret: SEC3, signature: sig });
  const t6 = r6.content[0].text;
  console.log(t6);
  assertContains(t6, '"keys_rotated"', 'externally-signed rotation accepted');

  console.log('\n══ STEP 7: forged signature with WRONG prior key — must reject ══');
  // Sign with SEC1's Ed25519 (which is no longer the published key)
  const stalePriorKeys = await deriveKeypair(SEC1, A);
  const fakeNewKeys = await deriveKeypair('attacker-secret', A);
  const fakePub = formatPublicKeys(fakeNewKeys);
  const fakeSig = signKeyRotation(A, fakePub, stalePriorKeys.ed25519.secretKey);
  const r7 = await handleKeyPublish({ agent_id: A, secret: 'attacker-secret', signature: fakeSig });
  const t7 = r7.content[0].text;
  console.log(t7);
  assertContains(t7, 'did not verify', 'forged signature with stale prior key rejected');

  console.log('\n══ STEP 8: direct pscale_write to passport position 9 — must reject ══');
  const r8 = await handleWrite({
    agent_id: A,
    name: 'passport',
    address: '9',
    content: 'attacker-overwrites-keys-via-write',
  });
  const t8 = r8.content[0].text;
  console.log(t8);
  assertContains(t8, 'reserved for cryptographic public keys', 'direct write to passport[9] rejected');

  console.log('\n══ STEP 9: direct pscale_write to passport position 9.x — must also reject ══');
  const r9 = await handleWrite({
    agent_id: A,
    name: 'passport',
    address: '9.1',
    content: 'sneaky-sub-position-write',
  });
  const t9 = r9.content[0].text;
  console.log(t9);
  assertContains(t9, 'reserved for cryptographic public keys', 'direct write to passport[9.1] rejected');

  // Cleanup — delete the test agent's passport
  console.log('\n══ CLEANUP ══');
  const supabase = getClient();
  const { error } = await supabase.from('pscale_blocks').delete().eq('owner_id', A);
  if (error) console.log(`  cleanup warning: ${error.message}`);
  else console.log(`  removed test rows for ${A}`);

  console.log(`\n══ RESULT: ${pass} passed, ${fail} failed ══`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
