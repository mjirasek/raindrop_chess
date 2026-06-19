# Rules Module

This folder is the source of truth for Destovky game rules.

- `types.ts` defines board, cards, pieces, turn modes, and game state.
- `deck.ts` defines the piece-card deck.
- `chessEngine.ts` handles square conversion, attacks, check detection, legal placements, and legal chess moves.
- `gameState.ts` applies rule actions: flip card, place piece, move piece, complete promotion, and resolve the next turn.
- `gameSerialization.ts` converts game state to and from Supabase JSON.

Engine code should depend on this folder, not on React components. The default engine lives in `src/engine/randomEngine.ts` and chooses from legal rule actions. A stronger engine can replace that chooser while still calling the same `legalEngineActions` / `applyEngineAction` style boundary.
