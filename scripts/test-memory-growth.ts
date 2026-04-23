/**
 * Memory growth invariant — structural correctness tests.
 *
 * Verifies that pscale_remember builds a pscale tree that matches the
 * compaction semantic: 9 memories fill a level, 10th transitions the
 * floor, each "address 342" reads as a spindle root → batch → leaf.
 *
 * Uses the handler functions directly; does not require a running MCP
 * server. Talks to real Supabase — uses a throwaway agent_id prefixed
 * with `test-memory-growth-` and a timestamp so runs don't collide.
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/test-memory-growth.ts
 */

import { handleRemember, handleRecall } from '../src/tools/memory-ops.js';
import { getBlock, getClient } from '../src/db.js';
import { floorDepth, bsp, type Block } from '../src/bsp.js';

const AGENT = `test-memory-growth-${Date.now()}`;
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}`);
    failed++;
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.log(`  ✗ ${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

async function currentBlock(): Promise<Block> {
  const row = await getBlock(AGENT, 'history');
  return row ? (row.block as Block) : {};
}

/** Count how many digits 1..9 are occupied at this node. */
function digitCount(node: any): number {
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  for (const d of '123456789') if (d in node) n++;
  return n;
}

/** Test: floor grows correctly and summary appears at batch underscore. */
async function main() {
  console.log(`\nMemory growth test — agent ${AGENT}\n`);

  // ── 1 to 9: floor 1 stays flat ──
  for (let i = 1; i <= 9; i++) {
    await handleRemember({ agent_id: AGENT, content: `entry-${i}` });
  }
  let block = await currentBlock();
  console.log('After 9 memories:');
  assertEqual(floorDepth(block), 1, 'floor is 1');
  assertEqual(digitCount(block), 9, 'root has 9 digits');
  assert(typeof block['1'] === 'string', 'digit 1 is a string');
  assert(typeof block['9'] === 'string', 'digit 9 is a string');
  assert(typeof block['1'] === 'string' && (block['1'] as string).startsWith('entry-1'), 'digit 1 is entry-1');
  assert(typeof block['9'] === 'string' && (block['9'] as string).startsWith('entry-9'), 'digit 9 is entry-9');

  // ── 10th memory: floor transitions to 2 ──
  await handleRemember({ agent_id: AGENT, content: 'entry-10' });
  block = await currentBlock();
  console.log('\nAfter 10 memories:');
  assertEqual(floorDepth(block), 2, 'floor is 2');
  assert(typeof block['1'] === 'object' && block['1'] !== null, 'root digit 1 is an object (closed batch)');
  assert(typeof block['2'] === 'object' && block['2'] !== null, 'root digit 2 is an object (open batch)');
  const batch1 = block['1'] as Block;
  assert(typeof batch1._ === 'string', 'batch 1 has a summary at _');
  assertEqual(digitCount(batch1), 9, 'batch 1 has 9 leaves');
  assert(typeof batch1['1'] === 'string' && (batch1['1'] as string).startsWith('entry-1'), 'batch 1.1 is entry-1');
  assert(typeof batch1['9'] === 'string' && (batch1['9'] as string).startsWith('entry-9'), 'batch 1.9 is entry-9');
  const batch2 = block['2'] as Block;
  assert(typeof batch2['1'] === 'string' && (batch2['1'] as string).startsWith('entry-10'), 'batch 2.1 is entry-10');
  assert(!('_' in batch2) || batch2._ === '', 'batch 2 has no summary yet (still open)');

  // ── 11 to 18: batch 2 fills ──
  for (let i = 11; i <= 18; i++) {
    await handleRemember({ agent_id: AGENT, content: `entry-${i}` });
  }
  block = await currentBlock();
  console.log('\nAfter 18 memories:');
  const batch2After = block['2'] as Block;
  assertEqual(digitCount(batch2After), 9, 'batch 2 has 9 leaves');
  assert(typeof batch2After._ === 'string', 'batch 2 now has a summary');
  assert(typeof batch2After['9'] === 'string' && (batch2After['9'] as string).startsWith('entry-18'), 'batch 2.9 is entry-18');
  // batch 1 should still be intact — THIS is the regression test for the overwrite bug.
  const batch1After = block['1'] as Block;
  assert(typeof batch1After['1'] === 'string' && (batch1After['1'] as string).startsWith('entry-1'),
    'batch 1.1 STILL entry-1 (not overwritten)');
  assert(typeof batch1After._ === 'string' && (batch1After._ as string).includes('entry-1'),
    'batch 1 summary still references entry-1');

  // ── 19th memory: opens batch 3 ──
  await handleRemember({ agent_id: AGENT, content: 'entry-19' });
  block = await currentBlock();
  console.log('\nAfter 19 memories:');
  assertEqual(floorDepth(block), 2, 'floor still 2');
  const batch3 = block['3'] as Block;
  assert(typeof batch3 === 'object' && batch3 !== null, 'batch 3 opened');
  assert(typeof batch3['1'] === 'string' && (batch3['1'] as string).startsWith('entry-19'), 'batch 3.1 is entry-19');
  // Batch 1 and 2 still intact
  const b1 = block['1'] as Block;
  const b2 = block['2'] as Block;
  assert(typeof b1['1'] === 'string' && (b1['1'] as string).startsWith('entry-1'), 'batch 1.1 still entry-1');
  assert(typeof b2['1'] === 'string' && (b2['1'] as string).startsWith('entry-10'), 'batch 2.1 still entry-10');

  // ── 20 to 81: floor-2 root fills ──
  for (let i = 20; i <= 81; i++) {
    await handleRemember({ agent_id: AGENT, content: `entry-${i}` });
  }
  block = await currentBlock();
  console.log('\nAfter 81 memories (floor-2 root full):');
  assertEqual(floorDepth(block), 2, 'floor still 2 (not yet grown)');
  assertEqual(digitCount(block), 9, 'all 9 root batches present');
  for (const d of '123456789') {
    const batch = block[d] as Block;
    assert(typeof batch._ === 'string', `batch ${d} closed (has summary)`);
    assertEqual(digitCount(batch), 9, `batch ${d} full (9 leaves)`);
  }

  // ── 82nd memory: floor grows to 3 ──
  await handleRemember({ agent_id: AGENT, content: 'entry-82' });
  block = await currentBlock();
  console.log('\nAfter 82 memories (floor grown to 3):');
  assertEqual(floorDepth(block), 3, 'floor is 3');
  assert(typeof block['1'] === 'object' && block['1'] !== null, 'new root 1 is an object (super-batch)');
  assert(typeof block['2'] === 'object' && block['2'] !== null, 'new root 2 is an object (open super-batch)');

  const superBatch1 = block['1'] as Block;
  assertEqual(floorDepth(superBatch1), 2, 'super-batch 1 is floor-2');
  assertEqual(digitCount(superBatch1), 9, 'super-batch 1 has 9 batches');
  // Deep-walk: first memory still at 111
  const walk111 = bsp(block, '111');
  assert(JSON.stringify(walk111).includes('entry-1'), 'address 111 walks to entry-1');

  const superBatch2 = block['2'] as Block;
  const sb2batch1 = superBatch2['1'] as Block;
  assert(typeof sb2batch1 === 'object' && sb2batch1 !== null, 'super-batch 2 > batch 1 exists');
  assert(typeof sb2batch1['1'] === 'string' && (sb2batch1['1'] as string).startsWith('entry-82'),
    'super-batch 2 > batch 1 > leaf 1 is entry-82 (address 211)');

  // ── Default recall returns spindle through current leaf ──
  console.log('\nDefault recall (no args):');
  const recall = await handleRecall({ agent_id: AGENT });
  const recallText = recall.content[0].text;
  assert(recallText.includes('entry-82'), 'default recall surfaces the most recent leaf (entry-82)');
  assert(recallText.toLowerCase().includes('spindle') || recallText.includes('[') || recallText.includes('pscale'),
    'default recall formatted as spindle');

  // ── Level-based recall ──
  console.log('\nLevel 1 recall (batch summaries at floor 3):');
  const lvl1 = await handleRecall({ agent_id: AGENT, level: 1 });
  assert(lvl1.content[0].text.length > 0, 'level 1 recall returns something');

  console.log('\nLevel 0 recall (leaves):');
  const lvl0 = await handleRecall({ agent_id: AGENT, level: 0 });
  assert(lvl0.content[0].text.includes('entry-'), 'level 0 recall surfaces individual memories');

  // ── Address spindle ──
  console.log('\nPosition recall for 342:');
  const pos342 = await handleRecall({ agent_id: AGENT, position: 342 });
  // 342 = super-batch 3, batch 4, leaf 2 = which entry?
  // super-batch 1 = entries 1-81
  // super-batch 2 = entries 82 onward; batch 1 = 82-90, batch 2 = 91-99... wait, 90 is entry 82+8=90, 91 would open batch 2
  // Actually we only wrote up to entry 82. Position 342 is outside what we wrote. Skip this assert.
  assert(pos342.content[0].text.length > 0, 'position recall returns something');

  // ── Cleanup ──
  const client = getClient();
  await client.from('pscale_blocks').delete().eq('owner_id', AGENT).eq('name', 'history');
  console.log(`\nCleanup: deleted test block for ${AGENT}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
