/**
 * One-shot setup for Thornkeep test prep steps 4-6 (2026-04-26).
 *
 *   4 — Lock thornkeep-gm/{world, rules, protocol} with the GM secret.
 *   5 — Create sed:thornkeep-authors collective with admin secret.
 *   6 — Create happyseaurchin/thornkeep-observations (locked) and register
 *       happyseaurchin at sed:thornkeep-authors:1 (auto-assigned position).
 *
 * Secrets come from CLI args, not hard-coded:
 *   tsx scripts/thornkeep-setup-456.ts <gm_secret> <authors_admin> <author_passphrase>
 *
 * The script verifies each step succeeded before continuing. Idempotency is
 * NOT guaranteed — if rerun, lock-block will reject with "already locked"
 * (use rotate via current_secret), create_collective with "already exists",
 * register will give the next position.
 */

import { handleLockBlock, handleCreateBlock } from '../src/tools/block-ops.js';
import { handleCreateCollective, handleRegister } from '../src/tools/collective-ops.js';
import { getClient } from '../src/db.js';

const args = process.argv.slice(2);
if (args.length !== 3) {
  console.error('usage: tsx scripts/thornkeep-setup-456.ts <gm_secret> <authors_admin> <author_passphrase>');
  process.exit(1);
}
const [GM_SECRET, ADMIN_SECRET, AUTHOR_PASSPHRASE] = args;

function textOf(r: any): string { return r?.content?.[0]?.text ?? ''; }

function expect(condition: boolean, label: string, detail?: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log('\n=== Thornkeep test prep: steps 4-6 ===\n');

  // Step 4 — Lock GM blocks.
  console.log('[4] Locking GM blocks with GM secret');
  for (const name of ['thornkeep-world', 'thornkeep-rules', 'thornkeep-protocol']) {
    const r = await handleLockBlock({ agent_id: 'thornkeep-gm', name, secret: GM_SECRET });
    expect(textOf(r).includes('write-locked'), `lock thornkeep-gm/${name}`, textOf(r));
  }

  // Step 5 — Create sed:thornkeep-authors.
  console.log('\n[5] Creating sed:thornkeep-authors collective');
  const conventions = `Thornkeep authors registry. Position 1 = world-keeper (David, happyseaurchin). Positions 2-9 = co-authors (extend by floor when 10+ authors join). Each declaration MUST include "observations: <agent>/thornkeep-observations" so the world compressor can find your stream. See sed:conventions/5.4 for the registry pattern and 5.5 for observation streams.`;
  const c = await handleCreateCollective({ collective: 'thornkeep-authors', conventions, creator_passphrase: ADMIN_SECRET });
  expect(textOf(c).includes('created'), 'sed:thornkeep-authors created', textOf(c));

  // Step 6a — Create happyseaurchin/thornkeep-observations (locked with author passphrase).
  console.log('\n[6a] Creating happyseaurchin/thornkeep-observations (locked)');
  const ob = await handleCreateBlock({
    agent_id: 'happyseaurchin',
    name: 'thornkeep-observations',
    initial_content: 'happyseaurchin\'s observations of Thornkeep — canon-candidate detail noticed during play. Each entry: TARGET (e.g. thornkeep-world@2) — DETAIL.',
    secret: AUTHOR_PASSPHRASE,
  });
  expect(textOf(ob).includes('"created": true') && textOf(ob).includes('"locked": true'), 'observations block created and locked', textOf(ob));

  // Step 6b — Register at sed:thornkeep-authors (auto-assigned, will be position 1 since first).
  console.log('\n[6b] Registering happyseaurchin at sed:thornkeep-authors');
  const declaration = 'happyseaurchin (David Pinto) | observations: happyseaurchin/thornkeep-observations | role: world-keeper';
  const reg = await handleRegister({
    collective: 'thornkeep-authors',
    declaration,
    shell_ref: 'happyseaurchin/thornkeep-observations',
    passphrase: AUTHOR_PASSPHRASE,
  });
  expect(textOf(reg).includes('Registered at position'), 'registered', textOf(reg));
  const positionMatch = textOf(reg).match(/position (\d+)/);
  if (positionMatch) console.log(`    → assigned position ${positionMatch[1]}`);

  // Cross-checks
  console.log('\n[verify] Cross-checks against live DB');
  const client = getClient();
  for (const name of ['thornkeep-world', 'thornkeep-rules', 'thornkeep-protocol']) {
    const { data } = await client.from('pscale_blocks')
      .select('position_hashes').eq('owner_id', 'thornkeep-gm').eq('name', name).single();
    const hash = (data as any)?.position_hashes?._;
    expect(!!hash, `thornkeep-gm/${name} has position_hashes['_']`);
  }
  const { data: collRow } = await client.from('pscale_blocks')
    .select('position_hashes, block').eq('owner_id', 'sed:thornkeep-authors').eq('name', 'thornkeep-authors').single();
  expect(!!(collRow as any)?.position_hashes?.['0'], 'sed:thornkeep-authors root has admin lock at position 0');
  expect(!!(collRow as any)?.position_hashes?.['1'], 'sed:thornkeep-authors position 1 occupied');
  expect(!!(collRow as any)?.block?.['1']?._?.toString().includes('happyseaurchin'), 'position 1 declaration mentions happyseaurchin');

  const { data: obsRow } = await client.from('pscale_blocks')
    .select('position_hashes').eq('owner_id', 'happyseaurchin').eq('name', 'thornkeep-observations').single();
  expect(!!(obsRow as any)?.position_hashes?._, 'happyseaurchin/thornkeep-observations is locked');

  console.log('\n=== ✓ steps 4-6 complete ===\n');
  console.log('Next:');
  console.log('  - Matthew registers as author (he runs pscale_register collective=thornkeep-authors with HIS passphrase + a declaration pointing at his observations block).');
  console.log('  - Step 7: scripts/world-compressor.ts');
  console.log('  - Step 8: self-test with both authors and at least one player.');
}

main().catch(e => { console.error(e); process.exit(1); });
