import { useEffect, useRef } from 'react';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Config } from 'chessground/config';
import type { Key, Piece as CGLibPiece, PiecesDiff, SquareClasses } from 'chessground/types';
import { squareToCgKey, cgKeyToSquare } from '../chessEngine';
import type { GameState, CGPiece, Square, Color } from '../types';

interface Props {
  state: GameState;
  onSquareClick: (sq: Square) => void;
  onMove: (from: Square, to: Square) => void;
  /** False when viewing history or promotion pending — disables all board interaction */
  interactive: boolean;
  orientation: Color;
}

function buildCGPieces(board: Map<Square, CGPiece>): Map<Key, CGLibPiece> {
  const map = new Map<Key, CGLibPiece>();
  for (const [sq, piece] of board) {
    map.set(squareToCgKey(sq) as Key, { role: piece.role, color: piece.color });
  }
  return map;
}

function buildDests(legalMoves: Map<Square, Square[]>): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const [from, tos] of legalMoves) {
    dests.set(squareToCgKey(from) as Key, tos.map(t => squareToCgKey(t) as Key));
  }
  return dests;
}

export default function ChessBoard({ state, onSquareClick, onMove, interactive, orientation }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cgRef = useRef<Api | null>(null);

  const onSquareClickRef = useRef(onSquareClick);

  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onSquareClickRef.current = onSquareClick;
  }, [onSquareClick]);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const cg = Chessground(el, {
      fen: '8/8/8/8/8/8/8/8',
      orientation,
      coordinates: true,
      movable: { free: false, showDests: false, color: undefined },
      selectable: { enabled: false },
      draggable: { enabled: false },
      premovable: { enabled: false },
      events: {
        select: (key: Key) => onSquareClickRef.current(cgKeyToSquare(key)),
        move: (from: Key, to: Key) => onMoveRef.current(cgKeyToSquare(from), cgKeyToSquare(to)),
      },
    });
    cgRef.current = cg;

    const raf = requestAnimationFrame(() => cg.redrawAll());
    const ro = new ResizeObserver(() => cg.redrawAll());
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cg.destroy();
      cgRef.current = null;
    };
  }, [orientation]);

  useEffect(() => {
    const cg = cgRef.current;
    if (!cg) return;

    const isPlacing = interactive && state.cardFlipped && !state.gameOver;
    const isMoving =
      interactive &&
      !state.pendingPromotion &&
      (state.turnMode === 'choose' || state.turnMode === 'must-move') &&
      !state.cardFlipped &&
      !state.gameOver;

    const customHighlights: SquareClasses = new Map();
    if (isPlacing) {
      for (const sq of state.legalPlacementSquares) {
        customHighlights.set(squareToCgKey(sq) as Key, 'move-dest');
      }
    }

    const config: Config = {
      orientation,
      check: state.inCheck ? state.turn : undefined,
      turnColor: state.turn,
      movable: {
        free: false,
        color: isMoving ? state.turn : undefined,
        dests: isMoving ? buildDests(state.legalMoves) : new Map(),
        showDests: isMoving,
      },
      selectable: { enabled: isPlacing || isMoving },
      highlight: {
        lastMove: false,
        check: true,
        custom: customHighlights,
      },
      draggable: { enabled: isMoving },
    };

    cg.set(config);
    // Clear any in-progress selection when leaving move mode
    if (!isMoving) cg.cancelMove();

    // Diff-update pieces
    const desired = buildCGPieces(state.board);
    const current = cg.state.pieces;
    const allKeys = new Set([...current.keys(), ...desired.keys()]);
    const diff: PiecesDiff = new Map();
    for (const key of allKeys) {
      const cur = current.get(key);
      const des = desired.get(key);
      if (JSON.stringify(cur) !== JSON.stringify(des)) diff.set(key, des);
    }
    if (diff.size > 0) cg.setPieces(diff);
  }, [state, interactive, orientation]);

  return (
    <div
      ref={containerRef}
      className="cg-wrap"
      style={{ width: '100%', aspectRatio: '1 / 1', display: 'block' }}
    />
  );
}
