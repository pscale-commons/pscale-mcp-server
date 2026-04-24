import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const hash = (pp: string, coll: string, pos: string) =>
  createHash('sha256').update(pp + coll + pos).digest('hex');

const h = {
  "0": hash('freedom142', 'conventions', '0'),
  "1": hash('comber857', 'conventions', '1'),
  "2": hash('comber857', 'conventions', '2'),
  "3": hash('comber857', 'conventions', '3'),
  "4": hash('comber857', 'conventions', '4'),
  "5": hash('ubarakar142', 'conventions', '5'),
  "6": hash('comber857', 'conventions', '6'),
};

const c = createClient('https://piqxyfmzzywxzqkzmpmm.supabase.co', process.env.SUPABASE_ANON_KEY!);
const { error } = await c.from('pscale_blocks')
  .update({ position_hashes: h, updated_at: new Date().toISOString() })
  .eq('owner_id', 'sed:conventions').eq('name', 'conventions');
if (error) { console.error(error); process.exit(1); }
console.log('hashes fixed');
