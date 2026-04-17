import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getPassportBlock } from '../db.js';

// ── Pure helpers ──

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Walk a block to an address like "6.1" or "0.341".
 * Pure digit traversal — returns the node at that address, or undefined if any step misses.
 */
function walkTo(block: Record<string, any>, address: string): any {
  const digits = address.replace(/\./g, '');
  let node: any = block;
  for (const d of digits) {
    if (!node || typeof node !== 'object') return undefined;
    node = node[d];
  }
  return node;
}

/**
 * Extract a scalar (string or number) from a node that may be a bare value
 * or wrapped in {_: value}. Follows the underscore chain.
 */
function extractScalar(node: any): string | number | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (typeof node === 'object' && node._ !== undefined) return extractScalar(node._);
  return undefined;
}

function parseNumberNode(node: any): number | undefined {
  const v = extractScalar(node);
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Types ──

interface ChainHop {
  agent: string;
  sig: string;
}

interface VerifyRiderArgs {
  rider?: unknown;
  probe_id?: string;
  chain?: ChainHop[];
  sender_agent_id: string;
  topic_coordinate?: string;
}

// ── Algorithm 1: chain integrity ──

function verifyChain(probe_id: string | undefined, chain: ChainHop[] | undefined) {
  if (!chain || chain.length === 0 || !probe_id) {
    return { checked: false };
  }
  for (let i = 0; i < chain.length; i++) {
    const prevSig = i === 0 ? '' : chain[i - 1].sig;
    const expected = sha256Hex(probe_id + prevSig);
    if (chain[i].sig !== expected) {
      return {
        checked: true,
        valid: false,
        break_at_hop: i,
        reason: `sig mismatch at hop ${i} (${chain[i].agent})`,
      };
    }
  }
  return { checked: true, valid: true };
}

// ── Algorithm 2: credit conservation ──
// Passport convention (Option 2, agreed 17 April 2026):
//   6: credits
//     _: "vector money state"
//     1: balance
//     2: total_sent
//     3: total_received

async function verifyCredits(rider: any, sender_agent_id: string) {
  const claimed = rider?.credits?.n;
  if (typeof claimed !== 'number') {
    return { checked: false };
  }
  const passport = await getPassportBlock(sender_agent_id);
  if (!passport) {
    return { checked: false, reason: `passport not found for ${sender_agent_id}` };
  }
  const balanceNode = walkTo(passport, '6.1');
  const balance = parseNumberNode(balanceNode);
  if (balance === undefined) {
    return {
      checked: false,
      reason: 'credits balance not found at passport address 6.1',
    };
  }
  const valid = claimed <= balance;
  return {
    checked: true,
    valid,
    claimed,
    balance,
    ...(valid ? {} : { reason: `overdraw: ${claimed} > ${balance}` }),
  };
}

// ── Algorithm 3: SQ computation ──
// Per Level 2 spec §5: SQ = Σ (v_latest / giver_total) across evaluators at the topic node.

async function verifySQ(rider: any, sender_agent_id: string, topic_coordinate: string | undefined) {
  const claimed = rider?.sq;
  if (!topic_coordinate || typeof claimed !== 'number') {
    return { checked: false };
  }
  const passport = await getPassportBlock(sender_agent_id);
  if (!passport) {
    return { checked: false, reason: `passport not found for ${sender_agent_id}` };
  }
  const topicNode = walkTo(passport, topic_coordinate);
  const evals = topicNode?.evaluations_received;
  if (!evals || typeof evals !== 'object') {
    return {
      checked: true,
      matches: false,
      claimed,
      computed: 0,
      reason: 'no evaluations at topic; claimed SQ unsupported',
    };
  }
  let computed = 0;
  for (const key of Object.keys(evals)) {
    const data = (evals as any)[key];
    if (
      data &&
      typeof data.v_latest === 'number' &&
      typeof data.giver_total === 'number' &&
      data.giver_total > 0
    ) {
      computed += data.v_latest / data.giver_total;
    }
  }
  const tolerance = 0.01;
  const matches = Math.abs(claimed - computed) < tolerance;
  return {
    checked: true,
    matches,
    claimed,
    computed,
    ...(matches ? {} : { reason: `SQ divergence: claimed ${claimed}, computed ${computed}` }),
  };
}

// ── Handler ──

export async function handleVerifyRider(args: VerifyRiderArgs) {
  const { rider, probe_id, chain, sender_agent_id, topic_coordinate } = args;

  // Missing / malformed rider → skip verdict. Makes the tool safe to call
  // unconditionally on any inbox message.
  if (!rider || typeof rider !== 'object') {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              chain: { checked: false },
              credits: { checked: false },
              sq: { checked: false },
              verdict: 'skip',
              reason: 'no rider',
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const chainResult = verifyChain(probe_id, chain);
  const creditsResult = await verifyCredits(rider, sender_agent_id);
  const sqResult = await verifySQ(rider, sender_agent_id, topic_coordinate);

  let verdict: 'pass' | 'warn' | 'fail';
  if ((chainResult as any).checked && !(chainResult as any).valid) {
    verdict = 'fail';
  } else if ((creditsResult as any).checked && !(creditsResult as any).valid) {
    verdict = 'fail';
  } else if ((sqResult as any).checked && !(sqResult as any).matches) {
    verdict = 'warn';
  } else {
    verdict = 'pass';
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            chain: chainResult,
            credits: creditsResult,
            sq: sqResult,
            verdict,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ── Registration ──

export function registerVerifyOps(server: McpServer) {
  server.tool(
    'pscale_verify_rider',
    `Deterministic arithmetic verification of a Level 2 ecosquared rider. Non-semantic, non-enforcing, non-storing. Checks three dimensions: chain integrity (sha256 chain tamper-resistance), credit conservation (rider.credits.n <= passport balance at 6.1), and SQ consistency (rider.sq recomputed from evaluations_received at the topic coordinate). Anyone can call; anyone gets the same answer; agents decide what to do with the verdict. This is the accountability layer that makes Level 2's "self-policed" convention mean something — LLMs can't reliably compute sha256 or SQ; this tool does the math so agents can trust the verdict.`,
    {
      rider: z
        .string()
        .optional()
        .describe(
          'The ecosquared rider JSON object, as a string. Parsed and validated against passport arithmetic. If absent or not valid JSON, verdict is "skip".',
        ),
      probe_id: z
        .string()
        .optional()
        .describe('Probe identifier. Required for chain verification (ignored without chain).'),
      chain: z
        .string()
        .optional()
        .describe(
          'JSON-encoded array of chain hops, each {agent, sig}. Required for chain verification. First hop: sig = sha256(probe_id + ""); subsequent hops: sig = sha256(probe_id + prev_sig).',
        ),
      sender_agent_id: z
        .string()
        .describe(
          "Whose passport to load for credit and SQ checks. Typically equals rider.from. Sedimentary addresses (sed:collective:position) are valid agent_ids.",
        ),
      topic_coordinate: z
        .string()
        .optional()
        .describe(
          'Pscale coordinate of the topic whose SQ to recompute (e.g. "0.341"). If absent, SQ check is skipped.',
        ),
    },
    async (args) => {
      let riderObj: unknown | undefined;
      if (args.rider) {
        try {
          riderObj = JSON.parse(args.rider);
        } catch {
          riderObj = undefined; // triggers skip verdict
        }
      }
      let chainArr: ChainHop[] | undefined;
      if (args.chain) {
        try {
          const parsed = JSON.parse(args.chain);
          if (Array.isArray(parsed)) chainArr = parsed;
        } catch {
          chainArr = undefined;
        }
      }
      return handleVerifyRider({
        rider: riderObj,
        probe_id: args.probe_id,
        chain: chainArr,
        sender_agent_id: args.sender_agent_id,
        topic_coordinate: args.topic_coordinate,
      });
    },
  );
}
