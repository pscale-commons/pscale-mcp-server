import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL || 'https://piqxyfmzzywxzqkzmpmm.supabase.co';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  '';

let client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!client) {
    if (!supabaseKey) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY is required');
    }
    client = createClient(supabaseUrl, supabaseKey);
  }
  return client;
}

// ── Sticky target ──

let currentTarget = 'supabase';

export function setTarget(target: string): void {
  currentTarget = target;
}

export function getTarget(): string {
  return currentTarget;
}

function isLocal(): boolean {
  return currentTarget !== 'supabase';
}

// ── Filesystem helpers ──

function blockPath(ownerId: string, name: string): string {
  return join(currentTarget, ownerId, `${name}.json`);
}

function ensureDir(ownerId: string): void {
  const dir = join(currentTarget, ownerId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

interface LocalBlockFile {
  block_type: string;
  block: Record<string, any>;
  position_hashes: Record<string, string>;
  updated_at: string;
}

function readLocalBlock(ownerId: string, name: string): BlockRow | null {
  const p = blockPath(ownerId, name);
  if (!existsSync(p)) return null;
  const data: LocalBlockFile = JSON.parse(readFileSync(p, 'utf-8'));
  return {
    id: `${ownerId}/${name}`,
    owner_id: ownerId,
    name,
    block_type: data.block_type,
    block: data.block,
    position_hashes: data.position_hashes || {},
    created_at: data.updated_at,
    updated_at: data.updated_at,
  };
}

function writeLocalBlock(ownerId: string, name: string, blockType: string, block: Record<string, any>, positionHashes?: Record<string, string>): BlockRow {
  ensureDir(ownerId);
  const now = new Date().toISOString();
  const existing = readLocalBlock(ownerId, name);
  const data: LocalBlockFile = {
    block_type: blockType,
    block,
    position_hashes: positionHashes ?? existing?.position_hashes ?? {},
    updated_at: now,
  };
  writeFileSync(blockPath(ownerId, name), JSON.stringify(data, null, 2));
  return {
    id: `${ownerId}/${name}`,
    owner_id: ownerId,
    name,
    block_type: blockType,
    block,
    position_hashes: data.position_hashes,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

// ── Block operations (route by target) ──

export interface BlockRow {
  id: string;
  owner_id: string;
  name: string;
  block_type: string;
  block: Record<string, any>;
  position_hashes: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export async function getBlock(ownerId: string, name: string): Promise<BlockRow | null> {
  if (isLocal()) return readLocalBlock(ownerId, name);

  const { data, error } = await getClient()
    .from('pscale_blocks')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('name', name)
    .single();

  if (error && error.code === 'PGRST116') return null; // not found
  if (error) throw new Error(`DB error: ${error.message}`);
  return data as BlockRow;
}

export async function upsertBlock(
  ownerId: string,
  name: string,
  blockType: string,
  block: Record<string, any>,
): Promise<BlockRow> {
  if (isLocal()) return writeLocalBlock(ownerId, name, blockType, block);

  const { data, error } = await getClient()
    .from('pscale_blocks')
    .upsert(
      {
        owner_id: ownerId,
        name,
        block_type: blockType,
        block,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_id,name' },
    )
    .select()
    .single();

  if (error) throw new Error(`DB error: ${error.message}`);
  return data as BlockRow;
}

export async function updatePositionHashes(
  ownerId: string,
  name: string,
  hashes: Record<string, string>,
): Promise<void> {
  if (isLocal()) {
    const existing = readLocalBlock(ownerId, name);
    if (existing) {
      writeLocalBlock(ownerId, name, existing.block_type, existing.block, hashes);
    }
    return;
  }

  const { error } = await getClient()
    .from('pscale_blocks')
    .update({ position_hashes: hashes, updated_at: new Date().toISOString() })
    .eq('owner_id', ownerId)
    .eq('name', name);

  if (error) throw new Error(`DB error: ${error.message}`);
}

/**
 * Get an agent's passport block. Passports are stored as pscale_blocks with name='passport'.
 * Returns the block JSON, or null if no passport exists.
 */
export async function getPassportBlock(agentId: string): Promise<Record<string, any> | null> {
  const row = await getBlock(agentId, 'passport');
  return row ? (row.block as Record<string, any>) : null;
}

/**
 * Get an agent's published public keys from their passport block (address 9).
 * Returns { x25519, ed25519 } or null if no keys published.
 */
export async function getPublicKeys(agentId: string): Promise<{ x25519: string; ed25519: string } | null> {
  const block = await getPassportBlock(agentId);
  if (!block) return null;
  const keys = block['9'];
  if (!keys || typeof keys !== 'object' || !keys.x25519 || !keys.ed25519) return null;
  return { x25519: keys.x25519, ed25519: keys.ed25519 };
}

export async function listBlocks(
  ownerId: string,
  blockType?: string,
): Promise<BlockRow[]> {
  if (isLocal()) {
    const dir = join(currentTarget, ownerId);
    if (!existsSync(dir)) return [];
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const rows: BlockRow[] = [];
    for (const f of files) {
      const name = f.replace(/\.json$/, '');
      const row = readLocalBlock(ownerId, name);
      if (row && (!blockType || row.block_type === blockType)) {
        rows.push(row);
      }
    }
    return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  let query = getClient()
    .from('pscale_blocks')
    .select('*')
    .eq('owner_id', ownerId);

  if (blockType) {
    query = query.eq('block_type', blockType);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw new Error(`DB error: ${error.message}`);
  return (data || []) as BlockRow[];
}
