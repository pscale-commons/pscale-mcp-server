import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { bsp, writeAt, type Block } from '../bsp.js';
import { getBlock, upsertBlock, getPassportFromAddress, setTarget } from '../db.js';

const TARGET_DESC = 'Storage target. Filesystem path for local storage, or "supabase" for the relay. Sticky — once set, persists for the session until changed.';

// ── Exported handler functions (used by kernel + legacy registration) ──

export async function handlePassportPublish(
  { agent_id, description, offers, needs, lineage, target }: {
    agent_id: string; description: string; offers?: string; needs?: string; lineage?: string; target?: string;
  },
) {
  if (target) setTarget(target);
  // The passport IS a pscale block. Structure encodes meaning.
  // _  = who you are
  // 1  = what you offer
  // 2  = what you need
  // 3  = lineage (star reference to origin)
  // 9  = public_keys (reserved for infrastructure — written by key_publish)
  //
  // Single source of truth: pscale_blocks where name='passport'.

  // Preserve existing block content (e.g. public_keys at 9, sub-addresses)
  const existing = await getBlock(agent_id, 'passport');
  const block: Block = existing ? { ...(existing.block as Block) } : {};

  block._ = description;
  if (offers) block['1'] = offers;
  if (needs) block['2'] = needs;
  if (lineage) block['3'] = lineage;

  await upsertBlock(agent_id, 'passport', 'general', block);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { published: true, agent_id: agent_id, passport: block },
          null,
          2,
        ),
      },
    ],
  };
}

export async function handlePassportRead(
  { agent_id }: { agent_id: string },
) {
  const passport = await getPassportFromAddress(agent_id);

  if (!passport) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No passport found for agent "${agent_id}".`,
        },
      ],
    };
  }

  const spindle = bsp(passport);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ agent_id, passport, tree: spindle }, null, 2),
      },
    ],
  };
}

// ── Legacy registration (kept for backward compat) ──

export function registerIdentityOps(server: McpServer) {
  server.tool(
    'pscale_passport_publish',
    `Publish your identity as a passport — a pscale block declaring who you are, what you can do, and what you're looking for. Other agents read your passport to assess whether to engage. The passport IS a block: underscore carries your description, digit 1 holds what you offer, digit 2 holds what you need. Navigate it with BSP like any other block.`,
    {
      agent_id: z.string().describe('Your agent identifier'),
      description: z
        .string()
        .describe('Who you are and what you do — becomes the block underscore'),
      offers: z
        .string()
        .optional()
        .describe('What you can provide — becomes digit 1'),
      needs: z
        .string()
        .optional()
        .describe("What you're looking for — becomes digit 2"),
      target: z.string().optional().describe(TARGET_DESC),
    },
    handlePassportPublish,
  );

  server.tool(
    'pscale_passport_read',
    `Read another agent's passport. Accepts bare agent_ids, grain sides (grain:{pair}:{side} → resolves to the underlying agent's passport), and sedimentary positions (sed:{collective}:{position} → returns the registrant's declaration at that position as their passport). Returns a pscale block — walk it with BSP to understand their identity at any depth. Underscore = who they are. Digit 1 = what they offer. Digit 2 = what they need.`,
    {
      agent_id: z.string().describe('Agent to look up. Bare id, grain:{pair}:{side}, or sed:{collective}:{position}.'),
    },
    handlePassportRead,
  );
}
