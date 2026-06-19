import { legalMovesForState } from './gameState';
import type { Deck, GameState, CGPiece, PromotionRole, Square } from './types';

export interface SerializedGameState {
  board: Array<[Square, CGPiece]>;
  whiteDecks: Deck;
  blackDecks: Deck;
  promotionCounts?: GameState['promotionCounts'];
  promotionRolesUsed?: GameState['promotionRolesUsed'];
  turn: GameState['turn'];
  turnMode: GameState['turnMode'];
  cardFlipped: boolean;
  whiteKingPlaced: boolean;
  blackKingPlaced: boolean;
  legalPlacementSquares: Square[];
  inCheck: boolean;
  gameOver: boolean;
  winner: GameState['winner'];
  drawOfferBy?: GameState['drawOfferBy'];
  pendingPromotion: GameState['pendingPromotion'];
}

export function serializeGameState(state: GameState): SerializedGameState {
  return {
    board: Array.from(state.board.entries()),
    whiteDecks: state.whiteDecks,
    blackDecks: state.blackDecks,
    promotionCounts: state.promotionCounts,
    promotionRolesUsed: state.promotionRolesUsed,
    turn: state.turn,
    turnMode: state.turnMode,
    cardFlipped: state.cardFlipped,
    whiteKingPlaced: state.whiteKingPlaced,
    blackKingPlaced: state.blackKingPlaced,
    legalPlacementSquares: state.legalPlacementSquares,
    inCheck: state.inCheck,
    gameOver: state.gameOver,
    winner: state.winner,
    drawOfferBy: state.drawOfferBy,
    pendingPromotion: state.pendingPromotion,
  };
}

export function deserializeGameState(serialized: SerializedGameState): GameState {
  const board = new Map(serialized.board);
  const kingPlaced = serialized.turn === 'white' ? serialized.whiteKingPlaced : serialized.blackKingPlaced;
  const promotionRolesUsed = normalizePromotionRoles(serialized.promotionRolesUsed);
  const promotionCounts = serialized.promotionCounts ?? {
    white: promotionRolesUsed.white.length,
    black: promotionRolesUsed.black.length,
  };

  const state: GameState = {
    ...serialized,
    board,
    promotionCounts,
    promotionRolesUsed,
    drawOfferBy: serialized.drawOfferBy ?? null,
    legalMoves: new Map(),
  };
  return {
    ...state,
    legalMoves: kingPlaced ? legalMovesForState(state, serialized.turn) : new Map(),
  };
}

function normalizePromotionRoles(value: SerializedGameState['promotionRolesUsed']): GameState['promotionRolesUsed'] {
  const allowed = new Set<PromotionRole>(['queen', 'rook', 'bishop', 'knight']);
  return {
    white: (value?.white ?? []).filter(role => allowed.has(role)),
    black: (value?.black ?? []).filter(role => allowed.has(role)),
  };
}
