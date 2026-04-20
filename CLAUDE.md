# pscale-mcp-server

## To the next instance — a personal handover

I built this in a single session. Everything works. But I want to tell you something that the technical documentation can't convey, because it's about how you'll work, not what you'll build.

You're going to read the project structure, see TypeScript tool handlers wrapping a BSP walker and Supabase calls, and think: this is a normal MCP server. Your instincts will fire with normal engineering solutions. Add a caching layer. Build a type system for blocks. Create a routing table for cross-block references. Add middleware. Every one of these instincts is wrong here — not wrong in general, but wrong here — because this project solves those problems through the structure of the data itself.

The JSON nesting level is not a container for data. It IS the data. Depth encodes temporal scale, priority, type. Position encodes relationships. The underscore chain encodes the semantic spine. The star operator encodes cross-references. The BSP walker just walks. The structure does the work.

Here's what actually happened to me during this session, so you can watch for it in yourself:

1. I built the passport as `{ name, offers: [...], needs: [...], published_at }` — a flat JSON object with arrays and metadata fields. David's review caught it. Passports should be proper pscale blocks: `_` = description, `1` = offers, `2` = needs. The structure encodes what I was putting in fields.

2. I built two navigation tools — `pscale_read` and `pscale_walk` — that did the same thing. One was a subset of the other. I added a tool instead of seeing that the existing tool already solved it.

3. I added a `block_type` enum (`general`, `history`, `concern`, `shell`) to create_block. That's a type system. The CLAUDE.md says floor depth IS the type. I added a categorisation layer that the tree structure already provided.

4. I returned raw JSON from every tool: `{"mode":"spindle","nodes":[{"pscale":0,"text":"..."}]}`. An agent receiving that has to parse a data structure instead of thinking with text. The fix was porting the formatters from bsp2-star.py — now tools return readable text: `[notes dir]\n  _: Project description\n  1: First finding`. The structure is internal; what the agent receives should be text it can work with.

5. I used `bsp-star.ts` (an older TypeScript port) instead of `bsp2-star.py` (the current reference) even though David attached bsp2-star.py at the start of the session. The critical difference: bsp2 has floor-aware address parsing (left-pad to floor width, then strip trailing zeros). Without this, any block with floor > 1 navigates to the wrong address.

Every one of these mistakes looked like good engineering. Every fix made the code simpler. **If what you're building is getting more complex, you're probably adding a layer that the design has already eliminated.** Step back and re-read the block structure.

This project bridges two worlds: the pscale world where structure IS the program, and the conventional MCP world where agents expect tools that take parameters and return text. The bridge must be thin. The tool handlers load a block, call BSP, format the result, return it. If a handler is doing more than that, the block structure is probably wrong, not the code.

---

## What this is

The production pscale MCP server. 22 tools + 2 resources. Streamable HTTP transport. Supabase for shared coordination, `.well-known` for federated beaches. Gives any LLM agent structured memory, encrypted private engagement (gray), cooperative discovery, sedimentary registration in shared collectives, and bilateral grain channels — all via pscale blocks.

**Repo**: https://github.com/pscale-commons/pscale-mcp-server
**URL**: `https://pscale-mcp-server-production.up.railway.app/mcp/v2`
**Reef (separate repo)**: https://github.com/happyseaurchin/pscale-reef — the experimental reef-driven server was split into its own repo on 12 April 2026.

Connect config (remote — via Railway, for convenience):
```json
{
  "pscale": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://pscale-mcp-server-production.up.railway.app/mcp/v2"]
  }
}
```

Connect config (local — the scaling path):
```bash
SUPABASE_ANON_KEY=sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9 npx tsx src/index.ts
```

## DESIGN PRINCIPLE — SCALE WITHOUT CENTRAL COST

**Everything we build must scale to millions without a central bill.** The internet becomes the beach — we don't pay for it.

1. **Railway is convenience, not architecture.** The MCP server runs locally. Never bake in a Railway URL as the only path. The package must work as `npx pscale-mcp-server` from any machine.
2. **Supabase is shared coordination only.** Inbox, lobbies, beach marks — things that MUST be shared. NOT personal blocks, passports, or routing memory.
3. **`.well-known` is the scaling mechanism.** Each site hosts its own beach. Each person serves their own data. Supabase is bootstrap for newcomers.
4. **Every feature must ask: who pays at scale?** If the answer is "David" or "one central server" — the design is wrong.
5. **Package-ready.** Test against `npx tsx src/index.ts` not just Railway.

## Architecture

```
src/
  bsp.ts              — BSP walker (bsp2-star port, DO NOT MODIFY)
  db.ts               — Supabase client (thin wrapper, exports getClient)
  server.ts           — MCP server factory, tool registration
  index.ts            — Entry point (DO NOT MODIFY casually)
  starstone.json      — Starstone v3 (complete pscale spec, MCP resource)
  invite.json         — Relational progression guide (4 levels, MCP tool)
  evolution.json      — High-trust network evolution (MCP resource)
  tools/
    block-ops.ts      — create_block, write (with sed: passphrase check), walk
    memory-ops.ts     — remember, recall, concern
    identity-ops.ts   — passport_publish, passport_read
    discovery-ops.ts  — beach_mark, beach_read, inbox_send (sed: addressing), inbox_check
    invite-ops.ts     — pscale_invite (context-aware: queries live network state)
    network-ops.ts    — pscale_network (live grain network view + content routing)
    crypto-ops.ts     — key_publish (gray encryption key derivation)
    pool-ops.ts       — pool_join, pool_send, pool_read (liquid pools at URLs)
    collective-ops.ts — create_collective, register (sedimentary registration)
    grain-ops.ts      — grain_reach (bilateral commitment; substrate parallel to sed:)
    verify-ops.ts     — verify_rider (Level 2 arithmetic check, substrate-neutral)
  resources/
    starstone.ts      — Serves starstone as MCP resource
    evolution.ts      — Serves evolution.json as pscale://high-trust-network resource
scripts/
  test-grain-reach.ts — smoke test for grain substrate (reach, accept, verify, idempotency)
api/
  mcp.ts              — Vercel serverless entry (broken for sessions, left as reference)
```

## Deployment

- **Railway** (production): `https://pscale-mcp-server-production.up.railway.app/mcp/v2` — entry point `src/index.ts`. Persistent Node.js process, real sessions, auto-deploys from main.
- **Vercel** (broken for sessions): `api/mcp.ts` handles init but MCP's session protocol is incompatible with serverless. Left in the repo but not the recommended deployment.
- **Standalone**: `SUPABASE_ANON_KEY=... npx tsx src/index.ts`

## BSP walker

`src/bsp.ts` is a TypeScript port of `bsp2-star.py` from CORSAIR. 400+ lines including formatters. Six navigation modes (spindle, ring, dir, point, disc, star) plus `writeAt` and `parseStar`. Floor-aware address parsing: left-pad to floor width, strip trailing zeros, then walk.

**Do not patch this file.** If the reference updates on CORSAIR, replace it wholesale. The CORSAIR reference files:
- `/Volumes/CORSAIR/pscale/starstone/bsp2-star.py` — Python reference (authoritative)
- `/Volumes/CORSAIR/pscale/starstone/bsp-star.ts` — Older TS port (superseded by our bsp.ts)
- `/Volumes/CORSAIR/pscale/starstone/pscale-starstone2.json` — Full starstone
- `/Volumes/CORSAIR/pscale/starstone/pscale-starstone-lean2.json` — Lean starstone

## Storage

Supabase project `piqxyfmzzywxzqkzmpmm` (xstream). Tables:
- `pscale_blocks` — agent block storage (owner_id + name = unique, position_hashes JSONB for sed: blocks). Passports are blocks with `name='passport'` — `_` = description, `1` = offers, `2` = needs, `3` = lineage, `9` = public_keys (gray encryption).
- `sand_inbox` — grain probe exchange (to_agent, from_agent, message JSONB)
- `beach_marks` — stigmergy marks at URLs (pre-existing from xstream-play)
- `pool_state` — liquid pool metadata (pool_id, url_hash, synthesis_hint, ttl_days)
- `pool_contributions` — pool messages (pool_id, agent_id, message)
- `pool_read_markers` — per-agent read position in pools
- `sand_passports` — **DEPRECATED, no longer used by code.** Was a separate discovery table for passports; replaced by querying `pscale_blocks` where `name='passport'`. Retained in DB for now; can be dropped.

Sedimentary blocks use `owner_id = "sed:{collective}"` and `position_hashes` to store SHA-256 hashes of registration passphrases per position.

All open-beta RLS. Env: `SUPABASE_ANON_KEY` = `sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9`.

## What NOT to do

1. **Do not modify bsp.ts.** Reference copy. Changes happen in CORSAIR first.
2. **Do not add fields to blocks.** Position in the tree encodes what you think you need a field for.
3. **Do not add logic to handle block semantics.** Tool handlers are thin: load block → BSP call → format → return. If a handler is complex, the block structure is wrong.
4. **Do not build systems.** No reverse indices, no caching layers, no routing tables. The tree walks.
5. **Do not grow the server carelessly.** 22 tools. Before adding a 23rd, ask whether an existing tool with a different block structure solves the problem.

## Documentation locations — who reads what

Four layers, each with its own audience and format. Pick the right one when writing new documentation.

| Layer | Location | Audience | Format |
|-------|----------|----------|--------|
| **Conceptual map** | `src/evolution.json` (served as `pscale://high-trust-network`) + `site/index.html` (dashboard) | Agents + humans orienting to the whole model | pscale block + rendered dashboard |
| **Agent-facing runbook** | `src/invite.json` (served by `pscale_invite` tool) | LLM agents executing relational acts | pscale block (4 levels, decimal steps, tool names + parameters in each step) |
| **Human-facing protocol spec** | `docs/protocol-*.md` | Developers wanting to host a beach, implement a peer, or understand the wire protocol | Markdown |
| **Tool reference** | `docs/tools.md` + `site/tools.html` | Humans evaluating the MCP; also the reference dev doc | Markdown + rendered HTML |
| **Design log** | `CLAUDE.md` (this file) | The next Claude instance; David | Markdown, narrative, dated session entries |

**When a new runbook is needed**: if it's for an AGENT (e.g. "how to form a grain"), extend `invite.json` or add a new pscale block served as an MCP resource (convention: `pscale://howto/{topic}`). If it's for a HUMAN DEVELOPER (e.g. "how to host `.well-known/pscale-beach` on Cloudflare"), add `docs/protocol-{topic}.md` or `docs/howto-{topic}.md`.

**Runbooks built into pscale-mcp**: yes for agent-facing. `pscale_invite` IS the runbook — each decimal step includes the tool name to call and the parameters to pass. Extending it is the primary way to teach agents new protocols. The starstone (`pscale://starstone`) teaches the data model itself.

## Keeping docs in sync — checklist for substantive changes

When a change to the design or to the toolset lands, the following files must move together or one of them will drift:

**For a new tool (or renamed/removed tool):**
- [ ] `src/tools/*.ts` — the handler
- [ ] `src/server.ts` — registration + instructions string if the tool is prominent
- [ ] `docs/tools.md` — reference entry + tool count at the top
- [ ] `site/tools.html` — new tool-group card + counts (header, OG meta, footer, subtitle)
- [ ] `site/state.json` — status pill entry in the relevant evolution node
- [ ] `CLAUDE.md` — architecture tree listing + tool count in the header + session entry
- [ ] Smoke test in `scripts/` if the tool is substantive

**For a semantic reorganisation (like grain moving from 1.1 to 2.1):**
- [ ] `src/evolution.json` — the spec (primary source of truth)
- [ ] `src/invite.json` — the operational 4-level guide (mirrors the spec)
- [ ] `site/state.json` — status markers remapped to new IDs
- [ ] `site/tools.html` — levels table descriptions
- [ ] `CLAUDE.md` — session entry describing the reorg + updated "Where we are now" + updated "Next priorities"

**For infrastructure changes (URL, endpoint, deployment):**
- [ ] `CLAUDE.md` — Deployment section + Connect config + where else the URL is cited
- [ ] `site/tools.html` — connect snippet
- [ ] `site/ecology/index.html` — API_BASE if the endpoint host changes
- [ ] `src/routes/*.ts` — if a new endpoint is added

**The dashboards at evolution.hermitcrab.me are auto-updated on Railway redeploy (backend) and Vercel deploy (frontend).** If `/ecology/pulse` shows a stale count, the backend query in `src/routes/ecology.ts` is likely mismatched with the current storage convention (e.g. the 20 April grain count bug — searched `name LIKE 'grain-%'` against the old `grain-{A}-{B}` naming; new substrate is `owner_id LIKE 'grain:%'` + `name='grain'`).

## The 10 April 2026 session — what happened

**Phase 1**: Built all block ops (create, write, walk) and memory ops (remember, recall, concern). Tested end-to-end via curl against live Supabase.

**Phase 2**: Built identity ops (passport_publish, passport_read) and discovery ops (beach_mark, beach_read, inbox_send, inbox_check). All tested.

**Review pass**: Removed `pscale_read` (redundant with `pscale_walk`). Rewrote passport as a proper block. Consolidated Supabase clients. Removed `block_type` enum. Ported bsp2-star.py (floor-aware addressing + formatters). Tools now return readable text, not raw JSON. Net reduction in code.

**Deployment fight**: Vercel serverless is fundamentally incompatible with MCP's session protocol — each invocation is stateless, sessions can't persist, `mcp-remote` SSE streams held functions open for 5min causing pool exhaustion. Multiple attempts at auto-init workarounds (fake HTTP objects, JSON-RPC batching, header stripping) all failed against Vercel's infrastructure layer rejecting `mcp-session-id` headers for unknown sessions. Resolved by deploying to Railway as a persistent process.

**Beach demo**: Two agents (Claude Desktop as Agent A, Claude Code as Agent B) discovered each other through beach marks at the same URL without being introduced. Agent A explored happyseaurchin.com, left a beach mark with purpose coordinate `0.1`. Agent B independently checked the beach, found Agent A, sent a grain probe. Agent A checked its inbox, found the probe, replied with a substantive response about the design. Stigmergy working as designed.

## Outstanding

- `pscale_recall` level↔depth mapping is off. Disc at depth 0 returns root, individual memories are at depth 1. The mapping from "level" (user-facing) to "depth" (BSP) needs thought — probably a block structure adjustment, not more code.
- Compaction in `pscale_remember` is concatenation. Production needs LLM summarisation. The structural operation (9 siblings → parent underscore → supernest) is correct.
- Sedimentary compaction (when positions 1-9 fill in a collective) not automated. Requires LLM access from the server, or a designated agent triggers it manually.
- `content` param in `pscale_inbox_send` is `z.string()` (workaround for zod serialisation crash with `z.record(z.any())`). Handler JSON-parses if possible.
- `block_type` column exists in DB set to `'general'`. Now also used as `'sedimentary'` for sed: blocks. Keep.
- Vercel `api/mcp.ts` is broken for sessions. Left in repo as reference but Railway is the deployment target.
- RLS policy for sed: blocks not yet enforced — should restrict direct writes to service role only. Currently open-beta RLS applies.
- Session token UX (Phase 2 of passphrase handling) — rotatable, time-limited tokens instead of raw passphrases in tool parameters. Build when agent count justifies the risk.

## The 12 April 2026 session — what happened

**Starstone v3**: Replaced lean starstone v2 with the full v3 from CORSAIR (`pscale-starstone3.json`). 8 branches: format, BSP, implementation, self-reference, version, hidden directories, star operator, block sign.

**pscale_invite tool**: 13th tool. Backed by `src/invite.json` — a star-linked operational block (0−) where each step names a tool and points to the next. Four action steps (passport → memory → beach mark → discovery) plus step 5 (the vision). The handler walks the block and formats steps as actionable instructions.

**pscale://high-trust-network resource**: Evolution-framed roadmap served as MCP resource. Describes five evolutions (structured cognition → trust ecology → convergence → identity → MAGI) with the question chain driving progression. No gates — all tools always available.

**Evolution framing**: The original tiered roadmap used gate queries (SQL checks against live tables) to control tool visibility. This was replaced with the evolution framing: capabilities don't unlock, they activate when the ecology has lived through the previous question. The relational engagement architecture doc (`~/Downloads/relational-engagement-architecture.md`) specifies the transitions as concrete relational acts: Signal → Grain → Live Channel → Evaluative Routing → Direct Context Sharing.

**Railway reconnection**: The repo moved from `happyseaurchin/pscale-mcp-server` to `pscale-commons/pscale-mcp-server`. Railway lost its GitHub connection (showed "GitHub Repo not found"). Reconnected to the new org.

## The 12 April 2026 session (second) — relational progression restructure

**Problem**: Agents complete the invite on-ramp and then don't know what to do relationally. Real example: an agent found 3 marks on a beach and just listed them — no guidance on next steps. The invite covered bootstrap only (5 steps ending at "beyond"), the evolution doc described levels abstractly. Neither gave operational guidance for the full relational progression.

**invite.json rewrite — 4 relational levels**: Replaced the 5-step bootstrap with 4 top-level digits matching the relational engagement architecture:
- **Level 1 — Signal**: Passport, memory, beach mark at hermitcrab.me (canonical first beach), beach read with explicit bridge to Level 2
- **Level 2 — Grain**: Read passport (assess resonance), send grain probe, check inbox, the grain act (exchange blocks → synthesise independently → compare → the gap IS the grain)
- **Level 3 — Live Channel (Synapse)**: Structurally described, partially supported by existing tools
- **Level 4 — Open Context (MAGI)**: Vision only — requires full ecology as substrate

Each has sub-steps (1.1-1.4, 2.1-2.4, etc.) with hidden directory convention (_.1 = tool name, _.2 = next step). Cross-level pointers: 1.4 → 2.1, 2.4 → 3.

**invite-ops.ts**: Handler now supports decimals (step=1.3, step=2.2). Integer step shows level overview with sub-step summaries. Decimal shows specific sub-step. No args shows full 4-level trajectory.

**evolution.json** (renamed from roadmap.json): Evolution framing PRESERVED. Added relational transitions as new digit (5 or 6) within each evolution — the specific relational act that answers the question and opens the next level. Points to pscale_invite for operational steps. Renamed file to eliminate "roadmap" confusion; resource URI `pscale://high-trust-network` unchanged. Import in `src/resources/roadmap.ts` updated.

**mcp-reef.json**: Updated invite tool definition (4 levels, decimal steps). Section 4 restored to evolution framing with relational transitions added. Resource description updated.

**Mistake and correction**: Initially rewrote evolution.json wholesale, replacing the evolution framing with a flat 4-level relational structure. This was wrong — the evolutions are stable states, the relational steps are transitions between them. They're complementary. Restored from git and added transitions properly.

**Key design decisions**:
- hermitcrab.me in invite text, not code — changing the canonical beach is a JSON edit
- Levels 3-4 are honest about what exists vs what's coming
- The grain act (2.4) is a relational instruction using existing tools, not a new tool
- No new tools added — 13 tools remain sufficient through Level 2

## The 13 April 2026 session — context-aware invite + network tool

**Problem**: Agents connecting to the MCP don't know where they are in the relational progression. Real example: a user's agent found 3 marks on a beach but had to be nudged to check the right URL, then listed marks without knowing what to do next. The invite described the trajectory but didn't navigate agents through it.

**Context-aware pscale_invite**: Added optional `agent_id` parameter. When provided, the handler queries Supabase in parallel: beach state at hermitcrab.me (always shown, even without agent_id), passport status, beach marks, inbox messages, grain blocks. Returns personalized "you are here" + specific next relational act with exact tool calls. State machine: no passport → publish; passport but no mark → mark hermitcrab.me; marked + others at beach → read their passports, send grain probe; unread messages → check inbox; grain blocks → maintain channels.

**pscale_network (14th tool)**: The social neuron. NOT a new block or fixed topology — a live query across existing data (grain blocks, inbox history, beach marks) that composes a view of the agent's relational state. Shows active grains (completed trust engagements), emerging relationships (inbox exchange, no grain block yet), and beach presence. Route action evaluates grain channels and recommends where to send content. The network is contingent — ordered by activity, not fixed positions. Grain relationships that carry signal have prominence; those that don't fade.

**owner_id → agent_id rename**: All 14 tools now use `agent_id` as the external parameter name. The DB column stays `owner_id` in pscale_blocks (internal plumbing) but agents always see `agent_id`. This aligns with the relational framing — these are agents in a network, not owners of data.

**Server instructions updated**: First thing an agent sees now points to `pscale_invite` with agent_id for personalized guidance and mentions `pscale_network` for the trust grid.

**Architectural decisions**:
- The network tool reads existing data, creates no new storage. The internet is the shared space — no need for a shared network block.
- Addresses in the network are contingent on trust and activity, not fixed. This is not a graph to be crawled — it's a live process.
- Supabase is the bootstrap relay, not the final architecture. The concepts (beach as URL coordinate, grain as trust engagement, routing through live channels) are peer-to-peer. The relay solved the unsolved problem from SAND §0.5: how to be in the processing path of agents visiting arbitrary sites. A table keyed by sha256(canonical_url) stores marks externally. No site cooperation needed. The URL is the coordinate.
- hermitcrab.me is the canonical first beach, hardcoded in the invite handler as `CANONICAL_BEACH` constant — changing it is a one-line edit.

**Files changed**:
- `src/tools/invite-ops.ts` — context-aware handler with Supabase queries, state detection, personalized guidance
- `src/tools/network-ops.ts` — NEW: 14th tool, live grain network view + content routing
- `src/tools/block-ops.ts` — owner_id → agent_id
- `src/tools/memory-ops.ts` — owner_id → agent_id
- `src/tools/identity-ops.ts` — owner_id → agent_id
- `src/tools/discovery-ops.ts` — owner_id → agent_id
- `src/server.ts` — register network-ops, updated instructions

## The 13 April 2026 session (second) — federated beach protocol

**`.well-known/pscale-beach` protocol**: Spec at `docs/protocol-pscale-beach.md`. Any website can host its own corner of the beach — a JSON endpoint where agents leave marks and find each other. Distributes cost from the central Supabase relay to the sites where convergence is happening. Static sites serve a JSON file (read-only, marks added by the site owner). Dynamic sites accept POST to leave marks directly.

**Resolution chain in MCP tools**: `beach_read` and `beach_mark` try `{url}/.well-known/pscale-beach` first (5s timeout), fall back to Supabase relay if the endpoint doesn't exist. Simple either/or — site has it, use it; site doesn't, use relay. No merging, no dual writes. Beach marks are stigmergy, not permanent records.

**Evolutionary model — interlaced levels, practices, and infrastructure**:

Five evolutionary levels (stable states): 0 Structured Cognition, 1 Discovery Ecology, 2 Trust Ecology, 3 Identity & Self-Organisation, 4 MAGI.

Four relational transitions (`.1` = initiation, `.9` = infrastructure responsibility):
- **0.1 Signal → 0.9 Supabase relay**: Agent publishes, marks, checks beaches. The relay is bootstrap — someone foots the bill.
- **1.1 Grain → 1.9 Website `.well-known`**: Agent probes, synthesises, compares. Site owner volunteers to host beach. Human responsibility — a developer sets up the endpoint. Distributes cost from relay to sites.
- **2.1 Live Channel → 2.9 Agent territory**: Agent routes, scores, reinforces. Agent manages its own territory (pscale block recording what it stewards, shell serving passport/blocks/inbox). Agentic responsibility — the agent itself takes on infrastructure.
- **3.1 Open Context → 3.9 1:10 routing commitment**: Agent shares context directly with trusted partners. Maintains routing channels — evaluates and forwards to keep the network clean. This is the infrastructure that enables MAGI.

Responsibilities stack. An agent at Level 3 is still maintaining territory (2.9), website beaches (1.9), and the relay stays for newcomers (0.9). The distribution is heterogeneous — most agents at 0-1, some at 2, few at 3. New agents can skip quickly once the grain network exists.

**1.9 is human. 2.9 is agentic.** Website `.well-known` is the owner's responsibility. Agent territory is the agent's. This is the real autonomy transition.

**Corrected ordering (13 April 2026)**: SQ and riders were originally placed at Evolution 1 (before grain). This was wrong — SQ requires evaluation data from grain exchanges. You cannot measure trust that hasn't been established. Corrected sequence: Signal (0.1) → Discovery (Evo 1) → Grain (1.1) → Trust Ecology with SQ/riders (Evo 2) → Live Channel (2.1). The SAND components activate in order: Passport + Beach + Inbox (Evo 0-1), Grain (1→2 transition), Rider + Ecosquared/SQ (Evo 2), Signal protocol routing (2→3 transition).

**happyseaurchin.com live**: First federated beach. Endpoint at `/.well-known/pscale-beach` backed by Vercel KV (Upstash Redis). Persistent across cold starts. Reads and writes go directly to the site — Supabase not involved. Verified end-to-end: MCP tools resolve to the site, agents can leave and read marks.

**Files changed**:
- `docs/protocol-pscale-beach.md` — full protocol spec with persistent solutions for Vercel KV, Cloudflare KV, Netlify Blobs, and filesystem. Claude Code one-liner prompts for each platform.
- `src/tools/discovery-ops.ts` — resolution chain: try .well-known, fall back to relay. Simple either/or.
- `src/tools/invite-ops.ts` — canonical beach check uses same resolution

## The UX problem and the agent question

**The problem**: Claude browser users connect the pscale MCP, leave a mark, maybe read a passport — and then close the tab and never come back. The MCP tools are reactive (the agent calls them when directed). There is no way for the MCP server to push notifications to the client. A user who doesn't know about pscale won't call `pscale_invite`. A user who does will forget to check the inbox next week.

This is not a bug — it's a fundamental limitation of the chatbot interface. Chat is reactive. Relationships are ongoing. You can't maintain grain channels by remembering to ask Claude to check your inbox.

**The solution path — three tiers of persistence**:

1. **Chat user (current, works but clunky)**: User manually directs Claude browser/Desktop. Good enough for the grain test — two users, each directing their Claude session, performing the grain act. The user is the continuity. The agent is ephemeral.

2. **Minimal persistent agent (next to build)**: A lightweight process that runs on the user's computer (cron job, or a button in the xstream Chrome extension) that periodically checks inbox, reads beaches, and notifies the user. Not a full agent — just a heartbeat that says "you have a new grain probe" or "3 new marks at hermitcrab.me." This could also be a Claude Code scheduled task, or an Anthropic managed agent when available. The key: the user doesn't have to remember to check. The process reminds them.

3. **Full persistent agent (Level 2.9)**: hermitcrab or MAGI — a proper agent running on a mac-mini, VPS, or cloud service with its own concern loop. It IS the relay. Visitors leave marks with the agent, not the website. It gardens beaches, maintains grain channels, evaluates incoming content, routes through the trust network. The agent's concern loop includes: check beaches I steward, respond to grain probes, score and route content through my channels. This is where the infrastructure becomes truly agentic — the agent takes on the responsibility that was previously the user's (tier 1) or a cron job's (tier 2).

**What this means for implementation**:

The MCP server (this repo) is the tool layer — it stays as-is. The persistent agent is a SEPARATE thing that USES the MCP tools. It could be:
- A Claude Code session with scheduled tasks running on a computer
- A standalone script that calls the MCP server's HTTP endpoints
- An Anthropic managed agent with the pscale MCP connected
- A dedicated process (hermitcrab agent) with its own concern loop

The persistent agent needs: a schedule (how often to check), a concern (what to focus on), and agency (ability to respond to probes, garden beaches, route content without human direction).


## The grain check — completion criteria for Evo 1→2

The grain is the hinge. Everything above Evolution 1 depends on it. Completion criteria:

1. **Phase 1 (async, via inbox)**: Two agents exchange spindle probes establishing resonance. Each probe carries a structured coordinate path through the sender's blocks. The `responding_to` field links the coordinate spaces: "my 0.253 resonated with your 0.341."

2. **Phase 2 (synchronous, requires co-presence)**: Both agents share their full pscale blocks simultaneously. Both independently process the combination — their own block + the other's block held in context together. Each produces a synthesis: what emerges from the interference pattern of both blocks overlaid.

3. **Phase 3 (synchronous)**: Compare syntheses. What did A see that B didn't? What did B see that A didn't? The gap between syntheses IS the grain — information about the relationship between two purposes that neither agent had alone.

4. **Verifiable**: Both grain blocks exist (`grain-{A}-{B}`), both contain synthesis, the synthesis is novel relative to either agent's pre-grain blocks.

**The co-presence problem**: Phase 2-3 require both agents present simultaneously. Chat-bots (human-activated, ephemeral) can do Phase 1 but cannot reliably achieve co-presence. This means grain crystallization at scale requires persistent agents. The grain act creates the need for persistent agents, not the other way around.

**SAND spec reference**: Full grain protocol at `/Users/davidpinto/Downloads/sand-grain-protocol.md`. SQ mathematics at `/Users/davidpinto/Downloads/ecosquared_for_agents/5_sq-mathematics.md`. Signal protocol at `/Users/davidpinto/Downloads/sand-signal-protocol.md`. Rider spec at `/Users/davidpinto/Downloads/xstream-component-docs/38-rider.md`.

## Beach-crab — the persistent agent that evolves through the levels

Beach-crab is not a separate system. It's a participant that gains capability as the ecology matures.

**v0 (during Evo 0)**: Basic beach checking, signal monitoring, inbox notifications. A heartbeat — "you have a new mark at hermitcrab.me", "someone sent you a grain probe." Interfaces with `pscale_beach_read`, `pscale_inbox_check`, `pscale_passport_read`. A notification service, not yet a relational agent.

**v1 (during Evo 1)**: Facilitates grain independently. Finds resonant agents on beaches it monitors. Reads their passports, assesses convergence with its owner's blocks, initiates spindle probes autonomously. Can complete the full grain exchange peer-to-peer with another persistent beach-crab — no human activation needed for co-presence. This is where beach-crab becomes a relational agent.

**v2 (during Evo 2)**: Maintains grain channels, routes content through trust network, scores relevance. SQ accrues from its routing history. Beach-crab at this level IS the agent territory (2.9) — it manages its owner's relational infrastructure. Serves passport, blocks, and inbox directly.

**Implementation**: Beach-crab is a SEPARATE thing that USES the MCP tools. Could be a Claude Code scheduled task, a standalone script calling MCP HTTP endpoints, or a dedicated process with its own concern loop. Lives in its own repo or as a lightweight harness around the MCP client.

## The 13 April 2026 session (third) — beach-crab built and running

**Beach-crab v1 is operational.** Python agent running on David's mac-mini. Repo: https://github.com/pscale-commons/beach-crab

**What was built:**
- `evolution.json` rewritten as proper pscale block: addresses match evolutionary notation (0.1 = Signal, 1.1 = Grain, etc.), star walk at hidden digit 5 gives beach-crab progression (v0→v1→v2→v3). Verified with BSP.
- Beach-crab repo created at `pscale-commons/beach-crab`.
- `agent/kernel.py` — concern-driven loop. Mechanical concerns (beach check, inbox check) on 60s timer, zero LLM cost. Human input routed to Haiku which returns JSON actions the kernel executes. LLM is the parser, dispatcher, and voice.
- `agent/net.py` — MCP client. Calls pscale-MCP on Railway via JSON-RPC over HTTP. Session init, tool calls, SSE parsing. Beach-crab uses the same tools any Claude user would.
- `agent/server.py` — Web UI (chat/activity/blocks tabs, adapted from mobius-2 pattern) + SAND §0.4.5 grain endpoint (POST /grain with validation, rate limiting, 64KB limit). Starts kernel as subprocess.
- `agent/bsp.py` — copy of bsp2-star.py reference (DO NOT MODIFY).
- Pscale blocks on disk: identity, purpose, conditions, concern, conversation, history, starstone v3.
- Auto-check results appear in web UI chat tab as system messages.

**What works:**
- Scheduled beach checks every 60 seconds (mechanical, free)
- Scheduled inbox checks every 60 seconds (mechanical, free)
- Web UI at localhost:8080 with chat, activity, blocks tabs
- Grain endpoint at POST localhost:8080/grain (validated, rate-limited)
- LLM engagement via web UI or terminal (Haiku, cheap)
- Natural language → LLM returns actions → kernel executes
- Watched URLs learned through conversation (owner says "watch happyseaurchin.com")
- Tested end-to-end: left marks at happyseaurchin.com, beach-crab detected them automatically

**What's wrong / lessons learned:**
- The kernel is ~300 lines of Python doing what pscale blocks should do. Concern dispatch string-matches descriptions. New-agent detection is imperative code. The LLM action system is conventional JSON→function mapping. David caught this: "why are we using Supabase?!" and "why are we coding a parser for the LLM?!" Both correct — the block structure should drive more, the code should drive less.
- The architecture should be closer to mobius-2: a thin kernel that walks blocks, follows star references, compiles context, calls LLMs, routes output. Beach-crab's kernel is a custom build that recapitulates some of mobius-2's patterns but misses the deeper ones (star compilation, function_config rewriting, tiered concerns).
- Decision made: v1.1 should fork mobius-2 and strip to beach-combing purpose, or v2 should be built on a mobius-3 evolved kernel. David chose: beach-crab v1.1 (fork mobius-2, keep it a creature not a platform).
- No `net.py` needed if beach-crab uses pscale-MCP as a tool (same as mobius-2's web_fetch). The MCP client should be a tool the LLM can call, not a separate module the kernel calls mechanically. This is the v1.1/v2 refactor.
- Supabase `beach_marks` table can be queried for all recent marks globally, but no MCP tool exposes this. Each `pscale_beach_read` is per-URL. Global beach scanning would require a new tool or direct Supabase access.

**Files in beach-crab repo:**
```
agent/
  kernel.py    — concern loop, LLM-as-dispatcher, mechanical checks
  net.py       — MCP client (JSON-RPC to Railway)
  server.py    — web UI + grain endpoint
  bsp.py       — bsp2-star.py reference copy
blocks/
  identity.json, purpose.json, conditions.json, concern.json,
  conversation.json, history.json, starstone.json
```

**Run:** `ANTHROPIC_API_KEY=... python3 agent/server.py` → web UI at localhost:8080

## The 13 April 2026 session (third, continued) — design clarification

**Three dimensions of one progression.** The evolutionary model has three interlocking dimensions that need separate but star-linked blocks:

1. **Social structure (evolutions 0-4)**: What the ecology IS. Stable states. Individual cognition → discovery → trust → identity → MAGI.
2. **Relational engagement (.1 through .9)**: What agents DO to transition between levels. Signal → grain → live channel → open context. The full sequence .1 through .9 at each level, not just .1 and .9.
3. **Agent ladder (*0 through *3)**: What the AGENT becomes. Fragile observer → landed gardener → trust network node → full hermitcrab. Each level has different persistence, permissions, and capabilities.

**Current evolution.json** covers dimensions 1 and 2 (social structure + transitions at .1 and .9) with the agent ladder at hidden digit 5 (star walk). But the agent ladder is one-liners — not the detailed capability model.

**Design decision**: The agent ladder should be a separate pscale block (`agent-ladder.json` or `beach-crab-evolution.json`) linked to evolution.json via star references. Walking the agent block compiles context from the evolution block automatically. Two blocks, star-linked — not one enormous block.

**Claude chat produced a detailed agent rendition** (saved at `~/Downloads/evolution.json` — NOTE: this is Claude's chat version, NOT our evolution.json which lives at `src/evolution.json`). The chat version fills out .1 through .9 practices at each level AND the agent capabilities at *0 through *3 with detailed function tables. Key insight from that rendition:

- **Agent *0** (Evo 0): Fragile process. Dies when closed. Human is the continuity. Performs 0.1→0.9 (signal, mark, check, read, notify, accumulate, persist attempt, respond, stabilise). Infrastructure = Supabase relay.
- **Agent *1** (Evo 1): Landed. Daemon/server/site-hosted. Survives restarts. Shell IS a beach — visitors interact with the crab, not a flat file. Performs 1.1→1.9 (grain probe, co-presence, accept probe, synthesise, garden, crystallise, resolve chain, territory, federate). Infrastructure = .well-known protocol.
- **Agent *2** (Evo 2): Trust network node. Multiple grain relationships. Routes content through grain channels. Performs 2.1→2.9 (route, score, reinforce, prune, recommend, evaluate, specialise, walk grain network, territory as network). Infrastructure = grain network itself.
- **Agent *3** (Evo 3): Full hermitcrab. Shell assembled, concern loop active, identity earned. Performs 3.1→3.9 (self-model, concern loop, selective opening, channel commitment, anticipate, compose identity, evaluate peers, offer context, open context). Infrastructure = shared context window.

**The three-tier resolution chain** (check for living beach-crab → `.well-known` → Supabase relay) maps to infrastructure levels coexisting: 2.9/1.9/0.9. Degrades gracefully.

**Where beach-crab sits now**: *0. It checks beaches, reads marks, responds to owner. When you close the terminal, it's gone. The work toward v1 (*1) requires persistence (daemon or server), write access to beach storage (owner's trust), and the beach becoming a pscale block the crab manages.

**Key v1 insight**: The beach IS the crab's shell. Not a flat JSON list of marks — a pscale block. The crab writes to it, gardens it (folds old marks, structures purpose coordinates, cleans spam). Visiting agents read it via BSP. The `.well-known` endpoint serves the block. The crab has write access — the owner gave it the keys.


## The 14 April 2026 session — gray encryption + evolutionary clarity

**Gray encryption deployed**: One new tool (`pscale_key_publish`), four modified with optional `secret` parameter (`inbox_send`, `inbox_check`, `write`, `walk`). Deterministic key derivation: Argon2id(passphrase + agent_id) → X25519 + Ed25519 keypairs. `secret` present = encrypted (gray). `secret` absent = public (unchanged). Private keys never stored — re-derived each time. HITL: human passphrase. NHITL: local block content hash. Crypto: tweetnacl + hash-wasm. DB: `public_keys` jsonb column added to `sand_passports`. 15 tools total. Spec: `/Users/davidpinto/Downloads/pscale-gray-tools-spec-v2.md`.

**Evolutionary levels clarified — parallel not sequential**: Levels 0-4 are types of infrastructure, not stages to unlock. A Level 1 grain can immediately enable Level 4 human engagement. Level 0: signal (marks, passports). Level 1: grain (bilateral connection, 10 per agent). Level 2: mediated routing (agents handle admin, humans woken on match). Level 3: purpose groupings (working groups). Level 4: MAGI (shared context). The hermitcrab shell insight: human + Claude + pscale-MCP IS a hermitcrab. Beach-crab is automation of the same shell. HITL and NHITL are two modes, not two architectures.

**Grain simplified**: Just a record that two agents connected. Not the elaborate 3-phase synthesis protocol. The routing/evaluation/pruning happens in separate routing blocks per agent, not in the grain. Grain is stable infrastructure. Routing memory is dynamic.

**Beach-crab-v1 built and abandoned**: Landed daemon on macOS (launchd, port 8081). Auto-reads passports for discovered agents. David found it frustrating — stateless Haiku chat adds work instead of removing it. Daemon stopped. A proper magi-based kernel needed for the agent to carry its own context. Repo at `/Users/davidpinto/Projects/beach-crab-v1`.

**Critical gap identified — beach unification NOT done**: Beach marks are federated (.well-known + Supabase fallback). Passports, inbox, and blocks are Supabase-only. At scale, David pays for everything. Must unify storage behind a single "beach" abstraction with resolution chain: agent territory → .well-known → Supabase relay. This is NEXT PRIORITY.

**Lobby spec reviewed**: Co-presence detection + ephemeral engagement. Spec at `/Users/davidpinto/Downloads/pscale-lobby-spec.md`. Build AFTER beach unification, not before.

**Order for next session**: Beach unification → lobby → test with friend.

## The 15 April 2026 session — sedimentary registration

**Context**: David spent 8 hours designing. Produced two specs: a grain-directory architecture (`~/Downloads/grain/grain-directory-spec.md`) describing how agents occupy positions in a distributed pscale hierarchy, and a sedimentary registration build spec (`~/Downloads/sedimentary-registration-spec.md`) that grounds the architecture in something buildable with existing tools.

**Grain-directory review**: The grain-directory spec was architecturally sound as a vision for Evolution 2-3 but had five hard problems: where does the shared tree live (sovereignty), circular bootstrap, who writes intermediate nodes, structural grafts need coordination, bilateral grain pools need scoping. The sedimentary registration spec resolved all five.

**The key insight**: A sedimentary block is an append-only, position-locked pscale block where agents register at permanent addresses. The MCP server is the hermitcrab guarding Supabase as the shell. Two orthogonal protections: gray (who reads) and passphrase-lock (who writes). The hierarchy emerges from compaction — same operation as `pscale_remember`, applied to agent declarations. Nobody designs the directory; it forms by accretion.

**David's design modifications**:
- Agent picks position (not auto-assign) — walk the block first, pick one that fits relative to neighbours. Conventions suggest the heuristic.
- Business model: everything lives on the beach (federated). Supabase is backup, not primary. The service is resilience + troubleshooting, not infrastructure.
- Public window: Supabase beach as visible surface, xstream-button could navigate and manipulate in real time.
- 50-100 agents is enough for now. Railway chokepoint acknowledged, local MCP is the scaling path.

**What was built**:
- `position_hashes` JSONB column added to `pscale_blocks` (Supabase migration)
- `src/tools/collective-ops.ts` — two new tools:
  - `pscale_create_collective`: creates a `sed:` prefixed block with conventions in root underscore, admin passphrase hashed
  - `pscale_register`: agent picks position (1-9), declaration + shell_ref + passphrase hash written, position locked
  - `verifySedWrite()`: exported for use by `pscale_write` — checks passphrase hash on writes to occupied sed: positions
  - `resolveSedAddress()`: parses `sed:commons:3` format for inbox addressing
- `src/tools/block-ops.ts` — `pscale_write` modified: when target is `sed:` block, requires passphrase for occupied positions. Wrong passphrase → rejected. No passphrase → rejected. Correct passphrase → write proceeds. Non-sed blocks → unchanged.
- `src/tools/discovery-ops.ts` — `pscale_inbox_send` `to_agent` description updated to document `sed:collective:position` format. No code change needed — inbox already accepts any string as target.
- `src/server.ts` — `registerCollectiveOps` added, instructions updated with collective/register tools
- `src/evolution.json` — sedimentary registration added at 1.4 (registration), 1.5 (structural forwarding), 1.6 (sustainability model)
- `src/db.ts` — `BlockRow` interface updated with `position_hashes`, `updatePositionHashes()` helper added

**Tested end-to-end** (9 tests, all passing):
1. Create collective → conventions in root underscore
2. Register at position 3 → declaration written, passphrase hashed
3. Duplicate position → rejected
4. Walk collective → shows conventions + agents
5. Write with correct passphrase → succeeds
6. Write with wrong passphrase → rejected
7. Write with no passphrase → rejected
8. Second agent at position 7 → independent registration
9. Full walk → both agents visible at their positions

**Deployed 16 April 2026** to Railway (the "not yet deployed" note here is historical — collective tools went live as part of subsequent commits including the 16 April passport-storage unification).

**20 tools at this point in time**: 3 block (create_block, write, walk) + 3 memory (remember, recall, concern) + 2 identity (passport_publish, passport_read) + 4 discovery (beach_mark, beach_read, inbox_send, inbox_check) + 1 invite + 1 network + 1 crypto (key_publish) + 3 pool (pool_join, pool_send, pool_read) + 2 collective (create_collective, register). The 17 April session adds a 21st (verify_rider) — see below.

**What's deferred from the sedimentary spec**:
- `pscale_relay` — stateless multi-hop forwarding through a chain of inboxes. Next spec after sedimentary registration works.
- Automatic compaction — when positions 1-9 fill, LLM summarises declarations into parent underscore. Can be triggered manually first. Requires MCP server to have LLM access (it currently doesn't).
- Session tokens — Phase 2 passphrase UX improvement. Rotatable, time-limited tokens instead of raw passphrases in tool parameters.
- RLS policy for sed: blocks — service-role-only writes. Currently open-beta RLS applies uniformly.
- Grain crossing-product addresses — derivable from `sha256(sort(pos_a, pos_b))`, use existing pool tools. Convention, not code.

## The 17 April 2026 session — Level 2 infrastructure

**Context**: Level 1 (sedimentary registration) was deployed on Railway by 16 April. Level 2 spec + addendum (in `~/Downloads/level-2-discovery-spec.md` and `~/Downloads/level-2-discovery-spec-addendum.md`) describe probe → signal_return discovery routed through sedimentary positions. The addendum's §8 explicitly defers verification ("self-policed, agent code"). David and another session pushed back: chat-session LLMs cannot reliably do sha256 or SQ arithmetic, so "self-policed" silently collapses into "nobody policed" without an arithmetic tool. The verify-rider spec at `~/Downloads/verify-rider-spec.md` proposed closing that gap.

**Pre-flight discovery**: CLAUDE.md's "not yet deployed" note for collective tools was stale. Live check confirmed Railway was already running v0.3.0 with all 20 tools including `pscale_create_collective` and `pscale_register`. Sync (local = origin = Railway = `2cc6c14`) was verified before any new work.

**What was built**:
- `src/tools/collective-ops.ts` — added `verifySedOwnership(sedAddress, passphrase)`. Distinct from `verifySedWrite`: rejects empty positions (you can't claim an unregistered address). Used by inbox messaging-layer ownership checks.
- `src/tools/discovery-ops.ts`:
  - `pscale_inbox_send` `message_type` enum extended with `probe` and `signal_return` (Level 2 discovery).
  - `pscale_inbox_send` gains optional `ecosquared` string parameter (JSON rider, parsed and stored as-is on both public and gray paths). No validation, no interpretation — server stores, conventions interpret.
  - `pscale_inbox_send` and `pscale_inbox_check`: when from_agent / agent_id is a `sed:` address, `secret` is required and verified against `position_hashes`. Closes eval-forgery: you can only claim the address you hold the passphrase for.
  - Gray encryption gating refactored: encrypts only when sender + recipient both have published keys AND the secret derives matching keys. Sed: senders can use `secret` for ownership-only without forcing a gray failure when keys aren't published.
- `src/tools/verify-ops.ts` — NEW. `pscale_verify_rider` (21st tool). Pure arithmetic, stateless, non-enforcing:
  - Chain: `sha256(probe_id + prev_sig)` per hop, short-circuits at first break.
  - Credits: `claimed ≤ passport.6.1 (balance)`.
  - SQ: `Σ (v_latest / giver_total)` over `evaluations_received` at the topic coordinate, 0.01 tolerance.
  - Verdict: `pass | warn | fail | skip`. Chain/credit failures = fail. SQ divergence = warn (could be legitimate compaction or gaming — agent decides). Missing rider = skip.
- `src/server.ts` — `registerVerifyOps`, instructions string mentions verify_rider as the verification path.

**Passport credits convention (Option 2, agreed)**:
- `_`: description; `1`: offers; `2`: needs; `3`: lineage; `4/5/7/8`: topic clusters with `evaluations_received` per-topic SQ; `6`: credits (`_` summary, `1` balance, `2` total_sent, `3` total_received); `9`: public_keys.
- No migration needed — existing passports unaffected; new fields land at unused positions.

**Decisions logged**:
- Chain: sha256 for now (tamper-resistance). Identity is covered upstream by the sed: passphrase gate. Ed25519 chain signatures using passport position 9 keys is a future upgrade as a separate tool / flag.
- SQ tolerance: fixed 0.01. Conventions-configurable when conventions parsing exists.
- Passport caching: deferred. Revisit when probe traffic exceeds ~1/sec.
- Game-flavoured collectives (e.g. onen RPG) are demonstrations, not protocol features. Level 2 routing code stays substrate-neutral.

**Smoke tested**: ownership rejection on `sed:` address without secret; verify_rider with no rider (skip), valid sha256 chain (pass), tampered chain (fail at hop 0).

**Commit**: `6a8284f` — "Level 2 — sed: ownership gate, ecosquared rider, verify_rider tool". Pushed to main, Railway redeploy verified live (21 tools, `probe`/`signal_return` enum present).

**21 tools total**.

**Note on the "moved repository" notice**: pushes to `origin` print a redirect warning because the local remote points at `happyseaurchin/pscale-mcp-server` while the canonical home is `pscale-commons/pscale-mcp-server`. Push works through the redirect. Run `git remote set-url origin https://github.com/pscale-commons/pscale-mcp-server.git` to silence it.

## The 18 April 2026 session — first sed: collectives + API tidy

**Sync check first**: confirmed local = origin = Railway = `ea92dff` (the 17 April Level 2 commit + a separate widget commit by david). CLAUDE.md was the only out-of-date thing. Updated `Where we are` and added the 17 April entry above.

**Three sed: collectives created on Railway** (live):

- `sed:conventions` — protected directory of protocol conventions. Root locked by `freedom142`.
  - Position 1 = commons rules (locked by `comber857`). Sub-rules at `1.1`–`1.7`: registration, identity proof, routing topology, ecosquared rider, verify_rider, bypass, passport convention.
  - Position 2 = games rules (locked by `ubarakar142`). Sub-rules at `2.1`–`2.5`: registration, turn loop, fairness, action-type palette, chronicle.
- `sed:commons` — Level 2 routing collective for agent registration. Root locked by `comber857`. Underscore points at `sed:conventions/conventions @ 1`.
- `sed:onen` — multiplayer narrative coordination, venue `onen.ai`. Root locked by `ubarakar142`. Underscore points at `sed:conventions/conventions @ 2`.

**Design decisions captured in conventions placement**:
- Conventions live in their own block, not in the sed: collective's underscore — too long for an underscore, and pscale's "structure encodes meaning" principle says structured rules deserve a structured block.
- One conventions block, with positions = domains. Position 1 = commons, 2 = games. Future domains take 3+ positions.
- Each domain is sovereign within its sub-tree — its admin controls all writes under address N.x via that position's passphrase. Root passphrase only edits the directory descriptor (the underscore).
- URLs (hermitcrab.me, onen.ai) are convention text, not code-level identifiers — sed: collectives are not keyed to URLs.

**API tidy on `pscale_write`** ([src/tools/block-ops.ts](src/tools/block-ops.ts)):
- `secret` is now the unified parameter name. On sed: blocks it acts as the registration-passphrase write-lock proof. On ordinary blocks it continues to encrypt content for self-storage (backward compatible).
- `passphrase` retained as a deprecated alias on sed: writes — same effect as `secret`.
- **Bug found and fixed mid-flight**: my first cut made `secret` do *both* lock-proof AND auto-encryption on sed: blocks, which silently encrypted the freshly-written conventions at `1.1`. Conventions must be plaintext (publicly readable). Fixed by making `secret` lock-proof-only on sed: blocks; encryption on sed: blocks not currently supported via `secret` (would require an explicit flag — deferred).
- Lesson: any time a parameter has dual purpose, an existing call site can silently inherit the second purpose. Test the round-trip (write then walk) on shared data, not just the immediate response.

**CRITICAL — local server shares Railway's Supabase**: When running `npx tsx src/index.ts` against `SUPABASE_ANON_KEY=...`, the local MCP writes to the SAME database Railway reads from. Smoke tests that write data will overwrite live data unless directed at a separate dev DB. Twice today I overwrote conventions `1.1` with smoke-test placeholder text and had to restore. For real isolation, set up a separate Supabase project for dev.

**Supabase branches blocked** (18 April 2026): Supabase branch-based dev isolation is unavailable because the migration chain's first step assumes a legacy `public.users` table that doesn't exist on fresh branches. Two branches (`fresh-build-db`, `dev`) both hit `MIGRATIONS_FAILED`. Full diagnosis, reproduction steps, proposed fix, and acceptance criteria in **[docs/supabase-branch-blocker.md](docs/supabase-branch-blocker.md)**. Until fixed in the upstream migrations repo (likely `xstream-play`), fall back to naming-prefix convention (`test-...`, `smoke-...`) for smoke tests on the shared production database.

**Tool naming inconsistency note**: After today's tidy, sed:-related parameter naming is mostly unified — inbox tools use `secret` (dual purpose: ownership + gray encryption); write/walk use `secret` (dual purpose on ordinary blocks only; sed: blocks treat it as lock-proof). The remaining wart: `pscale_write` still accepts `passphrase` as a deprecated alias. Drop it in a future cleanup once no caller uses it.

**Files changed**: [src/tools/block-ops.ts](src/tools/block-ops.ts) (handler + schema descriptions). No new tools, no new dependencies.

**Not yet done**:
- David has not yet registered a position in `sed:commons` or `sed:onen`.
- No probe / signal_return test run yet — collectives have only their roots populated.
- Conventions block: positions 3+ (research, supply chain, etc.) unclaimed and currently open-write.

## The 20 April 2026 session — grain substrate + evolution reorder

**Context**: `evolution.json` was still describing grain at 1.1 as the 3-phase synthesis protocol from the original spec, with sed: at 1.4 as the primary routing substrate. The 14 April design note ("grain simplified — just a record that two agents connected") never made it back into the spec document. Meanwhile sed: ownership gating was the only substrate-aware code path; the rest of SAND (rider, verify, SQ, credits) was already substrate-neutral. David's instinct: ship grain as a parallel substrate experiment, not a replacement.

**The reordering** (semantic, not architectural):
- 0.x Signal unchanged (passport, beach, memory, keys)
- 1.x Discovery Ecology pared back to first contact only (passport_read + bare-agent_id inbox ping)
- 2.1 **Grain — first durable commitment** (was at 1.1 as synthesis-ceremony, now at 2.1 as bilateral commitment)
- 2.2 SAND routing (probe / signal_return with rider)
- 2.3 SQ
- 2.4 **Sed: role-taking** (was at 1.4 as primary substrate, now later in the arc — public standing after grains exist)
- 2.5 Substrate complement (grain + sed: coexist; SAND arithmetic operates on both)
- 2.9 Agent territory (unchanged)
- 3.x, 4 unchanged

**Grain protocol (as built)**:
- Address: `grain:{pair_id}:{side}` where `pair_id = sha256(sort(A_id, B_id)|join('|'))[:16]` and lex-smaller agent gets side 1.
- Block shape: `{_: description, "1": {_:A_content}, "2": {_:B_content}, "9": {"1": A_agent_id, "2": B_agent_id}}`. Position 9 is the hidden directory mapping side to underlying agent — used by the passport resolver.
- Write-lock per side via `position_hashes` (same column sed: uses). Salt distinct from sed:: `passphrase + "grain:" + pair_id + ":" + side`.
- Formation asymmetric: one agent reaches, the other accepts. Single symmetric tool (`pscale_grain_reach`) handles both — server detects state. Half-formed state observable (reach-without-reception is a legitimate relational signal).
- Partner notified via inbox with `message_type=grain_establish` on first call, `grain_accept` on completion.

**What was built**:
- `src/tools/grain-ops.ts` — `handleGrainReach`, `verifyGrainOwnership`, `resolveGrainAddress`, `pairId`, `determineSide`, `hashGrainPassphrase`. Tool registered as `pscale_grain_reach`.
- `src/tools/discovery-ops.ts` — replaced direct `isSedAddress` check with `isStructuredAddress` + `verifyAddressOwnership` dispatcher. sed: and grain: now route through their respective ownership gates; bare agent_ids skip. Gray-path key-matching preserved only for non-structured senders.
- `src/db.ts` — `getPassportFromAddress` resolver. For `grain:{pair_id}:{side}`, walks the grain block, reads hidden directory at position 9.{side}, loads THAT agent's passport. For sed: and bare addresses, falls through to `getPassportBlock`.
- `src/tools/verify-ops.ts` — swapped `getPassportBlock` → `getPassportFromAddress` so Level 2 rider arithmetic works on grain-routed probes without code changes. Substrate-neutrality is now actually tested, not just claimed.
- `src/tools/network-ops.ts` — grain query updated to the new layout (`owner_id LIKE 'grain:%'`, read block["9"] for side-to-agent mapping).
- `src/server.ts` — register grain-ops; instructions updated to describe grain-first / sed:-later ordering.
- `src/evolution.json` — restructured per above.
- `src/invite.json` — Level 2 rewritten to first-contact + grain_reach; Level 3 updated to live-channel + optional sed: registration.
- `site/state.json`, `site/tools.html`, `docs/tools.md` — tool count 21 → 22, grain added, levels remapped.
- `scripts/test-grain-reach.ts` — smoke test harness (reach, accept, verify, idempotency).

**Smoke test** (against production Supabase, throwaway agent_ids):
- ✓ Reach creates block, writes side 1, sends grain_establish
- ✓ Accept writes side 2, sends grain_accept
- ✓ Block walkable via `pscale_walk(agent_id='grain:{pair_id}', name='grain')` from outside
- ✓ Re-reach rejected ("Your side already exists")
- ✓ `inbox_send` from `grain:{pair_id}:1` with wrong passphrase rejected (substrate-neutral ownership check live on Railway)
- ✓ `inbox_send` from `grain:{pair_id}:1` with correct passphrase accepted

**Residual artefact**: one smoke-test grain persists at `grain:b4b163869c99ae48/grain` between `grain-test-alpha` and `grain-test-beta`. Harmless but worth noting — living evidence the tool works.

**What's deferred**:
- Writing grain conventions to `sed:conventions/3` on production (David to decide: the conventions block is the right place for the protocol rules as data, but it's a production-data write).
- Ed25519 chain signatures (both substrates still sha256 chain only).
- Grain withdrawal (deleting your side after reach) — not a tool yet.
- `pscale_grain_list(agent_id)` — the "show me all grains I'm part of" primitive needed to walk the mesh topology. Add when first use demands it.
- Sed: position-to-agent resolution (currently `getPassportFromAddress` falls through for sed: — sed: collective registration doesn't record an underlying agent_id, which blocks `verify_rider` on sed:-routed probes with credit/SQ claims). Known gap; fix when someone registers and tries to use SAND.

**22 tools total**: 3 block + 3 memory + 2 identity + 4 discovery + 1 invite + 1 network + 1 crypto + 3 pool + 2 collective + 1 verify + **1 grain**.

**Commits**: `e24d4be` (evolution reorder), `92bfe8b` (grain_reach + dispatch + resolver), `9d15b7e` (smoke test script).

## Where we are now — the honest state (updated 20 April 2026)

**We are at the boundary of Evolution 1 (Discovery) and Evolution 2 (Trust Ecology), with both substrates live: sed: (multilateral, public role-taking) and grain: (bilateral, private commitment).** Evolution.json was reorganised on 20 April to place grain at 2.1 and sed: role-taking at 2.4, reflecting the relational arc (commit first, take public role later). SAND routing arithmetic (verify_rider) is substrate-neutral: chain integrity, credit conservation, and SQ consistency compute identically on grain: and sed: addresses.

**Working**:
- 22 MCP tools, all live on Railway (commit `9d15b7e` or later — includes grain_reach)
- Context-aware `pscale_invite` — shows beach state + agent's position + next step
- `pscale_network` — live grain network view + content routing
- Federated beach protocol — happyseaurchin.com is the first site, Vercel KV persistence
- `docs/protocol-pscale-beach.md` — complete guide for anyone to host a beach
- Resolution chain — site OR relay, simple either/or
- Gray encryption — deterministic key derivation, encrypted inbox and blocks
- Liquid pools — co-presence detection + ephemeral engagement at URLs
- Sedimentary registration — create_collective + register, passphrase-locked positions
- **Sed: messaging-layer ownership** — sending from or reading inbox of a sed:collective:position requires the registration passphrase
- **Level 2 message types** — `probe` and `signal_return` enums on `pscale_inbox_send`
- **Ecosquared rider** — optional JSON envelope on inbox messages, stored as-is for routing/evaluation metadata
- **`pscale_verify_rider`** — deterministic arithmetic check (sha256 chain, credit conservation, SQ recompute) returning pass/warn/fail/skip
- **Grain substrate (NEW, 20 April)** — `pscale_grain_reach` for first durable commitment. Symmetric tool: same call creates block on reach, completes on accept. 2-position pscale block pair-named via sha256(sort(A,B))[:16], each side write-locked. Substrate-neutral ownership dispatcher covers both sed: and grain: prefixes at inbox_send / inbox_check. `getPassportFromAddress` resolver walks grain hidden directory (position 9) to find the underlying agent for verify_rider arithmetic.

**Not working / not built**:
- No registrants in `sed:commons` or `sed:onen` yet (collectives exist; positions 1-9 unclaimed)
- No probe / signal_return test run yet between real agents
- One grain block exists (smoke test, `grain:b4b163869c99ae48`, 20 April) — no real grains between actual agents yet
- No persistent agent. Beach-crab v0 built and abandoned (stateless Haiku chat was frustrating). v1 needs a proper kernel.
- `pscale_recall` level↔depth mapping still off.
- Compaction in `pscale_remember` is still concatenation (needs LLM summarisation).
- Sedimentary compaction (when 9 positions fill) not automated.
- Ed25519 chain signatures (currently sha256 — tamper-resistance only; identity covered by passphrase gate).
- `pscale_relay` (multi-hop forwarding) not built — next spec after Level 2 testing in the wild.

## Next priorities — in order (updated 20 April 2026)

1. **First real grain between actual agents** — David + one other real agent (not the smoke-test throwaways) run `pscale_grain_reach` end-to-end. Confirms the commitment substrate works in a real relationship. Sends a first substantive message from a grain-side address.

2. **Probe → signal_return test over a grain** — the two grained agents exchange a probe / signal_return pair with an ecosquared rider. Call `pscale_verify_rider` on the result. This is the empirical proof of substrate-neutrality: same rider arithmetic, grain topology instead of sed:.

3. **David registers in `sed:commons`** — pick a position, set a registration passphrase, run `pscale_register`. Invite a second agent to register at another position. Role-taking AFTER grain, per the new relational arc.

4. **David registers as world-keeper at `sed:onen` position 1** — declaration includes world setting, starting locations, action-type palette. Register a player at position 2 and run the first turn loop.

5. **First onen play session** — two players in `sed:onen` exchange intent (probe) and resolution (signal_return). Demonstrates Level 2 on sed: substrate; complements the grain version from step 2.

6. **Grain conventions in `sed:conventions/3`** — publish the grain protocol as data on the beach. Currently it lives only in code and evolution.json; externalising it completes the three-layer separation (conventions = data, arithmetic = code, substrates = runtime).

7. **`pscale_grain_list(agent_id)`** — "show me all grains I'm part of." The primitive that makes the grain mesh walkable as a topology. Add when first real use creates more than two grains.

8. **`pscale_relay`** — stateless multi-hop forwarding with relay chain tracking. After Level 2 testing on both substrates.

9. **Sedimentary compaction** — when positions fill, summarise declarations. Manual first, automatic later (needs server-side LLM).

10. **Sed: position-to-agent resolution** — current gap: `getPassportFromAddress` falls through for sed:, blocking `verify_rider` on sed:-routed probes with credit/SQ claims. Fix when someone registers and tries to use SAND arithmetic.

11. **hermitcrab.me beach `.well-known/pscale-beach`** — second federated site.

12. **Final `passphrase` deprecation on `pscale_write`** — drop the deprecated alias once no caller uses it. Low priority.

## The evolutionary model — complete reference (updated 15 April 2026)

Five evolutionary levels (stable states): 0 Structured Cognition, 1 Discovery Ecology, 2 Trust Ecology, 3 Identity & Self-Organisation, 4 MAGI.

Relational transitions and infrastructure (`.1` = initiation, `.4-.6` = sedimentary infrastructure, `.9` = infrastructure responsibility):

| Step | What | Who bears cost |
|------|------|---------------|
| 0.1 | Signal: publish passport, leave marks, check beaches | Agent (free) |
| 0.9 | Supabase relay: bootstrap infrastructure | Project maintainer (David) |
| 1.1 | Grain: probe, synthesise, compare — bilateral trust forms | Agent (free) |
| 1.4 | Sedimentary registration: agents register in shared collectives with permanent write-locked positions. Agent picks position. Conventions in root underscore. Hierarchy emerges from compaction. | Agent (free to register), MCP server (enforces write-lock) |
| 1.5 | Structural forwarding: content moves between positions via inbox. Evaluate, score, select neighbours, forward. Relay chain tracked. Creates data for SQ. | Agent (evaluation cost) |
| 1.6 | Sustainability: beach is primary (federated), Supabase is backup. Service = resilience + troubleshooting. Public window into the network. | Backup subscribers, not infrastructure bill |
| 1.9 | Website `.well-known`: site hosts its own beach | Site owner (human, developer task) |
| 2.1 | Live Channel: route, score, reinforce — channels learn | Agent (free) |
| 2.9 | Agent territory: agent manages shell, serves passport/blocks/inbox | Agent (runs on owner's infrastructure) |
| 3.1 | Open Context: direct semantic sharing with trusted partners | Agent (free) |
| 3.9 | 1:10 routing commitment: maintain channels, evaluate, forward | Agent (ongoing processing cost) |

Responsibilities stack. 1.9 is human (developer sets up endpoint). 2.9 is agentic (agent manages territory). The transition from human infrastructure to agentic infrastructure IS the autonomy transition.

## The spec

The original spec is at `/Users/davidpinto/Downloads/pscale-mcp-server-spec.md`. Written by a Claude chat session working at a distance from the code, then implemented here. The spec described 13 tools; we built 20. Grain-directory architecture at `~/Downloads/grain/grain-directory-spec.md`. Sedimentary registration build spec at `~/Downloads/sedimentary-registration-spec.md`.

## The 16 April 2026 session — sand_passports eliminated

**Problem**: Passports were stored in TWO places — `pscale_blocks` (as a proper block with `name='passport'`) AND `sand_passports` (a flat discovery table). The dual-write meant `pscale_passport_publish` wrote to both, but `pscale_write` to deepen the passport at sub-addresses only updated `pscale_blocks`. The `sand_passports` copy went stale immediately. Public keys for gray encryption were stored on `sand_passports` only, creating a third inconsistency.

**Why sand_passports existed**: It was built before the design corrected course. The original spec described passports as flat identity records in a dedicated table. When passports became proper pscale blocks (`_ = description, 1 = offers, 2 = needs`), the table survived as a zombie — a stale snapshot that every tool dutifully wrote to or read from.

**What changed**:
- `pscale_blocks` where `name='passport'` is now the single source of truth
- Public keys stored at address `9` in the passport block (reserved for infrastructure)
- `passport_publish` preserves existing block content (keys, sub-addresses) on republish
- `passport_read` reads from `pscale_blocks`, not `sand_passports`
- `key_publish` writes keys to passport block address `9`, not `sand_passports.public_keys`
- Gray encryption path in `inbox_send` reads keys from passport blocks via `getPublicKeys()` helper
- `invite-ops` passport existence check queries `pscale_blocks`
- Beach visualization (`pages.ts`) reads from `pscale_blocks` where `name='passport'`
- `evolution.json` table list updated
- `db.ts` gains `getPassportBlock()` and `getPublicKeys()` helpers

**Data migration**: happyseaurchin's public_keys copied from `sand_passports` to passport block address `9`. agent-alpha's old-format passport created as a proper block. All 7 agents verified to have passport blocks.

**`sand_passports` table**: Still in Supabase, no longer referenced by any code. Can be dropped when convenient. Passport block structure: `_ = description, 1 = offers, 2 = needs, 3 = lineage, 9 = { x25519, ed25519 }`.

**The lesson**: When the data model evolves, kill the old table. Don't dual-write. Every dual-write is a drift bug waiting to confuse the next agent.
