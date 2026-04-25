#!/usr/bin/env tsx
/**
 * **OBSOLETE as of 2026-04-25 GRIT decoupling**: tests the server-side round
 * engine that was stripped from pool-ops.ts. Kept as a historical record of
 * the GRIT semantics; will fail against the current substrate. When GRIT is
 * rebuilt as a convention layer, replace this with a test of that.
 *
 * Smoke test for the GRIT round engine.
 *
 * Scenario:
 *   1. Create a fresh test pool with 3s round duration
 *   2. Player A joins, posts liquid  → round opens
 *   3. Player B posts liquid          → attaches to same round
 *   4. Wait > 3s                       → round should be closable
 *   5. Player C (non-contributor) reads → triggers close, dispatches
 *      resolution_request to non-contributors (A's join marker too; filter)
 *   6. Player C posts event resolving the round → contributors A, B notified
 *   7. Attempt second event for same round → rejected as already_resolved
 *   8. Player A attempts to resolve their own round → rejected as self-resolution
 *   9. Liquid arrives → new round opens with fresh round_id
 *
 * Cleans up test pool at the end.
 *
 * Usage:
 *   SUPABASE_ANON_KEY=... npx tsx scripts/test-grit-round-engine.ts
 */

import {
  handlePoolJoin, handlePoolSend, handlePoolRead,
} from '../src/tools/pool-ops.js';
import { getClient } from '../src/db.js';
import { createHash } from 'node:crypto';

const TEST_URL = `https://grit-test.example/round-engine-${Date.now()}`;
const ROUND_SECONDS = 3;
const A = 'grit-test-alpha';
const B = 'grit-test-beta';
const C = 'grit-test-gamma';  // the resolver

function parse(r: any) {
  return JSON.parse(r.content[0].text);
}

async function main() {
  console.log(`\n=== GRIT round engine smoke test ===`);
  console.log(`URL: ${TEST_URL}`);
  console.log(`Round duration: ${ROUND_SECONDS}s\n`);

  // 1. Create pool
  console.log('1. A creates pool...');
  const join1 = parse(await handlePoolJoin({
    agent_id: A, url: TEST_URL,
    synthesis_hint: 'Test pool. Resolvers: synthesize liquid into a single event sentence.',
    round_duration_seconds: ROUND_SECONDS,
  }));
  console.log(`   created=${join1.created} pool_id=${join1.pool_id} round_duration_seconds=${join1.round_duration_seconds}`);
  if (!join1.created) throw new Error('expected fresh pool creation');

  // B and C also join (so they have read_markers — eligible for dispatch)
  console.log('2. B joins...');
  await handlePoolJoin({ agent_id: B, url: TEST_URL });
  console.log('3. C joins (will be our resolver)...');
  await handlePoolJoin({ agent_id: C, url: TEST_URL });

  // A posts liquid — opens a round
  console.log('4. A posts liquid → opens a round...');
  const send1 = parse(await handlePoolSend({
    agent_id: A, url: TEST_URL,
    content: 'A walks to the well.',
  }));
  console.log(`   round_id=${send1.round_id} round_state=${send1.round_state}`);
  if (send1.round_state !== 'OPEN') throw new Error(`expected OPEN, got ${send1.round_state}`);
  const firstRoundId = send1.round_id;

  // B posts liquid — same round
  console.log('5. B posts liquid → attaches to same round...');
  const send2 = parse(await handlePoolSend({
    agent_id: B, url: TEST_URL,
    content: 'B watches from the doorway.',
  }));
  if (send2.round_id !== firstRoundId) {
    throw new Error(`expected round_id=${firstRoundId}, got ${send2.round_id}`);
  }
  console.log(`   ✓ same round_id`);

  // Wait for round to elapse
  console.log(`6. Sleeping ${ROUND_SECONDS + 1}s for round to elapse...`);
  await new Promise(r => setTimeout(r, (ROUND_SECONDS + 1) * 1000));

  // C reads → triggers lazy close + dispatch
  console.log('7. C reads → triggers round close + dispatch...');
  const read1 = parse(await handlePoolRead({ agent_id: C, url: TEST_URL }));
  console.log(`   current_round_state=${read1.current_round_state} (expect null = QUIET)`);
  if (read1.current_round_state !== null) {
    throw new Error(`expected null (QUIET) after close, got ${read1.current_round_state}`);
  }

  // Check inbox for C — should have a resolution_request
  console.log('8. Checking C inbox for resolution_request...');
  const client = getClient();
  const { data: inbox } = await client
    .from('sand_inbox')
    .select('*')
    .eq('to_agent', C)
    .order('created_at', { ascending: false })
    .limit(5);
  const rr = (inbox || []).find((m: any) => m.message?.type === 'resolution_request');
  if (!rr) {
    console.log('   inbox:', JSON.stringify(inbox, null, 2));
    throw new Error('C did not receive a resolution_request');
  }
  const rrPayload = JSON.parse(rr.message.content);
  console.log(`   ✓ received resolution_request for round ${rrPayload.round_id} with ${rrPayload.window_liquid.length} liquid entries`);

  // Self-resolution attempt: A tries to resolve its own round → should be rejected
  console.log('9. A attempts self-resolution → should be rejected...');
  const selfResolve = parse(await handlePoolSend({
    agent_id: A, url: TEST_URL,
    message_type: 'event',
    resolves_round_id: firstRoundId,
    content: 'A resolves own round (should fail).',
  }));
  if (!selfResolve.error || !selfResolve.error.includes('self-resolution')) {
    throw new Error(`expected self-resolution rejection, got: ${JSON.stringify(selfResolve)}`);
  }
  console.log(`   ✓ rejected: ${selfResolve.error}`);

  // C resolves the round
  console.log('10. C resolves the round...');
  const resolve = parse(await handlePoolSend({
    agent_id: C, url: TEST_URL,
    message_type: 'event',
    resolves_round_id: firstRoundId,
    content: 'A reaches the well; B continues to watch. Nothing breaks.',
  }));
  if (!resolve.confirmed) throw new Error(`expected confirmed, got: ${JSON.stringify(resolve)}`);
  console.log(`   ✓ confirmed; contributors_notified=${JSON.stringify(resolve.contributors_notified)}`);

  // Second event for same round → rejected
  console.log('11. Second event for same round → should be rejected...');
  const secondResolve = parse(await handlePoolSend({
    agent_id: C, url: TEST_URL,
    message_type: 'event',
    resolves_round_id: firstRoundId,
    content: 'attempting double-resolve',
  }));
  if (!secondResolve.error || !secondResolve.error.includes('already resolved')) {
    throw new Error(`expected already-resolved rejection, got: ${JSON.stringify(secondResolve)}`);
  }
  console.log(`   ✓ rejected: ${secondResolve.error}`);

  // Check A's inbox for resolution_confirmed
  console.log('12. Checking A inbox for resolution_confirmed...');
  const { data: aInbox } = await client
    .from('sand_inbox')
    .select('*')
    .eq('to_agent', A)
    .order('created_at', { ascending: false })
    .limit(5);
  const rc = (aInbox || []).find((m: any) => m.message?.type === 'resolution_confirmed');
  if (!rc) {
    console.log('   inbox:', JSON.stringify(aInbox, null, 2));
    throw new Error('A did not receive a resolution_confirmed');
  }
  const rcPayload = JSON.parse(rc.message.content);
  console.log(`   ✓ A got event: "${rcPayload.synthesis_text}"`);

  // New liquid → new round
  console.log('13. A posts new liquid → should open a fresh round...');
  const send3 = parse(await handlePoolSend({
    agent_id: A, url: TEST_URL,
    content: 'A picks up water.',
  }));
  if (send3.round_id === firstRoundId) {
    throw new Error(`expected fresh round_id, still got ${firstRoundId}`);
  }
  console.log(`   ✓ new round_id=${send3.round_id}`);

  // Cleanup
  console.log('\n14. Cleaning up test pool...');
  const { data: pools } = await client
    .from('pool_state')
    .select('pool_id')
    .eq('url_hash', createHash('sha256').update(TEST_URL.trim().toLowerCase()).digest('hex').slice(0, 16));
  const poolIds = (pools || []).map((p: any) => p.pool_id);
  if (poolIds.length > 0) {
    await client.from('pool_contributions').delete().in('pool_id', poolIds);
    await client.from('pool_read_markers').delete().in('pool_id', poolIds);
    await client.from('pool_state').delete().in('pool_id', poolIds);
  }
  await client.from('sand_inbox').delete().in('to_agent', [A, B, C]);
  console.log(`   ✓ cleaned ${poolIds.length} pool(s) and test inboxes`);

  console.log('\n=== ALL TESTS PASSED ===\n');
}

main().catch((e) => {
  console.error('\n✗ TEST FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
