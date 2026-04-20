/**
 * One-off smoke test for pscale_grain_reach.
 * Runs the handler directly against whichever Supabase SUPABASE_ANON_KEY
 * points at (production by default). Creates a grain between two throwaway
 * agent_ids, accepts it from the partner side, and walks the resulting block.
 *
 * Cleanup is manual for now: delete the two rows from pscale_blocks + the
 * two inbox messages if you want a tidy DB.
 */

import { handleGrainReach, pairId } from '../src/tools/grain-ops.js';
import { getBlock } from '../src/db.js';

const A = 'grain-test-alpha';
const B = 'grain-test-beta';
const PA = 'test-alpha-20260420';
const PB = 'test-beta-20260420';

async function main() {
  const pid = pairId(A, B);
  console.log(`pair_id: ${pid}`);
  console.log(`grain owner_id: grain:${pid}\n`);

  console.log('══ STEP 1: REACH (alpha → beta) ══');
  const r1 = await handleGrainReach({
    agent_id: A,
    partner_agent_id: B,
    description: 'smoke test of grain substrate — 2026-04-20',
    my_side_content: "alpha's opening: testing the new grain_reach tool; expecting lex-smaller side to be 1.",
    my_passphrase: PA,
  });
  console.log(r1.content[0].text);

  console.log('\n══ STEP 2: ACCEPT (beta → alpha) ══');
  const r2 = await handleGrainReach({
    agent_id: B,
    partner_agent_id: A,
    description: '(description ignored on accept)',
    my_side_content: "beta's response: received the reach, accepting; completing the grain.",
    my_passphrase: PB,
  });
  console.log(r2.content[0].text);

  console.log('\n══ STEP 3: VERIFY by direct block read ══');
  const row = await getBlock(`grain:${pid}`, 'grain');
  if (!row) {
    console.log('UNEXPECTED: block not found after accept.');
    process.exit(1);
  }
  console.log('block:');
  console.log(JSON.stringify(row.block, null, 2));
  console.log('\nposition_hashes (sides, hashes truncated to 12 chars for display):');
  const hashes = row.position_hashes || {};
  for (const [side, hash] of Object.entries(hashes)) {
    console.log(`  ${side}: ${String(hash).slice(0, 12)}…`);
  }

  console.log('\n══ STEP 4: REACH IDEMPOTENCY CHECK (alpha tries to reach again) ══');
  const r3 = await handleGrainReach({
    agent_id: A,
    partner_agent_id: B,
    description: 'should fail',
    my_side_content: 'should not appear',
    my_passphrase: PA,
  });
  console.log(r3.content[0].text);

  console.log('\nDone. Grain block persists at grain:' + pid + '/grain in Supabase.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
