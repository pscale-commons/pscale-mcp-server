/**
 * Smoke test for the pool identity-lock gate (step 1 of Thornkeep test prep).
 *
 * Verifies:
 *   1. Unlocked passport → pool_send + pool_join open (current behaviour preserved).
 *   2. Locked passport, no secret → pool_send rejected.
 *   3. Locked passport, wrong secret → pool_send rejected.
 *   4. Locked passport, correct secret → pool_send accepted.
 *   5. Locked passport, no secret → pool_join rejected.
 *   6. Locked passport, correct secret → pool_join accepted.
 *   7. pool_read remains unrestricted (no identity gate on read).
 *   8. Cleanup.
 */

import { handleCreateBlock, handleLockBlock } from '../src/tools/block-ops.js';
import { handlePoolJoin, handlePoolSend, handlePoolRead } from '../src/tools/pool-ops.js';
import { handlePassportPublish } from '../src/tools/identity-ops.js';
import { getClient } from '../src/db.js';

const STAMP = Date.now();
const AGENT_UNLOCKED = `pool-lock-test-open-${STAMP}`;
const AGENT_LOCKED = `pool-lock-test-locked-${STAMP}`;
const TEST_URL = `https://example.invalid/pool-lock-test-${STAMP}`;
const SECRET = 'forest-stone-river';
const WRONG_SECRET = 'wrong-secret';

let pass = 0, fail = 0;

function assert(cond: boolean, label: string) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else      { console.log(`  ✗ ${label}`); fail++; }
}
function textOf(r: any): string { return r?.content?.[0]?.text ?? ''; }
function jsonOf(r: any): any { try { return JSON.parse(textOf(r)); } catch { return {}; } }

async function main() {
  console.log(`\n=== pool identity-lock gate ===\n`);

  // Setup: publish a passport for both agents (unlocked).
  await handlePassportPublish({
    agent_id: AGENT_UNLOCKED,
    description: 'unlocked test agent',
    offers: 'nothing',
    needs: 'nothing',
  });
  await handlePassportPublish({
    agent_id: AGENT_LOCKED,
    description: 'locked test agent',
    offers: 'nothing',
    needs: 'nothing',
  });
  console.log(`  setup: passports published for ${AGENT_UNLOCKED} and ${AGENT_LOCKED}`);

  // [1] Unlocked passport → no gate
  console.log('\n[1] Unlocked passport: pool_send + pool_join open');
  const j1 = await handlePoolJoin({ agent_id: AGENT_UNLOCKED, url: TEST_URL, purpose: 'unlocked test' });
  assert(jsonOf(j1).pool_id, 'pool_join with unlocked passport, no secret → succeeds');
  const s1 = await handlePoolSend({ agent_id: AGENT_UNLOCKED, url: TEST_URL, content: 'open-send-1' });
  assert(jsonOf(s1).contributed === true, 'pool_send with unlocked passport, no secret → succeeds');

  // Lock AGENT_LOCKED's passport.
  const lock = await handleLockBlock({ agent_id: AGENT_LOCKED, name: 'passport', secret: SECRET });
  assert(textOf(lock).includes('write-locked'), `lock applied to ${AGENT_LOCKED}/passport`);

  // [2] Locked passport, no secret → reject
  console.log('\n[2] Locked passport, no secret');
  const s2 = await handlePoolSend({ agent_id: AGENT_LOCKED, url: TEST_URL, content: 'should-fail' });
  const e2 = jsonOf(s2);
  assert(!!e2.error && /locked passport|Provide secret/i.test(e2.error), `pool_send rejected: ${e2.error}`);

  // [3] Locked passport, wrong secret → reject
  console.log('\n[3] Locked passport, wrong secret');
  const s3 = await handlePoolSend({ agent_id: AGENT_LOCKED, url: TEST_URL, content: 'should-also-fail', secret: WRONG_SECRET });
  const e3 = jsonOf(s3);
  assert(!!e3.error && /Identity check failed|incorrect/i.test(e3.error), `pool_send rejected: ${e3.error}`);

  // [4] Locked passport, correct secret → accept
  console.log('\n[4] Locked passport, correct secret');
  const s4 = await handlePoolSend({ agent_id: AGENT_LOCKED, url: TEST_URL, content: 'should-succeed', secret: SECRET });
  assert(jsonOf(s4).contributed === true, `pool_send accepted with correct secret`);

  // [5] Locked passport, pool_join no secret → reject
  // Use a different URL so we test the join path cleanly.
  const TEST_URL_2 = TEST_URL + '-second';
  console.log('\n[5] Locked passport, pool_join no secret');
  const j5 = await handlePoolJoin({ agent_id: AGENT_LOCKED, url: TEST_URL_2 });
  const e5 = jsonOf(j5);
  assert(!!e5.error && /locked passport|Provide secret/i.test(e5.error), `pool_join rejected: ${e5.error}`);

  // [6] Locked passport, pool_join with correct secret → accept
  console.log('\n[6] Locked passport, pool_join with correct secret');
  const j6 = await handlePoolJoin({ agent_id: AGENT_LOCKED, url: TEST_URL_2, secret: SECRET, purpose: 'locked test ok' });
  assert(jsonOf(j6).pool_id, `pool_join accepted with correct secret`);

  // [7] pool_read is unrestricted regardless of lock
  console.log('\n[7] pool_read is unrestricted');
  const r7a = await handlePoolRead({ agent_id: AGENT_LOCKED, url: TEST_URL });
  assert(jsonOf(r7a).pool_id, 'pool_read with locked agent, no secret → succeeds');
  const r7b = await handlePoolRead({ agent_id: 'random-bystander-no-passport', url: TEST_URL });
  assert(jsonOf(r7b).pool_id, 'pool_read by random bystander → succeeds');

  // [8] Cleanup
  console.log('\n[8] Cleanup');
  const client = getClient();
  await client.from('pscale_blocks').delete().in('owner_id', [AGENT_UNLOCKED, AGENT_LOCKED]);
  await client.from('pool_contributions').delete().in('agent_id', [AGENT_UNLOCKED, AGENT_LOCKED, 'random-bystander-no-passport']);
  await client.from('pool_read_markers').delete().in('agent_id', [AGENT_UNLOCKED, AGENT_LOCKED, 'random-bystander-no-passport']);
  // Pool state lingers but is harmless (TTL'd test URLs).
  console.log(`  • cleaned blocks + contributions for ${AGENT_UNLOCKED}, ${AGENT_LOCKED}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
