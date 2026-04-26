#!/usr/bin/env tsx
/**
 * World compressor — integrates registered authors' observation streams into
 * the shared world block (step 7 of Thornkeep test prep, 2026-04-26).
 *
 * Sibling to scripts/grit-resolver.ts. Same shape: poll loop, LLM synthesis,
 * substrate writes. Different scope: the resolver writes resolution events
 * to the pool; the compressor writes world canon updates to the world block.
 *
 *   on each tick (every POLL_INTERVAL_SECONDS):
 *     for each game in config:
 *       authors = walk sed:{game}-authors → list of (position, agent_id, observations_block)
 *       cursors = world block @ position 9 hidden directory (per-author timestamps)
 *       for each author:
 *         observations = walk {agent}/{observations_block}, filter > cursor[author]
 *         if any:
 *           group by parsed TARGET (e.g. thornkeep-world@2)
 *           for each (target_address, observation_subset):
 *             current_room = pscale_walk world @ target_address (point/spindle)
 *             integrated_room = LLM(rules + current_room + observation_subset)
 *             pscale_write world @ target_address content=integrated_room secret=GM_SECRET
 *           advance cursor[author] = max observation timestamp
 *       persist updated cursors back to world @ 9
 *
 * Config (env):
 *   ANTHROPIC_API_KEY         — for LLM integration (Haiku)
 *   SUPABASE_ANON_KEY         — pscale relay access
 *   COMPRESSOR_GAMES_CONFIG   — path to JSON config file
 *   COMPRESSOR_GM_SECRET_<NAME> — GM secret for game NAME (per-game; uppercase, dashes→underscores)
 *
 * Games config example (compressor-games.json):
 *   {
 *     "games": [
 *       {
 *         "name": "thornkeep",
 *         "gm_agent_id": "thornkeep-gm",
 *         "world_block": "thornkeep-world",
 *         "rules_block": "thornkeep-rules",
 *         "authors_collective": "thornkeep-authors",
 *         "observations_block_name": "thornkeep-observations"
 *       }
 *     ]
 *   }
 *
 * GM secrets are env vars to keep them out of any config file. For the example
 * above, set COMPRESSOR_GM_SECRET_THORNKEEP=<gm_secret>.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_ANON_KEY=... \
 *   COMPRESSOR_GAMES_CONFIG=compressor-games.json \
 *   COMPRESSOR_GM_SECRET_THORNKEEP=thorn142 \
 *   npx tsx scripts/world-compressor.ts
 *
 * Or one-shot (no loop):
 *   COMPRESSOR_ONESHOT=1 npx tsx scripts/world-compressor.ts
 *
 * Lock model: the compressor needs the GM secret to write to the locked world
 * block. It does NOT need any author's secret because it only READS observation
 * blocks (locks are write-only; reads are public).
 */

import { handleWalk, handleWrite } from '../src/tools/block-ops.js';
import { getClient } from '../src/db.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

const POLL_INTERVAL_SECONDS = 60;
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const ONESHOT = process.env.COMPRESSOR_ONESHOT === '1';

const GAMES_CONFIG_PATH = process.env.COMPRESSOR_GAMES_CONFIG;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!GAMES_CONFIG_PATH) { console.error('COMPRESSOR_GAMES_CONFIG is required'); process.exit(1); }
if (!ANTHROPIC_KEY) { console.error('ANTHROPIC_API_KEY is required'); process.exit(1); }

interface GameConfig {
  name: string;
  gm_agent_id: string;
  world_block: string;
  rules_block: string;
  authors_collective: string;
  observations_block_name: string;
}

const config: { games: GameConfig[] } = JSON.parse(readFileSync(GAMES_CONFIG_PATH, 'utf-8'));
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

function gmSecretFor(game: GameConfig): string {
  const envKey = 'COMPRESSOR_GM_SECRET_' + game.name.toUpperCase().replace(/-/g, '_');
  const v = process.env[envKey];
  if (!v) { console.error(`${envKey} is required`); process.exit(1); }
  return v;
}

interface Author {
  position: string;             // e.g. "11"
  agent_id: string;             // bare agent_id, e.g. "happyseaurchin"
  observations_block: string;   // name of the observations block
}

interface Observation {
  position: string;             // e.g. "1", "2", ..., observation address
  target: string;               // e.g. "thornkeep-world@2"
  detail: string;
  ts: string;                   // ISO timestamp from updated_at on the source block (best-effort)
}

// ── Direct DB helpers (compressor reads observation blocks raw) ──

async function loadBlockRow(owner_id: string, name: string): Promise<{ block: any; updated_at: string } | null> {
  const client = getClient();
  const { data } = await client
    .from('pscale_blocks')
    .select('block, updated_at')
    .eq('owner_id', owner_id)
    .eq('name', name)
    .maybeSingle();
  return data ? { block: (data as any).block, updated_at: (data as any).updated_at } : null;
}

// ── Author registry walk ──

/**
 * Walk sed:{collective} and parse each registered position into an Author record.
 * Declarations follow the convention from sed:conventions/5.4.2:
 *   "<name> | observations: <agent_id>/<observations-block-name> | role: <role>"
 */
async function loadAuthors(game: GameConfig): Promise<Author[]> {
  const row = await loadBlockRow(`sed:${game.authors_collective}`, game.authors_collective);
  if (!row) {
    console.warn(`[${game.name}] sed:${game.authors_collective} not found; no authors registered`);
    return [];
  }
  const block = row.block as Record<string, any>;
  // Walk floor-2+ positions. Naive: iterate keys "1" to "9" recursively. The
  // BSP semantics give us position "11" at block.1.1, "12" at block.1.2, etc.
  // For the compressor we don't need to walk arbitrarily deep — we just need
  // the positions that have content beyond the structural underscore.
  const authors: Author[] = [];

  function visit(node: any, addressPrefix: string) {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (key === '_') continue;
      const sub = node[key];
      const address = addressPrefix + key;
      // A registered position has shape { _: { _: declaration, 1: shell_ref? } } or { _: declaration }
      if (sub && typeof sub === 'object') {
        const inner = sub._;
        // Declaration is either inner (string) or inner._ (string) for shell_ref-augmented form.
        const declarationText: string | undefined =
          typeof inner === 'string' ? inner :
          (inner && typeof inner === 'object' && typeof inner._ === 'string') ? inner._ : undefined;
        if (declarationText) {
          // Parse: "name | observations: <agent>/<block> | role: <role>"
          const obsMatch = declarationText.match(/observations:\s*([^\s/|]+)\/([^\s|]+)/);
          if (obsMatch) {
            authors.push({
              position: address,
              agent_id: obsMatch[1],
              observations_block: obsMatch[2],
            });
            continue; // don't recurse into a registered position
          }
        }
        // Otherwise recurse — could be a structural sub-tree.
        visit(sub, address);
      }
    }
  }

  visit(block, '');
  return authors;
}

// ── Cursor management (per-author timestamps in world block @ 9) ──

function getCursors(worldBlock: any): Record<string, string> {
  const nine = worldBlock?.['9'];
  if (!nine || typeof nine !== 'object') return {};
  const lc = nine.last_compression;
  if (lc && typeof lc === 'object') return { ...lc };
  return {};
}

function setCursors(worldBlock: any, cursors: Record<string, string>) {
  if (!worldBlock['9'] || typeof worldBlock['9'] !== 'object') worldBlock['9'] = {};
  worldBlock['9'].last_compression = cursors;
}

// ── Observation parsing ──

const OBSERVATION_RE = /^([A-Za-z][A-Za-z0-9_-]*-world(?:@[0-9.]+)?)\s*[—\-:]\s*(.+)$/;

/**
 * Walk an observation block and pull out (position, target, detail, ts) tuples.
 * The block grows like memory; positions hold strings of shape
 *   "thornkeep-world@2 — Ennick the hawker sells salted cod ..."
 *
 * ts: best-effort. The substrate doesn't store per-position timestamps;
 * we use the block's updated_at as a coarse proxy and rely on the position
 * order (numerical address) for ordering within a block. The cursor stores
 * the highest position-address seen rather than a true timestamp.
 *
 * Returns observations newer than the given cursor (lex-sorted by address).
 */
async function loadNewObservations(
  author: Author,
  cursorPosition: string | undefined,
): Promise<Observation[]> {
  const row = await loadBlockRow(author.agent_id, author.observations_block);
  if (!row) return [];
  const block = row.block as Record<string, any>;

  const observations: Observation[] = [];

  function visit(node: any, addressPrefix: string) {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (key === '_') continue;
      const sub = node[key];
      const address = addressPrefix + key;
      if (typeof sub === 'string') {
        const m = sub.match(OBSERVATION_RE);
        if (m) {
          observations.push({
            position: address,
            target: m[1],
            detail: m[2].trim(),
            ts: row.updated_at,
          });
        }
      } else if (sub && typeof sub === 'object') {
        visit(sub, address);
      }
    }
  }
  visit(block, '');

  // Filter: position > cursor (numeric compare on address as a number)
  if (cursorPosition) {
    const cur = parseInt(cursorPosition, 10);
    return observations.filter(o => parseInt(o.position, 10) > cur);
  }
  return observations;
}

// ── LLM integration ──

async function integrateRoom(
  game: GameConfig,
  rulesBlock: any,
  worldBlock: any,
  targetAddress: string,
  observations: Observation[],
): Promise<string> {
  const currentRoom = readAddressFromBlock(worldBlock, targetAddress);
  const rules = JSON.stringify(rulesBlock, null, 2);

  const system = `You are the world compressor for ${game.name}. Your job is to integrate canon-candidate observations from authorised authors into the world description for a specific room or location. The output is the NEW description for that room — a complete replacement, not a delta.

Rules:
- Preserve everything in the current description that is still consistent with the observations
- Add the canonical detail from the observations naturally — as if the room always had this detail
- DO NOT invent detail not present in observations
- DO NOT contradict the rules block
- Keep the same voice/style as the current description
- Output ONLY the new room description text — no preamble, no commentary

Rules block (live):
${rules}`;

  const obsList = observations
    .map(o => `[author: ${o.position} from ${o.target}] ${o.detail}`)
    .join('\n');

  const user = `Current room description (target: ${targetAddress}):
${currentRoom ?? '(empty — this room has no description yet)'}

Observations from authors to integrate (canon-candidate detail):
${obsList}

Write the new room description now. ONLY the description text.`;

  const response = await anthropic.messages.create({
    model: LLM_MODEL,
    max_tokens: 800,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const part = response.content[0];
  if (part.type !== 'text') throw new Error('Non-text LLM response');
  return part.text.trim();
}

/** Resolve an address like "2" or "1.3" within a world block, returning the room text or null. */
function readAddressFromBlock(block: any, address: string): string | null {
  // Strip the world-block prefix if present (e.g. "thornkeep-world@2" → "2")
  const addr = address.includes('@') ? address.split('@')[1] : address;
  const parts = addr.split('.');
  let node: any = block;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[p];
  }
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof node._ === 'string') return node._;
  return null;
}

// ── Per-game tick ──

async function tickGame(game: GameConfig) {
  console.log(`\n[${game.name}] tick`);
  const gmSecret = gmSecretFor(game);

  const authors = await loadAuthors(game);
  if (authors.length === 0) {
    console.log(`  (no authors registered; skipping)`);
    return;
  }
  console.log(`  authors: ${authors.map(a => `${a.position}/${a.agent_id}`).join(', ')}`);

  const worldRow = await loadBlockRow(game.gm_agent_id, game.world_block);
  const rulesRow = await loadBlockRow(game.gm_agent_id, game.rules_block);
  if (!worldRow) { console.warn(`  world block missing; skipping`); return; }
  if (!rulesRow) { console.warn(`  rules block missing; skipping`); return; }

  const worldBlock = worldRow.block as Record<string, any>;
  const rulesBlock = rulesRow.block as Record<string, any>;
  const cursors = getCursors(worldBlock);

  let anythingChanged = false;
  // Group all new observations across authors by target address.
  const byTarget: Record<string, Observation[]> = {};
  const advancedCursors: Record<string, string> = { ...cursors };

  for (const author of authors) {
    const cur = cursors[author.agent_id];
    const newObs = await loadNewObservations(author, cur);
    if (newObs.length === 0) {
      console.log(`  ${author.agent_id}: no new observations`);
      continue;
    }
    console.log(`  ${author.agent_id}: ${newObs.length} new observation(s)`);
    for (const o of newObs) {
      (byTarget[o.target] ||= []).push(o);
    }
    // Advance cursor to the highest position seen for this author (numeric).
    const maxPos = newObs
      .map(o => parseInt(o.position, 10))
      .reduce((a, b) => Math.max(a, b), parseInt(cur ?? '0', 10));
    advancedCursors[author.agent_id] = String(maxPos);
  }

  if (Object.keys(byTarget).length === 0) {
    console.log(`  (nothing to integrate)`);
    return;
  }

  // For each target room, integrate.
  for (const [target, obs] of Object.entries(byTarget)) {
    const addr = target.includes('@') ? target.split('@')[1] : target;
    console.log(`  integrating ${obs.length} obs into ${target} (address ${addr})`);
    let integrated: string;
    try {
      integrated = await integrateRoom(game, rulesBlock, worldBlock, target, obs);
    } catch (e: any) {
      console.error(`    LLM failed: ${e.message}; skipping this target`);
      continue;
    }
    // Write through the substrate (locks honoured via secret).
    const wr = await handleWrite({
      agent_id: game.gm_agent_id,
      name: game.world_block,
      address: addr,
      content: integrated,
      secret: gmSecret,
    });
    const out = wr.content[0].text;
    if (out.startsWith('Written')) {
      console.log(`    ✓ wrote ${target}`);
      anythingChanged = true;
      // Refresh worldBlock so subsequent integrations see the updated state.
      const refreshed = await loadBlockRow(game.gm_agent_id, game.world_block);
      if (refreshed) Object.assign(worldBlock, refreshed.block);
    } else {
      console.error(`    ✗ write failed: ${out}`);
    }
  }

  if (anythingChanged) {
    // Persist cursors via direct upsert so we don't fight the lock with a non-content write.
    setCursors(worldBlock, advancedCursors);
    const client = getClient();
    const { error } = await client
      .from('pscale_blocks')
      .upsert({
        owner_id: game.gm_agent_id,
        name: game.world_block,
        block_type: (await loadBlockRow(game.gm_agent_id, game.world_block))!.block ? 'general' : 'general',
        block: worldBlock,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'owner_id,name' });
    if (error) console.error(`  ✗ cursor persist failed: ${error.message}`);
    else console.log(`  ✓ cursors advanced: ${JSON.stringify(advancedCursors)}`);
  }
}

async function tick() {
  for (const g of config.games) {
    try { await tickGame(g); }
    catch (e: any) { console.error(`[${g.name}] tick error:`, e.message); }
  }
}

async function main() {
  console.log(`=== world compressor ===`);
  console.log(`games: ${config.games.map(g => g.name).join(', ')}`);
  console.log(`one-shot: ${ONESHOT}`);
  console.log(`poll interval: ${POLL_INTERVAL_SECONDS}s`);
  console.log(`LLM: ${LLM_MODEL}\n`);

  if (ONESHOT) {
    await tick();
    return;
  }

  while (true) {
    try { await tick(); }
    catch (e: any) { console.error('[tick] unhandled:', e.message); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));
  }
}

main();
