import { describe, expect, it } from 'vitest';
import { createInitialState } from '../rules/gameState';
import { legalEngineActions, playRandomEngineTurn } from './randomEngine';

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
});
