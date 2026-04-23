/**
 * Migration smoke test for pscale_evolution remember_migrate.
 *
 * Synthesises a pre-fix broken block (root digit 1 is a bare string — the
 * signature of post-supernest bug), runs the migration, verifies the
 * rebuilt block is structurally sound and all memories are preserved.
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/test-memory-evolution.ts
 */

import { handleEvolution } from '../src/tools/evolution-ops.js';
import { getBlock, getClient, upsertBlock } from '../src/db.js';
import { floorDepth, bsp, type Block } from '../src/bsp.js';

const AGENT = `test-memory-evolution-${Date.now()}`;
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}`); failed++; }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`); failed++; }
}

/**
 * Synthesise the actual post-bug shape the OLD pscale_remember produced
 * after 19 memories. Trace:
 *   - Entry 10 supernests: {_: {_: summary_1_9, 1: e1, ..., 9: e9}, 1: e10}
 *   - Entries 11..18 fill digits 2..9 at root.
 *   - Entry 19 triggers second compaction: compactLevel(root) = "e10|..|e18"
 *     OVERWRITES block._ (destroying entries 1-9 and their summary).
 *     Supernest wraps: block._ = {_: "e10..e18", 1: e10, ..., 9: e18}.
 *     Handler writes block['1'] = e19.
 *   - Final damaged shape: {_: {_: stale_str, 1: e10, ..., 9: e18}, 1: e19}
 *
 * Entries 1-9 are permanently lost — migration cannot recover them.
 * Migration DOES recover entries 10-19 (10 memories).
 */
function buildDamagedBlock(): Block {
  const innerUnderscore = 'entry-10 | entry-11 | entry-12 | entry-13 | entry-14 | entry-15 | entry-16 | entry-17 | entry-18';
  return {
    _: {
      _: innerUnderscore,
      '1': 'entry-10',
      '2': 'entry-11',
      '3': 'entry-12',
      '4': 'entry-13',
      '5': 'entry-14',
      '6': 'entry-15',
      '7': 'entry-16',
      '8': 'entry-17',
      '9': 'entry-18',
    },
    '1': 'entry-19',
  };
}

async function main() {
  console.log(`\nMigration test — agent ${AGENT}\n`);

  // Seed the damaged block directly (bypassing pscale_remember).
  const damaged = buildDamagedBlock();
  await upsertBlock(AGENT, 'history', 'history', damaged);

  // Verify the damaged shape.
  let row = await getBlock(AGENT, 'history');
  const before = row!.block as Block;
  console.log('Pre-migration (post-bug damaged shape):');
  assertEq(floorDepth(before), 2, 'damaged block is floor-2 (post-supernest)');
  assert(typeof before['1'] === 'string', 'root digit 1 is a bare string (damage signature)');
  assert(typeof before._ === 'object', 'root _ is an object (holds supernested remnants)');

  // Dry run first.
  console.log('\nDry-run:');
  const dry = await handleEvolution({ agent_id: AGENT, operation: 'remember_migrate', dry_run: true });
  const dryResult = JSON.parse(dry.content[0].text);
  assert(dryResult.status === 'noop', 'dry run reports noop status (no write yet)');
  assertEq(dryResult.memories_recovered, 10, 'dry run finds 10 recoverable memories (e10..e19)');

  // Verify dry-run didn't change anything.
  row = await getBlock(AGENT, 'history');
  const afterDry = row!.block as Block;
  assertEq(afterDry, damaged, 'dry run did not modify the block');

  // Real migration.
  console.log('\nMigration:');
  const result = await handleEvolution({ agent_id: AGENT, operation: 'remember_migrate', dry_run: false });
  const res = JSON.parse(result.content[0].text);
  assert(res.status === 'migrated', 'migration reports migrated status');
  assertEq(res.memories_recovered, 10, 'migration recovered 10 memories');
  assert(typeof res.backup_block === 'string' && res.backup_block.startsWith('history_pre_evolution_'),
    'backup_block name includes timestamp prefix');

  // Verify backup exists with original shape.
  const backupRow = await getBlock(AGENT, res.backup_block);
  assert(backupRow !== null, 'backup block was created');
  assertEq(backupRow!.block, damaged, 'backup matches the original damaged block');

  // Verify the new block is structurally sound.
  row = await getBlock(AGENT, 'history');
  const after = row!.block as Block;
  console.log('\nPost-migration (rebuilt shape):');
  assertEq(floorDepth(after), 2, '10 memories rebuild as floor-2 (entry 10 triggered growth)');
  const batch1 = after['1'] as Block;
  assert(typeof batch1 === 'object', 'root digit 1 is an object (closed batch)');
  assertEq(Object.keys(batch1).filter(k => k !== '_').length, 9, 'batch 1 has 9 leaves');
  assert(typeof batch1['1'] === 'string' && batch1['1'].includes('entry-10'), 'batch 1.1 is entry-10 (chronologically first recovered)');
  assert(typeof batch1['9'] === 'string' && batch1['9'].includes('entry-18'), 'batch 1.9 is entry-18');
  const batch2 = after['2'] as Block;
  assert(typeof batch2 === 'object', 'root digit 2 is an object (open batch)');
  assert(typeof batch2['1'] === 'string' && batch2['1'].includes('entry-19'), 'batch 2.1 is entry-19 (newest)');

  // Walk address 15: spindle through entry-14 (batch 1, leaf 5 = 5th recovered = e14).
  const walk15 = bsp(after, '15');
  const walkText = JSON.stringify(walk15);
  assert(walkText.includes('entry-14'), 'spindle through address 15 surfaces entry-14');

  // Cleanup.
  const client = getClient();
  await client.from('pscale_blocks').delete().eq('owner_id', AGENT);
  console.log(`\nCleanup: deleted all blocks for ${AGENT}`);

  // ── Second scenario: noop on a clean floor-1 block ──
  const AGENT2 = `test-memory-evolution-noop-${Date.now()}`;
  console.log(`\nNoop test — agent ${AGENT2}`);
  const clean: Block = { _: '', '1': 'memory-a', '2': 'memory-b' };
  await upsertBlock(AGENT2, 'history', 'history', clean);
  const noop = await handleEvolution({ agent_id: AGENT2, operation: 'remember_migrate', dry_run: false });
  const noopRes = JSON.parse(noop.content[0].text);
  assert(noopRes.status === 'noop', 'clean floor-1 block is noop');
  await client.from('pscale_blocks').delete().eq('owner_id', AGENT2);
  console.log(`  Cleanup: deleted ${AGENT2}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
