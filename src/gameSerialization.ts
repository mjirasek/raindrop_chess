import { legalChessMoves } from './chessEngine';
import type { Deck, GameState, CGPiece, Square } from './types';

export interface SerializedGameState {
  board: Array<[Square, CGPiece]>;
  whiteDecks: Deck;
  blackDecks: Deck;
  promotionCounts: GameState['promotionCounts'];
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

  return {
    ...serialized,
    board,
    drawOfferBy: serialized.drawOfferBy ?? null,
    legalMoves: kingPlaced ? legalChessMoves(serialized.turn, board) : new Map(),
  };
}
