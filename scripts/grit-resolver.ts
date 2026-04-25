#!/usr/bin/env tsx
/**
 * GRIT resolver — convention-layer rebuild (2026-04-25).
 *
 * After the substrate cleanup that returned pool-ops.ts to its primitive
 * shape, GRIT lives entirely in agent-side discipline. This script polls
 * each configured game pool, detects closeable windows by inspecting the
 * contribution stream, synthesises with an LLM, and posts the resolution
 * as a normal liquid contribution prefixed `[GRIT EVENT resolves=...]`.
 *
 * No server-side rounds, no inbox dispatch, no message_type column.
 * See docs/protocol-grit.md for the convention.
 *
 * Loop:
 *   every POLL_INTERVAL_SECONDS:
 *     for each game:
 *       rows = pool_read(resolver_id, game.url)
 *       window_start = first liquid timestamp after the most recent event
 *       if (now - window_start) < game.window_seconds: skip (window still open)
 *       contributor_ids = liquid agents in [window_start, now]
 *       if resolver_id in contributor_ids: skip (fairness — convention)
 *       re-read pool; if a [GRIT EVENT resolves=window_start] already exists: skip (race tolerance)
 *       synthesise with LLM (rules + world blocks + window liquid)
 *       pool_send(content="[GRIT EVENT resolves=<ts> window=<s>s]\n<synthesis>")
 *
 * Config:
 *   .env:
 *     ANTHROPIC_API_KEY     — for LLM synthesis (Haiku recommended)
 *     SUPABASE_ANON_KEY     — pscale relay access
 *     GRIT_RESOLVER_AGENT   — agent_id for this crab, e.g. "crab-thornkeep"
 *     GRIT_GAMES_CONFIG     — path to JSON with game list
 *
 * GRIT_GAMES_CONFIG example (games.json):
 *   {
 *     "games": [
 *       {
 *         "name": "thornkeep",
 *         "url": "https://play.onen.ai/thornkeep",
 *         "gm_agent_id": "thornkeep-gm",
 *         "rules_block": "thornkeep-rules",
 *         "world_block": "thornkeep-world",
 *         "window_seconds": 60
 *       }
 *     ]
 *   }
 *
 * On startup: subscribes to each game's pool (pool_join) so the resolver
 * has a read marker and can call pool_read.
 *
 * Usage:
 *   SUPABASE_ANON_KEY=... ANTHROPIC_API_KEY=... GRIT_RESOLVER_AGENT=crab-thornkeep \
 *   GRIT_GAMES_CONFIG=games.json npx tsx scripts/grit-resolver.ts
 */

import { handlePoolJoin, handlePoolSend, handlePoolRead } from '../src/tools/pool-ops.js';
import { getClient } from '../src/db.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

const POLL_INTERVAL_SECONDS = 30;
const LLM_MODEL = 'claude-haiku-4-5-20251001';
const EVENT_PREFIX_RE = /^\[GRIT EVENT(?:\s+resolves=([^\s\]]+))?(?:\s+window=([^\s\]]+))?\]/;

const RESOLVER_AGENT = process.env.GRIT_RESOLVER_AGENT;
const GAMES_CONFIG_PATH = process.env.GRIT_GAMES_CONFIG;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!RESOLVER_AGENT) {
  console.error("GRIT_RESOLVER_AGENT is required (the resolver's agent_id)");
  process.exit(1);
}
if (!GAMES_CONFIG_PATH) {
  console.error('GRIT_GAMES_CONFIG is required (path to games config JSON)');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

interface GameConfig {
  name: string;
  url: string;
  gm_agent_id: string;
  rules_block: string;
  world_block: string;
  window_seconds?: number;
}

const config: { games: GameConfig[] } = JSON.parse(readFileSync(GAMES_CONFIG_PATH, 'utf-8'));
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const DEFAULT_WINDOW_SECONDS = 60;

function parse(r: any) { return JSON.parse(r.content[0].text); }

function isEvent(message: string): boolean {
  return EVENT_PREFIX_RE.test(message);
}

function eventResolvesAt(message: string): string | null {
  const m = message.match(EVENT_PREFIX_RE);
  return m ? (m[1] ?? null) : null;
}

// ── Boot ──

async function subscribeToGames() {
  for (const game of config.games) {
    const window = game.window_seconds ?? DEFAULT_WINDOW_SECONDS;
    console.log(`[boot] subscribing to ${game.name} at ${game.url} (window=${window}s)`);
    await handlePoolJoin({
      agent_id: RESOLVER_AGENT!,
      url: game.url,
      purpose: `${RESOLVER_AGENT} — GRIT resolver (window=${window}s, never contributes liquid, only emits events)`,
    });
  }
}

// ── Per-game helpers: load rules/world blocks ──

async function loadBlock(owner_id: string, name: string): Promise<Record<string, any> | null> {
  const client = getClient();
  const { data } = await client
    .from('pscale_blocks')
    .select('block')
    .eq('owner_id', owner_id)
    .eq('name', name)
    .single();
  return data ? ((data as any).block as Record<string, any>) : null;
}

// ── LLM synthesis ──

async function synthesise(
  game: GameConfig,
  windowLiquid: Array<{ agent_id: string; message: string; created_at: string }>,
  contributors: string[],
): Promise<string> {
  const rules = await loadBlock(game.gm_agent_id, game.rules_block);
  const world = await loadBlock(game.gm_agent_id, game.world_block);

  const system = `You are the impartial resolver for a beach-game round in ${game.name}. You did not contribute to this round. Your job is to synthesise the window of character actions into a single coherent event paragraph that:
- Resolves the ENTIRE window together (not one action cherry-picked)
- Stays strictly within the rules
- Is written in third person, present tense
- Names outcomes that were left open by the liquid (what happens, what the environment or other characters do in response)
- Does NOT invent actions by any of the listed contributors beyond responding to what their liquid described
- Is ONE paragraph. No lists, no preamble. Just the paragraph.

Rules block (live):
${JSON.stringify(rules, null, 2)}

World block (live):
${JSON.stringify(world, null, 2)}

Contributors for this round (you are NOT one of them):
${contributors.join(', ')}`;

  const user = `Window liquid (chronological):

${windowLiquid.map(l => `[${l.created_at}] ${l.agent_id}: ${l.message}`).join('\n')}

Write the resolution paragraph now.`;

  const response = await anthropic.messages.create({
    model: LLM_MODEL,
    max_tokens: 600,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content[0];
  if (text.type !== 'text') throw new Error('Non-text response from LLM');
  return text.text.trim();
}

// ── Per-game tick ──

async function tickGame(game: GameConfig) {
  const windowSeconds = game.window_seconds ?? DEFAULT_WINDOW_SECONDS;

  // Read the pool from the start of time (since=epoch) so we always see the
  // full chronological picture for window-detection. Read marker advances
  // anyway; we just don't rely on it for windowing.
  const result = parse(await handlePoolRead({
    agent_id: RESOLVER_AGENT!,
    url: game.url,
    since: '1970-01-01T00:00:00Z',
  }));

  if (!result.active) {
    console.warn(`[${game.name}] pool not active (TTL'd?) — skipping`);
    return;
  }

  const contributions = (result.contributions || []) as Array<{
    agent_id: string;
    message: string;
    message_type: string;
    created_at: string;
  }>;

  // 1. Find the most recent event boundary
  let lastEventIdx = -1;
  for (let i = contributions.length - 1; i >= 0; i--) {
    if (isEvent(contributions[i].message)) {
      lastEventIdx = i;
      break;
    }
  }

  // 2. Window = liquid (non-event, non-join) after the last event
  const windowRows = contributions
    .slice(lastEventIdx + 1)
    .filter(r => !isEvent(r.message) && r.message_type !== 'join');

  if (windowRows.length === 0) return; // nothing to resolve

  const windowStart = windowRows[0].created_at;
  const elapsedMs = Date.now() - new Date(windowStart).getTime();
  if (elapsedMs < windowSeconds * 1000) return; // window still open

  // 3. Fairness — convention: don't resolve a window we contributed to
  const contributorIds = Array.from(new Set(windowRows.map(r => r.agent_id)));
  if (contributorIds.includes(RESOLVER_AGENT!)) {
    console.log(`[${game.name}] window since ${windowStart}: resolver is in contributors, abstaining`);
    return;
  }

  // 4. Race tolerance — re-read just before writing; if anyone else already
  //    resolved this window, defer.
  const recheck = parse(await handlePoolRead({
    agent_id: RESOLVER_AGENT!,
    url: game.url,
    since: windowStart,
  }));
  const recheckRows = (recheck.contributions || []) as Array<{ message: string }>;
  if (recheckRows.some(r => eventResolvesAt(r.message) === windowStart)) {
    console.log(`[${game.name}] window since ${windowStart}: already resolved by another agent`);
    return;
  }

  // 5. Synthesise + post
  console.log(`[${game.name}] window since ${windowStart}: ${windowRows.length} liquid entries, contributors=${contributorIds.join(',')}`);

  let synthesis: string;
  try {
    synthesis = await synthesise(game, windowRows, contributorIds);
  } catch (e: any) {
    console.error(`[${game.name}] LLM synthesis failed:`, e.message);
    return;
  }

  const body = `[GRIT EVENT resolves=${windowStart} window=${windowSeconds}s]\n${synthesis}`;
  const sendResult = parse(await handlePoolSend({
    agent_id: RESOLVER_AGENT!,
    url: game.url,
    content: body,
  }));

  if (sendResult.contributed) {
    console.log(`[${game.name}] ✓ event posted for window ${windowStart}`);
  } else {
    console.warn(`[${game.name}] event post failed:`, sendResult);
  }
}

async function tick() {
  for (const game of config.games) {
    try { await tickGame(game); }
    catch (e: any) { console.error(`[${game.name}] tick error:`, e.message); }
  }
}

async function main() {
  console.log(`=== GRIT resolver (convention layer): ${RESOLVER_AGENT} ===`);
  console.log(`Games:`, config.games.map(g => `${g.name} @ ${g.url} (window=${g.window_seconds ?? DEFAULT_WINDOW_SECONDS}s)`).join(', '));
  console.log(`Poll interval: ${POLL_INTERVAL_SECONDS}s`);
  console.log(`LLM: ${LLM_MODEL}\n`);

  await subscribeToGames();

  while (true) {
    try { await tick(); }
    catch (e: any) { console.error('[tick] unhandled error:', e.message); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));
  }
}

main();
