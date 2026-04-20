import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import howto from '../howto.json' with { type: 'json' };

export function registerHowto(server: McpServer) {
  server.resource(
    'pscale_howto',
    'pscale://howto',
    {
      description:
        "Operational runbooks for the pscale network — one pscale block, each numbered branch a self-contained how-to. Current branches: 1 publish passport, 2 use the beach, 3 use memory, 4 gray encryption, 5 first contact, 6 form a grain, 7 register in a sedimentary collective, 8 probe + rider + verify, 9 infrastructure (.well-known beach + beach-crab). For relational progression (where am I in the network), call pscale_invite instead. For the pscale block format itself, read pscale://starstone. New runbooks go in as new branches — no new tool needed.",
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
