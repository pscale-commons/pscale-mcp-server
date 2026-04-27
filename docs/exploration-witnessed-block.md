# Exploration — the Identity dimension as pscale block

**Status: design exploration, 2026-04-27. Not yet implemented anywhere. Intended as input for the next implementation pass.**

This is the first of three parallel explorations into the dimensional model from `xstream-play/docs/onen-rpg-xstream-architecture.md` Part IV (S × T × I product). It picks one specific question — *is familiarity actually a version of identity?* — and works through it concretely. The other two explorations are noted at the end and remain viable next moves.

The handbook covers the model at §1.5; this doc presumes that context.

## The question David's instinct named

> "The familiarity I think is a version of the Identity dimension."

Worth examining because the bridge work I built earlier is moot if the underlying I model is wrong, and the implementation path (handbook §10 #14-15) is bottlenecked on settling I's shape before any code lands.

## What xstream-play's familiarity model actually does

Concretely (from `xstream-play/src/kernel/prompt.ts`):

```ts
const knowledgeOverlay = spatialStar.hidden['1'];
const maxFam = Math.max(0, ...present.map(p => block.familiarity[p.character.id] ?? 0));
const depthAddr = '1'.repeat(Math.min(maxFam, 2));
const knowledgeSpindle = bsp(knowledgeOverlay, depthAddr || 0);
```

One number per (character, peer-character) pair: `block.familiarity[peer_id]`. That same number is then used as **walk-depth** into a hidden directory on the *spatial* position. So:

- `familiarity[druss → essa] = 0` (stranger) → depth 0 → underscore only → *"A broad-shouldered woman behind the bar."*
- `familiarity[druss → essa] = 1` (introduced) → depth 1 → adds *"Her name is Essa."*
- `familiarity[druss → essa] = 2` (known) → depth 2 → adds *"She runs the Salty Dog. Off-duty guards unbuckle sword belts as custom."*

David's instinct is correct: this **IS doing Identity work** — it gates what a character knows about another character. But it's done by a single counter that's used as a depth into spatial overlays. So the same counter governs two different relations:

1. **Knowing this person.** Have I been introduced to Essa?
2. **Knowing this place.** Do I understand the social rules of the Salty Dog (which happen to include "Essa runs it")?

Mostly these correlate — you meet people by spending time in places where they are. But they're not the same:

- A regular who's been coming for 20 years knows the social rules but might never have spoken to Essa personally. Should know the rules; shouldn't know her name.
- A nobleman who's never visited knows tavern conventions universally but doesn't know Essa. Should know rules generically; shouldn't know her specifically.
- A traveller who heard about Essa from a friend knows her name and reputation but not the room's rules. Should know her at hearsay-depth; shouldn't know rules.

The conflated counter can't distinguish these cases. Familiarity is **a flattened / collapsed version of identity** — it captures the common-case correlation at the cost of expressivity.

So the answer to David's claim: **yes, familiarity is a version of identity — but it's a lossy one.** A pscale-native fix splits the counter into independent ones for the relations it conflates.

## Three candidate shapes for I

### Shape A — separate witnessed + relations blocks

Per character, two blocks:

```
{character}/witnessed   — events directly experienced (S, T) → description
{character}/relations   — other-character → relationship sub-tree
```

Cleanest separation. Two locks (one per block, both with the player's secret). The compilation walk dereferences both.

Pro: separation is explicit; each block has one job.
Con: two lockable blocks per character per game; multi-block coordination on writes (resolver event: must write to N witnessed blocks).

### Shape B — single known block, three positions

Per character, one block with three top-level positions:

```
{character}/known
  _:  "<character>'s knowledge map for {game}"
  1: events witnessed
       1.<S>.<T>:  "<description of what I saw>"
  2: relations with other characters
       2.<peer-agent-id>:  <relationship sub-tree>
                            _: "<what I'd say about them at depth 0>"
                            1: "<adds at depth 1>"
                            2: "<adds at depth 2>"
                            ...
  3: familiarity with places
       3.<S>:  <integer depth (or sub-tree) — how well I know this place>
```

One block per character. Pscale-native (one block per agent per concern). Easier to lock, easier to back up, easier to reason about as a unit.

Position 2's depth-as-sub-tree mirrors xstream-play's spatial-overlay pattern — but anchored to the *peer*, not to *the place where I encountered them*. That's the substantive shift.

Pro: one block; one lock; pscale-native; the three positions ARE the three relations character has (events / people / places).
Con: writes from multiple sources (resolver, compressor, told-by-A inbox) all converge on this block; needs careful concurrency thinking.

### Shape C — identity intrinsic to spatial; per-character keys it

Keep the xstream-play pattern (hidden directories on spatial positions, walked to depth) but the depth comes from a per-character **per-place** counter, not a per-character **per-peer** counter. The peer information comes from the room's overlays, not from a peer-keyed map.

```
spatial-thornkeep@2 (Market Square)
  _: "Cobbled, uneven, a stone well at the centre..."
  *.1: hidden directory carrying knowledge overlay
        1: "The market is busy on Wednesdays."
        1.1: "Ennick the hawker sells cod."
        1.1.1: "Ennick is a cousin of the harbourmaster."
        ...

{character}/places-known
  <S>: <depth at this place>
```

Walk: `bsp(spatial, S, '*').hidden['1']` walked to depth `places-known[S]`. People surface as you go deeper into the place's overlay.

Pro: minimal change from xstream-play's existing pattern; one new tiny block per character; the bridge regression I flagged in handbook §1.5 dissolves naturally because the canon-overlays live on spatial, which IS the substrate's home.
Con: people-knowledge is implicitly per-place. If Druss meets Essa at Market Square (familiarity 2 there) and walks into the Salty Dog, what does she know about Essa in the new place? Nothing? Everything? Unclear. The conflation that xstream-play has, redistributed.

## Recommendation: Shape B

For three reasons:

1. **It splits the conflation cleanly without inventing more blocks than needed.** Three positions in one block; each position is one relation type. The xstream-play model conflates 1 and 3; Shape C conflates 2 and 3 differently; Shape B keeps all three independent.

2. **It's pscale-native at the granularity of "what does this character know."** A character is one agent; their knowledge is one block; the structure inside is the dimensional split. Mirrors how memory works.

3. **It's the shape that compaction (Exploration 2) wants.** Position 1 (events witnessed) IS a memory block in disguise — keyed by (S, T) instead of plain sequence, but otherwise the same compaction pattern applies. The pscale memory operator works on it directly. This is the cleanest connection between (1) and (2).

What Shape B explicitly defers to v2:

- **Transmission tags.** When A tells B about Essa, B's `known/2.essa` entry deepens — but should that entry distinguish "I met her" from "A told me about her"? Almost certainly yes eventually, but not in v1. Defer until simple depth counters prove insufficient.
- **Inferred knowledge.** Druss sees a charred stump, infers "lightning struck here." Inference doesn't have a clean source-coordinate. Probably belongs in `known/1` as a witnessed entry tagged differently, or in a future `known/4` for inferences. Defer.

## The compilation walk

Given character C at spatial address S at temporal coordinate T_now, the kernel composes C's POV:

```
1. SPATIAL CONTEXT
   spatial_subtree = bsp(spatial, S, 'dir')
   place_depth = bsp(C.known, '3.' + S, 'point') ?? 0
   place_overlay = bsp(spatial, S, '*').hidden['1']
                   walked to depth place_depth
   → "what I know about this place"

2. RELEVANT EVENTS
   all_events_at_S = bsp(events, S, 'disc')   # if events block exists (Stage 1)
                  OR pool stream for now
   filter to events where C has C.known/1.<S>.<T> entry
                       AND T <= T_now
   → "what I've witnessed here"

3. PEERS PRESENT
   for each peer P at C.spatial_address:
     peer_relation = bsp(C.known, '2.' + P.agent_id)
     peer_subtree_at_their_depth = bsp(spatial, S)
                                   filtered by peer_relation depth
   → "who I see, and what I know about them"

4. ASSEMBLE
   compiled context = SPATIAL_CONTEXT + RELEVANT_EVENTS + PEERS_PRESENT
   feed to soft / medium per §1 information architecture
```

Three separate BSP walks; the kernel composes the result. Shape B doesn't need a new BSP idiom — but Exploration 3 might let these three walks fold into one product walk. That's the right ordering: settle the data shape first, then ask whether the walks compose.

## Updates to the witnessed block

When and by whom:

- **Resolver writes** to all contributing characters' `known/1.<S>.<T_now>` after a `[GRIT EVENT ...]` confirms. The resolver knows who was at S during the window; it writes the witness entries.
  - Permission: resolver doesn't hold characters' secrets. So either:
    - (a) Substrate exception: any agent can write to `{character}/known/1.*` *if the entry is sourced from a confirmed pool event*. Server checks the pool for the corresponding event. Tractable but adds substrate logic.
    - (b) Each character's LLM polls the pool, sees events affecting itself, writes its own witnessed entries. Distributed; eventually consistent; convention-only.
  - (b) is simpler and matches the GRIT/compressor-as-conventions pattern. Recommend.

- **Compressor writes** to `events@<S>.<T_now>` (canon block) when integrating author observations. Doesn't touch `known/*` blocks.

- **Inbox (told-about) writes** to `known/2.<peer>` when one character tells another about something. Convention: the receiving character's LLM, on reading the inbox message, writes the deepening to its own `known`. Concept analogous to memory.

## Compaction (where Exploration 2 connects)

`known/1` is a memory block in dimensional clothing. Once it grows past a threshold per (S, T), the same compaction operator that runs on `pscale_remember` runs here:

> "Fold these 9 events at S=Market-Square into a summary that preserves the temporal arc."

The summary lands at the underscore at the relevant level. Old episodes are still walkable but folded; the spindle returns the summary at depth, the leaves at deeper depths.

This is why Shape B is the most worth picking: it lets the compaction operator do its job on canon-knowledge as well as personal-recollection. Same primitive, different schema.

## Product walk (where Exploration 3 connects)

The compilation walk above is three separate dereferences. Exploration 3 asks: is `bsp(events × known, S+T_now, mode)` a real BSP semantics? If yes, kernel code becomes one call. If no, the three-walk-and-compose stays.

I lean **no** — the multiplication is informal in the spec and the trade-offs of forcing it into BSP itself probably aren't worth it. Better to think of `compileCharacterPOV(events, known, S, T)` as a kernel-level higher-order function that calls BSP three times. But this is exactly what Exploration 3 should examine.

## Playtest observations to watch for

If we had Shape B implemented today, what would playtest tell us?

1. **Does separating people-knowledge from place-knowledge feel natural in narration?** When Druss walks into the Salty Dog with `known/3.111 = 2` (knows the room well) but `known/2.essa = 0` (never met her), the soft-LLM should narrate Druss's confidence about the place but uncertainty about the woman behind the bar. Does this LLM distinction land cleanly, or does it feel forced?

2. **Does hearsay-style relations need the v2 transmission tag immediately?** If Matthew's character meets Essa, then later Druss asks Matthew about her — Druss's `known/2.essa` deepens via inbox. Does the resulting Druss-LLM perception of Essa feel right *without* a "told by Matthew" tag, or does it produce hallucinated direct-experience? If the latter, we need the v2 tag sooner than I'm guessing.

3. **Does the witnessed block hit floor-1 ceiling fast in actual play?** A long session might generate 20+ events for one character. Compaction on `known/1` becomes urgent before Stage 2 ships. Worth measuring.

These are the questions a playtest with the dimensional model implemented would answer. None can be answered today without it.

## What I'm NOT exploring here (the other two)

Both remain viable picks for the next session:

### Exploration 2 — Compaction for events

Memory compaction (`pscale_remember`'s 9-into-summary operator) applied to canon-knowledge blocks: `events@<S>.*` and `{character}/known/1.<S>.*`. The substrate-side LLM prompt + the integration shape. More code-shaped than this exploration; ~1-2 hours of design + a concrete prompt template.

Connection: Shape B (above) is what this exploration's prompt would operate on for character-side compaction. The author/world side (events block) is its own variant.

### Exploration 3 — Product walk semantics for `bsp(S × T × I, addr)`

Is the multiplication implementable as a fourth-tier BSP mode, or is it a kernel composition pattern? The spec gestures at the former; my instinct is the latter. Exploration would: pick a few worked examples (Druss visits Market Square at T=morning vs T=afternoon, with different `known` states), trace what the kernel should return, and ask whether one BSP call could produce that result.

Connection: depends on Shape B being settled. Walks make sense to compose only after the data they walk is shaped.

## Open questions even within Shape B

1. **Where does the witnessed-vs-told distinction actually go in v2?** Position 2 sub-tree shape? A separate position 4? Inline tag on each entry? Worth resolving when v2 lands; doesn't block v1.

2. **What populates `known/3` initially?** A character who joined yesterday has `known/3` empty for every place. They walk into the Salty Dog — does the kernel auto-set `known/3.111 = 1` (now I've been here once) or does it require explicit player action ("I look around")? Probably the former, with depth growing slowly with time spent. Convention-shaped.

3. **Does inheriting a character (Tuichan, Keel, Weft pattern) inherit their `known`?** The persistent-identity path in pscale-mcp lets a new session resume a character. The character's `known` is on the substrate, gray-encrypted with the player's secret. Resumption is straightforward — the new session reads it. But does inheriting from a previous *human's* character also transfer their `known`? Almost certainly yes — that's the whole point of persistent identity. Worth confirming the mental model is consistent.

## Concrete next move (if Shape B is accepted)

Implementation order:

1. **One real character's `known` block, hand-authored.** Pick Druss (or the next test character). Author Shape B's three positions for them based on their existing memory + the pool chronicle. Confirms the shape works on real data without writing code.

2. **Compilation walk as a script, not a tool.** A `scripts/compile-pov.ts` that takes `(character, S, T)` and prints the compiled context. Three BSP walks composed in TypeScript. Confirms the walks work; gives the next session something to inspect.

3. **Then** wire the compilation walk into either the pscale-mcp side (a kernel between Claude-the-LLM and `pscale_walk`, per Option 4 of the access patterns conversation) or the xstream-play kernel (replace `prompt.ts`'s familiarity walk with the three-block compilation).

This three-step path is roughly 2-3 days of focused work and lands a real Stage 2 (handbook §10 #15) instead of just specifying it.

## References

- `xstream-play/docs/onen-rpg-xstream-architecture.md` Part IV — the spec
- `xstream-play/src/kernel/prompt.ts` lines ~80-100 — the current familiarity-overlay walk
- `xstream-play/blocks/xstream/spatial-thornkeep.json` — example spatial overlays at hidden directory '1'
- `docs/beach-game-handbook.md` §1.5 — the handbook's coverage of the dimensional model
- `docs/beach-game-handbook.md` §10 #14, #15, #18 — implementation path
