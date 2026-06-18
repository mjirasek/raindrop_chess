import { describe, expect, it } from 'vitest';
import { cgKeyToSquare, legalPlacementSquares, squareColor } from './chessEngine';

describe('square colors', () => {
  it('matches standard chessboard coloring', () => {
    expect(squareColor(cgKeyToSquare('a1'))).toBe('dark');
    expect(squareColor(cgKeyToSquare('b1'))).toBe('light');
    expect(squareColor(cgKeyToSquare('a8'))).toBe('light');
    expect(squareColor(cgKeyToSquare('h8'))).toBe('dark');
  });
});

describe('bishop placement', () => {
  it('places dark-square bishops only on dark squares', () => {
    const legal = legalPlacementSquares('bishop-dark', 'white', new Map());

    expect(legal).toContain(cgKeyToSquare('a1'));
    expect(legal).toContain(cgKeyToSquare('h8'));
    expect(legal).not.toContain(cgKeyToSquare('b1'));
    expect(legal).not.toContain(cgKeyToSquare('a8'));
  });

  it('places light-square bishops only on light squares', () => {
    const legal = legalPlacementSquares('bishop-light', 'white', new Map());

    expect(legal).toContain(cgKeyToSquare('b1'));
    expect(legal).toContain(cgKeyToSquare('a8'));
    expect(legal).not.toContain(cgKeyToSquare('a1'));
    expect(legal).not.toContain(cgKeyToSquare('h8'));
  });
});
