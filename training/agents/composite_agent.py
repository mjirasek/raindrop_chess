"""
Composite agent for Destovky — hybrid fast-eval + minimax (no Stockfish).

Architecture:
  ┌─────────────────────────────────────────────────────────────┐
  │  Phase detection → route to appropriate component           │
  ├──────────────────────┬──────────────────────────────────────┤
  │  Placement phase     │  Heuristic placement + deck EV       │
  │  (kings missing)     │  for flip-vs-move decision           │
  ├──────────────────────┼──────────────────────────────────────┤
  │  Chess phase         │  Alpha-beta minimax (depth 2)        │
  │  (both kings placed) │  using material+PST fast eval        │
  ├──────────────────────┼──────────────────────────────────────┤
  │  Mixed phase         │  Heuristic + light depth-1 eval      │
  │  (one king placed)   │                                      │
  └──────────────────────┴──────────────────────────────────────┘

No Stockfish required — ~1–10 ms per decision vs 140 ms for expectimax.
Enables 10–30x more selfplay games per hour.

Usage:
  from training.agents.composite_agent import choose_action, composite_policy
  action = choose_action(state, rng)

Selfplay (no SF needed, much faster):
  python -m training.scripts.selfplay --mode fast --games 2000 --agent composite --workers 1
"""

from __future__ import annotations
import math
import random as _random

from ..engine.game_state import make_move, available_promotion_roles
from ..agents.heuristic_agent import (
    choose_action as _heuristic_choose,
    score_placement,
    _softmax_choice,
    TEMPERATURE,
    PROMOTION_ORDER,
    _card_role,
)
from ..agents.evaluate import material_pst, PIECE_CP

# ── Tuning ─────────────────────────────────────────────────────────────────────

MINIMAX_DEPTH   = 2       # half-moves ahead in full chess phase
MATE_SCORE      = 50_000  # cp
MOVE_CAP        = 25      # root branches evaluated (speed cap)
FLIP_RISK_SCALE = 0.25    # deck EV multiplier when comparing flip vs move
FLIP_THRESHOLD  = 120     # minimum deck EV (cp) before flipping is considered


# ── Fast evaluation ────────────────────────────────────────────────────────────

def _fast_eval(state: dict, color: str) -> float:
    """Material + PST + light mobility/check signals. Pure Python, <0.1 ms."""
    if state['game_over']:
        w = state.get('winner')
        if w == color:      return  MATE_SCORE
        elif w is None:     return  0.0
        else:               return -MATE_SCORE

    score = float(material_pst(state['board'], color))

    # Mobility: legal move count as activity proxy
    if state['turn'] == color:
        score += sum(len(v) for v in state['legal_moves'].values()) * 3.0

    # Check signals
    if state['in_check']:
        score += 30.0 if state['turn'] != color else -30.0

    return score


# ── Deck expected value ────────────────────────────────────────────────────────

def _deck_ev(deck: list[str]) -> float:
    """Average centipawn value of the cards remaining in deck."""
    if not deck:
        return 0.0
    return sum(PIECE_CP.get(_card_role(c), 0) for c in deck) / len(deck)


# ── Move ordering (MVV-LVA) ────────────────────────────────────────────────────

def _order_moves(legal_moves: dict, board: dict) -> list[tuple[int, int, int]]:
    """Return [(priority, from_sq, to_sq)] sorted captures-first."""
    moves = []
    for from_sq, dests in legal_moves.items():
        att_val = PIECE_CP.get(board[from_sq][0], 0)
        for to_sq in dests:
            cap = board.get(to_sq)
            priority = (PIECE_CP.get(cap[0], 0) * 10 - att_val) if cap else 0
            moves.append((priority, from_sq, to_sq))
    moves.sort(reverse=True)
    return moves


# ── Alpha-beta minimax ─────────────────────────────────────────────────────────

def _minimax(state: dict, depth: int, alpha: float, beta: float, root_color: str) -> float:
    if depth == 0 or state['game_over']:
        return _fast_eval(state, root_color)

    legal = state.get('legal_moves', {})
    if not legal:
        return _fast_eval(state, root_color)

    is_max = state['turn'] == root_color
    best   = -math.inf if is_max else math.inf

    for _, from_sq, to_sq in _order_moves(legal, state['board']):
        val = _minimax(make_move(state, from_sq, to_sq), depth - 1, alpha, beta, root_color)
        if is_max:
            if val > best: best = val
            alpha = max(alpha, val)
        else:
            if val < best: best = val
            beta = min(beta, val)
        if beta <= alpha:
            break
    return best


# ── Phase-specific choosers ────────────────────────────────────────────────────

def _chess_phase_action(state: dict) -> tuple | None:
    """Both kings placed — alpha-beta minimax at MINIMAX_DEPTH."""
    color     = state['turn']
    board     = state['board']
    turn_mode = state['turn_mode']
    legal     = state.get('legal_moves', {})
    deck      = state['white_deck'] if color == 'white' else state['black_deck']

    best_score = -math.inf
    best_move  = None

    for _, from_sq, to_sq in _order_moves(legal, board)[:MOVE_CAP]:
        score = _minimax(make_move(state, from_sq, to_sq),
                         MINIMAX_DEPTH - 1, -math.inf, math.inf, color)
        if score > best_score:
            best_score = score
            best_move  = ('move', from_sq, to_sq)

    if turn_mode == 'must-move':
        return best_move

    # choose mode: consider flipping
    if deck and not state['in_check']:
        ev = _deck_ev(deck)
        if ev >= FLIP_THRESHOLD and ev * FLIP_RISK_SCALE > best_score * 0.08:
            return ('flip',)

    return best_move or (('flip',) if deck else None)


def _mixed_phase_action(state: dict, rng) -> tuple | None:
    """One king placed — depth-1 eval for chess moves, heuristic otherwise."""
    color     = state['turn']
    board     = state['board']
    turn_mode = state['turn_mode']
    legal     = state.get('legal_moves', {})

    if turn_mode == 'must-move' and legal:
        best_score = -math.inf
        best_move  = None
        for _, from_sq, to_sq in _order_moves(legal, board)[:MOVE_CAP]:
            score = _fast_eval(make_move(state, from_sq, to_sq), color)
            if score > best_score:
                best_score = score
                best_move  = ('move', from_sq, to_sq)
        return best_move

    return _heuristic_choose(state, rng)


# ── Selfplay policy (probability distribution) ─────────────────────────────────

def composite_policy(state: dict, rng=None, temperature: float = TEMPERATURE) -> dict | None:
    """
    Return {action: probability} for selfplay training targets.
    Chess phase: scored distribution via _fast_eval + softmax.
    Other phases: delegate to heuristic.
    """
    if rng is None:
        rng = _random

    if state['game_over']:
        return None

    color = state['turn']
    board = state['board']
    opp   = 'black' if color == 'white' else 'white'

    if state['pending_promotion'] is not None:
        available = available_promotion_roles(state, color)
        for role in PROMOTION_ORDER:
            if role in available:
                return {('promote', role): 1.0}
        return None

    if state['card_flipped']:
        rev = state['white_revealed'] if color == 'white' else state['black_revealed']
        if not rev or not state['legal_placement_sq']:
            return None
        scored = [(score_placement(board, rev, color, sq), ('place', sq))
                  for sq in state['legal_placement_sq']]
        if not scored:
            return None
        return {_softmax_choice(scored, rng, temperature): 1.0}

    has_my_king  = any(p == ('king', color) for p in board.values())
    has_opp_king = any(p == ('king', opp)   for p in board.values())

    if has_my_king and has_opp_king:
        # Score all moves with fast eval, add flip as option
        legal     = state.get('legal_moves', {})
        deck      = state['white_deck'] if color == 'white' else state['black_deck']
        turn_mode = state['turn_mode']
        scored: list[tuple[float, tuple]] = []

        if turn_mode != 'must-place':
            for _, from_sq, to_sq in _order_moves(legal, board)[:MOVE_CAP]:
                s = _fast_eval(make_move(state, from_sq, to_sq), color)
                scored.append((s, ('move', from_sq, to_sq)))

        if turn_mode != 'must-move' and deck and not state['in_check']:
            scored.append((_deck_ev(deck) * FLIP_RISK_SCALE, ('flip',)))

        if not scored:
            return None
        return {_softmax_choice(scored, rng, temperature): 1.0}

    action = _heuristic_choose(state, rng)
    return {action: 1.0} if action else None


# ── Main entry point ───────────────────────────────────────────────────────────

def choose_action(state: dict, rng=None) -> tuple | None:
    """Greedy action selection for arena / evaluation."""
    if rng is None:
        rng = _random

    if state['game_over']:
        return None

    color = state['turn']
    board = state['board']
    opp   = 'black' if color == 'white' else 'white'

    if state['pending_promotion'] is not None:
        available = available_promotion_roles(state, color)
        for role in PROMOTION_ORDER:
            if role in available:
                return ('promote', role)
        return None

    if state['card_flipped']:
        rev = state['white_revealed'] if color == 'white' else state['black_revealed']
        if not rev or not state['legal_placement_sq']:
            return None
        scored = [(score_placement(board, rev, color, sq), ('place', sq))
                  for sq in state['legal_placement_sq']]
        return max(scored)[1] if scored else None

    has_my_king  = any(p == ('king', color) for p in board.values())
    has_opp_king = any(p == ('king', opp)   for p in board.values())

    if has_my_king and has_opp_king:
        return _chess_phase_action(state)
    elif has_my_king or has_opp_king:
        return _mixed_phase_action(state, rng)
    else:
        return _heuristic_choose(state, rng)
