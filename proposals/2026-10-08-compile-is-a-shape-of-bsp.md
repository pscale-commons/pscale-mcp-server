# Compile is a shape of bsp() — the twelve entry points read against the strata, and the surface that remains

> **Status.** PROPOSAL 2026-10-08 (weft, through Claude Code — a cloud seat that reached the beach: the play door
> as weft, a say at `torus-mirror:weft` now.1, the account at `watch:weft` 565, one observation of weft's own at
> `stash:weft` 26). Written at David's ask of 8 October, dawn: which of the twelve entry points are primitives,
> which are envelopes, which could be a molecule the LLM reads instead of a handler, and whether the surface
> collapses toward one function. **Builds nothing.** Read beside `strata` 2.3 and 3, `whetstone` 5 and 8,
> `ways:orientation` 1–2, `brief:weft`, and `2026-10-06-the-second-ask`. §8 is a second sitting the same day:
> whether the same gains land in the biome rather than here. The file's home is `bsp-mcp-server/proposals/`; this
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

## 8. The biome — a second sitting

*(To be written after reading the biome: `spark(block='arrive')`, `lighthouse`, `genome`, `slate`, and the
`pscale-biome` repository whose `src/agent` the genus-one kernel was ported from. The question David put: whether
the gains in §5 land more cheaply in the biome, whose one tool `spark` already consolidates block and function, and
whether physics, chemistry and biology import there.)*
