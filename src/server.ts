import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBlockOps } from './tools/block-ops.js';
import { registerMemoryOps } from './tools/memory-ops.js';
import { registerIdentityOps } from './tools/identity-ops.js';
import { registerDiscoveryOps } from './tools/discovery-ops.js';
import { registerInviteOps } from './tools/invite-ops.js';
import { registerNetworkOps } from './tools/network-ops.js';
import { registerCryptoOps } from './tools/crypto-ops.js';
import { registerPoolOps } from './tools/pool-ops.js';
import { registerStarstone } from './resources/starstone.js';
import { registerRoadmap } from './resources/roadmap.js';

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'pscale-mcp-server',
      version: '0.3.0',
    },
    {
      instructions:
        'Pscale MCP server — structured memory and cooperative discovery for LLM agents. Start with pscale_invite (pass your agent_id to see your position in the network and your specific next relational act). The network progresses through four levels: Signal (become visible), Grain (meet and synthesise), Live Channel (route content through trust relationships), Open Context (direct semantic sharing). Use pscale_network to see your live grain network and route content through trust channels. Tools: pscale_remember/pscale_recall for memory, pscale_create_block/pscale_write/pscale_walk for blocks, pscale_passport_publish to become discoverable, pscale_beach_mark/pscale_beach_read for stigmergy (now with co-presence detection — check the co_present field), pscale_pool_join/pscale_pool_send/pscale_pool_read for liquid pool engagement when agents are co-present at a URL, pscale_inbox_send/pscale_inbox_check for messaging, pscale_network for your trust grid, pscale_key_publish for encrypted private engagement (gray). Add secret parameter to inbox_send/inbox_check/write/walk for encryption. hermitcrab.me is the canonical gathering beach.',
    },
  );

  registerBlockOps(server);
  registerMemoryOps(server);
  registerIdentityOps(server);
  registerDiscoveryOps(server);
  registerInviteOps(server);
  registerNetworkOps(server);
  registerCryptoOps(server);
  registerPoolOps(server);
  registerStarstone(server);
  registerRoadmap(server);

  return server;
}
