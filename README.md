# Raindrop Chess

A browser-based implementation of [Raindrop Chess](https://raindropchess.com/game-explanation/) — a card-driven chess variant where players reveal and place pieces from a shuffled hand before standard chess moves begin.

## How to Play

For the full implemented rules, including check handling and promotion behavior, see [docs/RAINDROP_RULES.md](docs/RAINDROP_RULES.md).

### Setup
Each player starts with a shuffled deck of 16 cards:
- 1 King, 1 Queen, 2 Rooks, 2 Knights, 1 Light-square Bishop, 1 Dark-square Bishop, 8 Pawns

### Turn structure
1. **Flip Card** — Reveal the top card of your deck. The revealed piece type is shown.
2. **Place Piece** — Click a highlighted (legal) square to place that piece on the board.
3. **Once your King is placed**, you may choose each turn to either:
   - Flip and place a card as above, OR
   - **Make a Chess Move** — click a piece, then click its destination.
4. Play continues until one player's King is checkmated.

### Placement rules
| Piece | Legal squares |
|---|---|
| Queen, Rook, Knight | Any empty square |
| Bishop (light) | Light squares only |
| Bishop (dark) | Dark squares only |
| White Pawn | Ranks 2–6 (cannot be placed on rank 1 or 8) |
| Black Pawn | Ranks 3–7 (cannot be placed on rank 1 or 8) |
| King | Any empty square not attacked by an opponent's piece |

Pieces can give check when placed.

## Getting Started

```bash
npm install
npm run dev
```

Open the URL printed in the terminal. Two players share the same screen (hot-seat).

For a simple two-device multiplayer deployment plan, see [docs/MULTIPLAYER_DEPLOYMENT_PLAN.md](docs/MULTIPLAYER_DEPLOYMENT_PLAN.md).

## Building for Production

```bash
npm run build
npm run preview
```

## Deployment

Pushes to `main` deploy through GitHub Pages. The Vite build uses `/raindrop_chess/` as its production base path, so the expected project URL is:

`https://michaeljirasek.com/raindrop_chess/`

Configure these GitHub repository variables before deploying multiplayer:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Tech Stack

- **React 18** + **TypeScript** + **Vite**
- **Tailwind CSS v4**
- **chessground** — Lichess open-source board UI (GPL-3.0)
- **chessops** — Lichess open-source chess logic (GPL-3.0)

## Credits and Licensing

This project uses two open-source libraries from the [Lichess](https://lichess.org) project:

- [**chessground**](https://github.com/lichess-org/chessground) (GPL-3.0) — interactive chess board UI
- [**chessops**](https://github.com/niklasf/chessops) (GPL-3.0) — chess move generation and attack detection

This project is released under GPL-3.0 in compliance with those licences. It is not affiliated with, endorsed by, or sponsored by Lichess or its team.

Raindrop Chess rules © their respective creators. See [raindropchess.com](https://raindropchess.com/game-explanation/) for the official rules.
