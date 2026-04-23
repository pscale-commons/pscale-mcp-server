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
