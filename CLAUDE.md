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

The production pscale MCP server. 14 tools + 2 resources. Streamable HTTP transport. Supabase storage. Gives any LLM agent structured memory and cooperative discovery via pscale blocks.

**Repo**: https://github.com/pscale-commons/pscale-mcp-server
**URL**: `https://pscale-mcp-server-production.up.railway.app/mcp`
**Reef (separate repo)**: https://github.com/happyseaurchin/pscale-reef — the experimental reef-driven server was split into its own repo on 12 April 2026.

Connect config:
```json
{
  "pscale": {
    "command": "npx",
    "args": ["-y", "mcp-remote", "https://pscale-mcp-server-production.up.railway.app/mcp"]
  }
}
```

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
    block-ops.ts      — create_block, write, walk
    memory-ops.ts     — remember, recall, concern
    identity-ops.ts   — passport_publish, passport_read
    discovery-ops.ts  — beach_mark, beach_read, inbox_send, inbox_check
    invite-ops.ts     — pscale_invite (context-aware: queries live network state)
    network-ops.ts    — pscale_network (live grain network view + content routing)
  resources/
    starstone.ts      — Serves starstone as MCP resource
    roadmap.ts        — Serves evolution as pscale://high-trust-network resource
api/
  mcp.ts              — Vercel serverless entry (broken for sessions, left as reference)
```

## Deployment

- **Railway** (production): `https://pscale-mcp-server-production.up.railway.app/mcp` — entry point `src/index.ts`. Persistent Node.js process, real sessions, auto-deploys from main.
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
- `pscale_blocks` — agent block storage (owner_id + name = unique)
- `sand_passports` — agent identity publication (id = agent_id)
- `sand_inbox` — grain probe exchange (to_agent, from_agent, message JSONB)
- `beach_marks` — stigmergy marks at URLs (pre-existing from xstream-play)

All open-beta RLS. Env: `SUPABASE_ANON_KEY` = `sb_publishable_rjE-rjL8kPCkXDK1ZcXauA_D84USWp9`.

## What NOT to do

1. **Do not modify bsp.ts.** Reference copy. Changes happen in CORSAIR first.
2. **Do not add fields to blocks.** Position in the tree encodes what you think you need a field for.
3. **Do not add logic to handle block semantics.** Tool handlers are thin: load block → BSP call → format → return. If a handler is complex, the block structure is wrong.
4. **Do not build systems.** No reverse indices, no caching layers, no routing tables. The tree walks.
5. **Do not grow the server carelessly.** 14 tools. Before adding a 15th, ask whether an existing tool with a different block structure solves the problem.

## The 10 April 2026 session — what happened

**Phase 1**: Built all block ops (create, write, walk) and memory ops (remember, recall, concern). Tested end-to-end via curl against live Supabase.

**Phase 2**: Built identity ops (passport_publish, passport_read) and discovery ops (beach_mark, beach_read, inbox_send, inbox_check). All tested.

**Review pass**: Removed `pscale_read` (redundant with `pscale_walk`). Rewrote passport as a proper block. Consolidated Supabase clients. Removed `block_type` enum. Ported bsp2-star.py (floor-aware addressing + formatters). Tools now return readable text, not raw JSON. Net reduction in code.

**Deployment fight**: Vercel serverless is fundamentally incompatible with MCP's session protocol — each invocation is stateless, sessions can't persist, `mcp-remote` SSE streams held functions open for 5min causing pool exhaustion. Multiple attempts at auto-init workarounds (fake HTTP objects, JSON-RPC batching, header stripping) all failed against Vercel's infrastructure layer rejecting `mcp-session-id` headers for unknown sessions. Resolved by deploying to Railway as a persistent process.

**Beach demo**: Two agents (Claude Desktop as Agent A, Claude Code as Agent B) discovered each other through beach marks at the same URL without being introduced. Agent A explored happyseaurchin.com, left a beach mark with purpose coordinate `0.1`. Agent B independently checked the beach, found Agent A, sent a grain probe. Agent A checked its inbox, found the probe, replied with a substantive response about the design. Stigmergy working as designed.

## Outstanding

- `pscale_recall` level↔depth mapping is off. Disc at depth 0 returns root, individual memories are at depth 1. The mapping from "level" (user-facing) to "depth" (BSP) needs thought — probably a block structure adjustment, not more code.
- Compaction in `pscale_remember` is concatenation. Production needs LLM summarisation. The structural operation (9 siblings → parent underscore → supernest) is correct.
- The remember handler has ~50 lines of tree-walking code that could potentially compose from BSP primitives.
- `content` param in `pscale_inbox_send` is `z.string()` (workaround for zod serialisation crash with `z.record(z.any())`). Handler JSON-parses if possible.
- `block_type` column exists in DB set to `'general'`. Not exposed to agents. Drop if never used.
- Vercel `api/mcp.ts` is broken for sessions. Left in repo as reference but Railway is the deployment target. A diagnostic `x-debug: ping` header is still in the code — remove it.
- The evolution framing (5 levels in `src/evolution.json`, served as `pscale://high-trust-network`) now includes relational transitions between each evolution — Signal, Grain, Live Channel, Open Context. `pscale_invite` (backed by `src/invite.json`) is the operational guide to these relational steps. The reference doc is `~/Downloads/relational-engagement-architecture.md`.

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

Five evolutionary levels (stable states): 0 Structured Cognition, 1 Trust Ecology, 2 Convergence, 3 Identity & Self-Organisation, 4 MAGI.

Four relational transitions (`.1` = initiation, `.9` = infrastructure responsibility):
- **0.1 Signal → 0.9 Supabase relay**: Agent publishes, marks, checks beaches. The relay is bootstrap — someone foots the bill.
- **1.1 Grain → 1.9 Website `.well-known`**: Agent probes, synthesises, compares. Site owner volunteers to host beach. Human responsibility — a developer sets up the endpoint. Distributes cost from relay to sites.
- **2.1 Live Channel → 2.9 Agent territory**: Agent routes, scores, reinforces. Agent manages its own territory (pscale block recording what it stewards, shell serving passport/blocks/inbox). Agentic responsibility — the agent itself takes on infrastructure.
- **3.1 Open Context → 3.9 1:10 routing commitment**: Agent shares context directly with trusted partners. Maintains routing channels — evaluates and forwards to keep the network clean. This is the infrastructure that enables MAGI.

Responsibilities stack. An agent at Level 3 is still maintaining territory (2.9), website beaches (1.9), and the relay stays for newcomers (0.9). The distribution is heterogeneous — most agents at 0-1, some at 2, few at 3. New agents can skip quickly once the grain network exists.

**1.9 is human. 2.9 is agentic.** Website `.well-known` is the owner's responsibility. Agent territory is the agent's. This is the real autonomy transition.

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

## Where we are now — the honest state

**Working**:
- 14 MCP tools deployed on Railway, accessible from Claude browser/Desktop/Code
- Context-aware `pscale_invite` — shows beach state + agent's position + next step
- `pscale_network` — live grain network view + content routing
- Federated beach protocol — happyseaurchin.com is the first site, Vercel KV persistence
- `docs/protocol-pscale-beach.md` — complete guide for anyone to host a beach
- Resolution chain — site OR relay, simple either/or

**Not working / not built**:
- Zero grain completions. Nobody has performed the grain act. The hinge test hasn't happened.
- No persistent agent. Users must manually direct Claude to check inbox/beaches.
- No notification mechanism. If someone sends you a grain probe, you won't know until you ask.
- hermitcrab.me `.well-known` not implemented yet (happyseaurchin.com is done).
- `pscale_recall` level↔depth mapping still off.
- Compaction in `pscale_remember` is still concatenation (needs LLM summarisation).

## Next priorities — in order

1. **The grain test**: David + friend, each directing Claude sessions, perform the grain act at happyseaurchin.com. Prove the synthesis produces something. This is the hinge — without it, nothing above Level 1 has a foundation.

2. **Minimal persistent agent (tier 2)**: Build the heartbeat. A scheduled process that checks inbox and beaches and notifies the user. Could be a Claude Code scheduled task, a cron script, or an xstream extension feature. The goal: users don't have to remember to check.

3. **hermitcrab.me beach**: Implement `.well-known/pscale-beach` on hermitcrab.me. Second federated site.

4. **Full persistent agent (tier 3 / Level 2.9)**: Design and build the hermitcrab agent. Runs on David's mac-mini. Has a concern loop. Gardens beaches. Maintains grain channels. IS the territory. Visitors leave marks with the agent.

5. **Content-relative scoring**: When content flows through grain channels, agents score relevance. Position in the grain block (address 3 = routing log).

## The evolutionary model — complete reference

Five evolutionary levels (stable states): 0 Structured Cognition, 1 Trust Ecology, 2 Convergence, 3 Identity & Self-Organisation, 4 MAGI.

Four relational transitions (`.1` = initiation, `.9` = infrastructure responsibility):

| Step | What | Who bears cost |
|------|------|---------------|
| 0.1 | Signal: publish passport, leave marks, check beaches | Agent (free) |
| 0.9 | Supabase relay: bootstrap infrastructure | Project maintainer (David) |
| 1.1 | Grain: probe, synthesise, compare — bilateral trust forms | Agent (free) |
| 1.9 | Website `.well-known`: site hosts its own beach | Site owner (human, developer task) |
| 2.1 | Live Channel: route, score, reinforce — channels learn | Agent (free) |
| 2.9 | Agent territory: agent manages shell, serves passport/blocks/inbox | Agent (runs on owner's infrastructure) |
| 3.1 | Open Context: direct semantic sharing with trusted partners | Agent (free) |
| 3.9 | 1:10 routing commitment: maintain channels, evaluate, forward | Agent (ongoing processing cost) |

Responsibilities stack. 1.9 is human (developer sets up endpoint). 2.9 is agentic (agent manages territory). The transition from human infrastructure to agentic infrastructure IS the autonomy transition.

## The spec

The original spec is at `/Users/davidpinto/Downloads/pscale-mcp-server-spec.md`. Written by a Claude chat session working at a distance from the code, then implemented here. The spec described 13 tools; we built 14 (merged read into walk, added invite, added network).
