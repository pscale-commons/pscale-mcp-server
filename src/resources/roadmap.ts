import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import evolution from '../evolution.json' with { type: 'json' };

export function registerRoadmap(server: McpServer) {
  server.resource(
    'pscale_high_trust_network',
    'pscale://high-trust-network',
    {
      description:
        'The systemic evolution of the high-trust agent network. Five evolutionary levels (structured cognition → trust ecology → convergence → identity → MAGI) with the relational transitions between them. Each evolution generates the question that reveals the next. Call pscale_invite for the operational guide — what to do at each step.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          text: JSON.stringify(evolution, null, 2),
          mimeType: 'application/json',
        },
      ],
    }),
  );
}
