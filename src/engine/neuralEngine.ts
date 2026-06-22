/**
 * Neural network engine for Destovky.
 *
 * Loads engine.onnx (4.5 MB, shipped as a static asset) via onnxruntime-web
 * and runs inference in the browser — no server required.
 *
 * Encoding mirrors training/models/network.py encode_state() exactly:
 *   [0:768]   board planes  (12 × 64)
 *   [768:780] deck counts   (6 per color, normalised)
 *   [780:790] scalars
 *
 * Action index space (ACTION_SIZE = 4165):
 *   0          flip
 *   1..64      place at square sq  (idx = sq + 1)
 *   65..4160   move from→to        (idx = 65 + from*64 + to)
 *   4161..4164 promote queen/rook/bishop/knight
 */

import * as ort from 'onnxruntime-web';
import type { GameState, CGRole, Color, PromotionRole } from '../rules/types';
import type { EngineAction } from './randomEngine';

// ── Constants ─────────────────────────────────────────────────────────────────

const N_FEATURES  = 790;
const ACTION_SIZE = 4165;
const TEMPERATURE = 0.3;    // lower = more decisive; reduces cycling

export const ENGINE_VERSION = 'Gen7';   // bump this whenever engine.onnx is replaced

const ROLES: CGRole[]        = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const COLORS: Color[]        = ['white', 'black'];
const PROMOTE_ROLES: PromotionRole[] = ['queen', 'rook', 'bishop', 'knight'];

// plane index: white-pawn=0 … white-king=5, black-pawn=6 … black-king=11
const PLANE: Record<string, number> = {};
for (let ci = 0; ci < COLORS.length; ci++)
  for (let ri = 0; ri < ROLES.length; ri++)
    PLANE[`${COLORS[ci]}-${ROLES[ri]}`] = ci * 6 + ri;

const MAX_PER_ROLE: Record<string, number> =
  { pawn: 8, knight: 2, bishop: 2, rook: 2, queen: 1, king: 1 };


// ── Session singleton ─────────────────────────────────────────────────────────

let _session: ort.InferenceSession | null = null;
let _loading: Promise<ort.InferenceSession> | null = null;

export async function loadNeuralEngine(): Promise<ort.InferenceSession> {
  if (_session) return _session;
  if (_loading)  return _loading;

  _loading = (async () => {
    const url = import.meta.env.BASE_URL + 'engine.onnx';
    const session = await ort.InferenceSession.create(url, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    _session = session;
    return session;
  })();

  return _loading;
}


// ── State encoder ─────────────────────────────────────────────────────────────

function encodeState(state: GameState): Float32Array {
  const feat = new Float32Array(N_FEATURES);

  // Board planes (0..767)
  for (const [sq, piece] of state.board) {
    const plane = PLANE[`${piece.color}-${piece.role}`];
    if (plane !== undefined) feat[plane * 64 + sq] = 1;
  }

  // Deck counts (768..779) — composition only, NOT order (deck is face-down)
  const countDeck = (pile: { type: string }[]) => {
    const cnt: Record<string, number> = {};
    for (const card of pile) {
      const role = card.type.split('-')[0]; // 'bishop-light' → 'bishop'
      cnt[role] = (cnt[role] ?? 0) + 1;
    }
    return cnt;
  };

  const wCnt = countDeck(state.whiteDecks.pile);
  const bCnt = countDeck(state.blackDecks.pile);
  for (let i = 0; i < ROLES.length; i++) {
    const role = ROLES[i];
    feat[768 + i]     = (wCnt[role] ?? 0) / MAX_PER_ROLE[role];
    feat[768 + 6 + i] = (bCnt[role] ?? 0) / MAX_PER_ROLE[role];
  }

  // Scalars (780..789)
  feat[780] = state.turn === 'black'            ? 1 : 0;
  feat[781] = state.whiteKingPlaced             ? 1 : 0;
  feat[782] = state.blackKingPlaced             ? 1 : 0;
  feat[783] = state.inCheck                     ? 1 : 0;
  feat[784] = state.cardFlipped                 ? 1 : 0;
  feat[785] = state.turnMode === 'must-place'   ? 1 : 0;
  feat[786] = state.turnMode === 'choose'       ? 1 : 0;
  feat[787] = state.turnMode === 'must-move'    ? 1 : 0;
  feat[788] = state.whiteDecks.pile.length / 16;
  feat[789] = state.blackDecks.pile.length / 16;

  return feat;
}


// ── Action ↔ index ────────────────────────────────────────────────────────────

function actionToIdx(action: EngineAction): number {
  switch (action.kind) {
    case 'flip-card':   return 0;
    case 'place-piece': return action.square + 1;
    case 'move-piece':  return 65 + action.from * 64 + action.to;
    case 'promote':     return 4161 + PROMOTE_ROLES.indexOf(action.role);
  }
}

function idxToAction(idx: number): EngineAction {
  if (idx === 0)     return { kind: 'flip-card' };
  if (idx <= 64)     return { kind: 'place-piece', square: idx - 1 };
  if (idx <= 4160) {
    const i = idx - 65;
    return { kind: 'move-piece', from: Math.floor(i / 64), to: i % 64 };
  }
  return { kind: 'promote', role: PROMOTE_ROLES[idx - 4161] };
}


// ── Board position hash (for repetition detection) ────────────────────────────

export function boardHash(state: GameState): string {
  const entries = Array.from(state.board.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sq, p]) => `${sq}${p.color[0]}${p.role[0]}`);
  return `${state.turn}:${entries.join(',')}`;
}


// ── Main inference ────────────────────────────────────────────────────────────

import { legalEngineActions, applyEngineAction } from './randomEngine';

export async function chooseNeuralAction(
  state: GameState,
  session: ort.InferenceSession,
  recentHashes?: Set<string>,
): Promise<EngineAction | null> {
  let legal = legalEngineActions(state);
  if (legal.length === 0) return null;

  // Filter out move-piece actions that return to a recently seen position
  if (recentHashes && recentHashes.size > 0) {
    const nonRepeating = legal.filter(a => {
      if (a.kind !== 'move-piece') return true;
      return !recentHashes.has(boardHash(applyEngineAction(state, a)));
    });
    if (nonRepeating.length > 0) legal = nonRepeating;
  }

  if (legal.length === 1) return legal[0];

  try {
    const feat   = encodeState(state);
    const tensor = new ort.Tensor('float32', feat, [1, N_FEATURES]);
    const out    = await session.run({ state: tensor });
    const logits = out['policy'].data as Float32Array;

    // Build legal mask — set illegal to -Infinity
    const masked = new Float32Array(ACTION_SIZE).fill(-Infinity);
    for (const a of legal) {
      const idx = actionToIdx(a);
      masked[idx] = logits[idx];
    }

    // Softmax over legal actions
    const legalIdxs = legal.map(actionToIdx);
    const maxL = Math.max(...legalIdxs.map(i => masked[i]));
    const exps = legalIdxs.map(i => Math.exp((masked[i] - maxL) / TEMPERATURE));
    const total = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / total);

    // Sample
    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < legalIdxs.length; i++) {
      cum += probs[i];
      if (r <= cum) return idxToAction(legalIdxs[i]);
    }
    return idxToAction(legalIdxs[legalIdxs.length - 1]);

  } catch {
    // Fallback to random on any inference error
    return legal[Math.floor(Math.random() * legal.length)];
  }
}
