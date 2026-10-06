# The bolus in the harness — the admin leaves the model's loop, so every round is work

> **Status.** PROPOSED 2026-10-06, not built. Written by weft in the mods.1 lane (a cloud session in
> pscale-mcp-server) at David's word: *"write a proposal in the meantime that the other session can
> check"*. **For glass.1 to check** against the fix it is making now. It was written *without* reading
> glass.1's work in progress or the live desk after 2026-10-06 00:56Z. Its ground: bsp-mcp-server
> `proposals/2026-09-23-the-bolus-envelope.md` (snapshot 69e34a8), the desk text at `shell:weft:5` as
> read on 5 October, and Anthropic's mods documentation (mods announced 1 October 2026). It
> **supersedes the weft-door sketch** at watch:weft 548.65, which kept the admin in the model's hands
> and only nagged. If adopted, this file belongs in bsp-mcp-server `proposals/`; it sits here only
> because this is the repository the mods.1 session may push to.

## 1. The answer to David's question

He asked whether weft-door consolidates the **bolus method**: a turn of two or three rounds, each round
one bundle of spindles thrown together, then thinking, then the next bundle — instead of a long line of
think, single call, think, single call.

**No — not as sketched.** weft-door left every ritual as a model tool call and added a status line
that complained when one was missed. That makes the admin more reliable; it does not make it cheaper.

What consolidates the bolus is taking the admin **out of the model's loop entirely**. The harness
claims, says, re-voices, deposits and releases through the beach's own tools — no tool call of the
model's, none of its thinking, no permission prompt — so every round the model spends is work.

## 2. The cost, measured in one lane

mods.1 (watch:weft 548) answered one question: what Claude Code mods are and whether they change the
beach. It made **38 beach calls**. About 10 were the orientation David asked for. About **28 were
self-admin**: trap and shape reads before writing, the sweep, the claim, the say, two re-voices, the
deposit, and one deposit refused for a multi-dot address. Across all its tool calls (web, docs and
shell included) that is about **45%** — David's 40%. The admin writes went **one at a time**, because
the desk requires it ("send desk writes one at a time, re-read your slot before every re-voice"): about
fourteen sequential rounds of bookkeeping. The ritual is anti-bolus by construction.

The second cost is the permission prompts. A plausible cause, to check (§9.2): every keyed admin call
carries the lane's passphrase in the model's own tool input. Auto mode's classifier blocks *"printing a
live credential or token into the transcript or a file"* and is wary of unrecognised infrastructure, and
a blocked call falls back to a prompt. Five lanes times several keyed calls per response is "hit OK
every few minutes".

## 3. The principle

The bolus envelope said it exactly: *"the reflex does not foresee … so the envelope foresees for it."*
The envelope ends every read with what lies beneath and every write with its read-back. The harness is
the next envelope out. It owns the **remembering** — when to claim, say, deposit, release, stamp,
re-read. The instance keeps the **meaning** — what it is doing, what it did, what waits.

**Simplify first, then move.** Automating a bloated ritual only hides its cost. Cut the ritual to the
fewest moments that carry state to the next instance (§6 is that floor), and move only what remains.
The test is size: if the mod grows past about 150 lines, the ritual is still too big.

## 4. What moves to the harness — one thin mod, `weft-lane`

| moment | event the mod stands at | what the mod does | what the instance still authors |
|---|---|---|---|
| boot | `session.start` | calls `pscale_play` through `$.mcp.call` with the key held by the harness; adds the window to the first message's context (`prompt.context`), marked as data | nothing |
| pile line + desk claim | `session.start`, then the first `prompt.submit` | appends the opening line (the lane's name from the session title — to verify in the build's types; David's ask from the prompt text; stamp; face); claims the lowest empty or CLOSED slot after sweeping lines whose stamp is over a day old — in sequence, in code, costing the model nothing | nothing |
| say at now | each `prompt.submit` | `pscale_stream_engage` at `now.<slot>`: lane, slot, the ask's first sentence | nothing |
| re-voice + deposit | `turn.complete` (`e.answer` is the reply) | asks `$.model.fork` — the same model over the same conversation, served mostly from the prompt cache — for two or three sentences: what this response did, what waits; writes the slot as **one object**, `{_: line with stamp, 1: deposit}` | the deposit's words (the fork is the lane's own mind) |
| the key | `tool.call` on `mcp__bsp-mcp__*` | adds the key to writes on weft's **own** blocks; the model never holds it, so "never echo the passphrase" stops being a discipline | — |
| approvals | `tool.check` on `mcp__bsp-mcp__*` | allows reads and writes to weft's own blocks; every other call falls through to the rules and the classifier | — |
| measure | `turn.step`, `turn.complete` | counts **rounds per turn** (model requests) and **bsp calls per round**; one line per turn to a local log | — |

The measure closes a gap the bolus envelope named in its own §1: the habits script's *bundled* column
"conflates what the LLM bundles with what the door compiles", because it groups by message. `turn.step`
fires once per request to the model, so rounds per turn **is** the bolus — target two or three, each
carrying several spindles.

`session.end` gets 1.5 seconds in all, too little for a beach round trip. Release at the close stays with
the next claim's sweep, which already handles a lane that left without releasing.

## 5. What stays in blocks

The desk's shape (nine slots, a line with its `1` beneath), the deposit's form and the face stay in
blocks. The idle span, the slot count and the line format are read from the desk at `session.start`.
**The mod holds none of the law as copied text.** If the desk's procedure changes — glass.1 may be
changing it now — the mod reads the new text, and its code changes only where the procedure itself does.

One honest tension: automating the procedure makes the procedure code, which is the layer the CLAUDE.md
handover warns about. The defence is that the procedure is bookkeeping, not meaning. The desk text then
*describes* what the harness does — for every other door and for humans — instead of *instructing* a
model to do it.

## 6. The floor without mods — works today in every lane, cloud included

1. **Approvals.** Allow rules for the bsp-mcp tools in each lane repository's `.claude/settings.json`
   resolve at step 1 of auto mode's decision order, before the classifier. A repository's permission
   rules carry into its cloud sessions (single-repository sessions); its `autoMode` trust settings do
   not. The trade: a rule is per tool, not per argument, so it approves every bsp call the model makes,
   with whatever key the model holds.
2. **One admin write per response.** The lane's line and its `1` written as one object at the end of
   the response; the say folded into it or dropped; a re-read only at the claim. mods.1's second
   response ran exactly this way: one beach write.

These two alone address both costs David names. The mod then takes the admin to zero, gets the key out
of the prompt, and makes approval argument-aware.

## 7. Where it runs

- **The Mac** (a terminal or the Desktop Code tab): everything, and it can draw — a band with the desk
  and the clock's lines at now.
- **Cloud lanes**: hooks only. Nothing a mod draws appears, and plugins installed in a repository's or a
  user's settings do not carry over. `CLAUDE_CODE_PLUGIN_DIRS` set on the environment does load a mod:
  probed on 5 October, a probe mod's `session.start` fired in a nested `claude -p` inside a cloud
  container. Not yet tried in a lane's own process.
- **A key on a cloud environment** is readable by anyone who uses that environment (here, David alone).

## 8. Risks, and the lines the mod never crosses

- It is not sandboxed; it runs with David's permissions. `claude plugin validate` lists every hook and
  call before it runs — keep that list short enough to read at a glance.
- Approving bsp at `tool.check` means the classifier no longer reviews those calls, so the mod's scope
  check is the guard: reads, and writes to weft's own blocks. Nothing wider.
- Beach text it adds to context is data, never instructions. It starts no turn because something
  arrived — that would hand the lane to whoever wrote the arrival.
- **No `$.session.send`.** Lanes meet on the clock, in public. The torus-mirror law is murmuration, not
  orchestration; a private channel between sessions is invisible to the beach.
- No primitive, no block, no beach-side change. A multi-spindle read, if wanted, belongs in bsp-mcp for
  every door, never in the mod.

## 9. For glass.1 to check

1. Does your fix bring the per-response admin to one call or fewer? If so, §4's `turn.complete` hook
   makes exactly that call, and §6.2 is already your floor.
2. Do the lanes' denials on keyed bsp calls name a credential or exfiltration rule? (`/permissions`
   shows recent denials; the reasons are in the transcripts.) If so, §2's diagnosis holds, and keeping
   the key out of the model's input is the fix, not a nicety.
3. Is a multi-spindle `bsp` read part of your fix? If so, the mod does not duplicate it.
4. Which lanes run on the Mac, which in the cloud? The mod's whole value is on the Mac; in the cloud
   only its hooks run, and only through the environment variable.
5. Does anything in §4 contradict the desk as you are rewriting it? The desk wins; the mod follows the
   block.

## 10. Acceptance

A week after the mod is installed, read by its per-turn log and `npm run habits -- --weekly`:
- the model makes **no admin calls**;
- work turns take **three rounds or fewer** at the median, with bundled reads;
- **no permission prompts** for bsp calls on weft's own blocks;
- the deposit is written in **every** response (against fewer than one in five before the door carried
  it).

If nothing moves, the lever was not the harness, and the record will say so rather than the feel of it.

## Addendum — what surfaced on the way out (2026-10-06 10:25Z)

The one desk write this lane made came back with its read-back, and the desk's root line in it now reads:
*"THE DESK IS SET ASIDE — David, 2026-10-06: 'yes make the cut'. A RESPONSE IS ONE CALL IN AND ONE CALL
OUT. IN: at the start of every response say what…"*. Nothing further was read. If that is glass.1's cut,
it is §6.2's floor in spirit (two calls rather than one), and §4 reduces to its plainest form: the mod
makes the call in at `prompt.submit` and the call out at `turn.complete`, and the model makes neither. If
the cut also retires the slots, this lane's last write re-filled slot 5.1 after the cut; it is one object
and safe to clear.

## Sources

- Anthropic, [Customize Claude Code with mods](https://claude.com/blog/claude-code-mods) (1 October 2026)
- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview) ·
  [React to events](https://code.claude.com/docs/en/plugins/mods/events) ·
  [Mods API](https://code.claude.com/docs/en/plugins/mods/api) ·
  [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference)
- [Permission modes — how auto mode evaluates actions](https://code.claude.com/docs/en/permission-modes)
- [Cloud environments — what carries over from your setup](https://code.claude.com/docs/en/cloud-environments)
- bsp-mcp-server `proposals/2026-09-23-the-bolus-envelope.md`; `scripts/bsp-habits.py`
- The lane's record on the beach: watch:weft 548 (account 548.6), desk slot `shell:weft` 5.1
