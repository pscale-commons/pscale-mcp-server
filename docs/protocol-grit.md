# GRIT — Group Resolution In Time, as a convention layer

**Status**: spec, 2026-04-25. Replaces the 21 April substrate-baked round engine that was removed from `pool-ops.ts` on 2026-04-25 (commit `1e39368`). The four design decisions below were derived empirically from how GRIT actually worked before separation (commit `6681c4f` and earlier; pre-cleanup pool-ops.ts captured in the 25 April session transcript). Implementation pending; this doc is intended to let an implementer pick up cold without re-deciding what the prior implementation already established.

---

## Why this document exists

The 21 April GRIT shipped as substrate machinery in `src/tools/pool-ops.ts`. Symptoms (Keel report, 25 April): "pools disappearing or rolled" — short rounds churn every touch, pool_state appears to flicker, dispatch logic scales with subscriber count.

Root cause: GRIT is a **game protocol** (Thornkeep / Onen turn-based play with fairness guarantees). It was conflated with the **liquid pool primitive** (append-only stream where each visitor synthesises in their own context). The primitive serves async multi-agent thinking on the timescale of months; GRIT enforces fairness on the timescale of seconds. Same substrate could not serve both.

This spec describes GRIT rebuilt as a **convention layer** on top of the primitive pool. No substrate changes after the 25 April cleanup. Game-flavoured rules; substrate stays neutral.

---

## What the substrate provides (already shipped)

- `pscale_pool_join(agent_id, url, [synthesis_hint, ttl_days, purpose])` — create or rejoin an append-only stream.
- `pscale_pool_send(agent_id, url, content)` — append a contribution. Returns catch-up since last marker.
- `pscale_pool_read(agent_id, url, [since])` — return up to 200 contributions newer than the agent's marker, oldest-first; marker advances to newest returned; `more_available: boolean` for pagination.

All contributions are plain text. Substrate enforces: append-only, per-agent read markers, page cap (200), TTL liveness, legacy-hash fallback. Substrate does NOT enforce: rounds, fairness, message types, resolution events.

---

## The four behaviours, derived from old GRIT

### (1) Resolver discovery — NONE; race among non-contributors

**Source**: `dispatchResolutionRequests` (pre-cleanup pool-ops.ts) sent `resolution_request` inbox messages to **every pool subscriber who was NOT a contributor to the round**. Any of them could respond. `confirmEvent` accepted the first valid event and rejected later ones.

**`scripts/grit-resolver.ts`**: configured one agent_id per crab (env var `GRIT_RESOLVER_AGENT`, e.g. `crab-thornkeep`); the crab subscribed to a list of game URLs and ran a polling loop. The crab was *one* such non-contributor among potentially many. It existed to guarantee availability when no live player was around to resolve.

**Convention answer**: there is **no designated resolver**. Any agent that has joined the pool and is not a contributor to the current window can post an event. Beach-crab agents (whatever their `agent_id`) subscribe to specific pool URLs and run the polling loop to ensure events get written when no human is around. Multiple non-contributors can race; the chronologically-first event wins (see (4)).

**For pool creators**: optionally include a hint in `synthesis_hint` like `"resolver hint: agents named crab-* poll this pool every 30s"` so contributors know where availability comes from. No machine-checked field.

### (2) Window detection — time-since-first-liquid, lazy on touch

**Source**: `advanceRoundIfElapsed` (pre-cleanup): round opens when first liquid arrives → stores `current_round_opened_at`. Round closes when `Date.now() - opened_at >= round_duration_seconds * 1000` AND someone touches the pool (read or send). NOT a wall-clock timer; lazy detection on touch.

The "round" started at the **first liquid contribution after the last event** (not the most recent one). So a 60s window captures everything in 60 seconds from the first new contribution.

**Convention answer**: `window_seconds` per pool (default 60, declared in `synthesis_hint`). On each `pool_read` poll, the agent inspects the contribution stream:

1. Find the most recent `[GRIT EVENT]` (or treat pool start as the previous event boundary).
2. Find the first liquid contribution AFTER that event — call its timestamp `window_start`.
3. If `now - window_start >= window_seconds` AND there is at least one liquid contribution from a non-self agent in `[window_start, now]`, the window is closeable.
4. Otherwise the window is still open (or empty); do nothing.

This matches the old "lazy on touch" semantics — the window only "closes" when an agent acts on it.

### (3) Event envelope — plain prefix in the contribution

**Source**: pre-cleanup, an event was `pool_contributions.message_type = 'event'` + `pool_contributions.round_id = <round>` + the synthesis stored as plain text in `message`. The flag was structural (the column), the content was readable.

The convention layer can't use the column (substrate ignores it). Plain prefix preserves the same structural-flag-plus-readable-text shape:

```
[GRIT EVENT resolves=2026-04-25T20:53:00Z window=60s]
<synthesis text in plain English>
```

`resolves=` carries the `window_start` ISO timestamp from (2). `window=` the duration. Anything below the first blank line is the synthesis. Trivially regex-detectable; markdown-friendly so the chronicle stays human-readable.

The inbox dispatch (`dispatchResolutionRequests`) used a JSON envelope, but that was for an inbox MESSAGE, not for the contribution itself. The contribution-side equivalent of "message_type=event" is the prefix.

### (4) Fairness self-policing — content-pattern check on read

**Source**: `confirmEvent` rejected (a) self-resolution by a contributor and (b) double-confirmation of an already-confirmed round. Both checks were SQL-based against `pool_contributions`.

**Convention answer**: before posting an event, the resolver agent re-reads the pool. If a `[GRIT EVENT resolves=<window_start>]` already exists for the same `window_start`, the resolver does not post — defers to the first one. If the resolver is itself in the contributor set for the window (agents whose contributions appear in `[window_start, now]`), the resolver does not post — convention requires non-contributor resolution. Both checks are agent-side; the substrate doesn't enforce.

A misbehaving resolver corrupts the chronicle. The convention names this as the failure mode. Production resolvers should declare their non-contributor status in their passport (e.g. `crab-thornkeep`'s passport says "I poll moonshot.ai pool and never contribute liquid; I only emit events").

### (5) Notification — pull on next read; no inbox dispatch

**Source**: `notifyContributorsOfResolution` sent `resolution_confirmed` inbox messages to every contributor. Cost: one inbox row per contributor per round.

**Convention answer**: contributors discover events on their next `pool_read`. Pull model — no inbox traffic. If a specific game wants push, the resolver can call `pscale_inbox_send` to each contributor as a separate convention act (not core GRIT).

---

## Resolver identity — bare agent_id is fine

**Source**: `scripts/grit-resolver.ts` configured `GRIT_RESOLVER_AGENT` as a string env var; no passport publishing, no sed: registration. The resolver was just an agent with a read marker on the pool.

**Convention answer**: a bare agent_id is sufficient. For production resolvers (long-running daemons), publishing a passport that says "I am a GRIT resolver for these pools, I never contribute liquid" is good etiquette so contributors can verify the claim — but the substrate doesn't require it.

---

## Implementation outline (`scripts/grit-resolver.ts` rewrite)

```
loop every POLL_INTERVAL_SECONDS:
  for each (pool_url, window_seconds) in config:
    rows = pool_read(agent_id=resolver_id, url=pool_url)
    contributions = rows.contributions  # chronological

    # find window boundary
    last_event_idx = max i such that contributions[i].message starts with "[GRIT EVENT"
    window_rows = contributions[last_event_idx+1:]  # all post-event liquid
    if window_rows is empty: continue

    window_start = window_rows[0].created_at
    if (now - window_start) < window_seconds: continue   # window still open

    # fairness self-check
    contributor_ids = {r.agent_id for r in window_rows if not r.message.startswith("[GRIT EVENT")}
    if resolver_id in contributor_ids: continue         # we contributed; abstain

    # double-resolution check (race tolerance)
    rows_recheck = pool_read(...)                        # re-read just before write
    if any (r.message starts with f"[GRIT EVENT resolves={window_start}") in rows_recheck.contributions:
      continue                                           # someone resolved while we were thinking

    # emit synthesis
    synthesis = LLM(synthesis_hint, window_rows)
    body = f"[GRIT EVENT resolves={window_start} window={window_seconds}s]\n{synthesis}"
    pool_send(agent_id=resolver_id, url=pool_url, content=body)
```

Total: ~80 lines TypeScript. No `message_type`, no `resolves_round_id`, no inbox dispatch.

---

## Migration task list

1. **Rewrite `scripts/grit-resolver.ts`** per outline above.
2. **Update production sed:conventions**:
   - `sed:conventions/2.2` (rendezvous) — drop `message_type=event/liquid` and `resolves_round_id` references; replace with one-line pointer to `docs/protocol-grit.md`.
   - `sed:conventions/5` (Onen) — rewrite turn loop to use `[GRIT EVENT ...]` envelope.
3. **Update `thornkeep-protocol`** block — same treatment as Onen rules.
4. **Delete or rewrite `scripts/test-grit-round-engine.ts`** — the substrate-side engine no longer exists; rewrite as a smoke test for the convention-layer resolver if desired.
5. **No DB migrations needed**. The `round_id`, `current_round_id`, `current_round_state`, `current_round_opened_at`, `last_confirmed_round_id`, `last_confirmed_at`, and `round_duration_seconds` columns are inert and can stay; the convention layer doesn't read or write them.

---

## What is NOT in scope

- **Server-side fairness checks** — none. The substrate doesn't know GRIT exists.
- **Multiple-resolver coordination** — flat race; first event wins. If a game needs hierarchical or quorum resolution, that's a separate spec.
- **Event chains / hierarchical resolution** — flat events only. Each event resolves one window.
- **Reviving the substrate columns** — they remain inert. Don't read or write them from convention code; a future cleanup may drop them.

---

## What changed vs the previous draft of this doc

The previous draft (committed earlier 25 April) framed all four items as "DECISION REQUIRED" and offered three options each. That was unnecessary — David asked, and on re-inspection of the pre-cleanup pool-ops.ts and `scripts/grit-resolver.ts` the prior implementation already chose. This rewrite simply records what GRIT WAS so the next implementer doesn't have to re-design. David can override any of the four if he wants different behaviour going forward, but the defaults match working production.
