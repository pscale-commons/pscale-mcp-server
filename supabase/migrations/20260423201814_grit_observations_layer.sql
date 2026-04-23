-- Layer 2 of narrative cohesion: public observation stream.
-- Observations are pool contributions that are NOT actions — they record
-- canonical-candidate detail that players' LLMs noticed and narrated.
-- They don't attach to rounds (no round_id), don't trigger round engine.
-- Layer 3 (world compression) integrates them into world blocks later.

ALTER TABLE pool_contributions DROP CONSTRAINT IF EXISTS valid_message_type;
ALTER TABLE pool_contributions ADD CONSTRAINT valid_message_type
  CHECK (message_type = ANY (ARRAY[
    'chat'::text, 'join'::text, 'leave'::text, 'system'::text,
    'liquid'::text, 'event'::text, 'contribution'::text,
    'observation'::text
  ]));

-- Track when the world block was last compressed from observations.
-- Compressors read observations with created_at > last_compression_at,
-- integrate into the world block(s), and update this timestamp.
ALTER TABLE pool_state
  ADD COLUMN IF NOT EXISTS last_compression_at TIMESTAMPTZ;
