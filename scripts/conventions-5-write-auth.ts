/**
 * One-shot writer for sed:conventions/5.3, 5.4, 5.5 — write-auth, authorship,
 * observations conventions for beach-games (Thornkeep family).
 *
 * Step 2 of Thornkeep test prep (2026-04-26). Adds three new sub-categories to
 * sed:conventions/5 (games, locked under ubarakar142):
 *
 *   5.3  write-auth         — lock primitive applied to game state
 *   5.4  authorship         — sed:{game}-authors registry pattern
 *   5.5  observation streams — per-author locked observation blocks
 *
 * The 5._ underscore is updated to mention the new positions.
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/conventions-5-write-auth.ts
 *
 * Direct DB upsert (matches scripts/migrate-conventions-to-depth.ts pattern).
 * The lock at 5._ is application-layer; direct upsert is the admin path for
 * migrations like this. Verify post-write by walking the block.
 */

import { getClient } from '../src/db.js';

const AGENT = 'sed:conventions';
const NAME = 'conventions';

const FIVE_UNDERSCORE = `Games (Onen / GRIT) — multiplayer narrative coordination on liquid pools with convention-layer round resolution. Top-level slot since 24 April 2026. 1=structure (roles, action-type palette), 2=turn (loop, fairness, chronicle), 3=write-auth (lock primitive on game state), 4=authorship (sed:{game}-authors registry), 5=observation streams (per-author locked blocks). As of 2026-04-25 GRIT lives entirely as agent-side convention on top of the primitive pool — see docs/protocol-grit.md and scripts/grit-resolver.ts in pscale-mcp-server. The substrate no longer enforces rounds, fairness, or message_type distinctions; the convention here is what makes a game work. As of 2026-04-26 the lock primitive (pscale_lock_block on ordinary blocks; passport-lock on agent identities → pool gate) provides the impersonation defence — see 5.3.`;

const FIVE_THREE = {
  _: `Write authorisation for shared game state. Three substrates of write-lock, same primitive: sed: per-position (sed:conventions/1.3 registration), grain: per-side (grain ownership), ordinary blocks (pscale_lock_block, added 2026-04-26). All three hash a passphrase against a salt; reads stay public; only writes are gated. Use the lock primitive on world, rules, protocol, and player passports so impostors cannot rewrite canon or post under another's agent_id. Lock is post-as-me only — pool_read remains unrestricted.`,

  '1': `World block lock — pscale_lock_block agent_id={gm} name={game}-world secret={gm-secret}. After locking, only the holder of {gm-secret} writes the shared canon. Reads remain public so any visitor can pscale_walk the world. The world compressor (scripts/world-compressor.ts) holds the GM secret and writes integrations; players never write directly to the world.`,

  '2': `Rules + protocol locks — pscale_lock_block on {gm}/{game}-rules and {gm}/{game}-protocol with the GM secret. Locks them against drift. The protocol is the document every player walks on first arrival; locking ensures everyone sees the same procedural runbook.`,

  '3': `Character/identity lock — pscale_lock_block agent_id={player} name=passport secret={player-secret}. Once locked, pscale_pool_send and pscale_pool_join reject posts under {player}'s agent_id without the secret. Substrate-enforced as of 2026-04-26 (see commit 052e285). The lock IS the impersonation defence for pool play. Read remains unrestricted. See sed:conventions/1.2 (naming), 1.3 (registration).`,

  '4': `Lock primitive vs signed writes — the lock is per-block, asserts "only the secret-holder writes here." A per-message signature would re-prove ownership on every write; the lock proves it once at the block level. Locks are coarse-grained but sufficient for game state and shipped (2026-04-26). Per-message signed writes remain a future option if finer granularity is needed.`,
};

const FIVE_FOUR = {
  _: `Authorship registry — when a game has multiple authors who contribute to world canon, register them in a sed:{game}-authors collective. Each registers at a position with their own passphrase + a pointer to their observation block. The world compressor reads the registry to know whose observation streams to integrate. Substrate-enforced authorship through sed: ownership; revocable by overwriting the position.`,

  '1': `Create the collective — pscale_create_collective name={game}-authors initial_content="{game} authors registry. Position 1 = GM. Positions 2-9 = co-authors. Floor 2 (11-19, 21-29, …) when more than nine authors join." admin_passphrase={admin-secret}. The admin passphrase locks the root underscore for descriptor edits. Per-position passphrases are independent.`,

  '2': `Registration — pscale_register collective={game}-authors position={N} declaration="<your-name> | observations: {your-agent-id}/{game}-observations | role: <e.g. world-keeper, co-author>" passphrase={your-secret}. The declaration MUST include your observation block address. Compressor parses this pointer; without it, your stream is invisible to canon integration.`,

  '3': `Revocation — admin re-registration overwrites the position with a different declaration. There is no destructive delete; the previous declaration is replaced. Compressor reads the new pointer; the prior author's stream is no longer integrated. For a clean handover, the previous author should publish a final summary to their observation block before being replaced.`,

  '4': `Single-author games — register only the GM at position 1. The collective is a one-row registry. Adding co-authors later is just additional registrations at positions 2, 3, …; no schema migration needed.`,
};

const FIVE_FIVE = {
  _: `Observation streams — each author writes observations to their own locked block, not to the world or pool directly. The world compressor reads observation streams from registered authors and integrates them into the shared world block. Per-author isolation: the lock primitive prevents impostors from polluting another author's stream. Compressor lifecycle is asynchronous — observations accumulate; integration happens on a cron or manual run.`,

  '1': `Block shape — {author}/{game}-observations, locked with pscale_lock_block agent_id={author} name={game}-observations secret={author-secret}. The block grows like memory: positions 1-9 at floor 1, then floor 2 (10-19, …), with compaction-aware addressing if observation volume warrants. Default starts as a flat block with sequential numbered positions.`,

  '2': `Write shape — pscale_write to the next free position. Content is structured text with two parts: TARGET (which world position the observation refers to, e.g. "thornkeep-world@2 (Market Square)") + DETAIL (what was observed). Example: "thornkeep-world@2 — Ennick the hawker sells salted cod from the Broken Coast catch; his accent marks him from the southern villages." The compressor parses the TARGET prefix to know which world room receives the integration.`,

  '3': `Compression cursor — the world block carries a hidden directory at position 9 with per-author cursors: {9: {last_compression: {author1: <ts>, author2: <ts>}}}. The compressor reads observations strictly newer than the cursor for each registered author, integrates per affected world position, advances the cursor, and writes the world block under the GM secret. Single-block tracking; no separate state table. (Replaces the 23 April speculative pool_state.last_compression_at column, which was dropped 2026-04-26.)`,

  '4': `Privacy — observations are by default plaintext so the compressor can read them. If an author has private notes that should NOT be integrated into shared canon, write those to a separate gray-encrypted memory block (pscale_remember with secret); the observations block is for canon-candidate detail only.`,
};

async function main() {
  const client = getClient();

  // 1. Read current conventions block
  console.log('reading sed:conventions/conventions...');
  const { data: row, error: readErr } = await client
    .from('pscale_blocks')
    .select('block, position_hashes, block_type')
    .eq('owner_id', AGENT)
    .eq('name', NAME)
    .single();
  if (readErr || !row) {
    console.error('failed to read conventions:', readErr);
    process.exit(1);
  }
  const block = (row as any).block;
  const positionHashes = (row as any).position_hashes;
  const blockType = (row as any).block_type;

  if (!block['5']) {
    console.error('position 5 (games) does not exist; aborting');
    process.exit(1);
  }
  if (block['5']['3'] || block['5']['4'] || block['5']['5']) {
    console.warn('one or more of 5.3 / 5.4 / 5.5 already exists; this script will OVERWRITE them. Continue? (sleeping 3s, ctrl-C to abort)');
    await new Promise(r => setTimeout(r, 3000));
  }

  // 2. Update in place
  block['5']['_'] = FIVE_UNDERSCORE;
  block['5']['3'] = FIVE_THREE;
  block['5']['4'] = FIVE_FOUR;
  block['5']['5'] = FIVE_FIVE;

  // 3. Upsert
  console.log('upserting...');
  const { error: writeErr } = await client
    .from('pscale_blocks')
    .upsert(
      {
        owner_id: AGENT,
        name: NAME,
        block_type: blockType,
        block,
        position_hashes: positionHashes, // preserve all locks
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,name' },
    );
  if (writeErr) {
    console.error('upsert failed:', writeErr);
    process.exit(1);
  }

  // 4. Verify
  const { data: check } = await client
    .from('pscale_blocks')
    .select('block')
    .eq('owner_id', AGENT)
    .eq('name', NAME)
    .single();
  const written = (check as any).block?.['5'];
  const ok = !!(written?.['3']?._ && written?.['4']?._ && written?.['5']?._ &&
                written._.includes('3=write-auth') && written._.includes('4=authorship'));
  if (!ok) {
    console.error('verification failed; check db state');
    process.exit(1);
  }

  console.log('\n✓ sed:conventions/5 updated');
  console.log('  5._ now lists positions 3, 4, 5');
  console.log('  5.3.1-4 (write-auth)');
  console.log('  5.4.1-4 (authorship)');
  console.log('  5.5.1-4 (observation streams)');
  console.log('\nVerify with:');
  console.log('  pscale_walk agent_id=sed:conventions name=conventions mode=dir address=5');
}

main().catch(e => { console.error(e); process.exit(1); });
