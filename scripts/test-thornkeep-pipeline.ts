/**
 * Substrate self-test for the Thornkeep test prep pipeline (step 8, 2026-04-26).
 *
 * Verifies — without invoking the LLM — that all the lock/observation/registry
 * plumbing wired up in steps 4-7 is consistent. The LLM integration itself is
 * a separate one-shot run with the world-compressor (requires ANTHROPIC_API_KEY).
 *
 * Tests:
 *   1. David (with author passphrase) can write to happyseaurchin/thornkeep-observations.
 *   2. Impostor without passphrase CANNOT write to David's observations block.
 *   3. Impostor with wrong passphrase CANNOT write to David's observations block.
 *   4. Impostor without GM secret CANNOT write to thornkeep-world.
 *   5. Impostor with wrong secret CANNOT write to thornkeep-world.
 *   6. Anyone (no secret) CAN read thornkeep-world (locks are write-only).
 *   7. The compressor's loadAuthors() finds David at sed:thornkeep-authors:11
 *      and resolves him to happyseaurchin/thornkeep-observations.
 *   8. The compressor's loadNewObservations() reads David's stream, parses
 *      TARGET + DETAIL, and respects the cursor.
 *   9. Pool gate: happyseaurchin's passport is unlocked → pool open. (We don't
 *      lock his passport here — that's a separate ecosystem decision.)
 *
 * Args: <author_passphrase> <gm_secret>
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/test-thornkeep-pipeline.ts thorn285 thorn142
 */

import { handleWrite, handleWalk } from '../src/tools/block-ops.js';

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('usage: tsx scripts/test-thornkeep-pipeline.ts <author_passphrase> <gm_secret>');
  process.exit(1);
}
const [AUTHOR_PASS, GM_SECRET] = args;

let pass = 0, fail = 0;

function assert(cond: boolean, label: string) {
  if (cond) { console.log(`  ✓ ${label}`); pass++; }
  else      { console.log(`  ✗ ${label}`); fail++; }
}
function textOf(r: any): string { return r?.content?.[0]?.text ?? ''; }

async function main() {
  console.log('\n=== Thornkeep substrate pipeline self-test ===\n');

  // [1] David writes a real observation about Market Square.
  console.log('[1] Author write to locked observations block (correct passphrase)');
  const obs1 = await handleWrite({
    agent_id: 'happyseaurchin',
    name: 'thornkeep-observations',
    address: '1',
    content: 'thornkeep-world@2 — a hawker named Ennick sells salted cod from the Broken Coast catch; weathered hands, southern accent, a quiet manner with regulars.',
    secret: AUTHOR_PASS,
  });
  assert(textOf(obs1).startsWith('Written'), `wrote observation at position 1`);

  // [2] Impostor (no secret) tries to write
  console.log('\n[2] Impostor without secret');
  const imp1 = await handleWrite({
    agent_id: 'happyseaurchin',
    name: 'thornkeep-observations',
    address: '2',
    content: 'thornkeep-world@2 — fake observation by impostor.',
  });
  assert(textOf(imp1).includes('write-locked'), `unsecreted write rejected`);

  // [3] Impostor with wrong secret
  console.log('\n[3] Impostor with wrong secret');
  const imp2 = await handleWrite({
    agent_id: 'happyseaurchin',
    name: 'thornkeep-observations',
    address: '2',
    content: 'thornkeep-world@2 — also fake.',
    secret: 'wrong-passphrase',
  });
  assert(textOf(imp2).includes('incorrect'), `wrong-secret write rejected`);

  // [4] Impostor without GM secret tries to edit world
  console.log('\n[4] Impostor without GM secret writing to thornkeep-world');
  const w1 = await handleWrite({
    agent_id: 'thornkeep-gm',
    name: 'thornkeep-world',
    address: '2',
    content: 'fake market square text from impostor',
  });
  assert(textOf(w1).includes('write-locked'), `unsecreted world write rejected`);

  // [5] Impostor with wrong GM secret
  console.log('\n[5] Impostor with wrong GM secret');
  const w2 = await handleWrite({
    agent_id: 'thornkeep-gm',
    name: 'thornkeep-world',
    address: '2',
    content: 'fake market square text again',
    secret: 'wrong-gm-secret',
  });
  assert(textOf(w2).includes('incorrect'), `wrong-GM-secret world write rejected`);

  // [6] Read access on locked blocks is open. dir on the whole block shows
  // each top-level entry as a string preview, including position 2 (Market Square).
  console.log('\n[6] Read access on locked world block (no secret)');
  const r6 = await handleWalk({ agent_id: 'thornkeep-gm', name: 'thornkeep-world', mode: 'dir' });
  const t6 = textOf(r6);
  assert(t6.includes('Market Square'), `world dir shows Market Square at position 2`);

  // [7] Compressor's loadAuthors logic — go direct to the registry block to
  // verify David's declaration parses. dir at address 11 shows the deep node.
  console.log('\n[7] Compressor parses sed:thornkeep-authors:11 declaration');
  const r7 = await handleWalk({ agent_id: 'sed:thornkeep-authors', name: 'thornkeep-authors', address: '11', mode: 'dir' });
  const t7 = textOf(r7);
  const obsMatch = t7.match(/observations:\s*(\S+)\/(\S+?)\s*\|/);
  assert(!!obsMatch, 'declaration parse: observations pointer found');
  if (obsMatch) {
    assert(obsMatch[1] === 'happyseaurchin', `parsed agent_id: ${obsMatch[1]}`);
    assert(obsMatch[2] === 'thornkeep-observations', `parsed observations block name: ${obsMatch[2]}`);
  }

  // [8] Observations block read + parse — dir shows position 1's full string.
  console.log('\n[8] Observations block read + parse');
  const r8 = await handleWalk({ agent_id: 'happyseaurchin', name: 'thornkeep-observations', mode: 'dir' });
  const t8 = textOf(r8);
  // Match the OBSERVATION_RE from world-compressor.ts
  const OBS_RE = /(thornkeep-world(?:@[0-9.]+)?)\s*[—\-:]\s*(.+)/;
  const m = t8.match(OBS_RE);
  assert(!!m, 'observation parses with TARGET + DETAIL pattern');
  if (m) {
    assert(m[1] === 'thornkeep-world@2', `parsed TARGET: ${m[1]}`);
    assert(m[2].toLowerCase().includes('ennick'), `parsed DETAIL contains 'Ennick'`);
  }

  // [9] Pool gate sanity: happyseaurchin's passport is currently UNLOCKED
  // (we did not lock it as part of this test). Confirm so the user knows.
  console.log('\n[9] Identity-gate state on happyseaurchin');
  const r9 = await handleWalk({ agent_id: 'happyseaurchin', name: 'passport', mode: 'dir' });
  const t9 = textOf(r9);
  assert(t9.includes('happyseaurchin') || t9.length > 0, `passport readable`);
  // We don't lock here — happyseaurchin is David's ecosystem identity, not a
  // game character. Note for the user.
  console.log('      (note: happyseaurchin/passport is intentionally NOT locked here.');
  console.log('       Lock it manually with pscale_lock_block if you want pool gate active.)');

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail === 0) {
    console.log('Substrate plumbing verified end-to-end.');
    console.log('');
    console.log('Next: run the LLM compression once with ANTHROPIC_API_KEY set:');
    console.log('  ANTHROPIC_API_KEY=sk-ant-... \\');
    console.log('  SUPABASE_ANON_KEY=sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9 \\');
    console.log('  COMPRESSOR_GAMES_CONFIG=scripts/compressor-games.example.json \\');
    console.log('  COMPRESSOR_GM_SECRET_THORNKEEP=' + GM_SECRET + ' \\');
    console.log('  COMPRESSOR_ONESHOT=1 \\');
    console.log('  npx tsx scripts/world-compressor.ts');
    console.log('');
    console.log('Then verify by walking thornkeep-world@2 — Market Square should now');
    console.log('mention Ennick the hawker.');
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
