/**
 * Smoke test for ordinary-block write-lock.
 *
 * Verifies:
 *   1. Create unlocked block → write without secret succeeds.
 *   2. Create locked block → write without secret rejected.
 *   3. Locked block → write with wrong secret rejected.
 *   4. Locked block → write with correct secret succeeds, content plaintext.
 *   5. pscale_lock_block on existing unlocked → subsequent write needs secret.
 *   6. pscale_lock_block rotation: requires current_secret.
 *   7. Reads remain public regardless of lock state.
 *   8. Cleanup.
 */

import { handleCreateBlock, handleWrite, handleWalk, handleLockBlock } from '../src/tools/block-ops.js';
import { getClient } from '../src/db.js';

const AGENT = `lock-test-${Date.now()}`;
const NAME_UNLOCKED = 'unlocked-shell';
const NAME_LOCKED = 'locked-shell';
const NAME_LATER = 'later-locked-shell';
const SECRET = 'forest-stone-river';
const WRONG_SECRET = 'wrong-secret';
const NEW_SECRET = 'new-secret-for-rotation';

let pass = 0;
let fail = 0;

function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}`);
    fail++;
  }
}

function textOf(result: any): string {
  return result?.content?.[0]?.text ?? '';
}

async function main() {
  console.log(`Test agent: ${AGENT}`);

  // 1. Unlocked block: write without secret succeeds.
  console.log('\n[1] Unlocked block — writes accepted without secret');
  await handleCreateBlock({ agent_id: AGENT, name: NAME_UNLOCKED, initial_content: 'unlocked' });
  const w1 = await handleWrite({ agent_id: AGENT, name: NAME_UNLOCKED, address: '1', content: 'plain content' });
  assert(textOf(w1).startsWith('Written'), 'unlocked write succeeds without secret');

  // 2. Locked block: write without secret rejected.
  console.log('\n[2] Locked block — writes rejected without secret');
  const c2 = await handleCreateBlock({ agent_id: AGENT, name: NAME_LOCKED, initial_content: 'sovereign', secret: SECRET });
  assert(textOf(c2).includes('locked'), 'create reports locked state');
  const w2 = await handleWrite({ agent_id: AGENT, name: NAME_LOCKED, address: '1', content: 'attempt' });
  assert(textOf(w2).includes('write-locked'), 'no-secret write rejected');

  // 3. Locked block: wrong secret rejected.
  console.log('\n[3] Locked block — wrong secret rejected');
  const w3 = await handleWrite({ agent_id: AGENT, name: NAME_LOCKED, address: '1', content: 'attempt', secret: WRONG_SECRET });
  assert(textOf(w3).includes('incorrect'), 'wrong-secret write rejected');

  // 4. Locked block: correct secret succeeds, content stored plaintext.
  console.log('\n[4] Locked block — correct secret writes plaintext');
  const w4 = await handleWrite({ agent_id: AGENT, name: NAME_LOCKED, address: '1', content: 'authorised', secret: SECRET });
  assert(textOf(w4).startsWith('Written'), 'correct-secret write succeeds');
  // Read raw block to confirm plaintext (no _gray wrapper).
  const { data: lockedRow } = await getClient()
    .from('pscale_blocks')
    .select('block, position_hashes')
    .eq('owner_id', AGENT)
    .eq('name', NAME_LOCKED)
    .single();
  const lockedBlock = lockedRow!.block as any;
  assert(lockedBlock['1'] === 'authorised', 'content stored plaintext (no encryption on locked block)');
  assert(!!lockedRow!.position_hashes['_'], 'position_hashes carries the lock');

  // Public read works regardless of lock.
  console.log('\n[7] Reads remain public (lock is write-only)');
  const r = await handleWalk({ agent_id: AGENT, name: NAME_LOCKED });
  assert(textOf(r).includes('authorised'), 'public read returns plaintext content');

  // 5. pscale_lock_block on existing unlocked block.
  console.log('\n[5] Lock an existing unlocked block, subsequent writes need secret');
  await handleCreateBlock({ agent_id: AGENT, name: NAME_LATER, initial_content: 'will be locked' });
  const l5 = await handleLockBlock({ agent_id: AGENT, name: NAME_LATER, secret: SECRET });
  assert(textOf(l5).includes('write-locked'), 'lock applied after creation');
  const w5 = await handleWrite({ agent_id: AGENT, name: NAME_LATER, address: '1', content: 'no secret' });
  assert(textOf(w5).includes('write-locked'), 'unsecreted write rejected after retro-lock');
  const w5b = await handleWrite({ agent_id: AGENT, name: NAME_LATER, address: '1', content: 'with secret', secret: SECRET });
  assert(textOf(w5b).startsWith('Written'), 'secreted write succeeds after retro-lock');

  // 6. Lock rotation: requires current_secret.
  console.log('\n[6] Lock rotation requires current_secret');
  const r6a = await handleLockBlock({ agent_id: AGENT, name: NAME_LATER, secret: NEW_SECRET });
  assert(textOf(r6a).includes('already locked'), 'rotation without current_secret rejected');
  const r6b = await handleLockBlock({ agent_id: AGENT, name: NAME_LATER, secret: NEW_SECRET, current_secret: WRONG_SECRET });
  assert(textOf(r6b).includes('incorrect'), 'rotation with wrong current_secret rejected');
  const r6c = await handleLockBlock({ agent_id: AGENT, name: NAME_LATER, secret: NEW_SECRET, current_secret: SECRET });
  assert(textOf(r6c).includes('rotated'), 'rotation with correct current_secret succeeds');
  const w6old = await handleWrite({ agent_id: AGENT, name: NAME_LATER, address: '2', content: 'old', secret: SECRET });
  assert(textOf(w6old).includes('incorrect'), 'old secret no longer works after rotation');
  const w6new = await handleWrite({ agent_id: AGENT, name: NAME_LATER, address: '2', content: 'new', secret: NEW_SECRET });
  assert(textOf(w6new).startsWith('Written'), 'new secret works after rotation');

  // 8. Cleanup.
  console.log('\n[8] Cleanup');
  await getClient().from('pscale_blocks').delete().eq('owner_id', AGENT);
  console.log('  • removed all blocks for', AGENT);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
