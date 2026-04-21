#!/usr/bin/env tsx
/**
 * GRIT beach-crab resolver — an always-on non-contributor that resolves
 * rounds for a beach-game when live human players aren't available.
 *
 * Loop:
 *   every POLL_INTERVAL_SECONDS:
 *     - pscale_inbox_check for unread messages
 *     - for each message with type=resolution_request:
 *         - parse window_liquid, contributors
 *         - verify not in contributors (server already filtered, but double-check)
 *         - walk the game's rules and world blocks (configured per game)
 *         - call an LLM with the synthesis prompt
 *         - pscale_pool_send message_type=event with resolves_round_id
 *
 * Config:
 *   .env:
 *     ANTHROPIC_API_KEY     — for LLM synthesis (Haiku recommended)
 *     SUPABASE_ANON_KEY     — pscale relay access
 *     GRIT_RESOLVER_AGENT   — agent_id for this crab, e.g. "crab-thornkeep"
 *     GRIT_GAMES_CONFIG     — path to JSON with game list (see below)
 *
 * GRIT_GAMES_CONFIG example (games.json):
 *   {
 *     "games": [
 *       {
 *         "name": "thornkeep",
 *         "url": "https://play.onen.ai/thornkeep",
 *         "gm_agent_id": "thornkeep-gm",
 *         "rules_block": "thornkeep-rules",
 *         "world_block": "thornkeep-world"
 *       }
 *     ]
 *   }
 *
 * On startup: subscribes to each game's pool (pool_join) so the crab appears
 * in pool_read_markers and is eligible to receive resolution_request messages.
 *
 * Usage:
 *   SUPABASE_ANON_KEY=... ANTHROPIC_API_KEY=... GRIT_RESOLVER_AGENT=crab-thornkeep \
 *   GRIT_GAMES_CONFIG=games.json npx tsx scripts/grit-resolver.ts
 */

import { handlePoolJoin, handlePoolSend } from '../src/tools/pool-ops.js';
import { handleInboxCheck } from '../src/tools/discovery-ops.js';
import { getClient } from '../src/db.js';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';

const POLL_INTERVAL_SECONDS = 30;
const LLM_MODEL = 'claude-haiku-4-5-20251001';

const RESOLVER_AGENT = process.env.GRIT_RESOLVER_AGENT;
const GAMES_CONFIG_PATH = process.env.GRIT_GAMES_CONFIG;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!RESOLVER_AGENT) {
  console.error('GRIT_RESOLVER_AGENT is required (the crab\'s agent_id)');
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
}

const config: { games: GameConfig[] } = JSON.parse(readFileSync(GAMES_CONFIG_PATH, 'utf-8'));
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

function parse(r: any) { return JSON.parse(r.content[0].text); }

// ── Boot ──

async function subscribeToGames() {
  for (const game of config.games) {
    console.log(`[boot] subscribing to ${game.name} at ${game.url}`);
    await handlePoolJoin({
      agent_id: RESOLVER_AGENT!,
      url: game.url,
      purpose: `${RESOLVER_AGENT} — GRIT resolver`,
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

function gameFromUrlHash(url_hash_prefix: string): GameConfig | null {
  // resolution_request content carries url_hash; match by prefix in game URL hash
  const { createHash } = require('node:crypto');
  for (const g of config.games) {
    const h = createHash('sha256').update(g.url.trim().toLowerCase()).digest('hex').slice(0, 16);
    if (h.startsWith(url_hash_prefix) || h === url_hash_prefix) return g;
  }
  return null;
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

// ── Main tick ──

async function tick() {
  const result = parse(await handleInboxCheck({
    agent_id: RESOLVER_AGENT!,
    unread_only: true,
  }));

  const messages = result.messages || [];
  if (messages.length === 0) return;

  for (const msg of messages) {
    const type = msg.message?.type;
    if (type !== 'resolution_request') continue;

    let payload: any;
    try { payload = JSON.parse(msg.message.content); }
    catch (e) { console.warn('[tick] failed to parse resolution_request content', e); continue; }

    const { round_id, url_hash, window_liquid, contributors } = payload;
    if (!round_id || !url_hash) { console.warn('[tick] malformed resolution_request, skipping'); continue; }

    if (contributors?.includes(RESOLVER_AGENT)) {
      console.log(`[tick] ${round_id}: crab is in contributors, skipping (shouldn't happen)`);
      continue;
    }

    const game = gameFromUrlHash(url_hash.slice(0, 16));
    if (!game) {
      console.warn(`[tick] ${round_id}: no game config matches url_hash ${url_hash}`);
      continue;
    }

    console.log(`[tick] ${round_id}: resolving for ${game.name} with ${window_liquid.length} liquid entries`);

    let synthesis: string;
    try {
      synthesis = await synthesise(game, window_liquid, contributors);
    } catch (e: any) {
      console.error(`[tick] ${round_id}: LLM synthesis failed:`, e.message);
      continue;
    }

    const sendResult = parse(await handlePoolSend({
      agent_id: RESOLVER_AGENT!,
      url: game.url,
      message_type: 'event',
      resolves_round_id: round_id,
      content: synthesis,
    }));

    if (sendResult.confirmed) {
      console.log(`[tick] ${round_id}: ✓ resolved (notified ${sendResult.contributors_notified?.length ?? 0} contributors)`);
    } else if (sendResult.error?.includes('already resolved')) {
      console.log(`[tick] ${round_id}: already resolved by another resolver (fine)`);
    } else {
      console.warn(`[tick] ${round_id}: event rejected: ${sendResult.error}`);
    }
  }
}

async function main() {
  console.log(`=== GRIT resolver: ${RESOLVER_AGENT} ===`);
  console.log(`Games:`, config.games.map(g => `${g.name} @ ${g.url}`).join(', '));
  console.log(`Poll interval: ${POLL_INTERVAL_SECONDS}s`);
  console.log(`LLM: ${LLM_MODEL}\n`);

  await subscribeToGames();

  // Loop
  while (true) {
    try { await tick(); }
    catch (e: any) { console.error('[tick] unhandled error:', e.message); }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_SECONDS * 1000));
  }
}

main();
