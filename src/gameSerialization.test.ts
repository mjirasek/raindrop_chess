import { describe, expect, it } from 'vitest';
import { createInitialState, flipCard, placePiece } from './gameState';
import { deserializeGameState, serializeGameState } from './gameSerialization';

describe('game serialization', () => {
  it('round-trips map-backed state for multiplayer storage', () => {
    const flipped = flipCard(createInitialState());
    const square = flipped.legalPlacementSquares[0];
    const placed = placePiece(flipped, square);

    const roundTripped = deserializeGameState(serializeGameState(placed));

    expect(Array.from(roundTripped.board.entries())).toEqual(Array.from(placed.board.entries()));
    expect(roundTripped.turn).toBe(placed.turn);
    expect(roundTripped.whiteDecks.pile.length).toBe(placed.whiteDecks.pile.length);
    expect(roundTripped.blackDecks.pile.length).toBe(placed.blackDecks.pile.length);
    expect(roundTripped.promotionCounts).toEqual(placed.promotionCounts);
  });
});
