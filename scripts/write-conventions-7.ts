#!/usr/bin/env tsx
/**
 * Write sed:conventions/7 (agent-shell) to the live conventions block.
 *
 * Position 7 is a NEW universal category alongside 1 (identity), 2 (messaging),
 * 3 (routing), 4 (verification), 6 (runbooks). Lock is comber857 — the
 * universal-category admin — so the same actor that owns 1/2/3/4/6 also
 * owns 7. (If you want a separate admin for agent-shell, change CATEGORY_SECRET
 * before running.)
 *
 * Reviewable content lives in conventions-7-agent-shell.json. Edit there,
 * not here, and re-run.
 *
 * Required env:
 *   SUPABASE_ANON_KEY         — service or anon key for piqxyfmzzywxzqkzmpmm.
 *   CATEGORY_SECRET           — the passphrase to lock position 7 with.
 *                               Pass `comber857` to extend the universal admin
 *                               to position 7 (recommended), or any new
 *                               passphrase if you want a separate lock.
 *
 * Optional env (for the root-underscore mention update):
 *   ROOT_SECRET               — `freedom142`. If supplied, the root underscore
 *                               of sed:conventions is updated to mention 7.
 *                               (You can also do this manually via pscale_write
 *                               agent_id=sed:conventions name=conventions
 *                               address=0 secret=freedom142.)
 *
 * Run:
 *   SUPABASE_ANON_KEY=<key> CATEGORY_SECRET=comber857 ROOT_SECRET=freedom142 \
 *     npx tsx scripts/write-conventions-7.ts
 *
 * Idempotent: re-running rewrites position 7 with whatever is in the JSON file.
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const supabaseUrl = process.env.SUPABASE_URL || 'https://piqxyfmzzywxzqkzmpmm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!supabaseKey) { console.error('missing SUPABASE_ANON_KEY'); process.exit(1); }

const CATEGORY_SECRET = process.env.CATEGORY_SECRET;
if (!CATEGORY_SECRET) { console.error('missing CATEGORY_SECRET (passphrase to lock position 7 with)'); process.exit(1); }
const ROOT_SECRET = process.env.ROOT_SECRET; // optional

const COLLECTIVE = 'conventions';
const OWNER = `sed:${COLLECTIVE}`;
const NAME = COLLECTIVE;

const client = createClient(supabaseUrl, supabaseKey);

function hashPassphrase(passphrase: string, collective: string, position: string): string {
  return createHash('sha256').update(passphrase + collective + position).digest('hex');
}

async function main() {
  // Load the conventions content for position 7.
  const contentPath = new URL('./conventions-7-agent-shell.json', import.meta.url).pathname;
  const position7 = JSON.parse(readFileSync(contentPath, 'utf-8'));

  // Fetch current block + position_hashes.
  const { data: row, error } = await client
    .from('pscale_blocks')
    .select('block, position_hashes')
    .eq('owner_id', OWNER)
    .eq('name', NAME)
    .single();
  if (error || !row) {
    console.error('Could not fetch sed:conventions block:', error?.message);
    process.exit(1);
  }

  const block = row.block as Record<string, any>;
  const positionHashes = (row.position_hashes || {}) as Record<string, string>;

  // Verify ROOT_SECRET (if supplied) before any mutation, by recomputing
  // its hash and comparing to position_hashes['0'].
  if (ROOT_SECRET) {
    const computed = hashPassphrase(ROOT_SECRET, COLLECTIVE, '0');
    const stored = positionHashes['0'];
    if (computed !== stored) {
      console.error('ROOT_SECRET does not match position_hashes[0]. Aborting.');
      process.exit(1);
    }
  }

  // Apply the writes locally.
  block['7'] = position7;
  positionHashes['7'] = hashPassphrase(CATEGORY_SECRET, COLLECTIVE, '7');

  // Optional root-underscore update — keeps the directory note current.
  if (ROOT_SECRET) {
    const rootUnderscore = "Conventions of the pscale commons — guidance and suggestions for protocol use, organised by topic with positions reserved 8-9 for growth. Categories: 1 identity, 2 messaging, 3 routing, 4 verification, 5 games (Onen / GRIT framework), 6 runbooks, 7 agent-shell. Universal categories (1, 2, 3, 4, 6, 7) are admin-locked by comber857; games (5) by ubarakar142; root by freedom142. Sub-categories at depth 2 group by topic; concrete guidance at depth 3. Walk this block to read the current convention layer; categories are not enforced at the protocol level — they are suggestions agents can adopt or adapt.";
    block['_'] = rootUnderscore;
  }

  const { error: writeError } = await client
    .from('pscale_blocks')
    .update({
      block,
      position_hashes: positionHashes,
      updated_at: new Date().toISOString(),
    })
    .eq('owner_id', OWNER)
    .eq('name', NAME);

  if (writeError) {
    console.error('Write failed:', writeError.message);
    process.exit(1);
  }

  console.log('✓ sed:conventions/7 (agent-shell) written.');
  console.log(`  - Position 7 locked with CATEGORY_SECRET (hash stored at position_hashes[7]).`);
  if (ROOT_SECRET) {
    console.log('  - Root underscore updated to mention category 7.');
  } else {
    console.log('  - Root underscore NOT updated (no ROOT_SECRET supplied). Update manually with:');
    console.log('    pscale_write agent_id=sed:conventions name=conventions address=0 secret=<freedom142> content=<new underscore>');
  }
  console.log('');
  console.log('Walk to verify: pscale_walk agent_id=sed:conventions name=conventions mode=dir address=7');
}

main().catch(e => { console.error(e); process.exit(1); });
