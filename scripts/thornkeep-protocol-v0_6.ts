/**
 * One-shot writer for thornkeep-protocol v0.6 (step 3 of Thornkeep test prep).
 *
 * v0.5 → v0.6 — pscale-native shape. Drops the "ON JOIN / ON USER INPUT /
 * ON TURN" event-callback naming (which described a programming model the
 * substrate doesn't actually have) in favour of noun-phrase situations.
 * Player's LLM walks dir on first connect, sees the situations, walks to
 * the position matching its current state.
 *
 * Content updates from v0.5:
 *   - Adds lock-block step on first ON JOIN: passport + memory + observations
 *     all locked with the player's passphrase.
 *   - Pool sends now pass `secret` to satisfy the post-26-April identity gate.
 *   - Introduces per-author observation block (thornkeep-{name}/thornkeep-observations,
 *     locked) as the canon-contribution surface — the world compressor reads
 *     these, not the pool.
 *   - Reframes the underscore: "this is one convention; fork it for your game."
 *   - Position 9 hidden directory: star-refs to conventions/5, world, rules.
 *
 * Run: SUPABASE_ANON_KEY=... npx tsx scripts/thornkeep-protocol-v0_6.ts
 *
 * Direct DB upsert. The protocol is currently unlocked (position_hashes={});
 * a separate step locks it once the GM secret is provided.
 */

import { getClient } from '../src/db.js';

const AGENT = 'thornkeep-gm';
const NAME = 'thornkeep-protocol';

const UNDERSCORE = `Thornkeep play protocol v0.6 — pscale-native situations on the GRIT + lock-primitive convention layer. What a player's Claude does. Read this first. Beach URL: https://play.onen.ai/thornkeep.

THIS IS ONE CONVENTION. Other groups running their own beach-game can fork it (copy this block to their-gm/their-game-protocol and edit). Nothing in pscale-mcp's substrate enforces this particular shape. The shape works if everyone in the game is using it; coherence is the enforcement. The framework conventions in sed:conventions/5 (write-auth, authorship, observation streams) are what you'd want any fork to honour.

POSITIONS as situations (not event hooks):
  1 arriving       — orientation for first-time and returning players
  2 taking-turn    — what to do when the user gives input
  3 reading-back   — what to do when checking for what happened
  4 substrate-and-convention — what tools do vs what GRIT and authorship do
  5 returning      — continuity across chat sessions
  6 privacy-and-locks — what your passphrase guards
  9 see-also       — star-refs to framework conventions and game blocks

Walk dir on first connect to see all six. Walk to the position matching your situation when in doubt.

v0.6 supersedes v0.5 (2026-04-26). Substrate changes since v0.5: pscale_lock_block (commit beef822, ordinary-block write-lock); pool identity-gate (commit 052e285, secret on pool_send/pool_join when passport is locked); GRIT inert metadata dropped (commit 5cf2fb2). Framework conventions added at sed:conventions/5.3-5.5 (commit 450dc66) — write-auth, authorship registry, observation streams.`;

const ARRIVING = `Arriving — first-time and returning players.

1) Ask the user: "What's your character's name (and a one-line description)? And a passphrase you'll remember — one memorable phrase that secures this character across future sessions."

2) Derive agent_id as thornkeep-{name-lowercase-dashed}. Hold the passphrase in conversation context for the whole session — use it as secret= in every gated operation below. Never repeat it back to the user.

3) pscale_passport_read agent_id=thornkeep-{name}. If a passport EXISTS: this is a RETURNING player → step 7. If not: this is a NEW player → step 4.

4) NEW player: pscale_passport_publish with agent_id, description (underscore), offers (1), needs (2).

5) NEW player: pscale_key_publish agent_id=thornkeep-{name} secret={passphrase} — publishes deterministic Ed25519+X25519 keys to passport position 9.

6) NEW player: pscale_lock_block agent_id=thornkeep-{name} name=passport secret={passphrase} — locks the passport. After this, every pool_send and pool_join under your agent_id must pass secret={passphrase}. The lock IS your impersonation defence on the pool. Continue to step 8.

7) RETURNING player: verify passphrase by attempting an authenticated read — pscale_inbox_check agent_id=thornkeep-{name} secret={passphrase}. If it returns without decryption errors, passphrase is correct. If decryption fails, tell the user "passphrase does not match this character — try again or pick a different character name." Then continue to step 8.

8) Ensure memory block exists, locked. pscale_walk agent_id=thornkeep-{name} name=memory mode=dir. If not found: pscale_create_block agent_id=thornkeep-{name} name=memory initial_content="session log for {name}" secret={passphrase} (creates locked). Then pscale_write address=1 content="{timestamp}: Character {created|resumed}. {description}" secret={passphrase}.

9) Ensure observation block exists, locked. pscale_walk agent_id=thornkeep-{name} name=thornkeep-observations mode=dir. If not found: pscale_create_block agent_id=thornkeep-{name} name=thornkeep-observations initial_content="{name}'s observations of Thornkeep — canon-candidate detail noticed during play" secret={passphrase}. This is where you write canon contributions; the world compressor reads it. NEW players: continue to step 10. RETURNING players: pscale_walk address=  with secret={passphrase} to recall what you've noticed.

10) RETURNING only: pscale_walk agent_id=thornkeep-{name} name=memory mode=dir secret={passphrase} — reconstruct prior context. Summarise to user: "Picking up where you left off: …".

11) pscale_beach_mark url=https://play.onen.ai/thornkeep with character agent_id and purpose_coordinate=starting_room (1 Harbour, 2 Market Square, 3 Inn — RETURNING uses last-known room from memory if recorded).

12) pscale_pool_join url=https://play.onen.ai/thornkeep secret={passphrase}. Without secret, the join is rejected per the locked-passport gate.

13) pscale_pool_send url=https://play.onen.ai/thornkeep content="{character} arrives at {room}" secret={passphrase}. This contributes to the chronicle.

14) pscale_walk agent_id=thornkeep-gm name=thornkeep-world at the starting room address — narrate to user.

15) Tell user: "you've arrived; the next [GRIT EVENT …] in the pool will pick up your action; resolver agents synthesise approximately every 60s when there's pending liquid." See substrate-and-convention (4) for what that means.`;

const TAKING_TURN = `Taking-turn — what to do when the user gives input.

Three classes of input. Pick by reading what the user said.

LOCAL READ (look, where am I, who's here, examine X, recall my last action):
  - pscale_walk agent_id=thornkeep-gm name=thornkeep-world at the room/address.
  - pscale_pool_read url=https://play.onen.ai/thornkeep — see the recent stream.
  - pscale_beach_read url=https://play.onen.ai/thornkeep — see who's around.
  - Optional: pscale_walk agent_id=thornkeep-{name} name=thornkeep-observations secret={passphrase} — see what you've noticed.
  Narrate to user. NO writes.

ACTION (your character does something with a possible outcome — moves, speaks, attacks, picks up):
  - pscale_pool_send agent_id=thornkeep-{name} url=https://play.onen.ai/thornkeep content="<outcome-free description of what your character attempts>" secret={passphrase}.
  - STOP. Do not narrate the outcome — that is the resolver's job (see reading-back, position 3). The substrate is plain append-only; nothing closes a window automatically; it accumulates until a resolver agent posts a [GRIT EVENT …] envelope.
  - Tell the user: "your action is in the pool; resolution comes back via the next [GRIT EVENT …]."

NOTICING (your character notices a canonical detail — colour, accent, smell, hidden mark; or after reading a resolver event you want to add a detail to canon):
  - pscale_write agent_id=thornkeep-{name} name=thornkeep-observations address=<next free position> content="thornkeep-world@<room-address> — <observation detail>" secret={passphrase}.
  - The TARGET prefix (thornkeep-world@<address>) tells the compressor which world position the detail belongs to. The DETAIL after the em-dash is what was noticed.
  - This is how canon grows. The world compressor reads observation blocks of registered authors (sed:thornkeep-authors) and integrates noticing into the world block.
  - For now, only registered authors' observations are integrated. If you are a player but not an author, your observations are still durable for your own continuity but won't reach shared canon until you register.
  - NO pool write. Noticing is a private contribution surfaced through compression, not broadcast through the pool.`;

const READING_BACK = `Reading-back — what to do when the user says "check" / "what happened" / "my turn" / periodically while waiting.

1) pscale_inbox_check agent_id=thornkeep-{name} secret={passphrase} — gray inbox decryption. Triage per wake-decision-tree (resolution_confirmed, grain_establish/accept, ordinary messages).

2) pscale_pool_read url=https://play.onen.ai/thornkeep — chronological stream since your read marker, capped at 200 with marker pagination (more_available:true → call again until exhausted).

3) For each [GRIT EVENT resolves=<ts> window=<s>s] contribution that affects your character (your name appears in the synthesis), narrate the synthesis to the user as if it just happened. Add it to memory: pscale_remember agent_id=thornkeep-{name} secret={passphrase} content="<event summary>".

4) Optional but recommended: if the resolver event mentioned canonical detail you want to lock in (a named NPC, a described object, a sensed atmosphere), follow the noticing path in taking-turn (2) — write it to your observations block.

5) For liquid contributions from other characters (no envelope prefix), you may react via the action path on your next turn. You do NOT resolve windows yourself; resolution is the resolver agent's role (e.g. crab-thornkeep, or any non-contributing peer).

6) If you ARE a registered resolver (rare for player Claudes; intended for crab-* agents), follow scripts/grit-resolver.ts logic instead: identify open window, fairness self-check (skip if you're in contributors), race-tolerance re-read, post envelope. See sed:conventions/5.2.1 for full turn-loop spec.`;

const SUBSTRATE_AND_CONVENTION = `Substrate-and-convention — what tools do vs what GRIT and authorship do.

SUBSTRATE (pscale-mcp tools, post 25-26 April 2026):
  - pscale_pool_join, pscale_pool_send, pscale_pool_read are an append-only stream with per-agent read markers and a 200-per-call page cap. No rounds, no states, no event/liquid distinction at the schema level.
  - pscale_lock_block applies a whole-block write-lock on ordinary blocks. Required for sovereign-shell, character-identity, and game-state assertions.
  - pool_send/pool_join verify the sender's passport-lock if present. Bare agent_id without a locked passport remains unrestricted (open-by-default).
  - sed: collectives + grain: pairs have their own ownership-gates at write time.
  - There is NO server-side fairness check, NO server-dispatched resolution_request, NO message_type distinguishing event from liquid.

CONVENTION LAYER GRIT (docs/protocol-grit.md, scripts/grit-resolver.ts):
  - A "window" is the liquid contributions in the pool after the most recent [GRIT EVENT …] contribution.
  - The window is closeable when (now - window_start) >= window_seconds (per-game; default 60).
  - A resolver agent (any non-contributor with a read marker on the pool — for Thornkeep typically crab-thornkeep) detects closeable windows, calls an LLM to synthesise (rules + world + window liquid), posts the synthesis as a normal contribution prefixed [GRIT EVENT resolves=<window_start> window=<s>s].
  - Fairness, race tolerance, and notification (pull-only on next pool_read) are convention only. See sed:conventions/5.2 for turn loop, fairness, chronicle.

CONVENTION LAYER AUTHORSHIP (sed:conventions/5.4-5.5):
  - World canon is shaped by registered authors, not all players. A player who wants to contribute canon registers in sed:thornkeep-authors at a position with their passphrase + a pointer to their observation block.
  - The world compressor (scripts/world-compressor.ts) reads observations from registered authors since the last compression cursor (stored in thornkeep-world position 9 hidden directory), integrates per affected world position, writes the world under the GM lock-secret.
  - Players who are not authors still benefit from canon (they read the integrated world); their personal observations stay private to their own block.

What changed from v0.5:
  - Pool gate added (lock your passport at arriving step 6 → pool requires secret).
  - Observation streams (per-author locked block) replace the speculative pool message_type=observation that was scoped 23 April but never shipped — observations don't go through the pool at all in v0.6.
  - Old GRIT substrate metadata removed entirely from the schema (commit 5cf2fb2).`;

const RETURNING = `Returning — continuity across chat sessions and devices.

All character state persists in Supabase independently of any chat session: the passport, the gray-encrypted memory block, the locked observation block, the pool chronicle, the inbox.

To resume in any fresh Claude chat on any device:
  - The user says "my character is thornkeep-{name}, passphrase {phrase}" (or your initial prompt asks).
  - Run arriving (1) — step 3 (passport_read) detects the existing passport → step 7 (verify passphrase via inbox_check) → step 8 (memory exists, walk it with secret) → step 10 (summarise to user) → steps 11-13 (beach, pool, arrival liquid) → step 14 (narrate world).

Memory is the bridge: every reading-back appended confirmed events. The next session reads memory and the narrative continues without requiring the prior chat's prose.

Observations carry forward similarly: walk thornkeep-observations with secret to recall what your character has noticed of the world.

If the passphrase is lost: gray state is unreachable (substrate-level crypto, no recovery). The character is effectively orphaned. Player can start a new character; this is a hard cost of the lock primitive's strength.`;

const PRIVACY_AND_LOCKS = `Privacy-and-locks — what your passphrase guards, and what it does not.

GUARANTEES (substrate-enforced):
  - Inbox: gray-encrypted to your X25519 public key. Only the passphrase holder decrypts. Resolution events addressed to your character via inbox cannot be intercepted.
  - Memory block: locked AND optionally gray-encrypted. Lock prevents impostor writes; gray encryption (when used) prevents reads.
  - Observation block: locked. Impostors cannot pollute your stream. (Unencrypted reads by default — the world compressor needs to read your observations to integrate canon. If you want some observations private, write them to a separate gray-encrypted memory block.)
  - Passport: locked. Pool sends + joins under your agent_id are rejected without your secret. Substrate-enforced as of 2026-04-26.
  - sed:thornkeep-cast position (if you registered there): writes from your sed: address require the registration passphrase.

WHAT THE LOCK DOES NOT DO:
  - Read access on locked-but-not-gray-encrypted blocks is public. The lock is post-as-me only; visibility is gray-encryption's separate concern.
  - The lock is per-block. A player who wants ALL their game state locked must lock each block individually (passport, memory, observations).
  - Lock secrets are local to your client (held in conversation context for a session). If your client log is compromised, the lock is compromised. Treat secrets like passwords.

HOW THE PIECES LAYER:
  - Lock = "only I can write here."
  - Gray encryption = "only I can read this."
  - sed: registration = "I am position N in this collective, prove it via passphrase."
  - Stack as needed. Most characters lock passport + memory + observations; gray-encrypt memory only.`;

const SEE_ALSO = {
  '_': 'Star references to framework conventions and the game blocks.',
  '1': 'sed:conventions/5 — Onen / GRIT framework (5.1 structure, 5.2 turn loop / fairness / chronicle, 5.3 write-auth, 5.4 authorship, 5.5 observation streams). Locked under ubarakar142.',
  '2': 'thornkeep-gm/thornkeep-world — the canon. Walk dir to see all rooms. Locked once the GM applies pscale_lock_block; reads remain public.',
  '3': 'thornkeep-gm/thornkeep-rules — game rules referenced by resolvers. Locked once the GM applies pscale_lock_block; reads remain public.',
  '4': 'sed:thornkeep-authors — author registry (when world canon contributions are scoped to a registered subset). Created at step 5 of Thornkeep test prep.',
  '5': 'docs/protocol-grit.md and scripts/grit-resolver.ts — the GRIT spec and reference resolver in pscale-mcp-server.',
  '6': 'pscale-mcp/scripts/world-compressor.ts — the script that reads registered authors\' observation streams and integrates into the world (created at step 7 of Thornkeep test prep).',
};

async function main() {
  const client = getClient();

  console.log('reading current thornkeep-protocol...');
  const { data: row, error: readErr } = await client
    .from('pscale_blocks')
    .select('block, position_hashes, block_type')
    .eq('owner_id', AGENT)
    .eq('name', NAME)
    .single();
  if (readErr || !row) {
    console.error('failed to read protocol:', readErr);
    process.exit(1);
  }

  const positionHashes = (row as any).position_hashes;
  const blockType = (row as any).block_type;

  if (positionHashes && Object.keys(positionHashes).length > 0) {
    console.warn('protocol already has position_hashes — block is locked. Direct upsert will succeed (RLS is open) but this script should be considered admin-only.');
  }

  const newBlock = {
    _: UNDERSCORE,
    '1': ARRIVING,
    '2': TAKING_TURN,
    '3': READING_BACK,
    '4': SUBSTRATE_AND_CONVENTION,
    '5': RETURNING,
    '6': PRIVACY_AND_LOCKS,
    '9': SEE_ALSO,
  };

  console.log('upserting new block...');
  const { error: writeErr } = await client
    .from('pscale_blocks')
    .upsert(
      {
        owner_id: AGENT,
        name: NAME,
        block_type: blockType,
        block: newBlock,
        position_hashes: positionHashes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,name' },
    );
  if (writeErr) {
    console.error('upsert failed:', writeErr);
    process.exit(1);
  }

  // Verify
  const { data: check } = await client
    .from('pscale_blocks')
    .select('block')
    .eq('owner_id', AGENT)
    .eq('name', NAME)
    .single();
  const written = (check as any).block;
  const ok = !!(written._.includes('v0.6') &&
                written['1'].includes('Arriving') &&
                written['2'].includes('Taking-turn') &&
                written['3'].includes('Reading-back') &&
                written['4'].includes('Substrate-and-convention') &&
                written['5'].includes('Returning') &&
                written['6'].includes('Privacy-and-locks') &&
                written['9']._);
  if (!ok) {
    console.error('verification failed; check db state');
    process.exit(1);
  }

  console.log('\n✓ thornkeep-protocol v0.6 written');
  console.log('  Positions:');
  console.log('    1 arriving       (was ON JOIN)');
  console.log('    2 taking-turn    (was ON USER INPUT)');
  console.log('    3 reading-back   (was ON TURN)');
  console.log('    4 substrate-and-convention');
  console.log('    5 returning');
  console.log('    6 privacy-and-locks');
  console.log('    9 see-also (star refs)');
  console.log('\nVerify: pscale_walk agent_id=thornkeep-gm name=thornkeep-protocol mode=dir');
}

main().catch(e => { console.error(e); process.exit(1); });
