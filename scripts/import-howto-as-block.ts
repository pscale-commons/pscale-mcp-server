#!/usr/bin/env tsx
/**
 * Mirror src/howto.json into a pscale_blocks row so it's walkable via
 * pscale_walk for clients (notably claude.ai) that don't expose the MCP
 * resources/read capability.
 *
 * After running this, both paths work:
 *   - resources/read at URI pscale://howto          (for Claude Desktop, Cursor, etc.)
 *   - pscale_walk agent_id='pscale-howto' name='howto' address='4.1.1'  (for claude.ai)
 *
 * Re-run when src/howto.json changes. Upsert is keyed on (owner_id, name).
 *
 * Usage:
 *   SUPABASE_ANON_KEY=<key> npx tsx scripts/import-howto-as-block.ts
 */

import { createClient } from '@supabase/supabase-js';
import howto from '../src/howto.json' with { type: 'json' };

const supabaseUrl = process.env.SUPABASE_URL || 'https://piqxyfmzzywxzqkzmpmm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error('Missing SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const OWNER_ID = 'pscale-howto';
const NAME = 'howto';

const client = createClient(supabaseUrl, supabaseKey);

const { data, error } = await client
  .from('pscale_blocks')
  .upsert(
    {
      owner_id: OWNER_ID,
      name: NAME,
      block_type: 'general',
      block: howto,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_id,name' },
  )
  .select()
  .single();

if (error) {
  console.error('Upsert failed:', error.message);
  process.exit(1);
}

console.log(`✓ Imported howto.json as block (${OWNER_ID}/${NAME})`);
console.log(`  Walkable via: pscale_walk agent_id='${OWNER_ID}' name='${NAME}' address='4.1.1'`);
console.log(`  Row id: ${data.id}`);
