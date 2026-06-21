"""
Phase 4 — Self-play data generation for Destovky.

Two modes:
  fast  Heuristic softmax scores as policy targets.  No MCTS, <1ms/step.
  mcts  IS-MCTS visit counts as policy targets.  ~100ms/step, higher quality.

Stockfish value labelling (--sf flag):
  For chess-phase positions (both kings placed, not in placement mode),
  Stockfish evaluates the board and provides a centipawn score converted to
  a value in [-1, 1].  This replaces the noisy binary game-outcome signal
  for those positions, dramatically reducing the 83% draw bias.

Each example dict:
  features    np.float16  length N_FEATURES
  policy_idx  np.int16    sparse action indices
  policy_val  np.float16  sparse action probabilities
  value       float       value from current player's POV
  color       str         'white'|'black'

Output: training/data/selfplay_MODE_YYYYMMDD_HHMMSS.pkl

Usage:
  python -m training.scripts.selfplay --games 500 --mode fast --workers 1
  python -m training.scripts.selfplay --games 500 --mode fast --workers 1 --sf
  python -m training.scripts.selfplay --games 200 --mode mcts --workers 1 --sf
"""

import os, sys, time, pickle, random, argparse, multiprocessing as mp
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))

MAX_TURNS = 500   # cap per game; keeps draw rate low

_SF_EXE = os.path.abspath(os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    'stockfish', 'stockfish', 'stockfish-windows-x86-64.exe',
))


# ── Helpers ───────────────────────────────────────────────────────────────────

def _chess_phase(state: dict) -> bool:
    """True when Stockfish can meaningfully evaluate the position."""
    return (state.get('white_king_placed', False) and
            state.get('black_king_placed', False) and
            not state.get('card_flipped', False) and
            state.get('pending_promotion') is None)


def _sf_value(engine, state: dict) -> float | None:
    """
    Evaluate state with Stockfish, return centipawn → value in [-1, 1]
    from the current player's POV. Returns None if not applicable or error.
    """
    if not _chess_phase(state):
        return None
    try:
        import chess, chess.engine, math
        from training.agents.evaluate import to_chess_board

        cb = to_chess_board(state)
        cb.turn = chess.WHITE if state['turn'] == 'white' else chess.BLACK

        info  = engine.analyse(cb, chess.engine.Limit(time=0.001))  # ~1ms
        score = info['score'].pov(cb.turn).score(mate_score=30_000)
        if score is None:
            return None
        # sigmoid(cp / 400) maps ±400cp → ±0.76, ±1000cp → ±0.97
        return float(2.0 / (1.0 + __import__('math').exp(-score / 400.0)) - 1.0)
    except Exception:
        return None


def _rollout_sf_value(engine, state: dict, rng, max_steps: int = 60) -> float | None:
    """
    For non-chess-phase positions (placement phase, one king missing, etc.):
    fast-forward to chess phase using heuristic policy, then SF-evaluate.

    Handles the asymmetric case where one player already has their king placed
    and can make chess moves while the other is still in placement mode —
    the rollout plays both sides with heuristic_policy until _chess_phase().

    Returns value from the CURRENT player's POV at the original state, or None.
    Blend weight for the caller: 0.5 (softer than 0.7 for direct SF eval).
    """
    if not engine:
        return None

    from training.engine.mcts import _apply

    original_turn = state['turn']
    s = state
    steps = 0

    # Play forward with heuristic policy until chess phase or game over.
    # Use default temperature (80) for diverse, realistic placement.
    while not s.get('game_over') and not _chess_phase(s) and steps < max_steps:
        vm = heuristic_policy(s)   # default temperature
        if not vm:
            break
        actions = list(vm.keys())
        weights  = [vm[a] for a in actions]
        action   = rng.choices(actions, weights=weights, k=1)[0]
        s        = _apply(s, action)
        steps   += 1

    if s.get('game_over'):
        winner = s.get('winner')
        if winner is None:
            return 0.0
        return 1.0 if winner == original_turn else -1.0

    if _chess_phase(s):
        sf_v = _sf_value(engine, s)
        if sf_v is None:
            return None
        # SF gives value from s['turn']'s POV — flip if turn parity changed
        return sf_v if s['turn'] == original_turn else -sf_v

    return None  # couldn't reach chess phase within max_steps


def _open_sf():
    """Open a Stockfish engine, return it or None on failure."""
    exe = os.environ.get('STOCKFISH_PATH') or _SF_EXE
    if not os.path.exists(exe):
        print(f'[selfplay] Stockfish not found at {exe}', flush=True)
        return None
    try:
        import chess.engine
        engine = chess.engine.SimpleEngine.popen_uci(exe)
        engine.configure({'Threads': 1, 'Hash': 16})
        return engine
    except Exception as e:
        print(f'[selfplay] Stockfish failed to start: {e}', flush=True)
        return None


# ── Policy extractors ─────────────────────────────────────────────────────────

def expectimax_policy(state, sf_engine, temperature=None):
    """Policy using expectimax reasoning at 'choose' turns.

    At turns where both flip and chess moves are available, computes:
      flip_val = E[V(flip)] via expectimax over deck composition
      move_val = max SF eval over legal moves
    Then uses softmax to split probability between flip and chess moves.
    Individual move probabilities are weighted by heuristic scores.
    Falls back to heuristic_policy at all other turns.
    """
    import math
    if state['turn_mode'] != 'choose':
        return heuristic_policy(state, temperature=temperature)

    from training.agents.random_agent import legal_actions as _legal_actions
    actions   = _legal_actions(state)
    has_flip  = any(a[0] == 'flip'  for a in actions)
    has_moves = any(a[0] == 'move'  for a in actions)

    if not has_flip or not has_moves:
        return heuristic_policy(state, temperature=temperature)

    try:
        from training.agents.expectimax_agent import _expected_flip_value, _best_chess_move
        flip_val    = _expected_flip_value(state, sf_engine, top_k=3)
        _, move_val = _best_chess_move(state, sf_engine)
    except Exception:
        return heuristic_policy(state, temperature=temperature)

    # Softmax over flip_val vs move_val (scale=4 → reasonable sharpness)
    scale     = 4.0
    exp_f     = math.exp(scale * flip_val)
    exp_m     = math.exp(scale * move_val)
    flip_prob = exp_f / (exp_f + exp_m)
    move_prob = exp_m / (exp_f + exp_m)

    # Distribute move_prob across individual moves using heuristic weights
    heur = heuristic_policy(state, temperature=temperature)
    move_heur_total = sum(v for a, v in heur.items() if a[0] == 'move')

    policy = {}
    for a, v in heur.items():
        if a[0] == 'flip':
            policy[a] = flip_prob
        elif a[0] == 'move':
            share = (v / move_heur_total) if move_heur_total > 0 else 1.0
            policy[a] = move_prob * share
        else:
            policy[a] = v  # promotions unchanged

    total_p = sum(policy.values())
    if total_p > 0:
        policy = {a: v / total_p for a, v in policy.items()}
    return policy


def _softmax_weights(scores, temperature=80.0):
    import math
    max_s = max(scores)
    w = [math.exp((s - max_s) / max(temperature, 1)) for s in scores]
    total = sum(w)
    return [x / total for x in w]


def heuristic_policy(state, temperature=None):
    """Return {action: probability} using heuristic scoring. No MCTS.

    temperature: softmax temperature in centipawns. None = use TEMPERATURE from
                 heuristic_agent (default 80). Lower = more decisive play.
    """
    from training.engine.game_state import available_promotion_roles
    from training.agents.heuristic_agent import (
        score_move, score_placement, _flip_weight, TEMPERATURE,
    )
    if temperature is None:
        temperature = TEMPERATURE

    PROMOTION_ORDER = ['queen', 'rook', 'bishop', 'knight']
    color = state['turn']
    board = state['board']
    deck  = state['white_deck'] if color == 'white' else state['black_deck']
    rev   = state['white_revealed'] if color == 'white' else state['black_revealed']
    tm    = state['turn_mode']

    if state['pending_promotion'] is not None:
        avail = available_promotion_roles(state, color)
        for role in PROMOTION_ORDER:
            if role in avail:
                return {('promote', role): 1.0}
        return {}

    if state['card_flipped']:
        if not rev or not state['legal_placement_sq']:
            return {}
        scored = [(score_placement(board, rev, color, sq), ('place', sq))
                  for sq in state['legal_placement_sq']]
        if not scored:
            return {}
        scores, actions = zip(*scored)
        return dict(zip(actions, _softmax_weights(list(scores), temperature)))

    scored = []
    if tm != 'must-place':
        for from_sq, dests in state['legal_moves'].items():
            for to_sq in dests:
                scored.append((score_move(board, from_sq, to_sq, color),
                                ('move', from_sq, to_sq)))
    if tm != 'must-move' and deck:
        scored.append((_flip_weight(state), ('flip',)))

    if not scored:
        return {}
    scores, actions = zip(*scored)
    return dict(zip(actions, _softmax_weights(list(scores), temperature)))


def mcts_policy(state, rng, n_det, time_ms):
    """Return {action: probability} from IS-MCTS visit counts."""
    from collections import defaultdict
    from training.engine.game_state import available_promotion_roles
    from training.engine.mcts import mcts_search
    from training.agents.mcts_agent import _determinize, PROMOTION_ORDER
    from training.agents.random_agent import legal_actions

    if state['pending_promotion'] is not None:
        color = state['turn']
        avail = available_promotion_roles(state, color)
        for role in PROMOTION_ORDER:
            if role in avail:
                return {('promote', role): 1.0}
        return {}

    if state['card_flipped']:
        return heuristic_policy(state)

    actions = legal_actions(state)
    if not actions:
        return {}
    if len(actions) == 1:
        return {actions[0]: 1.0}

    color = state['turn']
    if not state['white_king_placed'] or not state['black_king_placed']:
        return heuristic_policy(state)

    combined = defaultdict(int)
    for _ in range(n_det):
        det  = _determinize(state, rng)
        root = mcts_search(det, color, time_ms, rng)
        for action, (visits, _) in root.child_stats().items():
            combined[action] += visits

    if not combined:
        return heuristic_policy(state)
    total = sum(combined.values())
    return {a: v / total for a, v in combined.items()}


# ── Single game ───────────────────────────────────────────────────────────────

def play_selfplay_game(mode, n_det, time_ms, rng=None, sf_engine=None, temperature=None,
                       agent='heuristic'):
    if rng is None:
        rng = random.Random()

    from training.engine.game_state import create_initial_state
    from training.engine.mcts import _apply
    from training.models.network import encode_state, action_to_idx, ACTION_SIZE
    import numpy as np

    state    = create_initial_state()
    examples = []
    turn_idx = 0

    while not state['game_over'] and turn_idx < MAX_TURNS:
        if agent == 'expectimax':
            vm = expectimax_policy(state, sf_engine, temperature=temperature)
        elif agent == 'composite':
            from training.agents.composite_agent import composite_policy
            vm = composite_policy(state, rng,
                                  temperature=temperature if temperature is not None else 80)
        elif mode == 'fast':
            vm = heuristic_policy(state, temperature=temperature)
        else:
            vm = mcts_policy(state, rng, n_det, time_ms)
        if not vm:
            break

        # Sparse policy: only store non-zero entries (typically <40 out of 4165)
        p_idx, p_val = [], []
        for action, prob in vm.items():
            try:
                p_idx.append(action_to_idx(action))
                p_val.append(prob)
            except (ValueError, IndexError):
                pass

        # Stockfish value labelling:
        #   chess phase (both kings placed)     → direct SF,            blend 0.7
        #   asymmetric (one king placed)         → rollout to chess phase, blend 0.5
        #   pure placement (neither king placed) → game outcome only
        #     (too expensive + noisy to roll out 40+ moves; skip to keep speed)
        if sf_engine:
            if _chess_phase(state):
                sf_val   = _sf_value(sf_engine, state)
                sf_blend = 0.7
            elif state['white_king_placed'] or state['black_king_placed']:
                # One king placed: rollout is short (just need opponent to place king)
                sf_val   = _rollout_sf_value(sf_engine, state, rng, max_steps=30)
                sf_blend = 0.5
            else:
                # Neither king placed: skip rollout, use game outcome
                sf_val   = None
                sf_blend = 0.7  # unused
        else:
            sf_val   = None
            sf_blend = 0.7  # unused when sf_val is None

        examples.append({
            'features':   np.array(encode_state(state), dtype=np.float16),
            'policy_idx': np.array(p_idx, dtype=np.int16),
            'policy_val': np.array(p_val, dtype=np.float16),
            'color':      state['turn'],
            'turn_idx':   turn_idx,
            '_sf_val':    sf_val,    # temp; replaced below
            '_sf_blend':  sf_blend,  # temp; removed below
        })

        actions_list = list(vm.keys())
        weights      = [vm[a] for a in actions_list]
        action       = rng.choices(actions_list, weights=weights, k=1)[0]
        state        = _apply(state, action)
        turn_idx    += 1

    winner = state.get('winner')
    for ex in examples:
        if winner is None:
            game_val = 0.0
        elif winner == ex['color']:
            game_val = 1.0
        else:
            game_val = -1.0

        sf_v    = ex.pop('_sf_val',   None)
        sf_w    = ex.pop('_sf_blend', 0.7)
        if sf_v is not None:
            # Direct chess-phase SF: blend 0.7/0.3 (strong positional signal)
            # Rollout SF: blend 0.5/0.5 (softer — one heuristic rollout adds noise)
            ex['value'] = sf_w * sf_v + (1.0 - sf_w) * game_val
        else:
            ex['value'] = game_val

    return examples


# ── Batch worker — imports happen INSIDE the function for Windows spawn ───────

def _run_batch(args):
    """Multiprocessing worker: all heavy imports inside to avoid spawn issues."""
    import sys, os, random as rnd
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    sys.stdout.reconfigure(line_buffering=True)

    n_games, mode, n_det, time_ms, seed, use_sf, temperature, agent = args
    rng = rnd.Random(seed)

    # expectimax agent requires SF; open it even without --sf flag for value labelling
    sf_engine = _open_sf() if (use_sf or agent == 'expectimax') else None

    results = []
    for i in range(n_games):
        results.extend(play_selfplay_game(mode, n_det, time_ms, rng, sf_engine, temperature,
                                          agent=agent))
        if (i + 1) % 50 == 0:
            print(f'  {i+1}/{n_games} games done', flush=True)

    if sf_engine:
        try:
            sf_engine.quit()
        except Exception:
            pass

    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import sys as _sys
    _sys.stdout.reconfigure(line_buffering=True)

    ap = argparse.ArgumentParser()
    ap.add_argument('--games',   type=int,   default=500)
    ap.add_argument('--mode',    type=str,   default='fast', choices=['fast', 'mcts'])
    ap.add_argument('--workers', type=int,   default=1)
    ap.add_argument('--det',     type=int,   default=1)
    ap.add_argument('--ms',      type=float, default=20.0)
    ap.add_argument('--out',     type=str,   default='training/data')
    ap.add_argument('--sf',      action='store_true', default=False,
                    help='Use Stockfish to label chess-phase positions')
    ap.add_argument('--temp',    type=float, default=None,
                    help='Heuristic softmax temperature (centipawns). Default: 80 from heuristic_agent. Lower = more decisive.')
    ap.add_argument('--agent',   type=str,   default='heuristic',
                    choices=['heuristic', 'expectimax', 'composite'],
                    help='Policy agent for selfplay. composite = fast minimax, no SF needed.')
    args = ap.parse_args()

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(os.getcwd(), args.out)
    os.makedirs(out_dir, exist_ok=True)

    n_workers  = min(args.workers, args.games)
    batch_size = max(1, args.games // n_workers)
    batches    = []
    remaining  = args.games
    seed_base  = int(time.time())
    while remaining > 0:
        g = min(batch_size, remaining)
        batches.append((g, args.mode, args.det, args.ms, seed_base + len(batches),
                        args.sf, args.temp, args.agent))
        remaining -= g

    mode_str  = args.mode + (f' (det={args.det}, ms={args.ms})' if args.mode == 'mcts' else '')
    agent_str = f' agent={args.agent}' if args.agent != 'heuristic' else ''
    sf_str    = ' +SF-labels' if args.sf else ''
    temp_str  = f' temp={args.temp}' if args.temp is not None else ''
    print(f'Generating {args.games} games  [{mode_str}{agent_str}{sf_str}{temp_str}]', flush=True)
    print(f'  Workers: {n_workers}  |  max_turns/game: {MAX_TURNS}', flush=True)

    t0 = time.time()
    if n_workers == 1:
        batch_results = [_run_batch(b) for b in batches]
    else:
        with mp.Pool(n_workers) as pool:
            batch_results = pool.map(_run_batch, batches)
    elapsed = time.time() - t0

    all_examples = []
    for batch in batch_results:
        all_examples.extend(batch)

    n_ex   = len(all_examples)
    n_gm   = args.games
    pos    = sum(1 for e in all_examples if e['value'] > 0)
    neg    = sum(1 for e in all_examples if e['value'] < 0)
    ties   = n_ex - pos - neg
    sf_ct  = sum(1 for e in all_examples if abs(e.get('value', 0.0)) < 0.99)

    ts       = datetime.now().strftime('%Y%m%d_%H%M%S')
    use_sf_tag = args.sf or args.agent == 'expectimax'  # expectimax always uses SF
    agent_tag  = f'_{args.agent}' if args.agent != 'heuristic' else ''
    tag        = args.mode + ('_sf' if use_sf_tag else '') + agent_tag
    out_path = os.path.join(out_dir, f'selfplay_{tag}_{ts}.pkl')
    with open(out_path, 'wb') as f:
        pickle.dump(all_examples, f, protocol=pickle.HIGHEST_PROTOCOL)

    import json
    meta_path = os.path.join(out_dir, 'selfplay_meta.json')
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            meta = json.load(f)
    meta['total_games']    = meta.get('total_games', 0) + n_gm
    meta['total_examples'] = meta.get('total_examples', 0) + n_ex
    with open(meta_path, 'w') as f:
        json.dump(meta, f)

    print(f'\nDone in {elapsed:.1f}s  ({n_gm/elapsed:.1f} games/s)', flush=True)
    print(f'  Examples: {n_ex}  ({n_ex/n_gm:.0f}/game)', flush=True)
    print(f'  Value dist: +={pos}  0={ties} ({ties/n_ex*100:.0f}% draw)  -={neg}', flush=True)
    if args.sf:
        blended = sum(1 for e in all_examples if 0.0 < abs(e['value']) < 1.0)
        # values blended 0.7 are direct SF; blended 0.5 are rollout SF
        # approximate: direct SF values cluster away from ±1.0/0.0 but differently
        print(f'  SF-blended examples: {blended} ({blended/n_ex*100:.0f}%)', flush=True)
    print(f'  Saved -> {out_path}', flush=True)
    return out_path, n_ex, elapsed, n_gm


if __name__ == '__main__':
    main()
