import { createDeck } from './deck';
import { legalPlacementSquares, legalChessMoves, isInCheck } from './chessEngine';
import type { GameState, Color, CGPiece, CGRole, Square, TurnMode, Deck } from './types';

function opposite(c: Color): Color {
  return c === 'white' ? 'black' : 'white';
}

function makeDeck(): Deck {
  return { pile: createDeck(), revealed: null };
}

export function createInitialState(): GameState {
  return {
    board: new Map(),
    whiteDecks: makeDeck(),
    blackDecks: makeDeck(),
    turn: 'white',
    turnMode: 'must-place',
    cardFlipped: false,
    whiteKingPlaced: false,
    blackKingPlaced: false,
    legalPlacementSquares: [],
    legalMoves: new Map(),
    inCheck: false,
    gameOver: false,
    winner: null,
    pendingPromotion: null,
  };
}

export function flipCard(state: GameState): GameState {
  if (state.cardFlipped || state.gameOver) return state;
  const deckKey = state.turn === 'white' ? 'whiteDecks' : 'blackDecks';
  const deck = state[deckKey];
  if (deck.pile.length === 0) return state;
  const [top, ...rest] = deck.pile;
  let placementSquares = legalPlacementSquares(top.type, state.turn, state.board);

  // When in check, only squares that actually resolve check are valid
  if (state.inCheck) {
    const role: CGPiece['role'] =
      top.type === 'bishop-light' || top.type === 'bishop-dark' ? 'bishop' : (top.type as CGPiece['role']);
    placementSquares = placementSquares.filter(sq => {
      const testBoard = new Map(state.board);
      testBoard.set(sq, { role, color: state.turn });
      return !isInCheck(state.turn, testBoard);
    });
    // Card cannot resolve check — player gambled and loses
    if (placementSquares.length === 0) {
      return {
        ...state,
        [deckKey]: { pile: rest, revealed: top },
        cardFlipped: true,
        legalPlacementSquares: [],
        gameOver: true,
        winner: opposite(state.turn),
      };
    }
  }

  return {
    ...state,
    [deckKey]: { pile: rest, revealed: top },
    cardFlipped: true,
    legalPlacementSquares: placementSquares,
  };
}

export function placePiece(state: GameState, square: Square): GameState {
  if (state.gameOver) return state;
  if (!state.legalPlacementSquares.includes(square)) return state;
  const deckKey = state.turn === 'white' ? 'whiteDecks' : 'blackDecks';
  const deck = state[deckKey];
  if (!deck.revealed) return state;
  const card = deck.revealed;
  const role: CGPiece['role'] =
    card.type === 'bishop-light' || card.type === 'bishop-dark' ? 'bishop' : card.type;
  const newBoard = new Map(state.board);
  newBoard.set(square, { role, color: state.turn });
  const whiteKingPlaced = state.turn === 'white' && card.type === 'king' ? true : state.whiteKingPlaced;
  const blackKingPlaced = state.turn === 'black' && card.type === 'king' ? true : state.blackKingPlaced;
  return resolveNextTurn({
    ...state,
    board: newBoard,
    [deckKey]: { ...deck, revealed: null },
    turn: opposite(state.turn),
    cardFlipped: false,
    whiteKingPlaced,
    blackKingPlaced,
    legalPlacementSquares: [],
    legalMoves: new Map(),
    pendingPromotion: null,
  });
}

export function makeMove(state: GameState, from: Square, to: Square): GameState {
  if (state.gameOver) return state;
  const legal = state.legalMoves.get(from);
  if (!legal || !legal.includes(to)) return state;
  const newBoard = new Map(state.board);
  const piece = newBoard.get(from)!;
  newBoard.delete(from);
  newBoard.set(to, piece);
  const rank = to >> 3;
  // Pawn reaches back rank — pause for promotion choice
  if (
    piece.role === 'pawn' &&
    ((piece.color === 'white' && rank === 7) || (piece.color === 'black' && rank === 0))
  ) {
    return {
      ...state,
      board: newBoard,
      cardFlipped: false,
      legalPlacementSquares: [],
      legalMoves: new Map(),
      pendingPromotion: { from, to },
    };
  }
  return resolveNextTurn({
    ...state,
    board: newBoard,
    turn: opposite(state.turn),
    cardFlipped: false,
    legalPlacementSquares: [],
    legalMoves: new Map(),
    pendingPromotion: null,
  });
}

export function completePromotion(state: GameState, role: CGRole): GameState {
  if (!state.pendingPromotion) return state;
  const { to } = state.pendingPromotion;
  const newBoard = new Map(state.board);
  const piece = newBoard.get(to);
  if (!piece) return state;
  newBoard.set(to, { ...piece, role });
  return resolveNextTurn({
    ...state,
    board: newBoard,
    turn: opposite(state.turn),
    pendingPromotion: null,
    cardFlipped: false,
    legalPlacementSquares: [],
    legalMoves: new Map(),
  });
}

function resolveNextTurn(state: GameState): GameState {
  const { turn } = state;
  const myKingPlaced = turn === 'white' ? state.whiteKingPlaced : state.blackKingPlaced;
  const inCheck = isInCheck(turn, state.board);
  const legalMoves = myKingPlaced ? legalChessMoves(turn, state.board) : new Map<Square, Square[]>();
  const myDeck = turn === 'white' ? state.whiteDecks : state.blackDecks;
  const hasCards = myDeck.pile.length > 0;

  if (myKingPlaced && inCheck) {
    const hasMoves = legalMoves.size > 0;
    // Game over only when there are literally no options: no moves and no cards to flip
    if (!hasMoves && !hasCards) {
      return { ...state, inCheck: true, legalMoves, legalPlacementSquares: [], gameOver: true, winner: opposite(turn), turnMode: 'must-move', pendingPromotion: null };
    }
  }

  let turnMode: TurnMode;
  if (!myKingPlaced) {
    turnMode = 'must-place';
  } else if (inCheck) {
    // Has cards → player may move OR flip a card (risky — card might not resolve check)
    // No cards → must move
    turnMode = hasCards ? 'choose' : 'must-move';
  } else {
    turnMode = 'choose';
  }

  return { ...state, inCheck, legalMoves, legalPlacementSquares: [], turnMode, pendingPromotion: null };
}
