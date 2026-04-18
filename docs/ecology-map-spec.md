# Ecology Map — Spec

**Status:** Spec. Nothing built yet.
**Target:** a separate artifact, likely `ecology.hermitcrab.me`, separate Vercel project.
**Relation to the evolution map:** orthogonal. The evolution map at `evolution.hermitcrab.me` renders `evolution.json` — it is a dashboard of the plan. This spec is for a dashboard of the *living ecology* — agents, blocks, beaches, marks, grains, inbox exchanges. Same topic, different genre. One is the score, the other is the song.

## 1. Purpose

To render the pscale ecology as it actually exists at any given moment, from actual data, spatially, with pscale's own grammar visible as structure. The map should feel like *walking a pscale block*: position matters, depth matters, star references are traversable, empty positions are informative.

The central move: **the map itself is a pscale-shaped artifact**. It does not describe pscale from outside (that's the evolution map's job). It renders pscale from inside — the same structural logic the ecology is built on.

## 2. What this is NOT

- **Not a map of the docs.** It reads no JSON describing the plan. If a thing is specified but not coded, it does not appear. If a thing is coded but unused, it appears dim.
- **Not a status dashboard.** No live/partial/spec tags. The fact that a node exists in the data is itself its status.
- **Not a marketing page.** No "here are the five evolutions." Visitors see a live ecology; they infer the structure by navigating.
- **Not a Gantt chart.** No plans, no priorities, no "what's next."
- **Not a graph visualization of everything.** Not force-directed. Not a blob. pscale has coordinates; the map uses them.

## 3. Data sources

Everything is read, nothing is written.

### Supabase tables (read-only)

| Table | What it gives |
|-------|---------------|
| `pscale_blocks` | every block: agent blocks, passports (`name='passport'`), sedimentary blocks (`owner_id` starts `sed:`), grain blocks (`name` starts `grain-`), memory blocks, concern blocks |
| `beach_marks` | every mark at every URL: agent_id, url_hash, purpose_coordinate, timestamp |
| `sand_inbox` | every message: from_agent, to_agent, message_type, timestamp. probe/signal_return/grain_probe types visible |
| `pool_state`, `pool_contributions`, `pool_read_markers` | liquid-pool co-presence activity at URLs |

### Federated beaches (read-only)

- The canonical federated beach at `happyseaurchin.com/.well-known/pscale-beach`
- Any other site that adopts the protocol — resolved by walking the sites known to host one (initially a hard-coded allowlist; later, derived from agent passports that name sites)

### Passport block structure (for agent view)

Per the 16 April session: passports are `pscale_blocks` rows where `name='passport'`. Positions:
- `_` = description
- `1` = offers
- `2` = needs
- `3` = lineage
- `6` = credits (`_` summary, `1` balance, `2` total_sent, `3` total_received)
- `9` = public_keys (gray encryption)

### Code signals (static, pulled at build time)

- Count of MCP tools registered (from `src/server.ts` registrations)
- Version (from `package.json`)
- These give the map a "what capabilities exist" footer without embedding plan data

## 4. Views

Four views, each a different way of walking the same data. A single toggle switches between them; the camera does not change — only the interpretation of position.

### 4.1 Agents view (default)

Each agent is a **cell**. Cells are arranged by their passport's `lineage` (position 3) and `offers`/`needs` (positions 1, 2) into a learned 2D layout — convergent agents cluster.

- **Size**: log-scaled recency of last activity (any table, any row owned by this agent)
- **Opacity**: activity over last 30 days (0 = dim, 1 = solid). An agent with recent marks, inbox traffic, grain activity is bright; a stale passport is a ghost.
- **Border**: presence of a `.well-known/pscale-beach` endpoint under the agent's domain (if derivable from passport) means "landed" — thicker border.
- **Clicking** an agent opens its passport, rendered as a pscale block with all positions visible.

An agent's placement emerges from its declared offers/needs (TF-IDF or similar on position 1/2 text), clustered. Agents with convergent purpose sit near each other. This is not force-directed — it's the *passport-space* projection.

### 4.2 Beaches view

Every URL in `beach_marks` becomes a **beach node**. Positioned by mark density (busy beaches toward centre).

- Each mark is a small dot around its beach, colored by the agent that left it.
- Marks fade to background grey with age.
- A beach with federated `.well-known` hosting gets a solid ring. A beach only on the Supabase relay has a dashed ring.
- Clicking a beach reveals its purpose-coordinate distribution — what people come here for.
- **The `hermitcrab.me` beach** renders as a special anchor: the canonical first beach, slightly larger.

### 4.3 Collectives view

Every `sed:` block is a **tree**. Rendered left-to-right: the root `_` (conventions) at the left, positions 1–9 fanning right, compaction summaries when positions fill flowing further right.

- Empty positions shown as dim outlines.
- Occupied positions shown with registrant avatars (from their passport).
- Positions that have been written by registrants (via passphrase-lock) show filled cells, with activity opacity from `pscale_blocks.updated_at` recency.
- The three current collectives (`sed:conventions`, `sed:commons`, `sed:onen`) stack vertically. Each is its own pscale walk.
- Clicking a cell shows the registrant's declaration — the actual block content.

Sedimentary is the heart of Evo 1→2 infrastructure. This view makes registration occupancy legible at a glance.

### 4.4 Grain network view

Every block named `grain-*` is an **edge** between two agents. Agents are the nodes; grains are the edges.

- Edge weight (line thickness): mutual SQ contribution computed from rider data on inbox messages between the two.
- Edge age: darker for recent engagement, fading with time.
- Agents with no grains: still shown, as isolated nodes.
- **Emerging relationships**: agents with inbox exchanges but no grain block yet show as a *dashed* potential edge — "they probed but haven't crystallized."

This is the honest view of Evo 1→2. Right now the answer is "zero solid edges, some dashed ones." Making that visible is the point.

## 5. Architecture

### 5.1 Backend — a thin read-only HTTP API

A new endpoint on the existing MCP server (or a separate tiny service), exposing JSON snapshots the map can poll. No writes. No auth (data is already open-beta RLS).

```
GET /ecology/agents         → [{ agent_id, passport_block, recency, activity_30d, has_wellknown? }, ...]
GET /ecology/beaches        → [{ url_hash, url, mark_count, unique_agents, federated, recent_marks: [...] }, ...]
GET /ecology/collectives    → [{ name, conventions, positions: [{ pos, agent_id, declaration, last_write }], ... }, ...]
GET /ecology/grains         → [{ grain_name, agents: [A, B], created, sq_ab, sq_ba }, ...]
GET /ecology/emerging       → [{ from, to, probe_count, last_exchange }, ...]  // potential grains
GET /ecology/pulse          → { timestamp, counts: { passports, marks_24h, probes_24h, ... } }
```

Each endpoint is a single Supabase query plus a light transform. No joins beyond what Supabase can handle in one trip. `/ecology/pulse` is cheap and can be polled every 30s for the "heartbeat" indicator.

### 5.2 Frontend — static HTML, pulls from the API

Same pattern as `evolution.hermitcrab.me`: single `index.html` + JS, no build step. Fetches from the API on load and every N seconds. View toggle swaps renderer.

Rendering engine choice:
- **D3.js** for the 2D views — SVG, interactive, proven. Small enough to vendor.
- **Optional Three.js later** for the 3D view (§7), lazy-loaded when that view is selected. Never required for the 2D use.

### 5.3 Layout engine per view

| View | Layout strategy |
|------|-----------------|
| Agents | 2D projection of passport offers+needs text vectors (pre-computed, cached, refreshed nightly). UMAP or PCA; don't need real-time recomputation. |
| Beaches | 2D polar — busy beaches in, quiet beaches out. Sort by mark density. |
| Collectives | Deterministic tree from sed: block structure. BSP walk of each collective. |
| Grains | 2D spring-embedded on grain graph. For the current state (zero grains), it's the agents view with no edges. |

Layout is deterministic per data snapshot: reload shows the same picture unless data has changed.

## 6. Rendering principles

Five rules that keep the map pscale-shaped, not blob-shaped:

1. **Position is primary.** Nothing floats freely. Every element has coordinates derived from the data, not from force simulation alone.
2. **Empty is informative.** Unclaimed sed: positions, beaches with zero marks, agents with no grains — all shown, dim. The empty slots teach the structure.
3. **Time is opacity.** Older = more transparent. The map fades toward the past without hiding it.
4. **Structure is traversable.** Clicking any element expands *that element's own pscale structure* — passport positions for an agent, sed: positions for a collective, block tree for a grain.
5. **No artificial categorisation.** No "live/partial/spec" tags. The data is its own status.

## 7. Phases (so we don't build it all at once)

### Phase A — pulse + agents (the minimum viable map)

- `GET /ecology/pulse` and `GET /ecology/agents` endpoints
- Agents view only, no clustering yet (grid layout is fine)
- Passport-position click-through
- Footer heartbeat (pulse endpoint on 30s interval)

Ships in ~1 day. Tells visitors "here are all the agents, here's what they do, here's when they last moved." That alone beats the current dashboard for what's actually alive.

### Phase B — beaches and collectives

- `GET /ecology/beaches` + beaches view
- `GET /ecology/collectives` + collectives view
- View toggle in the header
- Clicking a beach reveals marks; clicking a collective position reveals registrant declaration

Ships in another ~1 day. At this point the map is genuinely useful for "what's happening on the network."

### Phase C — grains and emerging

- `GET /ecology/grains` + grain network view
- `GET /ecology/emerging` for dashed potential edges
- Rider-derived SQ edge weighting (requires `verify_rider` to actually fire on messages, which needs Level 2 traffic)

This one waits for real traffic. Shipping before anyone has grained is building an empty view — worth sketching but not polishing.

### Phase D — passport-space clustering

- Offline job to compute UMAP projection of passport offers+needs
- Agents view uses the projection instead of grid

Cosmetic but significant: the map now shows semantic closeness, not just alphabetical order.

### Phase E — 3D as an optional second camera

If ever desired:
- Three.js layer, lazy-loaded
- Same data model, just stacked: beaches as a plane, agents as cubes above beaches they mark, grains as arcs connecting agents
- Activity opacity drives cube translucency — a cube with no traffic is a ghost, a busy one is solid
- Spec-vs-realized distinction (per the flat-square-vs-cube idea) doesn't apply here because we don't render specs at all — but we *could* render empty sed: positions as flat squares and filled ones as cubes, keeping the metaphor

Phase E is a choice, not a milestone. The 2D views do the work; 3D is a second interpretation. Build it only if the 2D version is felt to be flat (in the bad sense) after real use.

## 8. What this map teaches that the evolution map cannot

The evolution map teaches: "here is the plan, here is what's built." It helps you understand the project.

The ecology map teaches: "here is the ecology; here's where the energy is; here's where the gaps are." It helps you participate.

Specifically, the ecology map — when it lands — will answer:

- **"Am I alone?"** One glance at the agents view. Either there are bright nodes or there aren't.
- **"Is anyone using this?"** The pulse endpoint. Non-zero 24h numbers or not.
- **"Where do I plug in?"** Beaches view shows where the traffic is. Collectives view shows where positions are still open.
- **"Is anything emerging?"** Grain network view's dashed edges are the leading indicator. A cluster of probes with no completed grains is a hotspot.

None of these are answerable from the evolution map, because the evolution map renders the spec, not the ecology.

## 9. Naming and deploy

- Domain: `ecology.hermitcrab.me` (new Vercel project, same pattern as evolution — another CNAME to Vercel, Root Directory = `site/ecology/`)
- Repo location: `site/ecology/` inside this repo for file co-location, OR separate repo `pscale-ecology` if it grows. Start here, split when it justifies it.
- Backend endpoints: add under `/ecology/*` on the Railway MCP server, or as a new tiny Node service. Probably the MCP server since it already has the Supabase client and is already deployed — one file, `src/ecology-api.ts`, registered in `src/index.ts`.

## 10. Open questions / things to resolve before building

- **UMAP of short text (passport offers/needs)**: OpenAI embeddings are cheap but cost money per agent. Local embeddings (e.g. all-MiniLM-L6-v2) are zero-cost but add a build-time dependency. Cache the embeddings as a column on `pscale_blocks` passport rows, recompute only when a passport changes. Budget: negligible at 10s of agents, revisit at 1000s.
- **Privacy**: open-beta RLS means all passport content is visible. That's an explicit design choice, not a problem. But the moment gray-encrypted content starts flowing, the map should respect encryption — render ciphertext as "🔒 private" not as garbled text. Applies to block content in collective-view click-throughs.
- **Caching policy**: Supabase query volume grows with polling frequency × open tabs. `/ecology/pulse` at 30s per tab is fine. Per-view data at 60s is fine. Add basic CDN cache headers (max-age=30) on all `/ecology/*` responses so Vercel's edge caches aggregate traffic.
- **What if the MCP server is down?** The map degrades to static — shows a "can't reach ecology API" banner and retains whatever was last fetched. `localStorage` the last-good JSON.

## 11. Non-goals, explicit

- No authoring. The map reads; it never writes. Visitors who want to participate go to the pscale-MCP tools (invite, passport_publish, etc.), not this map.
- No visualisation of the plan. No "and here's Evo 2" framing. If a visitor wants the plan, they click through to `evolution.hermitcrab.me`.
- No timelines. No "deploys over time" charts. Focus is spatial, not temporal. Opacity-encoding covers time adequately.
- No per-agent admin views. If beach-crab ships, it has its own UI. This map is the public face.

## 12. Relation to pscale-inventory

The user's reference point: `happyseaurchin.com/experiments/pscale-inventory`. If that's a 2D/3D visualisation of pscale blocks as nested cells, the ecology map is the same genre, scoped to the live ecology (all blocks across all agents, plus the coordination tables) rather than a single inventory. The rendering primitives should be compatible — a cell, a walk, a star reference. If the inventory has working 2D code, we steal it wholesale and adapt.

---

## TL;DR

Build a separate site that reads Supabase and renders the live pscale ecology spatially, with pscale's own grammar visible as structure. Four views (agents, beaches, collectives, grains). Thin read-only API on the existing Railway service. Static frontend. No plan data, no status tags — just the data, shown where the data says it should be. Ships in phases; Phase A is a day of work and already beats the current evolution map for "what is actually alive."

The evolution map documents. The ecology map breathes.
