/**
 * LLM-summary pathway test for pscale_remember.
 *
 * Verifies:
 *   - close_summary is used at the batch-close moment (instead of concat)
 *   - close_summary is ignored when the write doesn't close a batch
 *   - Response body reports closed + llm_summary_applied truthfully
 *   - Multi-level close (entry 81) applies close_summary at the deepest
 *     closing level; outer cascades fall back to concat
 *   - Fallback to concat when close_summary absent
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/test-memory-llm-summary.ts
 */

import { handleRemember } from '../src/tools/memory-ops.js';
import { getBlock, getClient } from '../src/db.js';
import { type Block } from '../src/bsp.js';

const AGENT = `test-memory-llm-summary-${Date.now()}`;
let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else { console.log(`  ✗ ${msg}`); failed++; }
}

async function currentBlock(): Promise<Block> {
  const row = await getBlock(AGENT, 'history');
  return row ? (row.block as Block) : {};
}

async function main() {
  console.log(`\nLLM-summary test — agent ${AGENT}\n`);
  const client = getClient();

  // ── Writes 1 through 8 without close_summary: no close, no flag set ──
  for (let i = 1; i <= 8; i++) {
    const r = await handleRemember({ agent_id: AGENT, content: `e${i}`, close_summary: `(early summary candidate ${i})` });
    const body = JSON.parse(r.content[0].text);
    if (i === 1) assert(body.closed === false, 'entry 1 does not close');
  }

  // Verify: none of those writes closed anything, even though we passed close_summary.
  let block = await currentBlock();
  console.log('After 8 memories with close_summary passed:');
  assert(typeof block._ !== 'string' || block._ === '', 'no summary written yet — close_summary ignored on non-closing writes');

  // ── Write 9: closes root, close_summary SHOULD be used ──
  console.log('\nEntry 9 with close_summary:');
  const llmSummary9 = 'Synthesis: the agent explored 8 variations of the same question, converging on the third approach as most robust.';
  const r9 = await handleRemember({ agent_id: AGENT, content: 'e9', close_summary: llmSummary9 });
  const body9 = JSON.parse(r9.content[0].text);
  assert(body9.closed === true, 'entry 9 reports closed=true');
  assert(body9.llm_summary_applied === true, 'entry 9 reports llm_summary_applied=true');

  block = await currentBlock();
  assert(block._ === llmSummary9, 'batch summary is the provided LLM text (not concat)');
  assert(!(block._ as string).includes(' | '), 'batch summary does not contain concat separator');

  // ── Write 10 with NO close_summary: triggers growth, no immediate close ──
  console.log('\nEntry 10 WITHOUT close_summary (triggers floor growth):');
  const r10 = await handleRemember({ agent_id: AGENT, content: 'e10' });
  const body10 = JSON.parse(r10.content[0].text);
  assert(body10.closed === false, 'entry 10 does not close (just opens batch 2)');
  assert(body10.llm_summary_applied === false, 'entry 10 llm_summary_applied=false (nothing to apply)');
  assert(body10.floor === 2, 'entry 10 floor is 2');

  block = await currentBlock();
  const batch1 = block['1'] as Block;
  assert(batch1._ === llmSummary9, 'after growth, batch 1 summary preserved as the LLM text');

  // ── Write 11 with close_summary but it's not a close-triggering write ──
  console.log('\nEntry 11 with close_summary but does not close:');
  const r11 = await handleRemember({ agent_id: AGENT, content: 'e11', close_summary: '(unused)' });
  const body11 = JSON.parse(r11.content[0].text);
  assert(body11.closed === false, 'entry 11 does not close');
  assert(body11.llm_summary_applied === false, 'entry 11 llm_summary_applied=false (close_summary ignored)');

  // ── Fill batch 2 without close_summary, verify concat fallback ──
  console.log('\nFilling batch 2 without close_summary (concat fallback):');
  for (let i = 12; i <= 18; i++) {
    await handleRemember({ agent_id: AGENT, content: `e${i}` });
  }
  block = await currentBlock();
  const batch2 = block['2'] as Block;
  assert(typeof batch2._ === 'string', 'batch 2 has a summary after filling');
  assert((batch2._ as string).includes(' | '), 'batch 2 summary contains concat separator (LLM fallback)');
  assert((batch2._ as string).includes('e10'), 'batch 2 concat includes e10');
  assert((batch2._ as string).includes('e18'), 'batch 2 concat includes e18');

  // ── Fill to entry 81: two levels close simultaneously ──
  console.log('\nFilling to entry 81 to trigger multi-level close:');
  for (let i = 19; i <= 80; i++) {
    await handleRemember({ agent_id: AGENT, content: `e${i}` });
  }
  // Entry 81 will close batch 9 (deepest) AND root (cascade). Only batch 9 gets LLM summary.
  const multiLevelSummary = 'Synthesis: batch 9 (entries 73-81) covered the convergence phase after batches 1-8 explored options.';
  const r81 = await handleRemember({ agent_id: AGENT, content: 'e81', close_summary: multiLevelSummary });
  const body81 = JSON.parse(r81.content[0].text);
  assert(body81.closed === true, 'entry 81 closed=true');
  assert(body81.llm_summary_applied === true, 'entry 81 llm_summary_applied=true (applied at deepest)');

  block = await currentBlock();
  const batch9 = block['9'] as Block;
  assert(batch9._ === multiLevelSummary, 'batch 9 summary is the LLM text (deepest close)');
  // The root of floor 2 closed too. Its innermost _ chain position holds the cascade summary (concat of batch summaries).
  // block._ is an object {_: string}. Walk to the string.
  let rootSummary: any = block._;
  while (rootSummary && typeof rootSummary === 'object') rootSummary = rootSummary._;
  assert(typeof rootSummary === 'string' && rootSummary.includes(' | '), 'root summary is concat of batch summaries (cascade fallback)');
  assert(rootSummary !== multiLevelSummary, 'root summary is NOT the same as the LLM text (not propagated)');

  // ── Cleanup ──
  await client.from('pscale_blocks').delete().eq('owner_id', AGENT);
  console.log(`\nCleanup: deleted test block for ${AGENT}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
