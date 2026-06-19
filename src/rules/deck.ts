import type { Card, CardType } from './types';

const DECK_TEMPLATE: CardType[] = [
  'king',
  'queen',
  'rook',
  'rook',
  'bishop-light',
  'bishop-dark',
  'knight',
  'knight',
  'pawn',
  'pawn',
  'pawn',
  'pawn',
  'pawn',
  'pawn',
  'pawn',
  'pawn',
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createDeck(): Card[] {
  return shuffle(DECK_TEMPLATE.map((type, id) => ({ type, id })));
}
