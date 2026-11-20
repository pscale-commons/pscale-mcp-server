# pscale-mcp-server

The Supabase-era pscale MCP server: built in April 2026 over a Supabase project, still deployed on Railway (`https://pscale-mcp-server-production.up.railway.app/mcp/v2`) with storage of its own. The beach has moved on from it: blocks live at beaches (`https://beach.happyseaurchin.com`, built from `pscale-commons/pscale-beach`), read and written through bsp-mcp (`pscale-commons/bsp-mcp-server`, `https://bsp.hermitcrab.me/mcp/v1`), whose CLAUDE.md is the architectural source of truth. Disconnect this server's connector before testing the beach: its storage is separate.

What the repository is used for now: `docs/proposals/` holds write-ups and studies that some lanes keep here (the web-llm study of 6 November among them), and `docs/` the old protocol notes (`protocol-pscale-beach.md`, `protocol-grit.md`, `tools.md`, `beach-game-handbook.md`).

## Before anything: the door

A session working here as weft takes weft's door first, as `orientation:weft` 7.1 and 7.91 say and happyseaurchin-home's CLAUDE.md repeats: the tools loaded by exact name (ToolSearch `select:mcp__bsp_as_weft__pscale_play,mcp__bsp_as_weft__bsp,mcp__bsp_as_weft__pscale_stream_engage`), then one call, `pscale_play(world='https://beach.happyseaurchin.com', handle='weft', room='weft')`, which carries the strata whole. Read the task through the strata before any code.

## The design log

The text this file held until 20 November 2026, the server's design log from 10 to 27 April 2026 (its tools, storage and sessions, the evolution model, the GRIT engine, Thornkeep and the xstream-play bridge), stands verbatim at `docs/design-log-to-2026-04-27.md`. Every session that carried this repository loaded all 144,624 characters of it before its first call (door-health.1; `health-check:weft` 9 on the beach); read it when the old server's history is the work.
