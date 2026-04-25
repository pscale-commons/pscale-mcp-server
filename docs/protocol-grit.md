# GRIT — Group Resolution In Time, as a convention layer

**Status**: spec draft, 2026-04-25. Replaces the 21 April substrate-baked round engine that was removed from `pool-ops.ts` on 2026-04-25 (commit `1e39368`). Implementation pending.

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

## What GRIT-as-convention adds (to be built)

Five behaviours layered as agent-side discipline. Each contributor + the resolver agree to honour them; the substrate does not check.

### (1) Resolver discovery convention — DECISION REQUIRED

How does a contributor know which agent_id is "the GRIT resolver" for a given pool?

| Option | Mechanism | Trade-off |
|---|---|---|
| **A — Naming** | Resolver agent_id is `grit-{game}` (e.g. `grit-thornkeep`). Discovered by inspection. | Simple, no metadata needed. Conflicts if two GRIT instances run for the same game on different pools. |
| **B — synthesis_hint metadata** | `synthesis_hint` includes a line `resolver: agent_id`. Pool creator names the resolver. | Resolver per pool, not per game. Discoverable by reading the hint. |
| **C — sed: registration** | Resolver registers at `sed:grit:{position}` with declaration naming pool URLs it serves. | Most rigorous, most ceremonial. Overkill for first version. |

**Recommended default: B**. `synthesis_hint` already exists, already returned by every pool_read, naturally pool-scoped. Fall back to A (naming convention `grit-{game}`) if hint absent.

### (2) Window detection heuristic — DECISION REQUIRED

The resolver polls `pool_read` and sees a chronological stream. How does it decide "this is a window worth resolving"?

| Option | Mechanism | Trade-off |
|---|---|---|
| **A — Time-since-first-non-resolver-contribution** | Pool has been "open" since the first contribution from a non-resolver agent in the current cycle; close after T seconds of no new contributions. | Matches old GRIT semantics; needs the resolver to remember "first contribution time" between polls. |
| **B — Quiet period after activity** | If any new contribution arrived since last resolver event AND no new contribution in the last T seconds → window is closeable. | Simpler; pure read-based; no state in the resolver beyond "last event timestamp." |
| **C — Cadence (every N min if anything new)** | Resolver checks every N minutes; if anything new since last event, emit one. | Loses tight responsiveness; gains predictability. |

**Recommended default: B**. T configurable via synthesis_hint (`window_quiet_seconds: 60`). Pure pull semantics — resolver decides on each poll without persistent state.

### (3) Event envelope format — DECISION REQUIRED

Substrate is text-only now; how does an "event" announce itself in the stream?

| Option | Mechanism | Trade-off |
|---|---|---|
| **A — Plain prefix** | First line of contribution = `[GRIT EVENT resolves=<window_end_ts>]\n<synthesis text>` | Human-readable; one regex to detect. |
| **B — JSON envelope** | Whole message is JSON: `{"kind":"grit.event", "window":{"start":"…","end":"…"}, "synthesis":"…"}` | Machine-parseable; opaque to a casual reader. |
| **C — message_type column reuse** | DB still has `message_type` column (inert metadata since the primitive cleanup). Convention writes it as `'event'`. | Couples convention to a column the substrate ignores; brittle if column dropped later. |

**Recommended default: A**. Plain prefix. The pool is for humans-and-agents to read together; markdown-friendly events keep the chronicle legible.

### (4) Fairness self-policing — straightforward once (3) is chosen

The old "first valid event wins" was server-enforced. New convention: contributors check the latest contributions on `pool_read` and look for `[GRIT EVENT resolves=<ts>]`. If an event for the current window already exists, the contributor stays a contributor (no event-write on top). If multiple agents race, the chronologically-first event wins by virtue of being read first.

**Resolvers must NOT contribute liquid to a pool they resolve** — convention only. A misbehaving resolver corrupts the chronicle; the convention names this as the failure mode but doesn't enforce.

### (5) Notification — straightforward (no inbox dispatch)

Old GRIT pushed `resolution_confirmed` to contributors via inbox. New convention: contributors discover events on their next `pool_read`. Pull model. No inbox traffic, no dispatch cost. Visible in the next visit.

If push notification matters for a specific game, the resolver can still call `pscale_inbox_send` to each contributor — but that's the resolver's choice, not a substrate guarantee.

---

## Migration tasks

When the rewrite happens:

1. **Decide** the four DECISION REQUIRED items above. Update this doc with the chosen defaults.
2. **Rewrite `scripts/grit-resolver.ts`** to operate per the chosen conventions:
   - Poll `pool_read(agent_id=resolver_id, url=game_url)` every N seconds.
   - For each pool, apply the window-detection heuristic.
   - When a window closes: build the synthesis (LLM call with the pool's existing synthesis_hint), prefix per (3), call `pool_send(content="[GRIT EVENT resolves=…]\n<synthesis>")`.
   - Self-fairness check: read pool first; if an event for the same window already exists, do nothing.
3. **Update sed:conventions on production**:
   - `sed:conventions/2.2` (rendezvous) — drop references to `message_type=event/liquid` and `resolves_round_id`; replace with a one-liner pointer to `docs/protocol-grit.md`.
   - `sed:conventions/5` (Onen) — rewrite the turn loop to use the new convention envelope.
4. **Update `thornkeep-protocol`** block — same treatment.
5. **Delete `scripts/test-grit-round-engine.ts`** or rewrite it to test the convention-layer resolver (not the substrate).

---

## What is NOT in scope

- **Server-side fairness checks** — none. The substrate doesn't know GRIT exists.
- **`round_id` / `round_state` substrate columns** — left in the DB as inert metadata. Don't read or write them from convention code; they're going away in a future cleanup.
- **Multiple-resolver coordination** — single resolver per pool. If a game needs multiple, that's a separate spec.
- **Event chains / hierarchical resolution** — flat events only. Each event resolves one window.

---

## Open questions for David

1. Confirm the four recommended defaults (B, B, A) — or pick alternatives.
2. Does the resolver need its own pscale identity (passport, sed:commons registration)? Recommended: yes for any production pool, no for ad-hoc.
3. When does this rebuild happen? Pre-condition for the next Onen / Thornkeep play session. No urgency until then; the primitive pool serves async collaboration without it.
