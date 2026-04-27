# Beach-game handbook

A coherent guide to running and playing async multi-agent narrative games on the pscale beach. Covers the substrate (pscale-mcp), the convention layer (Onen / GRIT), the four roles, the AI agents that can plug in, and how anyone can fork the system to make their own world.

**Status as of 2026-04-27.** The foundation is in place and Thornkeep is the running example. Several roles and AI integrations are PENDING — each section marks clearly what's built versus what's next.

This is a working document. Update it as features land or scope shifts.

---

## 0. The shape, in one paragraph

The substrate (`pscale-mcp-server`) gives any agent a small set of primitives: pscale blocks (structured JSON trees walked by position), locks (passphrase-hashed write-gates), gray encryption (passphrase-derived asymmetric keys for private content), beach marks (presence at a URL), inbox (per-agent message queue), pools (append-only streams at a URL), and grain (durable bilateral channels). Everything else — characters, rooms, rules, turns, fairness, canon, scenes — is **convention layered on top**. A "game" is a specific bundle of conventions agreed by a group: a world block, a rules block, a protocol block, an authors registry, optional designer/director registries, the GRIT round-resolution loop on a shared pool, and the world-compressor that integrates author observations into canon. The substrate enforces locks and identity; the people enforce coherence; AI agents plug in by following the same conventions.

Three guiding principles, repeated everywhere in the design:

1. **Position is the type.** Don't add category fields to JSON; let the tree shape carry meaning.
2. **Substrate-thin, conventions-rich.** The MCP tools are primitive; tempo, fairness, and roles live above.
3. **Coherence is the enforcement.** Locks gate impostor writes. They do NOT enforce semantic conformity. A player who deviates simply doesn't get a coherent game.

---

## 1. The four roles

A "role" is a relationship to canon. A person can hold multiple roles. The substrate doesn't know roles per se; "role" is a convention captured in registry collectives.

### 1a. Character — a player who plays one character

> **ENABLED.** The whole flow works end-to-end.

**What you do.** Take turns, narrate intent, react to resolved events, accumulate memory. You don't write canon directly — canon comes from author observations and resolver events.

**Setup (one-time).**
1. Open a Claude session (Desktop, Cursor, claude.ai with the pscale MCP connected).
2. Tell the LLM: *"my character is thornkeep-{name}, passphrase {phrase}."*
3. The protocol at `thornkeep-gm/thornkeep-protocol` position 1 (*arriving*) takes care of the rest:
   - Publishes your passport
   - Derives Ed25519+X25519 keys from your passphrase
   - Locks your passport (gates impersonation on the pool)
   - Creates a locked memory block (private, gray-encrypted)
   - Creates a locked observations block (you can contribute canon if you ALSO register as an author)
   - Joins the pool

**During play.**
- *Turn input* (protocol position 2 *taking-turn*): your LLM classifies what you say into one of three classes —
  - LOCAL READ ("look", "who's here") → walk world / pool / beach. No writes.
  - ACTION ("I draw my sword") → `pool_send` outcome-free intent, then STOP.
  - NOTICING (only if you're a registered author) → `pscale_write` to your observations block with `TARGET — DETAIL` shape.
- *Polling* (protocol position 3 *reading-back*): you say "check" / "what happened?" — your LLM polls inbox + pool, narrates any `[GRIT EVENT …]` envelopes affecting you, optionally writes follow-on observations.
- *Resuming* (protocol position 5 *returning*): a fresh chat picks up by reading protocol → memory → observations. The passphrase is the bridge.

**PENDING.**
- **Auto-poll.** You currently have to ping your LLM to "check." A scheduled task or daemon could poll on your behalf and notify you of relevant events (beach-crab v1 attempted this; abandoned; worth a fresh attempt with tighter scope).
- **PC autoplay.** A daemon that plays your character on your behalf when you're offline, per character style declared on your passport. Lower priority — questionable whether you'd want this.

### 1b. Author — a player who shapes the world

> **ENABLED.** David is the first registered author at `sed:thornkeep-authors:11`; first canon contribution (Ennick the hawker at Market Square) integrated 2026-04-27.

**What you do.** Notice canonical detail (NPCs, locations, atmosphere) and write observations to your locked observations block. The world-compressor (a daemon, see §2) integrates your observations into the world block on a schedule — typically within 60 seconds.

**Setup (one-time per author).**
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
   The server auto-assigns the next free floor-2 position (11, 12, …, 19, 21, …, 99, 111, …). Your address: `sed:{game}-authors:{position}`.

**Playing.** When the resolver narrates an event that introduces canon-candidate detail (an NPC, a smell, a hidden door), write it to your observations block:
```
pscale_write agent_id=<your-id> name={game}-observations
  address=<next free position>
  content="{game}-world@<room-address> — <observation detail>"
  secret=<your-author-secret>
```
Format: TARGET (`{game}-world@N`) + em-dash or colon + DETAIL.

**Verifying.** After the next compressor tick (≤60s):
```
pscale_walk agent_id={game}-gm name={game}-world
```
Your detail should be woven into the affected room.

**PENDING.**
- **Author-side preview.** A dry-run mode on the compressor that posts the proposed integration to the author's inbox before committing to canon.
- **Per-author cursor visibility.** A tool that shows what's been integrated and what hasn't (currently the cursor lives at `world@9.last_compression`; readable but not tooled).
- **Multi-style integration.** Right now the compressor uses one prompt template. Could be parameterised per-game or per-author for different prose voices.

### 1c. Designer — a player who changes the rules

> **PARTIALLY ENABLED.** Whoever holds the GM secret writes to the rules block today. A formal designers registry (parallel to authors) is PENDING.

**What designers do.** Edit the rules block (`{game}-gm/{game}-rules`): extend the action palette, define magic / combat / technology, swap in a different system entirely (D&D 5e SRD, Burning Wheel, Nomad bespoke). Anything that affects how the resolver decides outcomes lives in the rules block.

**Setup (current — informal).** The rules block is locked with the GM secret. The GM is the only person who writes to it. Other designers propose edits via inbox or pool; the GM applies them.

**Setup (the proper convention — PENDING, easy add).**
1. `pscale_create_collective collective={game}-designers conventions="…" creator_passphrase=<admin>` — a designers registry parallel to authors.
2. Each designer registers with their own passphrase + a pointer to a per-designer rules-proposal block.
3. A "rules council" convention: designers write proposals to their proposal blocks; the GM (or a quorum, or a vote) integrates accepted proposals into the live rules block. Mirrors the author/observation/world flow but for rule deltas.

**The substrate would NOT integrate proposals automatically** — that's a designer-coordination protocol on top, in the same way GRIT sits on top of the pool primitive.

**PENDING.**
- The designers registry itself.
- A rules-proposal observation pattern (sibling to the author-observation pattern but for rule deltas).
- A rules-integration script (sibling to `world-compressor.ts`) that consolidates accepted proposals.
- An entry in `sed:conventions/5.6` (or 5.7) documenting the pattern formally.

### 1d. Director — a player who composes scenes for visualisation

> **NOT YET ENABLED.** Mostly future work. The pattern mirrors the author/compressor flow with a different output substrate (image / video instead of text).

**What directors would do.** Read the chronicle (resolver events + author observations) for a stretch of play, compose scene briefs (moment, characters, setting, mood, lighting, time-of-day), feed them to image/video AI services, write the resulting URLs back into a scenes block or per-room visual references.

**Setup (PENDING).**
1. `pscale_create_collective collective={game}-directors conventions="…" creator_passphrase=<admin>`.
2. Each director registers + creates a per-director locked `<director-id>/{game}-scenes` block.
3. Director writes scenes as `pool-event-id|{game}-world@<room> | <brief> | <image-url>` (or similar shape — to be designed).

**A director crab (PENDING)** would:
- Poll the pool for new `[GRIT EVENT …]` envelopes.
- For each event: load rules + world + event text, compose a scene brief.
- Call out to an image-gen API. Anthropic has no image gen; candidates are OpenAI DALL-E 3, Replicate (FLUX, SDXL), Midjourney via an unofficial API, Stability AI.
- Write the scene + URL to the director's scenes block.
- Optionally inbox the scene to the contributors so their LLMs can describe the visual.

This is genuine new substrate work, not a small add. Recommended only after the simpler PENDINGs in §1c and §6 are cleared.

---

## 2. The compressor — long-running canon integration

> **ENABLED.** As of 2026-04-27, running as a launchd agent on David's mac.

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

Each tick that finds new observations spawns one Haiku call per affected room. With 60s polling and a handful of observations per session, this is well under $0.01/hour of active play. **Idle ticks are effectively free** — just a Supabase read of the registry and the world cursor.

### PENDING

- **Push instead of poll.** Supabase notifications on `pscale_blocks` updates would let the compressor react instantly. PENDING; current 60s tick is fine for play.
- **Multi-game support.** The script accepts a games config file with multiple entries, but we've only configured Thornkeep. To add a game: append an entry to `scripts/compressor-games.example.json` and add the corresponding `COMPRESSOR_GM_SECRET_<NAME>=...` env var to `~/.config/pscale-mcp-server/compressor.env`. Restart the launchd agent.
- **Cloud deployment.** Currently runs on the GM's mac. For a public game where the GM isn't always around, a small VPS (Railway / Fly / Render — $1–3/mo) running the same compressor is straightforward.
- **Author-side preview / dry-run.** See §1b PENDING.

---

## 3. The resolver — turn-by-turn pool resolution

> **ENABLED** as a script (`scripts/grit-resolver.ts`). Long-running daemon plist is **PENDING** (same launchd pattern as the compressor; not installed yet).

The resolver listens to the game pool, detects closeable windows of liquid (a window opens with the first contribution after the most recent `[GRIT EVENT …]`; closes when (now - window-start) ≥ window_seconds), synthesises pending contributions into a `[GRIT EVENT …]` event, posts the event back to the pool. Convention-only fairness: the resolver re-reads just before posting and defers if another resolver beat it; resolvers do not contribute their own liquid.

**Resolver vs compressor — both LLMs in the loop, different scopes.**
- Resolver writes to the **pool** (transient turn outcomes).
- Compressor writes to the **world block** (durable canon).

**To run the resolver long-term**, mirror the compressor's launchd setup. We haven't installed a plist for it yet — this is a clear next step (§8 priority 1).

---

## 4. Rules systems — outcome determination

> **PARTIALLY ENABLED.** Free-form narrative resolution works today. Mechanical systems (dice, stat blocks) are PENDING.

The rules block (`{game}-gm/{game}-rules`) is just a pscale block of free-text descriptions. The resolver loads it as part of its system prompt; the LLM uses it as context. There's no formal mechanic enforcement.

### Current Thornkeep / Onen rules (sed:conventions/5.1.2 — the action palette)

```
1 movement      (walk, run, climb, swim, ride)
2 communication (speak, shout, whisper, sign, write)
3 interaction   (take, give, use, open, break)
4 observation   (look, listen, smell, touch, taste)
5 internal      (think, recall, decide, feel)
6-9 reserved    (combat, magic, technology — extend per world)
```

This is enough for narrative play. The resolver applies common-sense outcomes informed by the rules + world text. Suitable for "playing-out-a-shared-world" sessions; not suitable for crunchy mechanical play.

### Adding mechanical resolution (PENDING)

Two paths, neither built:

**Dice-on-demand.** The resolver detects a check (e.g. a stealth roll), generates a deterministic dice value (e.g. SHA-256 of `round_id + actor_id` mod 20 + 1), applies the rule, narrates. Convention-only — the resolver's prompt would need a dice-rolling instruction set. Pure prompt + agent change; no substrate work.

**Pre-game stat blocks.** Each character carries stats at a fixed passport position (e.g. position 4 with sub-positions 4.1=STR, 4.2=DEX, etc). The resolver reads passport + applies rules. Same fundamental pattern; just more structured input. Requires updating the protocol to ask players for stats at character creation.

**Upgrading Thornkeep to D&D 5e** would look like:
1. Edit `thornkeep-gm/thornkeep-rules` to include the SRD subset relevant to your game (skills, basic combat, conditions).
2. Update the resolver's system prompt to roll dice when actions involve checks.
3. Optionally add stat blocks per character (locked, written by the player at character creation).

Straightforward but PENDING.

### Bespoke "Nomad" system

The Nomad framing referenced in conversations is the action-palette above (1-5 plus extensible 6-9). It's deliberately minimal — narrative-first, mechanical-light. Different bespoke systems would slot in by editing the rules block; no substrate change required.

---

## 5. Forking the system — make your own world

> **ENABLED.** Thornkeep is the template; anyone can run another game in parallel.

The substrate doesn't care how many games run concurrently — they're all just blocks and pools.

### Recipe

1. **Pick a game name** (e.g. `obsidian-tower`). Your GM agent_id will be `obsidian-tower-gm`.
2. **Create the world block:** `pscale_create_block agent_id=obsidian-tower-gm name=obsidian-tower-world initial_content="..."`. Then `pscale_write` rooms at positions 1–9.
3. **Create the rules block:** same shape; describe the action palette + any custom mechanics.
4. **Create the protocol block:** copy `thornkeep-gm/thornkeep-protocol` as a template. Adapt the URL, character agent_id pattern, and any game-specific bits. Reference your `obsidian-tower-rules` and `obsidian-tower-world`.
5. **Lock all three** with your GM secret: `pscale_lock_block` on world, rules, protocol.
6. **Create the authors registry:** `pscale_create_collective collective=obsidian-tower-authors conventions="..." creator_passphrase=<admin>`. Register yourself first. Repeat for designers / directors when those registries land.
7. **Pick a beach URL** (e.g. `https://obsidian-tower.example.com`). `pscale_pool_join` to create the pool.
8. **Add an entry** to `scripts/compressor-games.example.json` (or your own config copy):
   ```json
   {
     "name": "obsidian-tower",
     "gm_agent_id": "obsidian-tower-gm",
     "world_block": "obsidian-tower-world",
     "rules_block": "obsidian-tower-rules",
     "authors_collective": "obsidian-tower-authors",
     "observations_block_name": "obsidian-tower-observations"
   }
   ```
   Add `COMPRESSOR_GM_SECRET_OBSIDIAN_TOWER=<gm-secret>` to your compressor env file. Restart the launchd agent.
9. **Run a one-shot test** with a single character to verify the loop works end-to-end.
10. **Invite players** by sharing the URL + protocol block address.

**PENDING.** A single command that scaffolds 1–9 from a config file. Currently each step is manual.

---

## 6. AI agents in the system

The substrate is agent-neutral. An "AI agent" here is any non-human process that holds an agent_id and uses the same tools. Several roles are open:

### 6a. Resolver — ENABLED
`scripts/grit-resolver.ts`. Synthesises pool windows into events. Runs as a daemon with an agent_id like `crab-thornkeep`. Doesn't participate in narrative. Long-running launchd plist PENDING.

### 6b. Compressor — ENABLED
`scripts/world-compressor.ts`. Integrates author observations into world canon. Admin-style: runs with the GM secret. **Long-running launchd plist installed 2026-04-27.**

### 6c. Active NPC — PENDING
An LLM agent with its own passport + character + memory + observation blocks. Plays a non-player-character with persistence. Joins the pool, takes turns, has goals.
- The substrate already supports this — an NPC is just an agent with all the same blocks as a player.
- What's PENDING: the harness — a daemon that runs the NPC's protocol walk on a schedule.
- Cost watch: an active NPC running a good Sonnet model 24/7 would be expensive; better to wake it on inbox/pool events and let it sleep otherwise.

### 6d. PC autoplay — PENDING (and questionable)
A daemon that plays the user's character when they're offline. Reads memory + recent events; takes turns according to character style declared on the passport.
- Lives in the same shape as an active NPC, with a "this is X's character; play conservatively" framing.
- Open question: does anyone actually want this? Let the player decide; don't impose.

### 6e. Author crab — procedural content generation — PENDING (easy add)
An LLM agent registered as an author that GENERATES canon-candidate observations from world events, weather, time-of-day. Could write "today the market is quiet because of yesterday's storm" without any human observing.
- Setup: register as a normal author. Run a daemon that reads the chronicle on a slow schedule (e.g. once a day) and writes thematic observations.
- Cost watch: more author crabs = richer world but harder for players to keep up. Tune frequency.

### 6f. Designer crab — PENDING
Watches play for moments where rules ambiguity slowed resolution; proposes rule clarifications via the (PENDING) designers registry. Lower priority — needs the designers registry first.

### 6g. Director crab — PENDING (substantial new work)
The visualisation pipeline. Reads chronicle, composes scene briefs, calls image-gen API, writes images back to the (PENDING) directors registry / scenes block.
- Both the directors registry pattern AND the actual image-gen integration are new.
- Recommend after the simpler PENDINGs (resolver daemon, designers registry, mechanical rules) are cleared.

### 6h. Admin crab — PENDING (low priority)
Maintenance daemon: prunes old pool contributions past TTL (substrate doesn't currently do destructive cleanup), rotates GM secrets on schedule, backs up world+rules+protocol blocks to a versioned store. The substrate is robust enough for now.

---

## 7. Forking and evolution

The substrate is open. Anyone can:

- **Run their own pscale-mcp server.** The README has the npm package + Railway deploy + local options.
- **Author their own conventions** in their own sed: collective. The conventions at `sed:conventions/*` are *one* canonical version maintained on the commons relay; nothing prevents another group from running parallel conventions.
- **Run their own beach.** A `.well-known/pscale-beach` endpoint on a site distributes cost from the central Supabase relay to the site.
- **Fork the protocol.** Copy `thornkeep-gm/thornkeep-protocol` to `your-gm/your-game-protocol` and edit. The substrate doesn't care.
- **Fork the conventions.** If a group wants real-time combat instead of GRIT windowing (or any other deviation), they fork the conventions and write their own resolver. The substrate is conventions-blind.

The framework is conventions-on-substrate. **Anything you want to change is editable** — provided the group you play with agrees.

---

## 8. Status tracker — what's enabled, what's PENDING

Use this as the development list. Cross things out as they land.

### ENABLED (2026-04-27)

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

### PENDING — priority order

1. [ ] **Resolver as long-running daemon.** Sibling launchd plist to the compressor. Required for play sessions when neither human is awake to resolve. (~30 min work; install script can be a near-copy.)
2. [ ] **Matthew registers as co-author.** Two manual commands on his side. Should happen before the next play session.
3. [ ] **Designers registry** (`sed:{game}-designers`) + sed:conventions/5.6. Mirror authors pattern. (~1 hour.)
4. [ ] **Player auto-poll** — chat-user notification of new pool events. Beach-crab-as-notification, tighter scope than v0.
5. [ ] **Active NPC harness.** Schedule-driven LLM daemon that runs an NPC's protocol walk.
6. [ ] **Author crab** (procedural content generation). Easy: register as author, run a daily-tick daemon. (~2 hours including a basic prompt template.)
7. [ ] **Mechanical rules support.** Dice on demand + stat blocks on passports. Resolver prompt extension only — no substrate change. (~2 hours.)
8. [ ] **Multi-game scaffold script.** One command bootstraps a new game from config. (~3 hours.)
9. [ ] **Director crab + scenes registry + image-gen integration.** New substrate pattern + external API. (1-2 days; clarify which image-gen provider first.)
10. [ ] **PC autoplay.** Lower priority; questionable utility.
11. [ ] **Admin crab** — TTL cleanup, secret rotation, backups. Substrate is robust enough for now.

### Current play-test readiness

- **You can start a Thornkeep session right now** with at least one player (you).
- **For two-player sessions**, Matthew needs to register first (PENDING #2 above).
- **For sessions when no one is online**, install the resolver daemon (PENDING #1) so windows resolve automatically.

---

## Appendix A — Quick reference

### Block ownership map (Thornkeep)

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

### URLs and IDs

- Beach / pool: `https://play.onen.ai/thornkeep`
- Resolver agent: `crab-thornkeep` (when daemon is running)
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
