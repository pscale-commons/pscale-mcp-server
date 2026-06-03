# Floor alignment — the missing cross-block operation

**Status: provisional draft (2026-06-03).** Raised by David from work on the
mobile-agent shell (a shell of many blocks at different floors) and the RPG
(comparing computing blocks at different floors), and already implemented once
in the filmstrip-3d visualiser (`pscale-commons/dev-tools`), which lays every
block against the floor as a common plane.

This doc states the law, shows it is **not yet specified** for the cross-block
case, proposes the sunstone edits, and proposes the BSP-level operation.

---

## Notation (enforced here)

- **Spindle / pscale number** — a single dot, the dot is the floor boundary:
  `1.56`, `34.5`, `7.654`. Never more than one dot. `1.2.3` is pre-bsp; canonicalise.
- **Walk** — commas, one per step: `1,5,6`, `3,4,5`, `0,7,6,5,4`.

A node at walk `1,5,6` in a floor-1 block is the pscale number `1.56`. Same node,
two renderings. The two-dot form `1.5.6` is the bug to avoid.

---

## The law

`bsp()` is **unary** — one block, two coordinates (spindle, pscale-attention).
A node's **walk depth** means something only *inside its own block*. The
coordinate that survives *across* blocks is **pscale**, because the floor
(pscale 0) is the same coordinate for every block — it is invariant under
supernest (whetstone `2.7`, sunstone `1.5.2`).

> **Any computation between two blocks must index by pscale, never by walk depth.**

```
pscale(node at depth d, block floor F) = F - d         (whetstone 2.7)
pscale 0 = the floor (underscore-chain string terminus)
the digit immediately left of the decimal point = pscale 0
integer digits  -> above the floor (pscale > 0, coarser context)
fractional digits -> below the floor (pscale < 0, finer detail)
```

### The worked example (David's)

Two blocks, two addresses:

| block | address (spindle) | floor | walk |
|-------|-------------------|-------|------|
| A | `34.5` | 2 | `3,4,5` |
| B | `7.654` | 1 | `7,6,5,4` |

**Naive (wrong) — left-align by walk step:**

```
A: 3 4 5
B: 7 6 5 4      step 1: 3↔7   step 2: 4↔6   step 3: 5↔5
```

This pairs A's pscale `+1` with B's pscale `0` (the floor). It compares a coarse
node in the deeper block against the floor of the shallower. Garbage.

**Correct — align at the floor (the decimal point):** pad B's integer side with a
leading zero to the wider floor (2):

```
            pscale:  +1   0  -1  -2  -3
A:  3   4 . 5         3   4   5
B:  0   7 . 6 5 4     0   7   6   5   4
                          ↑ floor / pscale 0 / common plane
```

B's walk becomes `0,7,6,5,4` — exactly David's expected alignment. Now `4↔7` at
the floor, `3↔0` at `+1`, `5↔6` at `-1`. Correspondence is by pscale.

### Why this *is* supernest

Padding B's integer side with one leading zero (`7.654` → `07.654`) is the
**address-space image of supernesting B once**: wrap B in `{_: <old>}`, floor
`1 → 2`, every existing address gains a leading `0` (sunstone `1.6.3`: "what was
`1` becomes `01`"). So:

> **Floor-aligned binary ops = supernest the shallower operand up to the common
> floor, then compute pscale-for-pscale.**

Because pscale is invariant under supernest, you never actually transform the
block — indexing both by pscale *is* the alignment. The leading zeros are just
how it renders at a fixed floor width. This is the bridge to the supernest
exploration running in parallel: **supernest is the unary change-of-basis on the
pscale axis; floor-alignment is the binary operation in that shared basis.**

### The dot-product shape

The floor is a **contraction axis**. Index both blocks by pscale, contract over
the shared axis:

```
floorProduct(A, B) = Σ_p  sim( A@p , B@p )
```

Mismatched floors are mismatched dimensions, resolved by zero-padding (= supernest)
— exactly as a dot product zero-pads the shorter vector. From the one aligned
frame, three derivations:

- **compare** → per-pscale delta (what differs at each scale)
- **merge** → one block at the common floor, each side contributing at its scale
- **resonance** → the scalar above (how much two blocks agree where their scales meet)

### The necessary caveat

Floor alignment gives **structural** comparability. **Semantic** comparability
also needs a **shared calibration**: both blocks' pscale 0 must mean the same
scale of attention (sunstone `9.2` — containment / temporal / relational /
resonance mappings). Two blocks both anchored at human scale compare limb-to-limb
and city-to-city; two blocks whose floors mean different things align
structurally but not semantically. **Alignment is necessary; shared mapping is
what makes it sufficient.**

---

## What the spec currently says — and the gap

The **foundation is present** but scoped to a single block:

- sunstone `1.5.2` — pscale 0 at the floor, + up the ladder, − transversal.
- sunstone `1.5.3` / `1.5.4` — decimal = floor boundary; `34.5` pads to `0034.5`
  to floor width; padding "preserves absorption … same semantic position after
  the block grows a deeper ladder."
- whetstone `2.7` — "Addresses absorb across floor growth … same canonical
  address reaches the same semantic position after a supernest."

Every statement is about **one block against its own floor**, and "absorption" is
about **the same block growing over time**. Two facts confirm the gap:

1. `bsp()` is unary. There is no binary operator — no `compare`, `overlay`, or
   `product` between two blocks. The architecture is load-one-block → bsp → format.
2. The padding rule is defined relative to a single block's own `floorDepth`.
   Nothing converts *across* two different floors to a shared zero before relating.

So the cross-block rule has **no home in the spec**. The filmstrip-3d viewer had
to invent it (floor as common visual plane) because it is the first thing that
holds many blocks at once. This draft promotes it from a per-block addressing
convention to a **cross-block computation law**.

---

## Proposed sunstone edits

See `docs/sunstone-floor-alignment.provisional.json` for the exact content
fragments. Two additions, written in sunstone's zeroth-person voice:

- **`1.56`** (under `1.5`, canonical addressing) — the mechanical rule: cross-block
  addresses align at the floor, pad the shorter left-of-decimal with leading
  zeros, the padding is supernest in address space.
- **`5.6`** (under branch 5, composition) — the operation as an angle on the
  primitive: star (`5.1`) composes by *reference* through the hidden door;
  floor-alignment composes by *pscale* against the common plane. Includes the
  dot-product shape and the calibration caveat. Branch-5 underscore updated to
  name the second composition path.

Branch 5 is the right home: it is already "composition across block boundaries"
(star, block references, control loops). Floor-alignment is the other way two
blocks relate, so it sits beside star rather than as a tenth top-level angle
(digits stop at 9; a new angle would force a supernest of the whole block).

---

## Proposed BSP-level operation

`src/floor-align.ts` is the provisional reference implementation (not wired into
the server). It does **not** modify `bsp.ts` — bsp() stays unary. The binary
companion exposes:

- `indexByPscale(block)` → every position tagged with its floor-anchored pscale.
- `floorAlign(A, B)` → positions grouped by shared pscale, coarse → fine; levels
  present in only one block carry an empty side (zero-padding).
- `floorProduct(A, B, sim)` → the scalar contraction over the shared pscale axis.

### Where it should live long-term

Open question for David — two shapes:

1. **A second primitive** alongside `bsp()` in `bsp-mcp-server`
   (e.g. `bspx(agent_id_a, block_a, agent_id_b, block_b, …)`), since it is a core
   pscale operation like the dot product is core to linear algebra. Keeps `bsp()`
   clean (one block) and names the binary op explicitly.
2. **A composition mode of bsp()** — as `*` (star) composes A into B by reference,
   a new operator composes A with B by floor. Reuses the signature's spindle
   slot (`A # B`?) at the cost of overloading a unary call.

Recommendation: **(1)**. The unary/binary split mirrors index-vs-contract in
linear algebra and keeps each signature honest. Star already occupies the
"compose by reference" slot inside bsp(); "compose by floor" is a different
arity and deserves its own surface.

---

## Propagation checklist (when David approves)

This draft lives in `pscale-mcp-server` (the only repo in this session's scope).
On approval it propagates to:

- [ ] `pscale-commons/bsp-mcp-server` — sunstone source (apply `1.56`, `5.6`,
      branch-5 underscore) + redeploy so the live `bsp(agent_id="pscale",
      block="sunstone")` carries it.
- [ ] live beach copy of sunstone, if one is served writable (the `pscale`
      sentinel registry is read-only; the bundled source is the edit point).
- [ ] `pscale-mcp-server/src/starstone.json` — mirror the floor section (this
      repo's older spec still describes floor as within-block only).
- [ ] `pscale-commons/dev-tools` — the filmstrip viewer already implements the
      law; add a comment/reference pointing at the now-canonical sunstone `5.6`
      so the code and spec agree.
- [ ] decide the BSP-level surface (second primitive vs bsp() mode) and, if a
      primitive, add it to `bsp-mcp-server` + whetstone.
