/**
 * Lightweight minimax engine for Destovky browser play.
 *
 * Used as the chess-phase component of the hybrid engine:
 *   - Placement phase (kings missing) → NN policy handles it
 *   - Chess phase (both kings placed)  → alpha-beta minimax (depth 2) + fast eval
 *   - Mixed phase (one king)           → depth-1 fast eval
 *
 * The evaluator is pure material + PST — same classical values used in
 * the Python heuristic agent (Fruit/CPW tables).
 *
 * Exported: chooseMinimax(state) → EngineAction | null
 */

import type { GameState, CGRole, Color } from '../rules/types';
import type { EngineAction } from './randomEngine';
import { applyEngineAction } from './randomEngine';

// ── Piece values (centipawns) ─────────────────────────────────────────────────

const PIECE_CP: Record<CGRole, number> = {
  pawn:   100,
  knight: 320,
  bishop: 330,
  rook:   500,
  queen:  900,
  king:   0,
};

// ── Piece-Square Tables (White perspective; Black mirrors vertically) ──────────
// Index = sq (file + rank*8), rank 0 = rank 1 (bottom). Source: CPW/Fruit.

// prettier-ignore
const PAWN_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
// prettier-ignore
const KNIGHT_PST = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
// prettier-ignore
const BISHOP_PST = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
// prettier-ignore
const ROOK_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
// prettier-ignore
const QUEEN_PST = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
// prettier-ignore
const KING_PST = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];

const PST: Record<CGRole, number[]> = {
  pawn:   PAWN_PST,
  knight: KNIGHT_PST,
  bishop: BISHOP_PST,
  rook:   ROOK_PST,
  queen:  QUEEN_PST,
  king:   KING_PST,
};

function pstScore(role: CGRole, color: Color, sq: number): number {
  const table = PST[role];
  if (!table) return 0;
  // White reads rank 0 = a1 (bottom). Black mirrors vertically.
  const rank = sq >> 3;
  const file = sq & 7;
  const idx = color === 'white' ? sq : (7 - rank) * 8 + file;
  return table[idx] ?? 0;
}

// ── Fast position evaluation ──────────────────────────────────────────────────

const MATE_SCORE = 50_000;

function fastEval(state: GameState, color: Color): number {
  if (state.gameOver) {
    if (state.winner === color)   return  MATE_SCORE;
    if (state.winner === null)    return  0;
    return -MATE_SCORE;
  }

  let score = 0;

  for (const [sq, piece] of state.board) {
    const cp = PIECE_CP[piece.role] + pstScore(piece.role, piece.color, sq);
    score += piece.color === color ? cp : -cp;
  }

  // Mobility bonus
  if (state.turn === color) {
    let n = 0;
    for (const dests of state.legalMoves.values()) n += dests.length;
    score += n * 3;
  }

  // Check signal
  if (state.inCheck) {
    score += state.turn === color ? -30 : 30;
  }

  return score;
}

// ── Deck expected value ───────────────────────────────────────────────────────

function deckEv(state: GameState, color: Color): number {
  const deck = color === 'white' ? state.whiteDecks : state.blackDecks;
  if (!deck.pile.length) return 0;
  const total = deck.pile.reduce((s, c) => {
    const role = c.type.split('-')[0] as CGRole;
    return s + (PIECE_CP[role] ?? 0);
  }, 0);
  return total / deck.pile.length;
}

// ── Move ordering (captures first) ───────────────────────────────────────────

interface ScoredMove { score: number; action: EngineAction }

function orderMoves(state: GameState, moves: EngineAction[]): ScoredMove[] {
  return moves
    .filter(a => a.kind === 'move-piece')
    .map(a => {
      if (a.kind !== 'move-piece') return { score: 0, action: a };
      const captured = state.board.get(a.to);
      const attacker = state.board.get(a.from);
      const captureScore = captured ? PIECE_CP[captured.role] * 10 - (attacker ? PIECE_CP[attacker.role] : 0) : 0;
      return { score: captureScore, action: a };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Alpha-beta minimax ────────────────────────────────────────────────────────

const DEPTH = 2;
const BRANCH_CAP = 25; // max moves at each node for speed

function minimax(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  rootColor: Color,
): number {
  if (depth === 0 || state.gameOver) return fastEval(state, rootColor);

  // Only consider move-piece actions at inner nodes (chess phase)
  const moves: EngineAction[] = [];
  for (const [from, dests] of state.legalMoves) {
    for (const to of dests) {
      moves.push({ kind: 'move-piece', from, to });
    }
  }

  if (moves.length === 0) return fastEval(state, rootColor);

  const ordered = orderMoves(state, moves).slice(0, BRANCH_CAP);
  const isMax = state.turn === rootColor;
  let best = isMax ? -Infinity : Infinity;

  for (const { action } of ordered) {
    const child = applyEngineAction(state, action);
    const val = minimax(child, depth - 1, alpha, beta, rootColor);
    if (isMax) {
      if (val > best) best = val;
      if (val > alpha) alpha = val;
    } else {
      if (val < best) best = val;
      if (val < beta) beta = val;
    }
    if (beta <= alpha) break;
  }

  return best;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Choose the best action using phase-appropriate logic:
 * - Chess phase (both kings): alpha-beta minimax depth 2
 * - Mixed phase (one king):   depth-1 fast eval
 * - Other:                    null (caller should fall back to NN)
 */
export function chooseMinimax(state: GameState): EngineAction | null {
  if (state.gameOver) return null;

  const color = state.turn;

  const hasMyKing  = [...state.board.values()].some(p => p.role === 'king' && p.color === color);
  const hasOppKing = [...state.board.values()].some(p => p.role === 'king' && p.color !== color);

  // Only engage in chess-like phases
  if (!hasMyKing && !hasOppKing) return null;

  const legalMoves: EngineAction[] = [];
  for (const [from, dests] of state.legalMoves) {
    for (const to of dests) {
      legalMoves.push({ kind: 'move-piece', from, to });
    }
  }

  if (legalMoves.length === 0) return null;

  const depth = hasMyKing && hasOppKing ? DEPTH : 1;

  const ordered = orderMoves(state, legalMoves).slice(0, BRANCH_CAP);
  let bestScore = -Infinity;
  let bestAction: EngineAction | null = null;

  for (const { action } of ordered) {
    const child = applyEngineAction(state, action);
    const score = minimax(child, depth - 1, -Infinity, Infinity, color);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  // In choose mode: compare minimax best vs flip EV
  if (state.turnMode === 'choose' && !state.inCheck && hasMyKing && hasOppKing) {
    const ev = deckEv(state, color);
    const FLIP_THRESHOLD = 120;
    const FLIP_RISK = 0.25;
    if (ev >= FLIP_THRESHOLD && ev * FLIP_RISK > bestScore * 0.08) {
      return { kind: 'flip-card' };
    }
  }

  return bestAction;
}

/** Evaluate current position from `color`'s perspective (for debugging/UI). */
export function evaluatePosition(state: GameState, color: Color): number {
  return fastEval(state, color);
}
