/**
 * Chess engine utilities built on top of chessops low-level primitives.
 * Handles attack detection, legal move generation, and check/checkmate
 * for the non-standard Destovky positions (e.g. board with only
 * one king, or no kings at all).
 */

import { Board } from 'chessops/board';
import { SquareSet } from 'chessops/squareSet';
import {
  kingAttacks,
  knightAttacks,
  pawnAttacks,
  bishopAttacks,
  rookAttacks,
  queenAttacks,
} from 'chessops/attacks';
import { squareRank } from 'chessops/util';
import type { Color, Role, Square } from 'chessops/types';
import type { CGPiece } from './types';

export type { Square };

// ── Conversion helpers ────────────────────────────────────────────────────────

export function cgKeyToSquare(key: string): Square {
  const file = key.charCodeAt(0) - 97; // 'a'=0
  const rank = parseInt(key[1]) - 1;   // '1'=0
  return rank * 8 + file;
}

export function squareToCgKey(sq: Square): string {
  const file = sq & 7;
  const rank = sq >> 3;
  return String.fromCharCode(97 + file) + (rank + 1);
}

export function squareColor(sq: Square): 'light' | 'dark' {
  const file = sq & 7;
  const rank = sq >> 3;
  return (file + rank) % 2 === 0 ? 'dark' : 'light';
}

// ── Board builder ─────────────────────────────────────────────────────────────

/**
 * Build a chessops Board from our Map<Square, CGPiece>.
 */
export function buildBoard(pieces: Map<Square, CGPiece>): Board {
  const board = Board.empty();
  for (const [sq, piece] of pieces) {
    const role = piece.role as Role;
    const color = piece.color as Color;
    board.set(sq, { role, color });
  }
  return board;
}

// ── Attack detection ──────────────────────────────────────────────────────────

/**
 * Returns true if `square` is attacked by any piece of `byColor`.
 */
export function isSquareAttacked(
  sq: Square,
  byColor: Color,
  board: Board,
): boolean {
  const occupied = board.occupied;
  const them = board[byColor];

  if (rookAttacks(sq, occupied).intersect(board.rooksAndQueens()).intersect(them).nonEmpty()) return true;
  if (bishopAttacks(sq, occupied).intersect(board.bishopsAndQueens()).intersect(them).nonEmpty()) return true;
  if (knightAttacks(sq).intersect(board.knight).intersect(them).nonEmpty()) return true;
  if (kingAttacks(sq).intersect(board.king).intersect(them).nonEmpty()) return true;
  const oppColor: Color = byColor === 'white' ? 'black' : 'white';
  if (pawnAttacks(oppColor, sq).intersect(board.pawn).intersect(them).nonEmpty()) return true;

  return false;
}

// ── Legal placement squares ───────────────────────────────────────────────────

/**
 * Returns all squares where `cardRole` can legally be placed for `color`.
 * Takes into account bishop color, pawn rank restrictions, and king safety.
 */
export function legalPlacementSquares(
  cardType: string,
  color: Color,
  pieces: Map<Square, CGPiece>,
): Square[] {
  const board = buildBoard(pieces);
  const result: Square[] = [];

  for (let sq = 0; sq < 64; sq++) {
    if (board.occupied.has(sq)) continue;

    const rank = squareRank(sq); // 0-7

    if (cardType === 'pawn') {
      if (color === 'white' && (rank < 1 || rank > 5)) continue; // ranks 2-6
      if (color === 'black' && (rank < 2 || rank > 6)) continue; // ranks 3-7
    }

    if (cardType === 'bishop-light') {
      if (squareColor(sq) !== 'light') continue;
    }

    if (cardType === 'bishop-dark') {
      if (squareColor(sq) !== 'dark') continue;
    }

    if (cardType === 'king') {
      const opponent: Color = color === 'white' ? 'black' : 'white';
      if (isSquareAttacked(sq, opponent, board)) continue;
    }

    result.push(sq);
  }

  return result;
}

// ── Legal chess moves ─────────────────────────────────────────────────────────

/**
 * Returns all legal chess moves for `color` in the given position.
 * A move is legal if it doesn't leave the moving side's king in check.
 * (If the moving side has no king yet, we still allow moves but skip
 * the self-check filter.)
 */
export function legalChessMoves(
  color: Color,
  pieces: Map<Square, CGPiece>,
): Map<Square, Square[]> {
  const board = buildBoard(pieces);
  const result = new Map<Square, Square[]>();
  const opponent: Color = color === 'white' ? 'black' : 'white';

  for (const sq of board[color]) {
    const piece = board.get(sq);
    if (!piece) continue;

    const pseudo = pseudoMoves(piece.role, color, sq, board);
    const legal: Square[] = [];

    for (const dest of pseudo) {
      // Simulate move
      const newPieces = new Map(pieces);
      newPieces.delete(sq);
      newPieces.set(dest, pieces.get(sq)!);

      const newBoard = buildBoard(newPieces);
      const kingSquare = newBoard.kingOf(color);

      if (kingSquare !== undefined && isSquareAttacked(kingSquare, opponent, newBoard)) {
        continue; // leaves king in check — illegal
      }

      legal.push(dest);
    }

    if (legal.length > 0) result.set(sq, legal);
  }

  return result;
}

function pseudoMoves(role: Role, color: Color, sq: Square, board: Board): SquareSet {
  const occupied = board.occupied;
  const us = board[color];
  const opponent: Color = color === 'white' ? 'black' : 'white';
  const them = board[opponent];

  let pseudo: SquareSet;

  switch (role) {
    case 'pawn': {
      const dir = color === 'white' ? 1 : -1;
      const rank = squareRank(sq);
      const startRank = color === 'white' ? 1 : 6;
      let moves = SquareSet.empty();

      const step = sq + dir * 8;
      if (step >= 0 && step < 64 && !occupied.has(step)) {
        moves = moves.with(step);
        const doubleStep = sq + dir * 16;
        if (rank === startRank && !occupied.has(doubleStep)) {
          moves = moves.with(doubleStep);
        }
      }
      // captures
      pseudo = pawnAttacks(color, sq).intersect(them).union(moves);
      break;
    }
    case 'knight':
      pseudo = knightAttacks(sq).diff(us);
      break;
    case 'bishop':
      pseudo = bishopAttacks(sq, occupied).diff(us);
      break;
    case 'rook':
      pseudo = rookAttacks(sq, occupied).diff(us);
      break;
    case 'queen':
      pseudo = queenAttacks(sq, occupied).diff(us);
      break;
    case 'king':
      pseudo = kingAttacks(sq).diff(us);
      break;
    default:
      pseudo = SquareSet.empty();
  }

  return pseudo;
}

// ── Check / checkmate ─────────────────────────────────────────────────────────

export function isInCheck(color: Color, pieces: Map<Square, CGPiece>): boolean {
  const board = buildBoard(pieces);
  const kingSq = board.kingOf(color);
  if (kingSq === undefined) return false;
  const opponent: Color = color === 'white' ? 'black' : 'white';
  return isSquareAttacked(kingSq, opponent, board);
}

/**
 * Returns true if `color` is checkmated.
 * Requires the king to be on the board and in check with no legal moves.
 */
export function isCheckmate(color: Color, pieces: Map<Square, CGPiece>): boolean {
  if (!isInCheck(color, pieces)) return false;
  const moves = legalChessMoves(color, pieces);
  if (moves.size > 0) return false;

  // Also check: can any piece be PLACED to block? In Destovky a player
  // can always choose to place from their deck to resolve check, but only if
  // the king is already placed. Checkmate means no placement can help either.
  // We don't evaluate that here — the game loop handles it separately.
  return true;
}
