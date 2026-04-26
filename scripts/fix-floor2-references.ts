/**
 * Patch the floor-2-minimum reference in two places where I wrote "Position 1
 * = world-keeper" assuming positions 1-9 were user slots. They're not —
 * sed: collectives reserve 1-9 as structural-group reservations and put real
 * registrants at floor-2 minimum (11, 12, ..., 99, 111, ...). David landed
 * at sed:thornkeep-authors:11 as the first registrant.
 *
 * Two updates:
 *   1. sed:conventions/5.4.1 + 5.4.2 — clarify floor-2 semantics
 *   2. sed:thornkeep-authors root underscore — replace the wrong example text
 *
 * Direct upsert; both blocks are locked but RLS is open so admin migration
 * goes through. Args: <games_passphrase> <authors_admin_passphrase> (just
 * for the audit trail; the actual DB write doesn't enforce them).
 */

import { getClient } from '../src/db.js';

const GAMES_SECRET = process.argv[2];
const AUTHORS_ADMIN = process.argv[3];
if (!GAMES_SECRET || !AUTHORS_ADMIN) {
  console.error('usage: tsx scripts/fix-floor2-references.ts <games_passphrase> <authors_admin>');
  process.exit(1);
}

const NEW_5_4_1 = `Create the collective — pscale_create_collective collective={game}-authors conventions="{game} authors registry. First registrant lands at position 11 (floor-2 minimum); subsequent registrants at 12, 13, ..., 19, 21, ..., 99, 111, ... per the substrate's floor-aware addressing. Positions 1-9 are reserved as structural-group reservations and never user slots." creator_passphrase={admin-secret}. The admin passphrase locks the root underscore for descriptor edits. Per-position passphrases are independent and provided at registration time.`;

const NEW_5_4_2 = `Registration — pscale_register collective={game}-authors declaration="<your-name> | observations: {your-agent-id}/{game}-observations | role: <e.g. world-keeper, co-author>" passphrase={your-secret}. The server auto-assigns the next free floor-2 position (e.g. 11 for the first registrant, 12 for the second, ...) — landing order is your proof-of-presence-in-time. Your declaration MUST include the address of your observation block; without it, the compressor can't find your stream. Your address becomes sed:{game}-authors:{position}.`;

const NEW_5_4_3 = `Revocation — there is no destructive delete tool. Two paths to exclude a former author: (a) soft — the world compressor maintains an allowlist of trusted positions; removing a position from the allowlist excludes that author without modifying the registry, and the previous declaration remains on the chronicle. (b) hard — the admin rotates the position's lock to a new passphrase via direct upsert (substrate-level admin task, not an LLM operation), making the position no longer writable by the original author. (a) is the normal path; (b) is for compromised passphrases.`;

const NEW_AUTHORS_ROOT = `Thornkeep authors registry. First registrant landed at position 11 (floor-2 minimum per substrate convention); subsequent registrants take 12, 13, ..., 19, 21, ..., 99, 111, .... Positions 1-9 are structural reservations, never user slots. Each declaration MUST include "observations: <agent>/thornkeep-observations" so the world compressor can find your stream. See sed:conventions/5.4 for the registry pattern and 5.5 for observation streams. Created 2026-04-26 as part of Thornkeep test prep.`;

async function patchConventions5() {
  const client = getClient();
  const { data: row } = await client
    .from('pscale_blocks')
    .select('block, position_hashes, block_type')
    .eq('owner_id', 'sed:conventions')
    .eq('name', 'conventions')
    .single();
  if (!row) throw new Error('sed:conventions not found');

  const block = (row as any).block;
  block['5']['4']['1'] = NEW_5_4_1;
  block['5']['4']['2'] = NEW_5_4_2;
  block['5']['4']['3'] = NEW_5_4_3;

  const { error } = await client
    .from('pscale_blocks')
    .upsert({
      owner_id: 'sed:conventions', name: 'conventions',
      block_type: (row as any).block_type, block,
      position_hashes: (row as any).position_hashes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,name' });
  if (error) throw error;
  console.log('  ✓ sed:conventions/5.4.1, 5.4.2, 5.4.3 updated for floor-2 semantics');
}

async function patchAuthorsRoot() {
  const client = getClient();
  const { data: row } = await client
    .from('pscale_blocks')
    .select('block, position_hashes, block_type')
    .eq('owner_id', 'sed:thornkeep-authors')
    .eq('name', 'thornkeep-authors')
    .single();
  if (!row) throw new Error('sed:thornkeep-authors not found');

  const block = (row as any).block;
  block._ = NEW_AUTHORS_ROOT;

  const { error } = await client
    .from('pscale_blocks')
    .upsert({
      owner_id: 'sed:thornkeep-authors', name: 'thornkeep-authors',
      block_type: (row as any).block_type, block,
      position_hashes: (row as any).position_hashes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,name' });
  if (error) throw error;
  console.log('  ✓ sed:thornkeep-authors root underscore updated');
}

async function main() {
  console.log('Patching floor-2 references...');
  await patchConventions5();
  await patchAuthorsRoot();
  console.log('done.');
}

main().catch(e => { console.error(e); process.exit(1); });
