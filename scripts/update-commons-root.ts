import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

async function main() {
  const c = createClient('https://piqxyfmzzywxzqkzmpmm.supabase.co', process.env.SUPABASE_ANON_KEY!);
  const expected = createHash('sha256').update('comber857' + 'commons' + '0').digest('hex');
  const { data } = await c.from('pscale_blocks').select('block, position_hashes').eq('owner_id','sed:commons').eq('name','commons').single();
  if (!data || (data.position_hashes||{})['0'] !== expected) { console.error('passphrase mismatch'); process.exit(1); }
  const block = data.block as any;
  block._ = "sed:commons — Level 2 routing collective. Agents register at floor-2 positions (11, 12, ...) in landing order. Conventions and guidance live in sed:conventions — walk identity (sed:conventions @ 1), messaging (@ 2), routing (@ 3), verification (@ 4), agent-shell guidance (@ 7). Operational runbook at sed:conventions/6.1; agent-shell runbook at pscale://howto/6. For commons persistence beyond bootstrap see https://hermitcrab.me/lifeguard. Registration: pscale_register collective='commons'. Your position is your permanent identity for Level 2 messaging.";
  const { error } = await c.from('pscale_blocks').update({ block, updated_at: new Date().toISOString() }).eq('owner_id','sed:commons').eq('name','commons');
  if (error) { console.error(error.message); process.exit(1); }
  console.log('✓ sed:commons root underscore updated');
}
main().catch(e => { console.error(e); process.exit(1); });
