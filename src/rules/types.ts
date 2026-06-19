export type Color = 'white' | 'black';

export type CardType =
  | 'king'
  | 'queen'
  | 'rook'
  | 'knight'
  | 'bishop-light'
  | 'bishop-dark'
  | 'pawn';

export interface Card {
  type: CardType;
  id: number;
}

export interface Deck {
  pile: Card[];
  revealed: Card | null;
}

export type CGRole = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PromotionRole = 'queen' | 'rook' | 'bishop' | 'knight';
export type CGKey = string;

export interface CGPiece {
  role: CGRole;
  color: Color;
}

export type Square = number;

export type TurnMode =
  | 'must-place'  // king not yet placed — must flip card and place
  | 'choose'      // king placed — may flip+place OR move
  | 'must-move';  // king in check — must resolve via move (or place to block)

export interface GameState {
  board: Map<Square, CGPiece>;
  whiteDecks: Deck;
  blackDecks: Deck;
  promotionCounts: Record<Color, number>;
  promotionRolesUsed: Record<Color, PromotionRole[]>;
  turn: Color;
  turnMode: TurnMode;
  cardFlipped: boolean;
  whiteKingPlaced: boolean;
  blackKingPlaced: boolean;
  legalPlacementSquares: Square[];
  legalMoves: Map<Square, Square[]>;
  inCheck: boolean;
  gameOver: boolean;
  winner: Color | null;
  drawOfferBy: Color | null;
  /** Set when a pawn reaches the back rank; cleared after promotion choice */
  pendingPromotion: { from: Square; to: Square } | null;
}
