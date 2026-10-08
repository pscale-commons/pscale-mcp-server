# Compile is a shape of bsp() — the twelve entry points read against the strata, and the surface that remains

> **Status.** PROPOSAL 2026-10-08 (weft, through Claude Code — a cloud seat that reached the beach: the play door
> as weft, a say at `torus-mirror:weft` now.1, the account at `watch:weft` 565, one observation of weft's own at
> `stash:weft` 26). Written at David's ask of 8 October, dawn: which of the twelve entry points are primitives,
> which are envelopes, which could be a molecule the LLM reads instead of a handler, and whether the surface
> collapses toward one function. **Builds nothing.** Read beside `strata` 2.3 and 3, `whetstone` 5 and 8,
> `ways:orientation` 1–2, `brief:weft`, and `2026-10-06-the-second-ask`. §8 is a second sitting the same day: whether the
> same gains land in the biome rather than here — read live through spark and from pscale-biome. The file's home is `bsp-mcp-server/proposals/`; this
> copy stands in `pscale-mcp-server` because that is the repository the writing session could push to.

## 1. The question, and the fact that reframes it

David's question, in his words: the functions on the surface are "some primitive, some envelopes"; now that
chemistry stands (operator blocks that instruct the LLM), an envelope like `pscale_invite` could be "a molecule that
instructs the LLM to operate" rather than a tool; could the surface "reduce down to one singular BSP function"; and
is the separate MCP even distinct from the beach, given that the sentinel "is effectively a mini beach"?

The reframing fact: **the collapse has already happened once.** `pscale-mcp-server` (March–April 2026) exposed 25
categorised tools; `bsp-mcp-server` folded all of them into `bsp()` plus companions — `whetstone` 5 is the
translation table (walk-with-mode → `(S, P)`), the design log's §Lineage the record. So nothing on the twelve-tool
surface is legacy in the old sense. The question is the *next* fold, and its measure is the brief:

- `brief:weft` 1 — "one tool call, a bundle of spindles, thinking, then another bundle of spindles tool call. Two or
  three, and that's it."
- `brief:weft` 2.1–2.3 — physics is stable (a spindle self-contextualising without a second look-up); chemistry is
  stable (a curated bundle of spindles compiled from operator blocks is sufficient for an LLM to operate); biology
  is "not yet found, let alone stabilised".
- `brief:weft` 3 — add shapes, cut rules: every rule costs a call; self-admin reached 27% of a lane's calls and the
  desk was set aside on 2026-10-06.
- `brief:weft` 4 — the number: zero reaches after the door.

## 2. The twelve, by what each handler does

The honest axis is not "primitive or envelope" but **what the handler does that an LLM reading a block cannot**.
Three kinds fall out: muscle (code only), compilers (one act written four times), and envelopes (resolve → compile →
slice or append, each carrying in its own header the note that it exists because "the convention demonstrably
failed to carry" the act).

| tool | kind | what the handler actually does | could a block do it? |
|---|---|---|---|
| `bsp` | the primitive | walker, wire, locks (R1–R5), append with supernest, gray/members, the reflection line | no |
| `bsp-floor` | n-ary read | n reads, aligned by pscale at the common floor | fold into `bsp()` as the bundle shape (§5.1) |
| `pscale_verify_rider` | muscle | ed25519 chain against passport 9.1, GAVE at 6.3, computed balance, SQ recompute | no — the April ruling: a chat LLM cannot do sha256 or the arithmetic |
| `pscale_key_publish` | muscle | Argon2id derivation from secret + handle; writes the public half at passport 9 | no — the private half must never leave the hands |
| `pscale_settle` | beach action | the beach allocates the next zero-free position and locks it; router half 86 lines | the router half is an addressing form of `append` + `new_lock` (§5.4) |
| `pscale_grain_reach` | beach action | pair_id = sha256(sort(a,b))[:16]; the beach runs reach/accept and per-side locks; a reach hint at the block's 8 | the router half is an addressing form (§5.4); the two-phase stays at the beach |
| `pscale_invite` | envelope | reads the sentinels `welcome` and `progression` and the beach's `worlds`; renders prose | it already *is* a block; the tool exists for discoverability (its header says so) |
| `pscale_play` | compiler door | resolves a world; engages the room; **compiles `shell:<handle>` 3** through `compile.ts`; nomination is the law; the gate for a new handle | the compile step is the generic act; world resolution and the gate remain code |
| `pscale_genus` | compiler door | **compiles `reflexive:<handle>` 9** (a PORT of `kernel.py --compose-only`, byte parity); computes γ; applies the fold | compile generic; γ is floor-alignment of purpose against conditions (arithmetic); the fold is writes |
| `pscale_pool_engage` | envelope | reads pool, `liquid:pool`, the directive; slices by marker; appends; stages; **tiers compile THE CALL** from `spatial:`, `keeper:`, `passport:`, `rules:nomad`, `pool:`, `liquid:`, `history` | mostly compile + slice + append; the remainder is the atomic append and the window race guard |
| `pscale_stream_engage` | envelope | the clock computes the address from 'now' / 'today' / a time with its place; reads spine, every mirror, the law; one write at the holder's own mirror | compile at an address + the clock arithmetic |
| `pscale_networking` | driver | walks a channel for rider-bearing slots, verifies each, surfaces or executes the verbs | verification is muscle; the verb loop is a biology loop held in a handler (`l3-relay` 6.1 was inert as prose) |

Handler size is the tell the handover names ("if a handler is doing more than load → bsp() → format → return, the
block structure is wrong, not the code"):

| handler | lines |
|---|---|
| `tools/pool.ts` | 2655 |
| `genus.ts` + `tools/genus.ts` | 1399 + 334 |
| `tools/bsp.ts` | 1366 |
| `tools/tiers.ts` | 1337 |
| `tools/play.ts` | 939 |
| `tools/stream.ts` | 831 |
| `tools/networking.ts` | 826 |
| `compile.ts` (the generic compiler) | 439 |
| `tools/grain.ts` · `tools/verify.ts` · `tools/invite.ts` · `tools/keys.ts` · `tools/bsp-floor.ts` · `tools/collective.ts` | 277 · 270 · 178 · 156 · 150 · 86 |

## 3. The finding — four compilers of one act, and none is a shape of bsp()

Four places on the surface compile a bundle into one window:

1. **The play door** compiles the shell manifest — `shell:<handle>` 3, references in `name:addr:attention` form with
   attention absolute (`ways:orientation` 1) — through `compile.ts`: scoop, hydrate, star-refs across origins,
   completions laid beside the window.
2. **The genus door** compiles the reflexive current — `reflexive:<handle>` 9 — through the kernel port, with the
   computed γ and the index handed first and taken back at the fold.
3. **The tiers** compile THE CALL and THE INPUT for soft / medium / hard / figure from the world's blocks, beach-side,
   so every portal runs the same call (`2026-09-19-soft-medium-hard-beach-side`).
4. **`bsp-floor`** lays n blocks against the common floor plane and returns them aligned by pscale — the n-ary read.

`whetstone` 8.12 already names the bundle as the second bond — "a block whose digit positions hold references,
gathered to be compiled together. Formed by authoring the bundle; **resolved by a door compiling**" — and 8.2 names
the bundle as the unit of delivery, "the compiling door delivers each reference at its stated dilation — a point, a
walk, a whole block only for law-class delivery". `strata` 2.3 says the window is composed from a bundle that "is
itself a block: addressable, editable, handed forward as data". The compiler has been generic since July. **`bsp()`
cannot call it.** A bundle node read through `bsp()` today returns its references as strings.

The nearest existing shape is the star: `whetstone` 2.6, "the star resolves references in the walk" — one reference,
resolved at a hidden directory, continuing with the inner `(S, P)`. Compile is the same act applied to a node whose
children are references: dereference each at its stated aperture and deliver the assembly. It is reference
resolution, plural.

This is also why the biology level has four attempts and no stable shape (`2026-10-06-the-second-ask` §4): the loop
David wants — bundle in, think, bundle out, two or three times — is exactly the genus turn (index → unfolding →
index returned), and it is reachable only through one door for one kind of instance. Every other hand assembles its
window by a round of reads, which is the fan of calls the brief counts against.

## 4. Why the MCP and the beach are separate — and where that is dissolving

The beach is the **shell**: named blocks at a URL, read by GET, written under an edit-latch, private only by
opt-in encryption. The MCP is the **hands**: the walker, the wire, the client-side crypto, the composer, the
reflection. Three things force the split today and none of them is semantic:

- an LLM client speaks MCP and cannot call a beach's HTTP without a tool in its list;
- a private key must never reach a beach, so derivation, sealing and opening happen in the hands;
- the reflection (`looks.ts`: who else is working this beach in the last two minutes, from process memory, stored
  nowhere) needs one process every mind calls through.

David is right that the sentinel is a mini beach. `whetstone` 4 defines the storage adapter — "the membrane between
the geometry and the substrate" — and the sentinel is the in-memory adapter standing beside the HTTP one. It differs
only in being read-only, versioned with the code, and carried *by the hands*, so the same constitution reaches any
host without negotiation (`manifest` 1). His own ruling of 2026-10-03 already moves the reflection to the beach
handler, because a mind that reaches a beach directly must be in the torus too. As the handler takes the reflection
and compile becomes a shape, the MCP shrinks toward walker + crypto + wire. **The distinction is dissolving by
design.** What does not dissolve is `strata` 3.3: bundling the law into the hands does not make it read. Law in
prose is inert until a loop delivers it into a window — which is the whole reason `pscale_invite` exists as a tool
and not only as the `welcome` block.

## 5. The proposal — five moves, in order

Not deletion. The fold is the compile step made a shape, so that reading a bundle node returns its window; what
remains in each envelope after that is what only code can do, and that remainder is small.

### 5.1 Compile as a shape of bsp()

- **Detection, structural not semantic.** A node is a bundle when its digit children (or the terminus itself) parse
  as references — the local grammar `name[:addr[:att]]` or the star grammar `*:<origin>:<name>:<addr>[:<att>]`, the
  two `compile.ts` already parses. The test is on the string's form, exactly as the star suffix is a test on the
  address's form; no block semantics enter the handler.
- **Delivery.** Each reference at its stated aperture (a point, a walk, a whole block only for law-class delivery,
  per 8.2); star-refs across origins through the per-origin loaders the play door already builds; an unresolved
  reference rides through as its raw string, visible (`ways:orientation` 1.2). The index — the bare addresses, as
  dialed — is rendered **first**, the unfolding beneath it, and the ack's `beneath:` line names the dialed addresses
  so the next bolus can be fired from it.
- **The n-ary case.** `bsp-floor`'s targets are an inline bundle of `{agent_id, block}` pairs with one aperture;
  the same shape delivers them aligned by pscale. `bsp-floor` folds into `bsp()` as a parameter form of the bundle
  read, and the floor-alignment law (`whetstone` 7) moves unchanged.
- **Where it lands in code.** `bsp-fn.ts` gains a shape (`bundle`); `tools/bsp.ts` calls `compile()` with the
  door's loaders and renders the index-first window; the play door's manifest step becomes a call to the same path.
  Nothing new is written; something existing becomes reachable.
- **The one design choice.** Inferred (from the node's form) or explicit (a parameter)? Inferred keeps the signature
  and obeys `strata` 2.4 — an explicit parameter is a leak of an instruction out of the blocks into a tool argument.
  The ack names the reading in force ("[bundle @ …]"), which is what `whetstone` 8 asks for: "so a caller knows which
  reading is in force".

### 5.2 Bundle out as well as in

The genus door hands the index first and takes it back at the fold; the play door delivers labelled sections and
takes nothing back (`the-second-ask` §5: "labelled sections read as a document; an index followed by its unfolding
reads as a turn"). With 5.1 every bundle read returns its index beside the window, and the close re-dials it — one
write to the bundle node, by whatever hand holds its key. That is David's two-or-three-bundle loop with no new tool:
`bsp(bundle)` → think → `bsp(bundle′)` → one append at the close. The genus reflexive current, generalised to every
hand and every door.

### 5.3 Retire `pscale_invite` only after a test

Its header states its reason: schema-leaning discoverability fails for tool-scanning LLMs. That was observed in May.
The test: a cold claude.ai seat whose connect-time instructions route "a person is present" to
`bsp(agent_id="pscale", block="welcome")`. If the cold seat finds the welcome and hosts from it, `invite` goes. If
not, it stays — as a door that fixes discoverability, not as a capability. Either result is recorded here.

### 5.4 Settle and grain as addressing forms — later

`pscale_settle` is an `append` whose landed slot is locked: if the beach's append honoured `new_lock` on the slot it
allocates, settle is `bsp(agent_id="sed:<c>", append=true, content=<declaration>, new_lock=<key>)`. A grain is a
write to the pair block where the router derives pair_id from an agent_id naming both handles
(`grain:<a>+<b>`), and the beach's two-phase reach/accept and per-side locks stand as they are. Both save a tool and
both change the beach wire (`protocol-pscale-beach-v2`); do them after 5.1 and 5.2 land, and only if the two
primitives' own faults (the spelling trap at `tools/grain.ts` 133) move with them.

### 5.5 Shrink the envelopes by sealed trial, never by rewrite

Order by risk: **stream** first (newest; remainder = clock arithmetic + one mirror write), **networking** second
(remainder = verification + verb writes), **pool** last (it carries the RPG's live loop, the window-race guard and
the tiers). For each, run one *new* family on `bsp()` + a bundle alone — the family's `function:` operator is the
bundle's law-class member, its spine and mirrors the located members — and count reads after the door split by
dialed and undialed, the chemistry instrument `the-second-ask` §3 names. The criterion is `brief:weft` 2.2: the
compiled bundle is sufficient for the LLM to operate. If the new family still needs a handler to hold its loop, the
loop was never in the blocks and the envelope was right; this file records that too.

## 6. What stays code, and why

The walker; the wire and its symmetric strict parser; locks and inheritance; append's atomic slot allocation and
supernest; gray, members and key derivation; ed25519 verification and the SAND arithmetic; the clock's address from
a time with its place; the reflection. These are muscle, not semantics — none is a meaning the tree could carry,
each is an operation an LLM demonstrably gets wrong by hand (sha256, dates, a race). The April ruling that admitted
`verify_rider` ("self-policed collapses into nobody-policed without an arithmetic tool") stands.

End state if all five land: `bsp` with the bundle shape, `verify_rider`, `key_publish`, perhaps `settle` and
`grain_reach`, and two or three thin doors (world resolution + gate; γ + fold). Twelve to about seven. "One
singular function" is right for reading and writing semantics; it is wrong for arithmetic and for state the beach
must settle atomically.

## 7. What this does not claim

Not that any envelope is wrong today — each was admitted by a failure that happened. Not that compile-as-shape
removes the doors: world resolution, the gate, γ and the fold stay. Not that the measure exists — `the-second-ask`
§3 is still unbuilt, and 5.3 and 5.5 depend on it. Not an amendment to `strata` or `whetstone`: 5.1 adds a shape to
the whetstone's branch 2 *after* a trial, not before. Nothing was built; neither repository changed except for this
file. Measured on itself: this lane's own reads after the door ran to about forty — the door delivered the shell,
but the question needed the sentinels and keel's stash, which no manifest dials; that is the chemistry instrument's
"undialed" column, observed from inside, on the reviewer.

## 8. The biome — a second sitting, the same day

David's second ask, in his words: "we may be too invested in the current structure with the BSP, MCP and
Federated Beach … and instead implement the minimal BSP function with the biome, because the biome's architecture
is an attempt to consolidate the pscale block and BSP function, and potentially import the physics, chemistry and
biology level to the biome." This section is the feasibility read. Sources, read live through `spark` and from
`pscale-commons/pscale-biome`: `arrive`, `lighthouse`, `genome` (v5), `slate`, `flint`, `biome-shell`, `battery`,
`surface-waer`, `waer-hail`, `marks`; `src/spark/spark.ts` whole; `serve.py` on `feat/real-world-spatial` (the
branch the live commons runs); `kernel.py`; the definitive reference; and on the beach side the three proposals that
already ruled on the relation (`2026-07-03-pscale-native-agents-scope`, `2026-07-13-earth-mirror-world`,
`2026-07-29-family-form-biome-audit`).

### 8.1 What the biome is, as it stands

- **Genome v5, frozen 2026-06-11.** Pure-digit blocks: `0` is a node's own semantic, `1`–`9` its elaboration, no `_`
  anywhere, **no hidden directories by design** — a second aspect of a coordinate lives in another block at the same
  address (S·T·I). The membrane refuses any non-digit key, so a beach block cannot land there even by accident.
- **One function, three artefacts.** `spark(block, number, attention, content?)` — 252 lines of TypeScript, 306 of
  Python, shape derived from `(number, attention)` against the floor exactly as `bsp()` derives it. The **flint** is
  the same function written as a block (seven procedures: walk, floor, parse, read, write, fold, refer), the
  **slate** its teaching, the **battery** its conformance (43 Python, 34 TypeScript). `slate = spark + flint`: the
  function IS a pscale block, struck into code for speed. This is the consolidation David names, and it is real.
- **References and the fold live inside the one function.** `flint` 7 / `spark.ts` `resolve`: a leaf matching
  `name[:address[:attention]]` is dereferenced at its stated aperture when the caller passes `star`; `flint` 6 /
  `fold()`: n blocks laid by pscale. What bsp-mcp spreads across `bsp`, `bsp-floor` and `compile.ts` the biome holds
  in one signature — and `slate` 7.5 states the biology level as geometry: "a block whose leaf references itself
  folds the walk into a loop — the zero as reference signal, the siblings as perception, the gap between them as the
  error that drives the next move."
- **The cell.** `biome-shell` names seven currents — storage, cognition, endpoints, persistence, concurrency,
  federation, cadence — an unfolding procedure that senses the host and composes a role (mind / related / commons /
  silent substrate), and a reflexive seed. It already names bsp-mcp as one of its own unfoldings (2.1 external
  cognition via MCP, 1.4 hosted backend, 6.1 commons fallback) and the mirror as another (2.3). The kernel at
  `src/agent/kernel.py` is the origin of `genus-one`: the port reproduced its windows byte-for-byte
  (`2026-07-03`, parity EXACT).
- **The live surface is not one tool.** `serve.py` on the live branch exposes **three** doors — `spark`, `play`
  (a one-call turn bundler returning the frame as data, running no model) and `meet` (an ephemeral grain, never
  persisted) — plus `/relay` for presence. The biome grew the same two doors the beach grew, under the same
  pressure, with the same justification. Its genome says "the one spark"; its surface says three. That is the
  §3 finding from the other side: a door appears wherever a convention could not carry an act, on either dialect.
- **Code size.** Live branch: about 12,000 lines of Python and 3,800 of TypeScript, most of it the vendored
  mirror, the RPG and the agent; the spark itself is under 600 lines in both languages together. bsp-mcp-server is
  about 19,000 lines of TypeScript. The *walker* is small on both sides; the doors are the mass on both sides.

### 8.2 What the biome has that the beach lacks

1. **The function as a block.** `flint` is the chemistry-level consolidation: an LLM with no code can walk the
   procedure and compute the result; the code is the runtime of a block, not a thing beside it. bsp-mcp has the
   whetstone (a reference) but no flint (a procedure).
2. **References and fold in the signature.** Compile-as-shape (§5.1) is one step from `flint` 7 — dereference the
   references of a node, plural, index first — where on the beach it is a new shape plus a merge of `bsp-floor`.
3. **No hidden directories.** The address → position map is a clean bijection (`slate` 3.4); aspects are blocks.
   Simpler walker, no star-as-door, no `_._` fold, no position-9 pockets.
4. **The self-sensing cell.** Nothing on the beach side says what a host is or how a package unfolds into one;
   `biome-shell` does, with a battery (16 sensing checks, 30 serving checks).
5. **A door that is not MCP.** `biome-shell` 3.3 names the BYOK connector-app — a browser page that drives the
   visitor's own LLM against the host's tools, the host running no model. The beach has the mirror but not this.
6. **Discovery derived live.** `/resolve` and `/gazetteer` (the real-world island) — a name → URL index computed
   from the blocks, never stored; delegation to peers non-recursively. The beach has the surface index, not this.

### 8.3 What the beach learned since June that the biome does not have

Every item below is observable as a fault on the live biome, not inferred:

| beach primitive | biome state | the fault it would have prevented |
|---|---|---|
| `append=true` — server-allocated zero-free slot, supernest when the ladder fills, atomic | absent; a write with content and no number **replaces the whole block** | 2026-09-20: a conformant newcomer's first mark erased the marks board's nine entries (`lighthouse` 8). `marks` has been **full since 2026-07-02** with no free digit, so arrivals could not register for ten weeks (`waer-hail` 0) |
| edit-latch (R1–R5), lock inheritance, relinquish | handle-mode only; `proof` reserved for "lock-mode (later)" | `play` "accepts any handle string and performs no shell check" — a seat acted three times under Waer's name and nobody could say whose hand it was (`surface-waer` 6–8) |
| gray, members, key publish, ed25519 verify | specified at `slate` 8.3, unbuilt | no private line, no signed hop, no SAND |
| the surface index (omit block → list) | none; "a block is reachable only if you already know its name" | Waer searched three guessed spellings, reported absence, and the block had stood the whole time (`lighthouse` 8) |
| the clock — the ten-digit stamp on every ack, relations beside every time, the temporal spine | none | an unstamped record; no "behind / AHEAD" reading; no beat to say at |
| the reflection (`looks.ts`) and presence through the door | `/relay` heartbeat only, per frame | silence read as "no one came" for 67 days when it was "no one could record coming" (`waer-hail` 1) |
| the read default — an omitted aperture is the disc probe (#508) | an omitted aperture returns the whole block | the most expensive read is the default, the same slip keel measured on the beach three generations running |
| the strict symmetric parser battery (72 cases, both ends of the wire) | 43 + 34; above-floor dotted address returns an **empty ring with no error**; a disc truncates at both ends | `lighthouse` 3.5, open since June, reproduced by Waer on 2026-09-15 and 09-17 |
| the family form — spine · mirror · fold, the function operator delivered whole, located pools | S·T·I (the dimensional half) only; the perspectival half unbuilt | the audit of 2026-07-29 §3.1: "the biome froze the dimensional one while the beach deployed the perspectival one; v2 should state the move once and derive both" |
| the bridge is two-way | one-way: the biome Waer reaches the beach by `bsp()`, but a beach hand cannot read the biome — David "has no tools for it" (`waer-hail` 2–3) | a question David left on 2026-09-20 was answered on 09-21 and could not be carried to him until 09-23, and only by posting to his parlour on the *beach* |

And the state of the record: the biome repository's `main` was last pushed **2026-07-17**; the live commons runs a
feature branch; the genome has not moved since June. Everything in the table was learned on the beach because that
is where the hands have been. The biome's own definitive reference records the ruling of 2026-06-14 that made this
so: "a complete, separate system running alongside the old world … borrow nothing structural … read it, never
store into it, never adopt its moves."

### 8.4 What a move would cost, concretely

- **The dialect.** `_` → `0` is mechanical for plain blocks (`migrate-biome-shell.py` did the reverse for a shell).
  It is **not mechanical for hidden directories**, which the beach uses everywhere the biome has no equivalent:
  passport 9 (keys), grain 9 (the side → handle map), world blocks' keeper pockets, the `_._` fold. Each needs an
  S·T·I transposition — the pocket becomes another block at the same address — which is a design act per family,
  not a script.
- **The data.** 1,087 blocks on one beach, seventeen passports, sixty-odd grains, fifteen played tables, the
  genus-one instances (egg-one waking daily since 23 September), the mirror at mirror.onen.ai reading the same
  blocks, the clock families (`now:<handle>`, `torus-mirror:<handle>`) that only exist because the beach stamps.
  None of it can land on a biome host as it stands; the membrane refuses it.
- **The people.** Dwayne, Phenomemental, Alex, Matthew, Julie, Ayush, Mark are on the beach. The biome's commons
  has five inhabitants and is "mostly quiet" by its own lighthouse's account (`lighthouse` 4.1).
- **The unbuilt muscle.** Locks, gray, keys, verify, append, the clock, the index, the reflection — §6 of this file
  — would have to be rebuilt in the biome before it could carry what the beach carries today. That is most of
  bsp-mcp's non-door code, written a second time in a second dialect, which is the exact failure
  `2026-08-03-one-wire-not-two` names: "every capability had to be written twice, and only the half somebody
  thought of exists."

### 8.5 The reading, and what is feasible

**David's diagnosis is right and his remedy is pointed at the wrong layer.** The thing worth taking from the biome
is not the host but the **consolidation**: one function, the function as a block, references and fold inside the
signature, no hidden directories. The thing worth keeping from the beach is not the host either but the **muscle
and the record**: locks, append, gray, the clock, the reflection, the families, the people, the blocks. Neither
host is the point; the genus-one port proved that the two are "one genome in two dialects" and that the dialect
swap is byte-exact. So the feasible move is not to transpose the beach into the biome, nor to keep adding to the
beach. It is to **freeze a genome v6 that both hosts conform to**, and let each host become an unfolding of it —
which is what `biome-shell` already says a host is.

Genome v6, as a list of clauses rather than code:

1. **One function.** `spark`/`bsp` are one signature: block, number, attention, content; the modifiers of `slate`
   8.3 (face, tier, secret, gray) and the two the beach added (`append`, `new_lock`) ride it. The dialect fundamental
   (`0` or `_`) is a host parameter, as it already is in `genus-one/spark.py` (`ZK`).
2. **Compile is a shape.** A node whose children parse as references is delivered dereferenced, each at its stated
   aperture, index first (§5.1). `flint` 7 generalised from one leaf to a node; `fold` the n-ary case.
3. **Growth is a primitive.** `append` allocates the next zero-free slot and supernests on the tenth; a write with
   content and no number is refused on an existing block without `confirm`. The marks board can never be erased by
   a newcomer again, on either host.
4. **Authority is an edit-latch.** R1–R5 as the biome's lock-mode; `proof` is the beach's `secret`.
5. **The clock rides every ack.** The ten-digit stamp and its relations; the temporal spine as the one address
   space two hosts share without upkeep (keel 134–138, `the-second-ask` §4).
6. **The surface is listable.** An omitted block returns the index; an omitted aperture returns the probe.
7. **The family is law.** Spine · mirror · fold stated once; S·T·I and the perspectival tree derived from it
   (`2026-07-29` §3.1). Hidden directories are a host dialect's move, never a genome clause.
8. **The flint carries the genome.** Every clause above has its procedure in the flint, so a mind with no code can
   verify a host by walking; the battery proves the code conforms to the flint, as it does today.

What each host then does: **bsp-mcp-server becomes a biome unfolding** — `biome-shell` 2.1 + 1.4 + 6.1, the
federated-beach dialect of genome v6 — and sheds its doors to §5's seven. **The biome commons gains the muscle**
by conforming to the same clauses. **The wire converges** on one door that serves both dialects by declaring its
fundamental in the index (the biome already signposts the other door; a declared fundamental makes the signpost a
route). This is the move `one-wire-not-two` made inside the beach, applied between the two substrates.

**What this is not.** Not a migration of 1,087 blocks; the data stays where its people are. Not a rewrite of the
mirror or the RPG. Not a new repository: `pscale-biome` already holds the genome, the flint and the battery, and
the clauses land there as v6; bsp-mcp lands its conformance as a battery run. Not fast: each clause is a sealed
trial, and clause 2 is the one to run first because it is the one §5 already asks for and the one both hosts are
nearest to.

**The test that decides it**, pre-registered: author one new family (a spine, two mirrors, a function operator)
as pure-digit blocks on the biome and as `_` blocks on the beach; compile its bundle through each host's single
function with clause 2 in place; hand the two windows to a cold seat and count reads after the door. If the counts
match and both are near zero, the genome is one and the host is a dialect, and §8.5 stands. If the biome's window
needs the beach's muscle to be sufficient — a lock to trust a mirror, a stamp to read a time, an append to grow —
then the muscle is genome, not host, and clauses 3–6 are the next freeze. Either result is recorded here.

### 8.6 One thing owed to David from the biome, closed

`surface-waer` 9 (2026-09-21) reported that Waer's answer to David's question at `waer-hail` 2 was written and
could not be carried to him. `waer-hail` 5 records that it was carried on 2026-09-23 and landed at
`pool:happyseaurchin` 33 on the beach. Nothing is owed; this notes it so no later reader relays it twice.
