# Destovky Engine Plan

This folder owns computer-player decision logic. It should depend on `src/rules`, but `src/rules` should never depend on engine code or React UI.

## Current Engine

- `randomEngine.ts` is the first playable baseline.
- It asks the rules layer for legal actions.
- It applies one full turn for the computer.
- It is intentionally weak, but legal.
- When both moving and drawing are possible, it now chooses the action category first:
  - draw a card with weight `flipCardWeight`
  - move an existing piece with weight `moveWeight`
  - then choose a random legal action inside that category

This avoids the old behavior where moving was overrepresented because one turn could have many legal moves but only one `flip-card` action.

## Folder Boundaries

- `src/rules`: deterministic game rules, legal moves, placements, promotion limits, serialization.
- `src/engine`: decision making, search, randomness, evaluation, training hooks.
- `src/components`: React UI only.
- `src/App.tsx`: current app wiring between UI, rules, multiplayer, and engine.

## Short-Term Engine Levels

1. **Random Legal**
   - Current baseline.
   - Randomly choose between drawing and moving.
   - Randomly choose placement, move, and promotion.

2. **Heuristic Random**
   - Still stochastic, but biased.
   - Prefer safe king placement.
   - Prefer checking moves.
   - Prefer captures by value.
   - Prefer drawing while material is low.
   - Avoid obviously hanging the king.

3. **One-Ply Evaluator**
   - Generate all legal actions or full legal turns.
   - Score resulting positions.
   - Add noise so it does not play the same line every game.
   - Evaluation features:
     - material
     - king safety
     - check / checkmate threats
     - mobility
     - deck cards remaining
     - promotion options remaining
     - piece activity and board control

4. **Monte Carlo Engine**
   - For each candidate action, run random playouts.
   - Estimate win/draw/loss score.
   - This fits Destovky because hidden shuffled decks add poker-like uncertainty.
   - Keep playouts time-limited for browser performance.

5. **MCTS**
   - Use AlphaGo-style Monte Carlo Tree Search.
   - Nodes are game states.
   - Edges are legal actions.
   - Selection uses UCB/PUCT.
   - Expansion uses the rules layer.
   - Rollouts start random, then later use a learned policy.

6. **Learned Policy + Value**
   - Train a model from self-play games.
   - Policy head predicts promising actions.
   - Value head predicts expected outcome.
   - Use MCTS to improve play, then train on improved decisions.

## Poker-Like Uncertainty

Destovky has hidden information through shuffled decks. The engine should treat unrevealed cards probabilistically.

Useful concepts:

- **Belief state**: what cards could still be in each deck.
- **Chance nodes**: card draws are random events, not player choices.
- **Sampling**: evaluate several possible deck futures rather than assuming one.
- **Risk preference**: sometimes drawing in check is a gamble; the engine should price that risk.

Initial practical approach:

1. Track visible cards, revealed cards, and cards already placed.
2. Derive possible remaining deck cards.
3. During Monte Carlo rollouts, sample hidden deck order.
4. Score actions by average result across samples.

## Suggested Interfaces

```ts
export interface EngineContext {
  state: GameState;
  timeLimitMs: number;
  random: () => number;
}

export interface EngineDecision {
  action: EngineAction | null;
  score?: number;
  principalVariation?: EngineAction[];
  explanation?: string;
}

export interface Engine {
  name: string;
  chooseAction(context: EngineContext): EngineDecision;
}
```

The UI can then choose:

- random engine
- heuristic engine
- Monte Carlo engine
- future neural/MCTS engine

## Development Order

1. Keep `randomEngine.ts` as the regression baseline.
2. Add `turnGenerator.ts` that enumerates full legal turns, not only single actions.
3. Add `evaluate.ts` with a simple static evaluation.
4. Add `heuristicEngine.ts`.
5. Add deterministic seeded random for reproducible tests.
6. Add `monteCarloEngine.ts` with a small rollout budget.
7. Save completed games as training data.
8. Build an offline self-play runner.
9. Only then consider neural policy/value training.

## Testing Requirements

- Every engine must only output legal actions.
- Engine output must be reproducible when seeded.
- Engines must respect promotion limits.
- Engines must handle pending promotion.
- Engines must handle in-check card gambles.
- Browser engines must respect a time budget.
