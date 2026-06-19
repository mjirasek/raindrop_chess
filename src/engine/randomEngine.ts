import {
  availablePromotionRoles,
  completePromotion,
  flipCard,
  makeMove,
  placePiece,
} from '../rules/gameState';
import type { GameState, PromotionRole, Square } from '../rules/types';

export type EngineAction =
  | { kind: 'flip-card' }
  | { kind: 'place-piece'; square: Square }
  | { kind: 'move-piece'; from: Square; to: Square }
  | { kind: 'promote'; role: PromotionRole };

export interface EngineStep {
  action: EngineAction | null;
  state: GameState;
}

function currentDeckHasCards(state: GameState): boolean {
  return (state.turn === 'white' ? state.whiteDecks : state.blackDecks).pile.length > 0;
}

export function legalEngineActions(state: GameState): EngineAction[] {
  if (state.gameOver) return [];

  if (state.pendingPromotion) {
    const piece = state.board.get(state.pendingPromotion.to);
    if (!piece) return [];
    return availablePromotionRoles(state, piece.color).map(role => ({ kind: 'promote', role }));
  }

  if (state.cardFlipped) {
    return state.legalPlacementSquares.map(square => ({ kind: 'place-piece', square }));
  }

  const actions: EngineAction[] = [];

  if (state.turnMode !== 'must-place') {
    for (const [from, destinations] of state.legalMoves) {
      for (const to of destinations) actions.push({ kind: 'move-piece', from, to });
    }
  }

  if (state.turnMode !== 'must-move' && currentDeckHasCards(state)) {
    actions.push({ kind: 'flip-card' });
  }

  return actions;
}

export function chooseRandomEngineAction(
  state: GameState,
  random: () => number = Math.random,
): EngineAction | null {
  const actions = legalEngineActions(state);
  if (actions.length === 0) return null;
  return actions[Math.floor(random() * actions.length)];
}

export function applyEngineAction(state: GameState, action: EngineAction): GameState {
  switch (action.kind) {
    case 'flip-card':
      return flipCard(state);
    case 'place-piece':
      return placePiece(state, action.square);
    case 'move-piece':
      return makeMove(state, action.from, action.to);
    case 'promote':
      return completePromotion(state, action.role);
  }
}

export function playRandomEngineStep(
  state: GameState,
  random: () => number = Math.random,
): EngineStep {
  const action = chooseRandomEngineAction(state, random);
  return { action, state: action ? applyEngineAction(state, action) : state };
}

export function playRandomEngineTurn(
  state: GameState,
  random: () => number = Math.random,
): EngineStep {
  const first = chooseRandomEngineAction(state, random);
  if (!first) return { action: null, state };

  let next = applyEngineAction(state, first);
  if (first.kind === 'flip-card' && next.cardFlipped) {
    const placement = chooseRandomEngineAction(next, random);
    if (placement?.kind === 'place-piece') next = applyEngineAction(next, placement);
  }

  if (next.pendingPromotion) {
    const promotion = chooseRandomEngineAction(next, random);
    if (promotion?.kind === 'promote') next = applyEngineAction(next, promotion);
  }

  return { action: first, state: next };
}
