import { describe, expect, it } from 'vitest';
import { createInitialState, legalMovesForState } from '../rules/gameState';
import type { GameState } from '../rules/types';
import { chooseRandomEngineAction, legalEngineActions, playRandomEngineTurn } from './randomEngine';

describe('random engine', () => {
  it('starts by flipping a card when placement is required', () => {
    const state = createInitialState();

    expect(legalEngineActions(state)).toEqual([{ kind: 'flip-card' }]);
  });

  it('can complete one random turn from the initial state', () => {
    const state = createInitialState();
    const result = playRandomEngineTurn(state, () => 0);

    expect(result.action).toEqual({ kind: 'flip-card' });
    expect(result.state.turn).toBe('black');
    expect(result.state.cardFlipped).toBe(false);
    expect(result.state.board.size).toBe(1);
  });

  it('balances card flips against moves after the king is placed', () => {
    const state: GameState = {
      ...createInitialState(),
      board: new Map([
        [4, { role: 'king', color: 'white' }],
        [60, { role: 'king', color: 'black' }],
        [56, { role: 'rook', color: 'black' }],
      ]),
      turn: 'black',
      turnMode: 'choose',
      whiteKingPlaced: true,
      blackKingPlaced: true,
    };
    state.legalMoves = legalMovesForState(state, 'black');

    expect(legalEngineActions(state).some(action => action.kind === 'move-piece')).toBe(true);
    expect(chooseRandomEngineAction(state, () => 0.25)?.kind).toBe('flip-card');
    expect(chooseRandomEngineAction(state, () => 0.75)?.kind).toBe('move-piece');
  });
});
