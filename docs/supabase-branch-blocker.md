# Supabase branch creation is blocked — fix required upstream

**Status**: Unresolved as of 18 April 2026.
**Impact**: Supabase branch-based dev isolation is unavailable for the xstream project (`piqxyfmzzywxzqkzmpmm`). Any branch fails migrations at step 1.
**Fix location**: Upstream migrations repo (likely `xstream-play`, where the Onen migrations are authored).

---

## TL;DR

The first migration in the chain (`20260402 add_paid_and_saved_games`) runs:

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS paid boolean DEFAULT false
```

`public.users` exists on the `main` branch (legacy Onen table, created outside the migration chain long ago) but does **not** exist on a fresh branch. The migration therefore errors:

```
ERROR: relation "public.users" does not exist
```

Status becomes `MIGRATIONS_FAILED`. Only the first applied migration (`beach_marks`) lands. The remaining 9 migrations never run. The branch is unusable for testing pscale MCP because `pscale_blocks`, `sand_inbox`, `beach_marks` indexes, `pool_state`, `position_hashes`, etc. are missing.

---

## Verified reproduction (18 April 2026)

Steps:

1. `mcp__supabase__create_branch` against `piqxyfmzzywxzqkzmpmm` with any name.
2. Wait ~2 minutes.
3. `mcp__supabase__list_branches` — new branch shows `status: "MIGRATIONS_FAILED"`, `preview_project_status: "ACTIVE_HEALTHY"` (postgres is up; the migrations are what failed).
4. `mcp__supabase__list_migrations` on the new branch — returns only `[{"version":"20260402155557","name":"beach_marks"}]`. Main has 11 migrations.
5. `mcp__supabase__get_logs` with `service: "postgres"` — shows:

```
ERROR  relation "public.users" does not exist
LOG    execute <unnamed>: -- Add paid column to users
       ALTER TABLE public.users ADD COLUMN IF NOT EXISTS paid boolean DEFAULT false
```

This has happened twice (the earlier `fresh-build-db` branch created January 2026 hit the same state; `dev` created today hit the same state).

---

## Full migration chain on main (for reference)

```
20260402         add_paid_and_saved_games           <-- fails on fresh branch
20260402155557   beach_marks                         <-- the only one that applies
20260410095335   create_pscale_blocks               <-- never reached
20260410095342   create_sand_passports              <-- never reached
20260410095706   create_sand_inbox                  <-- never reached
20260414145631   create_lobby_messages              <-- never reached
20260414160325   add_lobby_messages_indexes         <-- never reached
20260414180831   create_lobby_state_and_read_markers <-- never reached
20260414182438   rename_lobby_to_pool               <-- never reached
20260415205855   add_position_hashes_to_pscale_blocks <-- never reached
20260416084811   create_beach_subscriptions         <-- never reached
```

---

## Root cause

`public.users` was created on the production database at some point outside the migration chain (probably when the Onen product was first built on this Supabase project). Subsequent migrations assume it exists. Supabase's branching creates a **fresh** database and replays the migration chain from scratch — nothing outside the chain comes along. So the assumption breaks.

This is not a Supabase bug; it's a migration hygiene problem in the upstream repo.

---

## Proposed fix

Wrap the `ALTER TABLE public.users` statements in a guard so the migration no-ops on fresh DBs and still works on main (where `IF NOT EXISTS` on the column handles re-application):

```sql
-- Add paid column to users (tolerant of missing table on fresh branches)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS paid boolean DEFAULT false;
    -- add whatever other columns the migration originally set here
  END IF;
END $$;
```

If the migration file also touches `saved_games` or similar, wrap those statements in the same guard.

Alternative: if `public.users` is actually meant to be part of the schema, add an earlier migration that creates it:

```sql
-- Create users table (canonical — predates any column alters)
CREATE TABLE IF NOT EXISTS public.users (
  -- ... original columns as they exist on main today ...
);
```

Then the later `ALTER` runs harmlessly. This is cleaner but requires knowing the original table definition — run `\d public.users` against production to capture it first.

**Recommendation**: the guard approach. It's smaller, doesn't assume anything about the Onen data model, and ships the existing behaviour exactly as it was on main.

---

## Where to make the change

The migration files aren't in the `pscale-mcp-server` repo. They likely live in:

- `xstream-play` repo (the parent project that originated the xstream Supabase project), or
- Directly in the Supabase dashboard's migration editor.

Start with `git grep 'add_paid_and_saved_games'` in whichever repo owns xstream's migrations. If nothing, check the Supabase dashboard → Database → Migrations.

---

## Acceptance criteria

A new branch created via `mcp__supabase__create_branch` reaches `status: "FUNCTIONS_DEPLOYED"` (or similar healthy state) and `mcp__supabase__list_migrations` against the branch returns all 11 migrations, matching main.

Smoke test after that lands:

1. Create a branch named `dev-test`.
2. Wait 2 minutes.
3. Confirm all 11 migrations applied on the branch.
4. Query the branch: `execute_sql('SELECT COUNT(*) FROM pscale_blocks')` should return 0 (empty but table exists).
5. Delete the branch.

---

## Until it's fixed

Use naming-prefix convention for smoke tests on the shared database:

- Agent IDs: `test-...`, `smoke-...`
- Block names: `test-...`, `smoke-...`
- Never reuse real agent names / real `sed:` addresses in smoke tests

This isn't isolation — it's a naming convention that avoids collisions. Good enough for small-scale development but insufficient for multi-agent Level 2 stress testing, which is the point at which this blocker becomes urgent to unblock.

---

## Evidence captured during today's diagnosis

Logs, migration lists, and branch statuses from the failed creation attempt are reproducible via the `mcp__supabase__*` tools listed above. The session that created this doc also verified that:

- Deleting both failed branches (`fresh-build-db`, `dev`) stops billing — Supabase bills per-branch-hour, not per create event.
- Main (`piqxyfmzzywxzqkzmpmm`) is unaffected and healthy throughout.
