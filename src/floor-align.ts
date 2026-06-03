/**
 * floor-align.ts — PROVISIONAL reference implementation (2026-06-03).
 *
 * The missing cross-block operation: relating two pscale blocks by their
 * shared floor plane, not by walk depth.
 *
 * Status: DRAFT / not wired into the server. This is the reference for a
 * proposed core pscale operation (see docs/floor-alignment-and-cross-block-ops.md).
 * It deliberately does NOT modify bsp.ts — bsp() is unary (one block, two
 * coordinates). This is the binary companion: bsp() indexes within a block,
 * floor-align relates across blocks.
 *
 * THE LAW
 * -------
 * bsp() is block-local: a node's walk depth means something only inside its
 * own block. The floor-anchored coordinate — pscale — is the invariant that
 * survives across blocks, because the floor (pscale 0) is the same coordinate
 * for every block (it is invariant under supernest). Therefore: any computation
 * BETWEEN two blocks must index by pscale, never by walk depth.
 *
 *   pscale(node at depth d, block floor F) = F - d        (whetstone 2.7)
 *   pscale 0 sits at the floor (the underscore-chain string terminus).
 *   The digit immediately left of the decimal point is pscale 0.
 *   Integer digits walk above the floor (pscale > 0, coarser).
 *   Fractional digits walk below the floor (pscale < 0, finer).
 *
 * Comparing two addresses left-aligned by walk step (3,4,5 against 7,6,5,4)
 * is the bug: it pairs a coarse position in the deeper block with the floor of
 * the shallower. The fix is decimal-point alignment — pad the shorter
 * left-of-decimal with leading zeros to the wider floor:
 *
 *   34.5   (floor 2)  ->  3,4,5      pscale  +1  0 -1
 *   7.654  (floor 1)  ->  0,7,6,5,4  pscale  +1  0 -1 -2 -3   (padded)
 *
 * Leading-zero padding in address space IS the supernest operation in block
 * space: wrapping the shallower block in `{_: <old>}` until the floors match.
 * So floor-aligned binary ops = "supernest the shallower up to the common
 * floor, then compute pscale-for-pscale." The dot-product analogy is exact:
 * the floor is the contraction axis; mismatched floors are mismatched
 * dimensions, resolved by zero-padding.
 */

import type { Block } from './bsp.js';
import { floorDepth } from './bsp.js';

// ── pscale indexing ──

export interface PscaleNode {
  /** floor-anchored coordinate; 0 = floor, + above, - below */
  pscale: number;
  /** walk path as comma-free digit string, e.g. "345" for walk 3,4,5 */
  walk: string;
  /** canonical single-dot pscale address, e.g. "34.5" */
  address: string;
  text: string | null;
}

/** Follow the underscore chain to a string (mirrors bsp.collectUnderscore). */
function underscoreText(node: any): string | null {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object' || !('_' in node)) return null;
  const v = node._;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && '_' in v) return underscoreText(v);
  return null;
}

/**
 * Render a walk (digit string) as a canonical single-dot pscale address for a
 * block of the given floor. The decimal goes after the F-th integer digit;
 * trailing/needed zeros make the integer part exactly F wide.
 * Walk "345" at floor 2 -> "34.5". Walk "7654" at floor 1 -> "7.654".
 * Never emits more than one dot.
 */
export function walkToAddress(walk: string, floor: number): string {
  if (floor <= 0) return walk;
  if (walk.length <= floor) return walk.padEnd(floor, '0');
  return walk.slice(0, floor) + '.' + walk.slice(floor);
}

/**
 * Index every semantic-bearing position of a block by pscale.
 * Walk depth d -> pscale (F - d). Root object (depth 0) is structural (pscale F)
 * and carries the floor-chain identity at pscale 0..F-1 collapsed onto the
 * spine; we emit the floor identity at pscale 0 and every digit branch at its
 * own pscale. Hidden directories (off-chain underscore-objects) are not walked
 * here — composition across the star door is a separate operator.
 */
export function indexByPscale(block: Block): PscaleNode[] {
  const F = floorDepth(block);
  const out: PscaleNode[] = [];

  function visit(node: any, depth: number, walk: string) {
    const pscale = F - depth;
    const text = underscoreText(node);
    if (text !== null && walk !== '') {
      out.push({ pscale, walk, address: walkToAddress(walk, F), text });
    }
    if (!node || typeof node !== 'object') return;
    // step the ladder (digit 0 = underscore) only while it stays on the chain
    if ('_' in node && typeof node._ === 'object') {
      visit(node._, depth + 1, walk + '0');
    }
    for (const d of '123456789') {
      if (d in node) visit(node[d], depth + 1, walk + d);
    }
  }

  // emit the floor identity (the root's underscore-chain string) at pscale 0
  const rootText = underscoreText(block);
  if (rootText !== null) {
    out.push({ pscale: 0, walk: '0'.repeat(Math.max(F, 1)), address: walkToAddress('', F) || '0', text: rootText });
  }
  for (const d of '123456789') {
    if (d in block) visit(block[d], 1, d);
  }
  return out;
}

// ── the binary operation ──

export interface AlignedLevel {
  pscale: number;
  a: PscaleNode[];
  b: PscaleNode[];
}

/**
 * floorAlign(A, B) — lay both blocks against the floor as a common plane and
 * group their positions by shared pscale. Coarse (high pscale) first, fine
 * (low pscale) last. Levels present in only one block carry an empty side —
 * the structural image of zero-padding the shorter operand.
 *
 * Note: pscale is invariant under supernest, so no block is actually
 * transformed. Indexing both by pscale IS the alignment; the "leading zeros"
 * are only how it renders when you write addresses at a fixed floor width.
 */
export function floorAlign(blockA: Block, blockB: Block): AlignedLevel[] {
  const ia = indexByPscale(blockA);
  const ib = indexByPscale(blockB);
  const levels = new Set<number>();
  for (const n of ia) levels.add(n.pscale);
  for (const n of ib) levels.add(n.pscale);
  return [...levels]
    .sort((x, y) => y - x) // coarse -> fine
    .map((pscale) => ({
      pscale,
      a: ia.filter((n) => n.pscale === pscale),
      b: ib.filter((n) => n.pscale === pscale),
    }));
}

/**
 * floorProduct(A, B, sim) — the dot product over the shared pscale axis.
 * Contracts two blocks into a single scalar: the summed similarity of their
 * content where their scales coincide. Levels where either side is empty
 * contribute 0 (zero-padding). `sim` is any text-pair scorer (cosine of
 * embeddings, lexical overlap, LLM judgement — caller's choice).
 *
 * This is the "dot product with matrix" shape the floor makes possible:
 *   floorProduct(A, B) = Σ_p  sim( A@p , B@p )
 * misaligned floors are mismatched dimensions; the floor plane is what lets
 * the inner products line up. Comparison and merge are the other two
 * derivations from the same aligned frame (see the design doc).
 */
export function floorProduct(
  blockA: Block,
  blockB: Block,
  sim: (a: string, b: string) => number,
): number {
  let total = 0;
  for (const level of floorAlign(blockA, blockB)) {
    if (!level.a.length || !level.b.length) continue; // zero-padded level
    const aText = level.a.map((n) => n.text ?? '').join(' ');
    const bText = level.b.map((n) => n.text ?? '').join(' ');
    total += sim(aText, bText);
  }
  return total;
}
