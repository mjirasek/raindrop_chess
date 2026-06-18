# Raindrop Chess Rules

This document describes the rules used by this app. Raindrop Chess starts from an empty chessboard. Players reveal cards from their own shuffled piece decks and decide where those pieces enter the board.

## Components

Each player has a deck of 16 cards:

- 1 king
- 1 queen
- 2 rooks
- 2 knights
- 1 light-square bishop
- 1 dark-square bishop
- 8 pawns

The board is a normal 8 by 8 chessboard. Square colors follow standard chess coloring: `a1` is dark, `h1` is light, `a8` is light, and `h8` is dark.

## Goal

Win by checkmating the opponent's king.

## Turn Order

White starts.

On a turn before your king is on the board:

1. Flip the top card from your deck.
2. Place that piece on a legal empty square.
3. The turn passes to the opponent.

On a turn after your king is on the board:

1. If you have cards left and are not forced to move, you may flip and place a card.
2. Or you may make a normal chess move with one of your pieces.
3. The turn passes to the opponent after a legal placement or move.

## Placement Rules

All placed pieces must go on empty squares.

Piece-specific placement:

| Card | Legal placement squares |
| --- | --- |
| King | Any empty square not attacked by an enemy piece |
| Queen | Any empty square |
| Rook | Any empty square |
| Knight | Any empty square |
| Light-square bishop | Empty light squares only |
| Dark-square bishop | Empty dark squares only |
| White pawn | Empty squares on ranks 2 through 6 |
| Black pawn | Empty squares on ranks 3 through 7 |

A placed piece may immediately give check.

## Check

If your king is in check, the check must be resolved.

In this app:

- You may make a legal chess move that removes the check.
- If you still have cards, you may flip a card and try to place it so the check is blocked, the attacker is captured by placement, or the king is otherwise no longer in check.
- If the flipped card has no legal placement that resolves check, the player who flipped it loses.
- If you have no legal moves and no cards that can resolve the check, you are checkmated.

## Movement After Pieces Are Placed

Pieces move and capture like normal chess:

- King moves one square in any direction and may not move into check.
- Queen moves any distance along ranks, files, or diagonals.
- Rook moves any distance along ranks or files.
- Bishop moves any distance diagonally.
- Knight moves in an L shape and may jump over pieces.
- Pawn moves one square forward into an empty square, may move two squares from its starting rank if both squares are empty, and captures one square diagonally forward.

Current app behavior:

- Pawn promotion is implemented.
- Castling is not implemented.
- En passant is not implemented.

## Pawn Promotion

When a pawn reaches the farthest rank, it promotes immediately:

- White promotes on rank 8.
- Black promotes on rank 1.
- The choice is queen, rook, bishop, or knight.

Promotion is not limited by captured pieces or by the original deck contents. For example, a side may have more than one queen after promotion.

There is still a hard upper bound: each side starts with only 8 pawns, so each side can promote at most 8 times in a game. The app tracks this as "promotions left".

## Game End

The game ends when one side is checkmated, loses after flipping a card that cannot resolve check, or loses on time if a clock is enabled.

