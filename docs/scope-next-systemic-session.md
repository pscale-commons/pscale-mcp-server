# Scope for next systemic session — narrative cohesion + write-auth

**Framed as a single systemic jump**, not two unrelated fixes. These two problems share the same root: the substrate doesn't currently enforce who can write what, which is what makes both narrative cohesion and character lock-down dependent on honor-system conventions today.

## The systemic gap

Exactly one write-auth primitive is server-enforced: the sed:-passphrase at registration positions. Gray encryption protects READS, not WRITES. Everything else — passports, world blocks, pool contributions — is honor-system. That gap forces every design decision into one of three unpleasant shapes:

1. Trust everyone (works for small groups, breaks at public scale)
2. Sed: everything (works but is heavy — every writable entity needs registration with a passphrase)
3. Defer the question (what we've done so far)

We've been taking option 3 and it's now limiting us.

## The jump — signed writes as a substrate primitive

Add a `signature` field to `pscale_write` (and by extension `pool_send`, `inbox_send`, `passport_publish`). Server verifies the signature against the writer's published Ed25519 public key, which already lives at passport position 9 (published by `pscale_key_publish`). If signature present and valid → write proceeds. If present and invalid → rejected. If absent → open (backward-compatible).

This solves character lock-down, world edit auth, and rules/protocol edit auth with one primitive, gradually. Players who care sign; players who don't don't. No universal sed: registration required. The infrastructure for derivation already exists — `pscale_key_publish` publishes both x25519 (encryption) and ed25519 (signing) keys from a passphrase. Only the verify + accept path is missing.

## Narrative cohesion — the three layers, properly

Once signed writes exist, the narrative cohesion layers become:

### Layer 1 — Private character memory (WORKING AS OF v0.4.1)
Each character has a gray-encrypted memory block. ON JOIN creates it on-demand (v0.4.1 fix); ON TURN appends confirmed events; RESUMING reads it. Private to the passphrase holder. **Already landed; nothing to do.**

### Layer 2 — Public observation stream
New pool message type `observation`. When a player's LLM narrates an OBSERVATION (look, listen, who's here), after narrating it also posts `pool_send message_type=observation content=<structured JSON>` with room + detail. Observations don't attach to rounds (no round_id, no round engine semantics); they're a typed stream on the same pool.

**What this needs:**
- ~~Supabase DDL: expand `valid_message_type` constraint to include `observation`. Add `last_compression_at TIMESTAMPTZ` to `pool_state`.~~ **APPLIED 23 April via CLI** (`supabase/migrations/20260423201814_grit_observations_layer.sql`). DDL is live on remote; local repo now tracks migrations under `supabase/migrations/`.
- `pool-ops.ts`: handle `message_type=observation` (simple passthrough insert, no round logic).
- Protocol v0.5: extend ON USER INPUT → OBSERVATION with post-narration observation posting (after narrating, structure the invented canonical detail and post_send it).
- Signed writes so impostors can't pollute the observation stream with false canon under another character's name.

### Layer 3 — World compression (canon integration)
A script (`scripts/world-compressor.ts`) reads observations since `last_compression_at`, groups by room, per-room LLM call integrating observations into the world description, writes updated room descriptions to `thornkeep-world`, updates `last_compression_at`. Manual invocation; cron or scheduled crab later.

**What this needs:**
- Layer 2 schema in place.
- The script itself (~100 lines, parallels `grit-resolver.ts`).
- Write access to `thornkeep-world` — either (a) GM runs the script with implicit trust, (b) the compressor agent is registered in `sed:thornkeep-world-admin`, or (c) compressor signs writes with the GM's Ed25519 key (requires signed-writes primitive).

Option (c) is the systemic move.

## Character lock-down

Two shapes, same problem:

### Shape A — sed:thornkeep-cast (available today)
Dedicated character-roster sed: collective. Each character registers at a position with their passphrase. Canonical identity becomes `sed:thornkeep-cast:N`. Every pool_send and inbox call goes through that address with `secret=<passphrase>` — server rejects writes without the passphrase.

Works today. Heavy: requires protocol adjustment to use the sed: address as canonical identity for registered characters.

### Shape B — signed writes (V2 substrate)
Character stays as bare agent_id. Writes include an Ed25519 signature. Server verifies against the character's published public key. Anyone without the passphrase cannot produce a valid signature; their write is rejected.

Lighter for the player. Requires substrate extension.

**Recommendation:** build B in the next session as part of the systemic jump. Keep A as a note for paranoid players who want lock-down before B ships.

## Pre-coding design decisions (resolved 23 April)

Four decisions that sharpen the scope from "roughly systemic" to "genuinely systemic". Each is load-bearing. Build session should re-read this section before touching code.

### D1. Observation shape — PSCALE, not flat category-JSON

**Observations are pscale blocks**, not `{"room": "2", "detail": "..."}`-style category records. The CLAUDE.md warning — "position encodes relationships; depth IS the meaning; don't add category layers the tree already provides" — applies here directly. Observations are first-class pscale data.

**Convention for an observation's pscale shape** (serialised as JSON into the pool contribution's `message`):

```
{
  "_":  "natural-language summary of what was observed",
  "1":  "thornkeep-world@2",                            // target: address in affected block
  "2":  {                                                // content to integrate (pscale sub-tree)
    "_":  "subject summary (e.g. 'Ennick, hawker selling salted cod')",
    "1":  "first attribute",
    "2":  "second attribute",
    ...
  }
}
```

Position 1 is the target reference (block + pscale address). Position 2 is itself a pscale sub-tree (underscore + positions). The compressor walks the target, places `2` at the next free position under that room (or as a nested addendum; depends on shape). World stays pscale-shaped.

**Where observations live structurally:** also worth considering — a per-character `observations` block (`thornkeep-{name}/observations`) that accumulates observations as sub-positions over time. The pool contribution then carries a pointer (star-ref) to the latest observation position on that block, not the full content. Keeps the pool light and makes observations first-class per-character data. This is the cleaner shape long-term; V0.5 can ship with either shape (content-in-pool or pointer-in-pool), decide at build time based on compressor simplicity.

**Rule of thumb for all future substrate decisions:** if you find yourself writing `{key: value}` where `key` is a category label ("type", "room", "detail"), stop. Pscale encodes category through POSITION. The tree already knows.

### D2. World compressor — AUTHORS write to world

The compressor is the process that integrates observations into world blocks. **Only authors have write rights to the world.** Authors are a distinct role from characters — a player can be both, but the write paths are different.

**Authority model:**
- Author identity lives in a sed: collective (see D3): `sed:{game}-authors`.
- Compressor invocation is author-authenticated: the running compressor signs writes to `thornkeep-world` with the author's Ed25519 key (derived from their passphrase via `pscale_key_publish`, verified server-side against the author's passport position 9).
- Any author can run the compressor. Any author's write is valid. Multiple authors = multiple compression passes possible; they should coordinate out-of-band or the compressor should be atomic per room.

**Infrastructure:**
- Compressor runs as a script (`onen/scripts/world-compressor.ts` once the onen/ directory exists, or `scripts/` for now). Manual invocation at first; cron / paid-tier crab later.
- Reads observations from pool since `last_compression_at`, groups by target address, one LLM call per target room integrating observations into current description, signed write, updates `last_compression_at`.

### D3. Per-role seds, ONE passphrase per player

**Four per-role sed: collectives** — one per mode:
- `sed:{game}-cast` for characters (players)
- `sed:{game}-authors` for authors
- `sed:{game}-designers` for designers
- `sed:{game}-directors` for directors

A single person registers only in the seds their roles require. Default new player tomorrow: registers only in `sed:thornkeep-cast`. One passphrase, one sed, one position, done.

**One passphrase per player, not per role.** A player who's both character and author uses the SAME passphrase across both sed registrations. Convention, not technically enforced — but protocol v0.5 should default to reusing and not ask for a separate passphrase.

**Backward compat for existing characters (Druss, Fardle):**
- They already have `pscale_key_publish`'d keys from this session. Their passphrase works as-is.
- On first resume after v0.5, protocol detects "passport exists, no cast registration" → asks "Register as cast member? (y/n; same passphrase)". If yes, calls `pscale_register` in `sed:thornkeep-cast`. Character's canonical write-identity becomes `sed:thornkeep-cast:N`; display name stays `thornkeep-{name}`.
- After registration, all pool sends use `from_agent=sed:thornkeep-cast:N secret={passphrase}` — server-enforced write-lock. Impersonation blocked.

**New players (tomorrow):**
- ON JOIN asks for character name + passphrase (as v0.4.1).
- Protocol additionally calls `pscale_register collective=thornkeep-cast declaration={one-liner} passphrase={passphrase}` — single step, same passphrase.
- From then on, all writes go through `sed:thornkeep-cast:N` with the passphrase. Player never sees the sed: mechanics; just plays.

### D4. Self-test PASS criteria

End-to-end smoke test after v0.5 lands. Order:

1. Druss (registered in `sed:thornkeep-cast`) observes at Market Square: "a hawker named Ennick sells salted cod from the Broken Coast catch" — posts via `pool_send message_type=observation`.
2. Observation appears in pool with `message_type=observation`, signed by Druss's key, linked to round-less entry.
3. Author (David's `thornkeep-gm` as author, or a dedicated author registered in `sed:thornkeep-authors`) runs world-compressor.
4. Compressor integrates observation into `thornkeep-world@2` (Market Square), signing the write with author's Ed25519 key.
5. Fardle (separate character) walks into Market Square for the first time post-compression, `pscale_walk thornkeep-world@2 mode=dir` — **the room description now contains Ennick the hawker**, traceable back to Druss's observation.
6. Impostor attempt: someone posts `from_agent=sed:thornkeep-cast:N` (Druss's position) without the passphrase → **rejected at server**.
7. Impostor attempt: someone signs a world write with a non-author key → **rejected at server**.

All seven must pass for the systemic release to be considered landed.

## Order of operations for the next session

1. Signed writes on `pscale_write` (server-side). Smoke test.
2. Extend `pool_send`, `inbox_send`, `passport_publish` to accept signatures.
3. Supabase DDL for `observation` message_type + `last_compression_at`.
4. Pool-ops Layer 2 passthrough.
5. Protocol v0.5: ON USER INPUT → OBSERVATION with observation posting.
6. `scripts/world-compressor.ts` with signed writes (Option c above).
7. Test end-to-end: Druss observes → appears in pool as observation → compressor integrates into world → Fardle visits room later and sees updated description.

**Scope gate:** don't start step 2 until step 1's smoke test passes. Don't start step 6 until step 5 is landed. Systemic, not sequential patching.

## What NOT to do

- Don't add `message_type=observation` as a content-prefix workaround on the existing `chat` type. Tempting when Supabase MCP is unauthed; it creates tech debt that lives forever. Wait for the real DDL.
- Don't build `sed:thornkeep-cast` as the character-lock answer. It works but commits us to the wrong direction — signed writes is the systemic answer.
- Don't add per-tool signature verification separately. Do it once in a shared helper and apply everywhere.

## Pre-session prep

- **Skip Supabase MCP; use the CLI.** `supabase link --project-ref piqxyfmzzywxzqkzmpmm` is already done (23 April). For new DDL: `supabase migration new <name>` → edit the SQL file → `supabase db push --linked`. If the local migrations directory disagrees with remote history, `supabase migration repair --status reverted <versions>` to reconcile before pushing. Supabase MCP auth is flaky across sessions; CLI is the reliable path.
- Read the nacl signing primitives already used by `crypto-ops.ts` and `pscale_key_publish` — the Ed25519 key is already derived and published; only the verify path is missing.
- Review the v0.4 protocol: ON JOIN (now v0.4.1 with robust memory handling), ON USER INPUT, ON TURN. The v0.5 changes are additions to ON USER INPUT, not rewrites.
- `supabase/migrations/` directory now tracks all future DDL. The 13 pre-existing migrations were marked `reverted` in the repair step so local tracking starts fresh from 23 April; they remain applied on remote.
