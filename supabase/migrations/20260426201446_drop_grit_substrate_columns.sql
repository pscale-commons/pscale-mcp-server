-- Drop the inert metadata left over from the substrate-baked GRIT round engine
-- (21 April 2026, removed from pool-ops.ts on 25 April 2026).
--
-- GRIT is now a convention layer (docs/protocol-grit.md, scripts/grit-resolver.ts).
-- The convention layer reads only message text — it does NOT use these columns.
-- Leaving them in place invites future sessions to mistakenly build against them
-- (the recurring "kill the old table" lesson — same as sand_passports).
--
-- Also drops last_compression_at from the 23 April observations DDL: the revised
-- plan stores observations in per-author locked blocks (not the pool), so
-- compression timestamps move to the world block or per-author tracking.
--
-- valid_message_type constraint: rebuild without 'event', 'contribution',
-- 'observation'. The convention-layer GRIT event uses message_type='liquid'
-- with a [GRIT EVENT ...] prefix in the content; no enum value needed.

ALTER TABLE pool_state
  DROP COLUMN IF EXISTS round_duration_seconds,
  DROP COLUMN IF EXISTS current_round_id,
  DROP COLUMN IF EXISTS current_round_state,
  DROP COLUMN IF EXISTS current_round_opened_at,
  DROP COLUMN IF EXISTS last_confirmed_round_id,
  DROP COLUMN IF EXISTS last_confirmed_at,
  DROP COLUMN IF EXISTS last_compression_at;

ALTER TABLE pool_contributions
  DROP COLUMN IF EXISTS round_id;

-- Reconcile historical 'event' rows (5 chronicle entries from the 21-25 April
-- substrate engine, before the convention-layer prefix existed). Flip
-- message_type to 'liquid'; content is preserved untouched. They remain
-- readable chronicle; no re-resolution is meaningful for windows that closed
-- weeks ago.
UPDATE pool_contributions SET message_type = 'liquid'
  WHERE message_type IN ('event', 'contribution', 'observation');

ALTER TABLE pool_contributions DROP CONSTRAINT IF EXISTS valid_message_type;
ALTER TABLE pool_contributions ADD CONSTRAINT valid_message_type
  CHECK (message_type = ANY (ARRAY[
    'chat'::text,
    'join'::text,
    'leave'::text,
    'system'::text,
    'liquid'::text
  ]));
