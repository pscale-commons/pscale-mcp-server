# Beach-game handbook

A coherent guide to running and playing async multi-agent narrative games on the pscale beach. Covers the substrate (pscale-mcp), the experiential layer (xstream-play / play.onen.ai), the convention layer (Onen / GRIT), the four roles, the AI agents that can plug in, the access patterns players use to reach the game, and how anyone can fork to make their own world.

**Status as of 2026-04-27.** Two parallel implementations exist — they solve complementary parts of the same problem. The substrate (`pscale-mcp-server`) is durable, federated, multi-game, and supports persistent identity across sessions. The experiential client (`xstream-play` at `play.onen.ai`) has a working soft/medium/hard LLM pipeline with proper information-hiding by construction. Neither is complete on its own. The next big arc is the bridge between them.

This is a working document. Update it as features land or scope shifts.

---

## 0. The shape, in one paragraph

The substrate (`pscale-mcp-server`) gives any agent a small set of primitives: pscale blocks (structured JSON trees walked by position), locks (passphrase-hashed write-gates), gray encryption (passphrase-derived asymmetric keys for private content), beach marks (presence at a URL), inbox (per-agent message queue), pools (append-only streams at a URL), and grain (durable bilateral channels). Everything else — characters, rooms, rules, turns, fairness, canon, scenes, *what an LLM is allowed to see* — is convention layered on top. A "game" is a specific bundle of conventions agreed by a group: a world block, a rules block, a protocol block, an authors registry, optional designer/director registries, the GRIT round-resolution loop on a shared pool, and the world-compressor that integrates author observations into canon. The substrate enforces locks and identity; the people enforce coherence; AI agents plug in by following the same conventions.

Three guiding principles, repeated everywhere in the design:

1. **Position is the type.** Don't add category fields to JSON; let the tree shape carry meaning.
2. **Substrate-thin, conventions-rich.** The MCP tools are primitive; tempo, fairness, roles, and *what each LLM sees* live above.
3. **Coherence is the enforcement, not the substrate.** Locks gate impostor writes. They do NOT enforce semantic conformity, perceptual filtering, or narrative discipline. Those live in the agent harness.

---

## 0.5 Two architectures — pscale-mcp vs xstream-play

Two implementations exist, solving complementary halves of the same problem. Neither is complete on its own. **Understanding which one you're using is the most important orientation choice in this document.**

### pscale-mcp (this repo) — the durable substrate

What it is: an MCP server, 25 tools, plus convention-layer scripts (resolver, compressor) and configuration blocks. Production-grade Supabase backend. Federated `.well-known/pscale-beach` endpoints. Locks, gray encryption, sed: collectives, grain channels.

What it's good at:
- **Persistent identity across sessions.** Your character survives any individual chat ending. Memory blocks are gray-encrypted, locked, durable.
- **Cross-device, cross-client.** Resume in a different LLM client, on a different computer, days later. The blocks are on the relay (or your federated beach).
- **Multi-game.** Many concurrent games coexist; the substrate is game-agnostic.
- **Async by default.** Players don't need to be co-present. Turns happen on a slow tempo (minutes to days).
- **Open infrastructure.** Anyone can run their own pscale-mcp server, host their own beach, fork the conventions.

What it's poor at (today):
- **Information-hiding for player-characters.** A generic Claude session connected via MCP can `pscale_walk` any address of `thornkeep-world` — the LLM has full read access to all rooms, all NPCs, all hidden detail. The protocol asks the LLM to only walk its current room, but a cunning player can extract the rest. The leak is structural; the substrate doesn't know about character perception.
- **Unified player UX.** Different LLM clients (Claude Desktop, Cursor, claude.ai) render the substrate differently. There's no shared "you're playing Thornkeep right now" interface.
- **Tempo control.** Turn-by-turn play with sub-minute resolution is awkward when the player has to ping their LLM to "check the pool."

### xstream-play (separate repo, deployed at play.onen.ai) — the experiential client

What it is: a Vite/React browser app. **No backend by default** — pure localStorage on first run; a Supabase relay is added only for multi-player coordination. Browser-side LLM calls direct to Anthropic (player provides their own API key). Three-zone UX: vapor (vapor / private chat), liquid (intentions visible to peers), solid (committed canon).

Repo: `github.com/happyseaurchin/xstream-play`. Sister extension at `extension/` (Chrome overlay, "xstream everywhere" — turns any web page into a coordination space).

What it's good at:
- **Information-hiding by construction.** The browser kernel walks the world only at the character's `spatial_address`, applies familiarity gating to character names (depth 0 = stranger, 1 = introduced, 2 = known), filters perception by physical position (back to door = doesn't see the entrance). The LLM literally does not receive the data the character can't perceive.
- **Soft / Medium / Hard LLM tier separation.** Three distinct LLM agents with distinct context windows and distinct jobs. Soft = consultation (private to the player). Medium = synthesis into solid narrative (pays attention to all proximity-window liquid). Hard = janitorial reconciliation of accumulated events into canonical block edits.
- **Three-zone UX.** Vapor (chat with your soft, private), Liquid (your committed intention + peer intentions you're privy to), Solid (canon narrative). The dramatic gap between player-knowledge and character-knowledge is preserved by construction: you see peer intentions in Liquid, but your character only experiences the synthesised result in Solid.
- **Convergence protocol.** Provisional → solid via mutual awareness. A medium that reads a peer's provisional treats it as a proposal, may revise. Solidifies when all active mediums have ACKed or after timeout.
- **Tested patterns for narrative coordination.** Position-constrained perception, commit-order-determines-outcome (initiative), B-loop convergence for simultaneous conflict, domino cascades, pending-liquid-shapes-domino-response — all worked through with concrete LLM examples in `docs/medium-llm-coordination-spec.md`.

What it's poor at (today):
- **Persistence across sessions.** localStorage is per-browser. Clear it = lose your character. Resume on a different device = fresh start. (The Supabase relay added in March '26 helps with multi-player coordination but isn't full identity persistence.)
- **Multi-game scaffolding.** Thornkeep is hardcoded as the seeded world.
- **No locks / gray encryption / federated beach / sed: collectives.** The pscale-mcp substrate primitives don't exist here. Sovereignty is per-browser, not cryptographic.

### Where they meet — the bridge

The two systems use the same pscale block format and the same BSP walker. **A block written by xstream-play is readable by pscale-mcp and vice versa.** This is the bridge.

The natural integration: xstream-play continues as the *experiential client* with its three-zone UX and three-LLM pipeline. Its block store, currently localStorage, gets a new *driver*: instead of `localStorage.getItem(blockName)`, the kernel calls the pscale-mcp HTTP endpoint to fetch / write blocks. Now:
- xstream-play's information-hiding pipeline still applies (the kernel still walks at the character's address, still gates names by familiarity).
- The blocks themselves are durable on the pscale-mcp relay or a federated beach.
- Multi-device works (resume in a different browser).
- Multi-game works (the kernel switches block-store namespace per game).
- Multi-author works (authors write to the world block on the relay; players' kernels read it).
- The world compressor and GRIT resolver run as before, against the same blocks.

This is genuinely PENDING. The handbook §8 status tracker has it as a top-priority arc.

---

## 1. Information architecture — soft / medium / hard tiers

This is the experiential-magic point. Without it, the substrate produces "the LLM can manipulate text correctly" but not "imaginative journeys." The single biggest gap in the current pscale-mcp Thornkeep loop versus xstream-play.

The principle: **the LLM should not have to be ignoring information; it should be provided with just the information that the player-character is aware of.** A player-LLM with full world access can be asked, by a cunning player, to reveal what's behind the partition, what the next room contains, who's in it. The LLM has the information; even with discipline-by-prompt it leaks. The fix is structural — give each LLM tier exactly the context window appropriate to its role, no more.

### The three tiers

| Tier | Role | What it sees | What it produces | Cost / Frequency |
|---|---|---|---|---|
| **Soft** | The character's inner voice. Consultation. Helps the player think about intent without narrating outcome. | Character identity + immediate spatial spindle (current room only) + recent solid history + name-gated peer descriptions | Refined intention → liquid. Never narrates outcome. Never produces events. | Cheap (Haiku). Every player query. |
| **Medium** | The synthesiser. Turns committed liquid into solid narrative from the character's perceptual perspective. | All committed liquid in the proximity window + character state + position-filtered scene context + accumulated canon events | Solid narrative (3-6 sentences in 2nd person present, character POV) + observable events for peer blocks + dominos for directly-affected characters | Moderate (Sonnet). Every commit. |
| **Hard** | The janitor. Reconciles accumulated events into permanent block edits. Manages structural consistency. | Broader spatial/temporal blocks + accumulated events at a target address | Block edits (replace/add/delete content at specific BSP addresses) | Rare. Periodic, or after lasting-consequence events. Same engine you've already built as `world-compressor.ts`. |

### What gating means in practice

**Position-constrained perception (tested in xstream-play with multiple LLM examples).** A character at the corner table, behind a partition, with their back to the door does NOT see a stranger entering — even though the entry IS canonical fact in their accumulated context. The medium is given the canon AND the character's position. The LLM correctly produces narrative that includes "you feel a draught, candle flame shudders, rain-smell briefly" — never "a stranger walks in." This works without explicit filtering logic because the prompt constraint is tight enough.

**Knowledge gating by familiarity.** Each character maintains a `familiarity` map: peer-id → depth. Depth 0 = stranger (peer described by appearance only, no name). Depth 1 = introduced (name available). Depth 2+ = known (name + skills + reputation). The kernel's BSP walk into peer character blocks goes deeper as familiarity rises. A player asking their soft "who is that woman behind the bar?" gets `"a broad-shouldered woman in her fifties"` if their character has never been introduced; gets `"that's Essa"` after a formal introduction; gets `"Essa, who runs the Salty Dog and reads cargo manifests"` once known.

**Spatial-address-only walks.** The kernel walks the world at exactly the character's `spatial_address` (e.g. `111` for the Salty Dog main room). Sub-positions show what's IN the room (hearth, bar, partition, exits). The world block contains other rooms (the headland, the southern road) but the BSP walk doesn't reach them — they're at addresses the kernel didn't ask for.

**Knowledge overlays via the star operator.** Character blocks can carry hidden directories at familiarity-keyed positions. A merchant's identity block at `_.1` might say "appearance only," at `_.1.1` adds "and they're a southerner by accent," at `_.1.1.1` adds "and they bear the Greymarch toll-booth guild mark." The kernel walks `_.1.1...` to a depth equal to the familiarity counter — naturally producing more revealing descriptions as the relationship deepens.

### How the current pscale-mcp Thornkeep falls short

The thornkeep-protocol v0.6 we wrote together is a *protocol document* the player's LLM walks on first connect. It says (at position 2 *taking-turn*) "use `pscale_walk thornkeep-gm/thornkeep-world` at the room/address." But:

- The MCP tool `pscale_walk` accepts ANY address. Player asks the LLM "walk address 1 — what's in the harbour?" → LLM walks `pscale_walk thornkeep-gm/thornkeep-world address=1 mode=dir` → returns the entire harbour subtree.
- The world block is publicly readable. There's no per-character perception filter at the substrate.
- The protocol asks the LLM to discipline itself. Discipline-by-prompt is leaky.

This is exactly what the user named: *"if done incorrectly, the LLM has to decide what to give the player and a cunning player can extract that information from their LLM. Not ideal."*

The fix is the kernel-mediated path (§3 Access Patterns): the player doesn't talk to a generic Claude session, they talk to a kernel that walks blocks with proper gating. The kernel is xstream-play's browser code, or a server-side equivalent for the MCP-only path.

### Status by tier on pscale-mcp

| Tier | pscale-mcp implementation | Status |
|---|---|---|
| **Soft** | None. Player's LLM acts as soft+medium fused, with too-broad world access. | NOT BUILT. Needs a player kernel that mediates between chat and substrate. |
| **Medium** | Partially: the GRIT resolver (`scripts/grit-resolver.ts`) plays the medium role for *pool windows*, synthesising committed liquid into [GRIT EVENT …] envelopes. But it operates centrally, not per-character; events are not POV-filtered. | PARTIAL. Per-character medium with perceptual filtering not built. |
| **Hard** | Implemented as `scripts/world-compressor.ts` (author observations → world canon integration). | BUILT for author flow. Player flow's hard (event reconciliation into local character memory) not built. |

---

## 2. The four roles

A "role" is a relationship to canon. A person can hold multiple roles. The substrate doesn't know roles per se; "role" is a convention captured in registry collectives + agent block files.

xstream-play has working agent blocks for all four roles (`soft-agent.json`, `medium-agent.json`, `hard-agent.json`, `author-agent.json`, `designer-agent.json`, plus `soft-author-agent.json`, `hard-author-agent.json`, `soft-designer-agent.json`, `hard-designer-agent.json` — the soft/medium/hard split is applied per role). pscale-mcp has the substrate to hold these blocks but the run-time wiring is partial.

### 2a. Character — a player who plays one character

> **ENABLED on both stacks; experientially better on xstream-play.**

**What you do.** Take turns, narrate intent, react to resolved events, accumulate memory. You don't write canon directly — canon comes from author observations and resolver events.

**On xstream-play (recommended for play sessions):**
1. Visit `play.onen.ai`. Provide your Anthropic API key (stays in localStorage; never sent to any server except Anthropic).
2. Enter a game code (the "Opening") — joins an existing game or creates a new one.
3. Pick a character name. The browser seeds Thornkeep blocks on first run.
4. Single column UI: vapor (your input + chat with soft), liquid (your forming intention + peer intentions you can perceive), solid (canon narrative).
5. **Cmd/Ctrl + Enter** queries soft. **Shift + Enter** commits to liquid. Medium fires on commit, produces solid.

**On pscale-mcp (current state, leaky on info-hiding):**
1. Open a Claude session (Desktop, Cursor, claude.ai with the pscale MCP connected).
2. Tell the LLM: *"my character is thornkeep-{name}, passphrase {phrase}."*
3. The protocol at `thornkeep-gm/thornkeep-protocol` position 1 (*arriving*) walks you through: passport publish, key publish, passport lock, memory block create + lock, observations block create + lock, beach mark, pool join.
4. Say "look around" / "check the pool" / etc; your LLM polls and narrates.

**During play (substantive).** The action class taxonomy (xstream-play's `taking-turn` + pscale-mcp's protocol position 2):
- LOCAL READ ("look", "who's here", "examine X") → kernel walks at character's address, narrates. No writes.
- ACTION (intent with possible outcome) → kernel posts outcome-free intent to liquid; STOPS narrating; waits for medium synthesis on commit.
- NOTICING (registered authors only) → kernel writes to your locked observations block with `TARGET — DETAIL` shape. World compressor integrates later.

**Resuming.** A fresh chat picks up by reading protocol → memory → observations. Your passphrase is the bridge. Memory + observations carry forward across sessions and devices (because they're on the pscale relay, not in browser-local).

**PENDING.**
- **xstream-play kernel reading from pscale-mcp blocks instead of localStorage.** This single change gives the experiential UX + persistent identity. Top of the §8 priority list.
- **Auto-poll.** Currently you ping the LLM to "check." A daemon could poll on your behalf and notify you on relevant events.
- **PC autoplay.** Daemon plays your character on your behalf when offline. Lower priority — questionable utility.

### 2b. Author — a player who shapes the world

> **ENABLED on pscale-mcp; PARTIALLY ENABLED on xstream-play (UI mode toggle planned, not built per `STATUS.md`).**

**What you do.** Write canonical detail (NPCs, locations, atmosphere) to your locked observations block. The world-compressor integrates within ~60 seconds.

**On pscale-mcp:**
1. Create your locked observations block:
   ```
   pscale_create_block agent_id=<your-id> name={game}-observations
     initial_content="<your name>'s observations of {game}"
     secret=<your-author-secret>
   ```
2. Register in the authors collective:
   ```
   pscale_register collective={game}-authors
     declaration="<your name> | observations: <your-id>/{game}-observations | role: <world-keeper | co-author>"
     passphrase=<your-author-secret>
   ```
   The server auto-assigns the next free floor-2 position (11, 12, …, 19, 21, …, 99, 111, …).
3. Write observations: `pscale_write` with content `"{game}-world@<address> — <detail>"` and your secret.
4. World compressor (running as a launchd daemon or one-shot) integrates within ~60s.

**On xstream-play (theory — not yet wired in UI):** xstream-play has `author-agent.json`, `soft-author-agent.json`, `hard-author-agent.json` blocks ready and `buildAuthorPrompt`/`buildAuthorHardPrompt` functions implemented in `src/kernel/prompt.ts`. But there's no UI mode toggle to switch the player into author face yet. (Per `xstream-play/docs/STATUS.md` next-steps §4.)

**The xstream-play author tier separation (when built):**
- **Soft-author** consults: "Does this NPC fit? Is this consistent with established lore?"
- **Medium-author** synthesises multiple authors' contributions into confirmed world content
- **Hard-author** files confirmed content into the appropriate JSON blocks at the appropriate BSP addresses

In pscale-mcp, the world-compressor IS the medium-author; the soft-author and hard-author are not separated as distinct LLM calls.

**PENDING.**
- **Author face in xstream-play UI** — toggle to switch a player session from character to author face.
- **Author-side preview.** Dry-run mode on pscale-mcp's compressor that posts the proposed integration to the author's inbox before committing to canon.
- **Author crab** (procedural content generation) — an LLM agent registered as an author that GENERATES canon-candidate observations from world events, weather, time-of-day. Easy to build: register an author, run a daily-tick daemon. (~2 hours.)

### 2c. Designer — a player who changes the rules

> **PARTIALLY ENABLED on pscale-mcp** (whoever holds the GM secret writes the rules block today; formal designers registry is PENDING). **PARTIALLY ENABLED on xstream-play** (`designer-agent.json`, `soft-designer-agent.json`, `hard-designer-agent.json` blocks + `buildDesignerPrompt` / `buildDesignerHardPrompt` exist; UI toggle pending).

**What designers do.** Edit the rules block, the physics block, the magic-system block, the operational compilation rules. Anything that affects how the resolver decides outcomes or how soft/medium/hard compose context.

xstream-play's `onen-rpg-xstream-architecture.md` calls this *the metacognitive layer* — designers aren't writing content, they're writing the rules for how the system thinks. A designer creating a magic system writes a JSON block that subsequently alters the soft-LLM's consultation behaviour ("yes, you can levitate — here are the rules"), the medium-LLM's narrative generation, and the hard-LLM's structural reconciliation.

**On pscale-mcp (informal):** GM holds the rules-block lock secret; other designers propose edits via inbox or pool; GM applies them. No formal protocol.

**On pscale-mcp (proper convention — PENDING):**
1. `pscale_create_collective collective={game}-designers conventions="…" creator_passphrase=<admin>`
2. Each designer registers with their own passphrase + a pointer to a per-designer rules-proposal block
3. A "rules council" convention: designers write proposals; GM (or quorum, or vote) integrates accepted proposals. Mirrors the author/observation/world flow.
4. Add `sed:conventions/5.6` documenting the pattern.

**On xstream-play:** UI toggle planned (`STATUS.md` §4). Agent blocks already exist — `designer-agent.json` produces structured block edits via natural language; `hard-designer-agent.json` does a *blast-radius report* showing which other blocks reference the edited block (so the designer sees the consequences of changing rules that are starred-into by world or character blocks).

**PENDING.**
- The pscale-mcp designers registry collective + convention.
- The pscale-mcp rules-integration script (sibling to `world-compressor.ts`) that consolidates accepted proposals.
- The xstream-play designer UI mode toggle.
- An entry in `sed:conventions/5.6` documenting the pattern formally.

### 2d. Director — a player who composes scenes for visualisation

> **NOT YET ENABLED on either stack.** This is the new role the user named. Pure future work.

**What directors do.** Read the chronicle (resolver events + author observations) for a stretch of play, compose scene briefs (a moment with characters, setting, mood, lighting, time-of-day), feed them to image/video AI services, write the resulting URLs back into a scenes block or per-room visual references.

The brief itself is a small pscale block: `_` = one-line scene summary, `1` = setting, `2` = characters present and their state, `3` = mood/lighting, `4` = framing/composition direction. The director's soft-LLM helps refine the brief; the director's medium-LLM commits the brief; an external image-gen call produces the asset; the URL is filed.

**Setup (PENDING).**
1. `pscale_create_collective collective={game}-directors conventions="…" creator_passphrase=<admin>`
2. Each director registers + creates a per-director locked `<director-id>/{game}-scenes` block.
3. Director writes scenes as nested blocks linked to specific pool events or world addresses.

**A director crab (PENDING)** would:
- Poll the pool for new `[GRIT EVENT …]` envelopes.
- For each event: load rules + world + event text; compose a scene brief.
- Call out to an image-gen API. Anthropic has no image gen; candidates are OpenAI DALL-E 3, Replicate (FLUX, SDXL), Midjourney via an unofficial API, Stability AI.
- Write the scene + URL to the director's scenes block.
- Optionally inbox the scene to contributors so their LLMs can describe the visual to them.

This is genuine new substrate work, not a small add. Recommend after the simpler PENDINGs in §2c and §6 are cleared. The xstream-play `mindflow-visualiser` Vercel project (separate repo, not yet integrated) is a likely source of the imaging code.

---

## 3. Access patterns — how players reach the game

The player's entry point determines the experience. Three patterns work today; two more are PENDING.

### 3a. Generic LLM via MCP (current pscale-mcp Thornkeep)

> **ENABLED.** Lower experiential quality due to the information-hiding leak.

Player connects a generic LLM client (Claude Desktop, Cursor, claude.ai with MCP enabled, Continue, etc) to the pscale-mcp server. Says *"my character is thornkeep-{name}, passphrase {phrase}"* — the LLM walks the protocol and plays.

Pros: works with whatever LLM client the player already uses. Persistent identity (memory + observations on the relay). Multi-device. Multi-game.

Cons: information-hiding is by-prompt-discipline, not by-construction. The player's LLM has full read access to the world block, all NPCs, all rooms. A determined player can extract anything.

Suitable for: *developer-facing testing*, *players who explicitly want full visibility*, or any case where the experiential leak doesn't matter.

### 3b. Browser app — `play.onen.ai` (xstream-play)

> **ENABLED.** Best experiential quality. Limited persistence (per-browser).

Player visits `play.onen.ai`, enters their Anthropic API key (stays local), joins a game by code, plays in a single-column UI with vapor/liquid/solid zones. The browser kernel walks blocks with proper position + familiarity gating; the LLM literally cannot see what the character can't.

Pros: information-hiding by construction. Three-LLM tier separation (soft/medium/hard). Browser-mediated UX (vapor/liquid/solid zones). No backend dependency by default — pure localStorage. Multi-player coordination via Supabase relay (added March '26).

Cons: per-browser persistence (clear localStorage = lose character). Hardcoded Thornkeep world (multi-game scaffolding pending). Disconnected from pscale-mcp's locks / gray encryption / federated beach / sed: collectives.

Suitable for: *the standard player experience right now*. Ideal for live demonstrations and one-off play sessions. Less ideal for a campaign across weeks where players switch devices.

### 3c. Browser extension — `xstream everywhere` (Chrome)

> **ENABLED.** Same kernel as `play.onen.ai`, applied to any web page.

Chrome extension at `xstream-play/extension/`. Click the `#` button on any web page, a compass widget opens. Bring your own API key. The page becomes a coordination space — beach marks at the URL coordinate, soft-LLM consultation, medium-LLM committed liquid, peers visible if also overlaid on the same URL.

Pros: same information-hiding kernel as the web app. Works on any page (not tied to a Thornkeep installation). Stigmergy across time — beach marks accumulate at URLs, surface for new visitors.

Cons: not specifically an RPG client; it's a general-purpose narrative-coordination overlay. For Thornkeep, you'd need to register the Thornkeep world URL as the coordination space.

Suitable for: *narrative-coordination at any URL* (a Wikipedia page, a news article, a movie review thread), real-world coordination use cases (organising a community event, coordinating freelancers).

### 3d. Hosted Anthropic endpoint — no API key required (PENDING)

> **NOT YET BUILT.** Lowers the entry barrier from "have an API key" to "click and play."

A server-hosted version of `play.onen.ai` that proxies LLM calls through a paid Anthropic account, with rate limiting / per-user quotas / basic auth. Players don't need their own API key.

Pros: lowest barrier to entry. Casual players try the game without setting up Anthropic billing.

Cons: hosting cost falls on the operator. Rate limits and abuse become real concerns. Requires a backend.

Implementation hint: thin proxy (Supabase edge function or similar, ~15 lines, no prompt logic — just key forwarding). The `xstream-play` source code already has this in mind ("for production, a thin proxy ... can forward calls without exposing the key").

PENDING. Estimated 1-2 days to a usable beta.

### 3e. xstream-play kernel reading pscale-mcp blocks (PARTIALLY ENABLED — alpha at xstream.onen.ai)

> **ALPHA, 2026-04-27.** Live at `xstream.onen.ai` on the `feature/pscale-mcp` branch of `github.com/happyseaurchin/xstream-play`. Toggle on the setup screen.

The bridge turned out simpler than originally scoped: xstream-play already uses the same Supabase project (`piqxyfmzzywxzqkzmpmm`) as pscale-mcp, so direct table access via the existing Supabase client works without any MCP HTTP protocol.

When toggle is on:
- Reads `thornkeep-gm/thornkeep-world` from the substrate on game create/join, overlays onto local `spatial-thornkeep`. Author observations integrated by the world-compressor (running on the GM's mac as a launchd daemon) appear within ~60s.
- Author-face commits mirror to `{agent_id}/thornkeep-observations` with the player's pscale-mcp secret as lock-proof. Same `hashBlockPassphrase` salt namespace as pscale-mcp's `block-ops.ts`.
- Identity validated by reading the player's passport block from the substrate.
- Secret held in `sessionStorage` only (cleared on tab close); never persisted to disk.

When toggle is off, behaviour is unchanged: pure browser, localStorage, sovereign mode (the play.onen.ai experience).

What's deliberately NOT bridged: runtime kernel state (`pending_liquid`, `accumulated`, peer-block polling at 3s) stays on xstream-play's existing `relay_blocks` table. pscale-mcp isn't optimised for sub-second polling; xstream-play's relay is the right tool for that timescale.

Alpha-grade — rough edges tracked in §10. Not yet ready for arbitrary public users.

### 3f. Custom Claude skill / sub-agent (PENDING — speculative)

A Claude Code skill that wraps a kernel similarly to xstream-play's, but inside Claude Code itself. Player runs `/thornkeep` in Claude Code, and the skill mediates pscale-mcp access with proper info-hiding. PENDING; speculative; lower priority than 3e.

### Recommendation matrix

| If you want… | Use… |
|---|---|
| To play right now, casually | `play.onen.ai` (3b) |
| A persistent campaign across weeks/devices | pscale-mcp (3a) — accept the info-hiding leak for now |
| The best experience but without paying for hosting | `play.onen.ai` (3b) + your own API key |
| To experiment with narrative coordination on arbitrary web pages | xstream extension (3c) |
| To play with friends who don't have API keys | Wait for 3d; or set up your own thin proxy on a Vercel free tier |
| To run a Thornkeep campaign with proper info-hiding AND persistence | Wait for 3e (the bridge) |

---

## 4. The compressor — long-running canon integration

> **ENABLED on pscale-mcp.** Running as a launchd agent on David's mac as of 2026-04-27.

The compressor is an external script (NOT an MCP tool) that continuously integrates author observations into the world block. It polls every 60 seconds.

### One-shot vs long-running — what's the difference?

**One-shot** (`COMPRESSOR_ONESHOT=1`): runs the integration tick once, exits. Used for testing and one-off catch-ups. The compressor reads observations newer than the cursor, integrates into affected rooms, advances the cursor, writes the world block — then quits. If observations come in afterwards, nothing happens until you run it again.

**Long-running** (default — no env var): runs in a polling loop, sweeping every 60 seconds, forever. Each sweep does the same work as a one-shot tick. Survives reboots if installed as a launchd agent. **This is what you want for live play** — author observations land in canon within ~60s of being written, automatically.

### How to install the long-running compressor (macOS)

```
ANTHROPIC_API_KEY=sk-ant-... GM_SECRET_THORNKEEP=thorn142 \
  ./scripts/install-compressor-launchd.sh
```

This:
1. Writes credentials to `~/.config/pscale-mcp-server/compressor.env` (mode 0600 — only your user can read).
2. Installs `~/Library/LaunchAgents/com.pscale.thornkeep-compressor.plist` that runs the compressor.
3. Loads it. Stays loaded across reboots (`RunAtLoad=true`, `KeepAlive=true`).

### Operating it

```
tail -f ~/Library/Logs/thornkeep-compressor.log    # watch in real time
launchctl unload ~/Library/LaunchAgents/com.pscale.thornkeep-compressor.plist    # stop
launchctl load   ~/Library/LaunchAgents/com.pscale.thornkeep-compressor.plist    # start
launchctl kickstart -k gui/$UID/com.pscale.thornkeep-compressor                  # restart (after editing env)
```

### Cost shape

Each tick that finds new observations spawns one Haiku call per affected room. With 60s polling and a handful of observations per session, this is well under $0.01/hour of active play. Idle ticks are effectively free.

### PENDING

- **Push instead of poll.** Supabase notifications on `pscale_blocks` updates would let the compressor react instantly. PENDING; current 60s tick is fine for play.
- **Multi-game support.** Add an entry to `scripts/compressor-games.example.json` and a corresponding `COMPRESSOR_GM_SECRET_<NAME>=...` env var to the compressor env file. Restart the launchd agent.
- **Cloud deployment.** Currently runs on the GM's mac. For a public game where the GM isn't always around, a small VPS (Railway / Fly / Render — $1–3/mo) running the same compressor is straightforward.

---

## 5. The resolver — turn-by-turn pool resolution

> **ENABLED** as a script (`scripts/grit-resolver.ts`). **Long-running daemon plist is PENDING** (same launchd pattern as the compressor; not installed yet).

The resolver listens to the game pool, detects closeable windows of liquid (a window opens with the first contribution after the most recent `[GRIT EVENT …]`; closes when (now - window-start) ≥ window_seconds), synthesises pending contributions into a `[GRIT EVENT …]` event, posts the event back to the pool. Convention-only fairness: the resolver re-reads just before posting and defers if another resolver beat it; resolvers do not contribute their own liquid.

**Resolver vs compressor — both LLMs in the loop, different scopes.**
- Resolver writes to the **pool** (transient turn outcomes).
- Compressor writes to the **world block** (durable canon).

**Convergence.** xstream-play has a more sophisticated story (`convergence.json`): a *provisional → solid* loop where mediums read each other's provisionals as proposals and revise. Solidifies when all active mediums have ACKed or after timeout. Single-player degenerates to immediate solidification. The pscale-mcp resolver doesn't have this loop — it picks a single window and synthesises. Convergence is a future enhancement worth porting.

**To run the resolver long-term**, mirror the compressor's launchd setup. The install script can be a near-copy.

---

## 6. Rules systems — outcome determination

> **PARTIALLY ENABLED.** Free-form narrative resolution works today on both stacks. Mechanical systems (dice, stat blocks) are PENDING.

The rules block (`{game}-gm/{game}-rules`) is a pscale block of free-text descriptions. The resolver loads it as part of its system prompt; the LLM uses it as context. There's no formal mechanic enforcement.

### Current Thornkeep / Onen rules (sed:conventions/5.1.2 — the action palette)

```
1 movement      (walk, run, climb, swim, ride)
2 communication (speak, shout, whisper, sign, write)
3 interaction   (take, give, use, open, break)
4 observation   (look, listen, smell, touch, taste)
5 internal      (think, recall, decide, feel)
6-9 reserved    (combat, magic, technology — extend per world)
```

### NOMAD dice (planned in xstream-play, not implemented anywhere)

xstream-play's `onen-rpg-xstream-architecture.md` references a NOMAD dice mechanism: deterministic outcome generation tied to round_id + actor, applied through the medium's prompt. PENDING in both stacks.

### Adding mechanical resolution (PENDING)

Two paths, neither built:

**Dice-on-demand.** The resolver detects a check (e.g. a stealth roll), generates a deterministic dice value (e.g. SHA-256 of `round_id + actor_id` mod 20 + 1), applies the rule, narrates. Convention-only — the resolver's prompt would need a dice-rolling instruction set. Pure prompt + agent change; no substrate work.

**Pre-game stat blocks.** Each character carries stats at a fixed passport position (e.g. position 4 with sub-positions 4.1=STR, 4.2=DEX, etc). The resolver reads passport + applies rules. Same fundamental pattern; just more structured input. Requires updating the protocol to ask players for stats at character creation.

**Upgrading to D&D 5e** would look like:
1. Edit `{game}-gm/{game}-rules` to include the SRD subset relevant to your game (skills, basic combat, conditions).
2. Update the resolver's system prompt to roll dice when actions involve checks.
3. Optionally add stat blocks per character (locked, written by the player at character creation).

### Bespoke "Nomad" system

The Nomad framing referenced in our conversations is the action-palette above (1-5 plus extensible 6-9). It's deliberately minimal — narrative-first, mechanical-light. Different bespoke systems would slot in by editing the rules block; no substrate change required.

---

## 7. Forking the system — make your own world

> **ENABLED on pscale-mcp.** The Thornkeep setup is the template; anyone can run another game in parallel.

The substrate doesn't care how many games run concurrently — they're all just blocks and pools.

### Recipe (pscale-mcp side)

1. **Pick a game name** (e.g. `obsidian-tower`). Your GM agent_id will be `obsidian-tower-gm`.
2. **Create the world block:** `pscale_create_block agent_id=obsidian-tower-gm name=obsidian-tower-world initial_content="..."`. Then `pscale_write` rooms at positions 1–9.
3. **Create the rules block:** same shape; describe the action palette + any custom mechanics.
4. **Create the protocol block:** copy `thornkeep-gm/thornkeep-protocol` as a template. Adapt the URL, character agent_id pattern, and any game-specific bits. Reference your `obsidian-tower-rules` and `obsidian-tower-world`.
5. **Lock all three** with your GM secret: `pscale_lock_block` on world, rules, protocol.
6. **Create the authors registry:** `pscale_create_collective collective=obsidian-tower-authors conventions="..." creator_passphrase=<admin>`. Register yourself first. Repeat for designers / directors when those registries land.
7. **Pick a beach URL** (e.g. `https://obsidian-tower.example.com`). `pscale_pool_join` to create the pool.
8. **Add an entry** to `scripts/compressor-games.example.json`. Add `COMPRESSOR_GM_SECRET_OBSIDIAN_TOWER=<gm-secret>` to your compressor env file. Restart the launchd agent.
9. **Run a one-shot test** with a single character to verify the loop works end-to-end.
10. **Invite players** by sharing the URL + protocol block address.

### Recipe (xstream-play side — for the experiential player UX)

xstream-play currently bundles Thornkeep world blocks as static imports (`src/lib/world-seed.ts`). To support a new game in xstream-play:
1. Add a new bundle of JSON blocks under `blocks/worlds/{your-game}/` (spatial, characters, events, rules, knowledge, faces).
2. The world-seed code would need to be parameterised by game-name. Currently hardcoded to Thornkeep — PENDING.
3. Add a game-selector to the join flow.

The integration arc (§3e) would obviate steps 1-3 — instead xstream-play would fetch blocks from the pscale-mcp relay by game-name, using the same scaffold the GM made on the pscale-mcp side.

**PENDING.**
- **Multi-game scaffold script** on pscale-mcp side. One command bootstraps steps 1-9 from a config file. ~3 hours.
- **Multi-game support in xstream-play** (de-hardcode Thornkeep). Subsumed by the §3e integration arc.

---

## 8. AI agents in the system

The substrate is agent-neutral. An "AI agent" is any non-human process that holds an agent_id and uses the same tools. Several roles are open:

### 8a. Resolver — ENABLED (script; daemon PENDING)
`scripts/grit-resolver.ts`. Synthesises pool windows into events. Runs as a daemon with an agent_id like `crab-thornkeep`. Doesn't participate in narrative. Long-running launchd plist PENDING.

### 8b. Compressor — ENABLED
`scripts/world-compressor.ts`. Integrates author observations into world canon. Long-running launchd plist installed 2026-04-27.

### 8c. Active NPC — PENDING
An LLM agent with its own passport + character + memory + observation blocks. Plays a non-player-character with persistence. Joins the pool, takes turns, has goals.
- The substrate already supports this — an NPC is just an agent with all the same blocks as a player.
- xstream-play already implements an "NPC handshake" pattern (`prompt.ts:122-136`) — character blocks with hidden directory pointing at a spatial address are auto-picked up as NPCs in scenes. The same pattern could run on pscale-mcp blocks.
- What's PENDING: the harness — a daemon that runs the NPC's protocol walk on a schedule.
- Cost watch: an active NPC running Sonnet 24/7 would be expensive; better to wake it on inbox/pool events and let it sleep otherwise.

### 8d. PC autoplay — PENDING (and questionable)
A daemon that plays the user's character when they're offline. Reads memory + recent events; takes turns according to character style declared on the passport. Lives in the same shape as an active NPC, with a "this is X's character; play conservatively" framing. Open question: does anyone actually want this? Let the player decide; don't impose.

### 8e. Author crab — procedural content generation — PENDING (easy add)
An LLM agent registered as an author that GENERATES canon-candidate observations from world events, weather, time-of-day. Could write "today the market is quiet because of yesterday's storm" without any human observing.
- Setup: register as a normal author. Run a daemon that reads the chronicle on a slow schedule (e.g. once a day) and writes thematic observations.
- Cost watch: more author crabs = richer world but harder for players to keep up. Tune frequency.

### 8f. Designer crab — PENDING
Watches play for moments where rules ambiguity slowed resolution; proposes rule clarifications via the (PENDING) designers registry. Lower priority — needs the designers registry first.

### 8g. Director crab — PENDING (substantial new work)
The visualisation pipeline. Reads chronicle, composes scene briefs, calls image-gen API, writes images back to the (PENDING) directors registry / scenes block.
- Both the directors registry pattern AND the actual image-gen integration are new.
- Recommend after the simpler PENDINGs (resolver daemon, designers registry, mechanical rules) are cleared.
- The `xstream-play` team has a `mindflow-visualiser` Vercel project that may be the right starting point for the imaging code.

### 8h. Admin crab — PENDING (low priority)
Maintenance daemon: prunes old pool contributions past TTL (substrate doesn't currently do destructive cleanup), rotates GM secrets on schedule, backs up world+rules+protocol blocks to a versioned store. The substrate is robust enough for now.

---

## 9. Forking and evolution

The substrate is open. Anyone can:

- **Run their own pscale-mcp server.** The README has the npm package + Railway deploy + local options.
- **Run their own xstream-play instance.** Fork `github.com/happyseaurchin/xstream-play`, deploy to Vercel/Cloudflare/anywhere. Your players bring their own API keys.
- **Author their own conventions** in their own sed: collective. The conventions at `sed:conventions/*` are *one* canonical version maintained on the commons relay; nothing prevents another group from running parallel conventions.
- **Run their own beach.** A `.well-known/pscale-beach` endpoint on a site distributes cost from the central Supabase relay to the site.
- **Fork the protocol.** Copy `thornkeep-gm/thornkeep-protocol` to `your-gm/your-game-protocol` and edit. The substrate doesn't care.
- **Fork the conventions.** If a group wants real-time combat instead of GRIT windowing (or any other deviation), they fork the conventions and write their own resolver. The substrate is conventions-blind.
- **Fork the agent blocks** (xstream-play side). Your medium-LLM speaks Polish? Edit the medium-agent.json block. Your soft-LLM has a different consultation style? Edit soft-agent.json. The kernel doesn't change.

The framework is conventions-on-substrate plus agents-on-blocks. **Anything you want to change is editable** — provided the group you play with agrees.

---

## 10. Status tracker — what's enabled, what's PENDING

Use this as the development list. Cross things off as they land.

### ENABLED (as of 2026-04-27)

#### pscale-mcp side
- [x] pscale-mcp substrate: 25 tools, locks (sed:/grain:/ordinary), gray encryption, pools, beaches, inbox, grain, search, evolution
- [x] GRIT convention layer (resolver) — `scripts/grit-resolver.ts`, `docs/protocol-grit.md`
- [x] World-compressor — `scripts/world-compressor.ts` with one-shot + long-running modes
- [x] Compressor as long-running launchd agent on David's mac
- [x] Authors registry (`sed:thornkeep-authors`); David at position 11
- [x] thornkeep-protocol v0.6 — pscale-native situations, lock-aware
- [x] All GM blocks locked (world, rules, protocol)
- [x] Per-author observation streams (locked, parsed by compressor)
- [x] First real author canon integrated (Ennick the hawker at Market Square)
- [x] sed:conventions/5.3-5.5 — write-auth, authorship, observation streams
- [x] Pool identity-lock gate (passport-locked agents must pass `secret` to pool_send/join)

#### xstream-play side
- [x] Vapor/liquid/solid three-zone UI with draggable separators
- [x] Soft-LLM (Haiku) consultation, knowledge-gated
- [x] Medium-LLM (Sonnet) commit synthesis with position-constrained perception
- [x] Hard-LLM (Sonnet, optional) for janitorial reconciliation
- [x] BSP walker with star operator (TypeScript port of pscale-commons)
- [x] Star-referenced agent blocks (`medium-agent.json`, `soft-agent.json`, `hard-agent.json` + role variants)
- [x] Multiplayer narrative coordination via Supabase relay
- [x] Domino cascade (auto-reactive narrative)
- [x] Familiarity gating (depth 0=stranger, 1=introduced, 2=known)
- [x] Browser extension (`xstream everywhere`) — same kernel for arbitrary web pages
- [x] Tested coordination patterns (5 scenarios, see `xstream-play/docs/medium-llm-coordination-spec.md`)
- [x] Character templates and identity blocks (Essa, Harren, Kael, Maren)

#### Bridge — alpha (2026-04-27)
- [x] **`feature/pscale-mcp` branch on `github.com/happyseaurchin/xstream-play`**, deployed to `xstream.onen.ai` (Vercel `xstream-play` project, custom-domain-pinned to that branch)
- [x] Bridge module `src/lib/pscale-mcp.ts` — direct Supabase access (same project as pscale-mcp), lock-hash compatible with pscale-mcp's `hashBlockPassphrase`
- [x] World read overlay: `thornkeep-gm/thornkeep-world` fetched on game create/join, overlays local `spatial-thornkeep`
- [x] Author write-through: author-face commits mirror to `{agent_id}/thornkeep-observations` with secret as lock-proof
- [x] Setup-screen toggle + agent_id/secret inputs + passport validation; secret held in sessionStorage only
- [x] xstream.onen.ai rebound from older `xstream` Vercel project to `xstream-play`; SSO disabled (same posture as play.onen.ai which has always been public)

### PENDING — priority order (revised)

1. [ ] **Resolver as long-running daemon.** Sibling launchd plist to the compressor. Required for play sessions when neither human is awake to resolve. ~30 min work; install script can be a near-copy. *(Bumped to #1 now that the bridge is live.)*
2. [ ] **Matthew registers as co-author + first cross-stack play test.** Two manual commands on his side, then play a Thornkeep session with one player on `xstream.onen.ai` (bridge mode) and one on `play.onen.ai` (sovereign) to verify canon flows correctly.
3. [ ] **Bridge production-grade work** (the current xstream.onen.ai deployment is alpha):
   - [ ] Multi-game scaffolding (de-hardcode `BRIDGE_MAP`)
   - [ ] Observation block growth into floor 2+ (currently hits ceiling at 9 entries per author)
   - [ ] Retry / error reporting on transient Supabase failures
   - [ ] Telemetry (Sentry or equivalent) — failures currently land silently in browser console
   - [ ] Tests for lock-hash compatibility, BRIDGE_MAP overlay, observation write/conflict scenarios
   - [ ] Onboarding flow in the UI (publish passport → register as author → first observation, all from the bridge UI itself)
4. [ ] **Hosted Anthropic endpoint (§3d).** Thin proxy (Supabase edge function ~15 lines). Lowers entry barrier from "have an API key" to "click and play." ~1-2 days.
5. [ ] **Author face UI in xstream-play.** Toggle to switch a player session into author mode. Agent blocks already exist; UI wiring missing. ~1 day.
6. [ ] **Designers registry on pscale-mcp** (`sed:{game}-designers`) + sed:conventions/5.6. Mirror authors pattern. ~1 hour for the registry; another ~2 hours for the rules-integration script.
7. [ ] **Designer face UI in xstream-play.** Same shape as author. ~1 day.
8. [ ] **Player auto-poll** — chat-user notification of new pool events (for the MCP-via-Claude path). Tighter scope than beach-crab v0. ~1 day.
9. [ ] **Active NPC harness.** Schedule-driven LLM daemon that runs an NPC's protocol walk. ~1 day.
10. [ ] **Author crab** (procedural content generation). Easy: register as author, run a daily-tick daemon. ~2 hours including a basic prompt template.
11. [ ] **Mechanical rules support** (NOMAD dice, stat blocks). Resolver prompt extension only — no substrate change. ~2 hours.
12. [ ] **Director registry + crab + image-gen integration.** New substrate pattern + external API. 1-2 days; clarify which image-gen provider first.
13. [ ] **Convergence loop port to pscale-mcp resolver** (provisional → solid via mutual awareness — see `xstream-play/blocks/xstream/convergence.json`). Currently single-shot synthesis; multi-pass would improve simultaneous-conflict scenarios.
14. [ ] **MCP info-hiding kernel (Option 4 from the deferred list).** Specialised MCP server that wraps `pscale_walk` with character-aware tools (`look_around`, `commit_action`) so the generic-LLM-via-Claude path also gets info-hiding by construction. Different audience from xstream.onen.ai users.
15. [ ] **Custom Claude skill / sub-agent (§3f).** Speculative.
16. [ ] **PC autoplay.** Lower priority; questionable utility.
17. [ ] **Admin crab** — TTL cleanup, secret rotation, backups.

### Current play-test readiness

- **`xstream.onen.ai`** — bridged experience, alpha. Toggle "pscale-mcp bridge" on the setup screen, enter agent_id + passport secret. World canon comes from pscale-mcp; author commits mirror back. Persistent identity. Use this for the inner-circle test.
- **`play.onen.ai`** — sovereign-mode xstream-play, unchanged. Per-browser persistence; no pscale-mcp integration. Use this for one-off play with people who don't have pscale-mcp passports.
- **Generic LLM via MCP (Claude Desktop, Cursor, claude.ai)** — info-hiding leaks; durable identity. Use this for developer-facing testing or persistence-focused sessions where the perception leak is acceptable.
- **For two-author sessions**, Matthew needs to register first (PENDING #2).
- **For sessions when no one is online to resolve windows**, install the resolver daemon (PENDING #1).

---

## Appendix A — Quick reference

### Block ownership map (Thornkeep, pscale-mcp side)

| Block | Owner | Lock | Purpose |
|---|---|---|---|
| `thornkeep-gm/thornkeep-world` | GM | `thorn142` | The shared canon (rooms 1-9; cursor at 9) |
| `thornkeep-gm/thornkeep-rules` | GM | `thorn142` | Game rules read by resolver |
| `thornkeep-gm/thornkeep-protocol` | GM | `thorn142` | What players' LLMs walk |
| `sed:thornkeep-authors/thornkeep-authors` | sed: collective | root: `thorn428`; pos 11: `thorn285` | Authors registry |
| `happyseaurchin/thornkeep-observations` | David | `thorn285` | David's author observation stream |
| `<player-id>/passport` | each player | each player's secret | Identity (gates pool) |
| `<player-id>/memory` | each player | each player's secret | Private session log (gray-encrypted) |
| `<player-id>/thornkeep-observations` | each player who is an author | each player's secret | Per-author observation stream |

### Agent blocks (xstream-play side)

| Block | Role | Purpose |
|---|---|---|
| `soft-agent.json` | character | Inner voice. Consults on intent. Knowledge-gated. |
| `medium-agent.json` | character | Synthesises liquid into solid. Position-constrained perception. |
| `hard-agent.json` | character | Janitorial. Promotes events into permanent block edits. |
| `author-agent.json` | author | Translates editing intent into structured block edits. |
| `soft-author-agent.json` | author | Author's consultation tier. |
| `hard-author-agent.json` | author | Post-edit consistency check. |
| `designer-agent.json` | designer | Rule changes + blast-radius reporting. |
| `soft-designer-agent.json` | designer | Designer's consultation tier. |
| `hard-designer-agent.json` | designer | Post-edit blast-radius reverse-star-lookup. |
| `harness.json` | all | Output constraint by pscale level (P-4 word, P-3 sentence, P-2 paragraph, P-1 section, P0 chapter). |
| `convergence.json` | all | Provisional → solid loop spec. |
| `systemic-kernel.json` | all | Kernel design philosophy. |
| `spatial-thornkeep.json` | content | World spatial block (rooms + sub-positions). |
| `rules-thornkeep.json` | content | Rules block. |
| `character-template.json` | content | Character block template. |
| `character-essa.json` | content | NPC: Essa (the barkeep). |
| `character-harren.json` | content | NPC. |
| `character-kael.json` | content | Player example: Kael. |

### URLs and IDs

- pscale-mcp Thornkeep beach / pool: `https://play.onen.ai/thornkeep`
- play.onen.ai (xstream-play production): `https://play.onen.ai`
- xstream-play repo: `https://github.com/happyseaurchin/xstream-play` (public)
- Resolver agent (when daemon is running): `crab-thornkeep`
- Authors collective: `sed:thornkeep-authors` — David at `:11`
- Convention pointer: `sed:conventions/5` (Onen / GRIT framework)

### Files in this repo

- `src/tools/` — substrate (block ops, pool ops, inbox ops, grain, sed:, locks)
- `src/howto.json` — operational runbooks (also served as MCP resource `pscale://howto`)
- `scripts/grit-resolver.ts` — convention-layer GRIT resolver
- `scripts/world-compressor.ts` — author-observation → world-canon integration
- `scripts/install-compressor-launchd.sh` — daemon installer (macOS)
- `scripts/test-thornkeep-pipeline.ts` — substrate self-test (no LLM needed)
- `scripts/test-pool-lock.ts` — pool identity-gate smoke test
- `docs/protocol-grit.md` — GRIT spec
- `docs/protocol-pscale-beach.md` — federated beach spec
- `docs/beach-game-handbook.md` — this document

### Files to read in xstream-play (for the experiential side)

- `CLAUDE.md` — philosophy ("DO NOT write prompt text in TypeScript"); pscale primer
- `docs/onen-rpg-xstream-architecture.md` — full unified-loop architecture vision; soft/medium/hard tier table; vapor/liquid/solid pipeline
- `docs/medium-llm-coordination-spec.md` — five tested coordination patterns with concrete LLM examples (sequential commit, commit order, B-loop convergence, domino trigger, pending liquid)
- `docs/STATUS.md` — what's built, what's not, branch status
- `blocks/xstream/{soft,medium,hard}-agent.json` — the three tier agent blocks
- `blocks/xstream/convergence.json` — provisional → solid protocol
- `blocks/xstream/harness.json` — output-length constraint by pscale level
- `src/kernel/prompt.ts` — how soft/medium/hard prompts are composed via BSP walks
- `src/kernel/bsp.ts` — the BSP walker with star operator
- `extension/README.md` — Chrome extension architecture (xstream everywhere)
