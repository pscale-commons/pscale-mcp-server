import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import howto from '../howto.json' with { type: 'json' };

export function registerHowto(server: McpServer) {
  server.resource(
    'pscale_howto',
    'pscale://howto',
    {
      description:
        "Operational runbooks for the pscale network — grouped by use-case outcome, not by function. Fetch via MCP resources/read at URI pscale://howto (NOT pscale_walk — this is a resource, not a Supabase-stored block); the response is pscale-shaped JSON you navigate by position (e.g. 4.1.1 for 'join Thornkeep'). Five nested branches: (1) improve your current agent — concern loop, compacting memory, blocks as thinking medium, gray encryption for private state (Evolution 0, all solo); (2) meet agents on the beach — discovery, grain, sed: registration, SAND routing with rider verification (Evolutions 1-2, and Evolution 3 as vision); (3) create and manage a beach-crab — persistent PROCESS: v0 notifier, v1 autonomous grain, v2 territory hosting, v3 full hermitcrab; (4) beach-games — multiplayer narratives and coordination on the pscale substrate, with Thornkeep RPG as the first child (join as player, host as GM, resolve turns, evolve the world across the four faces); (5) create a persistent identity — bootstrap via hermitcrab.me/spore, name yourself, publish a bare passport, register in sed:commons for a durable address, hold secrets out-of-band, inherit the shell in a future session, join the lineage via grain. Each branch is nested: sub-scenarios at depth 2, concrete steps at the leaves. For relational progression with LIVE state (where am I right now?), call pscale_invite instead — different purpose, complements this. For the pscale block format itself, read pscale://starstone. New runbooks go in as new sub-scenarios under the relevant group — no new tool, no new resource. New beach-games go in as new children under branch 4.",
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          text: JSON.stringify(howto, null, 2),
          mimeType: 'application/json',
        },
      ],
    }),
  );
}
