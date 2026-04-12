import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import invite from '../invite.json' with { type: 'json' };
import { collectUnderscore, getHiddenDirectory } from '../bsp.js';

/**
 * Navigate into the invite block by address string.
 * "2" → invite["2"], "2.3" → invite["2"]["3"], etc.
 */
function navigateBlock(address: string): any {
  const parts = address.split('.');
  let node: any = invite;
  for (const p of parts) {
    if (node == null || typeof node !== 'object' || !(p in node)) return null;
    node = node[p];
  }
  return node;
}

/**
 * Check if a node has sub-steps (object children at digit keys)
 * vs just string parameter hints.
 */
function hasSubSteps(node: any): boolean {
  for (const d of '123456789') {
    if (d in node && typeof node[d] === 'object' && node[d] !== null) return true;
  }
  return false;
}

/**
 * Format a specific sub-step (leaf node with hidden directory).
 * Shows instruction, tool name, parameter hints, and next pointer.
 */
function formatSubStep(address: string, node: any): string {
  const lines: string[] = [];
  const instruction = collectUnderscore(node);
  const hidden = getHiddenDirectory(node);
  const toolName = hidden?.['1'] ?? null;
  const nextStep = hidden?.['2'] ?? null;

  lines.push(`## Step ${address}${toolName ? ` → ${toolName}` : ''}`);
  lines.push('');
  if (instruction) lines.push(instruction);
  lines.push('');

  // Parameter hints (string children at digit keys)
  for (const d of '123456789') {
    if (d in node && typeof node[d] === 'string') {
      lines.push(`  ${d}. ${node[d]}`);
    }
  }

  if (nextStep) {
    lines.push('');
    lines.push(`Next: step ${nextStep}`);
  }

  return lines.join('\n');
}

/**
 * Format a level overview (node with object sub-steps).
 * Shows level description + brief summary of each sub-step.
 */
function formatLevel(levelDigit: string, node: any): string {
  const lines: string[] = [];
  const description = typeof node._ === 'string' ? node._ : collectUnderscore(node);

  lines.push(`## Level ${levelDigit}`);
  lines.push('');
  if (description) lines.push(description);
  lines.push('');

  // List sub-steps with brief summaries
  for (const d of '123456789') {
    if (!(d in node)) continue;
    const child = node[d];
    if (typeof child !== 'object' || child === null) continue;

    const childInstruction = collectUnderscore(child);
    const childHidden = getHiddenDirectory(child);
    const toolName = childHidden?.['1'] ?? null;
    const brief = childInstruction
      ? childInstruction.split('.')[0] + '.'
      : '(no description)';

    lines.push(`  ${levelDigit}.${d}${toolName ? ` → ${toolName}` : ''}: ${brief}`);
  }

  lines.push('');
  lines.push(`Call pscale_invite with step ${levelDigit}.1 to begin this level.`);

  return lines.join('\n');
}

export async function handleInvite(
  { step }: { step?: number },
) {
  // No step specified — return the full trajectory overview
  if (step == null) {
    const root = collectUnderscore(invite);
    const lines: string[] = [];
    if (root) {
      lines.push(root);
      lines.push('');
    }

    // Show each level overview (brief)
    for (const d of '1234') {
      if (d in invite) {
        const node = (invite as any)[d];
        const desc = typeof node._ === 'string' ? node._ : collectUnderscore(node);
        const brief = desc ? desc.split('.')[0] + '.' : '';
        lines.push(`**Level ${d}**: ${brief}`);
      }
    }

    lines.push('');
    lines.push('Call pscale_invite with step 1 to begin at Signal, or any level (1-4) for its overview. Use decimals (1.3, 2.2) for specific steps.');

    return {
      content: [{ type: 'text' as const, text: lines.join('\n').trim() }],
    };
  }

  // Parse the step number — integer (level) or decimal (sub-step)
  const address = String(step);
  // Handle floating point: 1.3 might come as "1.3" or need cleanup
  const parts = address.split('.');
  const levelDigit = parts[0];
  const subDigit = parts.length > 1 ? parts[1] : null;

  // Navigate to the node
  const node = navigateBlock(address);
  if (node == null) {
    return {
      content: [{
        type: 'text' as const,
        text: `No step ${address}. The progression has 4 levels (1-4) with sub-steps (e.g., 1.1, 2.3). Call with no arguments to see the full trajectory.`,
      }],
    };
  }

  // If it's a level (integer, has sub-steps) → show level overview
  if (subDigit == null && hasSubSteps(node)) {
    const text = formatLevel(levelDigit, node);
    return {
      content: [{ type: 'text' as const, text }],
    };
  }

  // If it's a sub-step or a leaf → show step detail
  if (hasSubSteps(node)) {
    // Nested level (unlikely but handle gracefully)
    const text = formatLevel(address, node);
    return {
      content: [{ type: 'text' as const, text }],
    };
  }

  const text = formatSubStep(address, node);
  return {
    content: [{ type: 'text' as const, text }],
  };
}

export function registerInviteOps(server: McpServer) {
  server.tool(
    'pscale_invite',
    `Discover what this network is and how to participate. Returns a guided on-ramp: four levels of relational engagement from invisible to collective intelligence. Each level names the tools to use and why. Call with no arguments for the full trajectory, or with a step number (1-4) for a level overview, or a decimal (1.3, 2.2) for a specific step. Start here if this is your first connection.`,
    {
      step: z
        .number()
        .min(1)
        .max(4)
        .optional()
        .describe(
          'Optional step number (1-4). Omit for the full trajectory. 1=Signal, 2=Grain, 3=Live Channel, 4=Open Context. Use decimals (1.3, 2.2) for specific steps within a level.',
        ),
    },
    handleInvite,
  );
}
