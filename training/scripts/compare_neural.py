"""
Phase 4 — Compare neural agent vs heuristic baseline.

Runs 3 matchup sets (20 games each = 60 total):
  [A] Neural(W)   vs Heuristic(B)
  [B] Heuristic(W) vs Neural(B)
  [C] Neural(W)   vs Neural(B)

Results appended to training/progress.html as Phase 4 section.
"""

import os, sys, time, random, multiprocessing as mp

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, ROOT)


def _run_batch(args):
    white_name, black_name, n_games, seed, ckpt = args
    import random as rnd
    rng = rnd.Random(seed)

    sys.path.insert(0, ROOT)
    from training.arena.arena import play_game
    from training.agents.heuristic_agent import choose_action as heuristic
    from training.agents.neural_agent import make_agent

    def _heuristic(s, r=None): return heuristic(s, r or rnd.Random())

    neural = make_agent(ckpt)

    agents = {'neural': neural, 'heuristic': _heuristic}
    white_fn = agents[white_name]
    black_fn = agents[black_name]

    results = []
    for _ in range(n_games):
        result = play_game(white_fn, black_fn, rng)
        results.append(result)
    return results


def main():
    ckpt = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                        'models', 'checkpoints', 'best.pt')

    matchups = [
        ('neural',    'heuristic', 50, 100),
        ('heuristic', 'neural',    50, 200),
        ('neural',    'neural',    50, 300),
    ]

    n_workers = min(mp.cpu_count() - 1, 12)
    print(f'Running {sum(m[2] for m in matchups)} games with {n_workers} workers')
    print(f'Neural checkpoint: {ckpt}')

    t0 = time.time()
    tasks = [(wn, bn, ng, seed, ckpt) for wn, bn, ng, seed in matchups]
    with mp.Pool(n_workers) as pool:
        batch_results = pool.map(_run_batch, tasks)

    elapsed = time.time() - t0
    total_games = sum(m[2] for m in matchups)
    print(f'\nDone in {elapsed:.1f}s  ({total_games/elapsed:.2f} games/s)\n')

    labels = ['[A] Neural(W) vs Heuristic(B)',
              '[B] Heuristic(W) vs Neural(B)',
              '[C] Neural(W) vs Neural(B)']

    all_matchup_stats = []
    for label, (wname, bname, ng, _), results in zip(labels, matchups, batch_results):
        w = sum(1 for r in results if r['winner'] == 'white') / ng
        b = sum(1 for r in results if r['winner'] == 'black') / ng
        d = sum(1 for r in results if r['winner'] is None)    / ng
        reps = sum(1 for r in results if r.get('end_reason') == 'repetition') / ng
        tos  = sum(1 for r in results if r.get('end_reason') == 'timeout')    / ng
        med_turns = sorted(r['turns'] for r in results)[ng // 2]
        print(f'{label:38s}  W:{w:.0%}  B:{b:.0%}  Draw:{d:.0%}(rep:{reps:.0%} to:{tos:.0%})  med:{med_turns}')
        all_matchup_stats.append({'label': label, 'white': wname, 'black': bname,
                                   'w_rate': w, 'b_rate': b, 'd_rate': d,
                                   'med_turns': med_turns, 'results': results})

    _save_to_json(all_matchup_stats, elapsed, total_games)
    _append_to_report(all_matchup_stats, elapsed, total_games)


def _save_to_json(matchup_stats, elapsed, total_games):
    """Persist arena results to training/data/arena_history.json (append)."""
    import json
    from datetime import datetime

    entry = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'total_games': total_games,
        'elapsed': round(elapsed, 1),
        'matchups': [
            {k: v for k, v in m.items() if k != 'results'}
            for m in matchup_stats
        ],
    }

    json_path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                             'data', 'arena_history.json')
    history = []
    if os.path.exists(json_path):
        try:
            with open(json_path) as f:
                history = json.load(f)
        except Exception:
            history = []
    history.append(entry)
    with open(json_path, 'w') as f:
        json.dump(history, f, indent=2)
    print(f'Arena results saved -> {json_path}')


def _append_to_report(matchup_stats, elapsed, total_games):
    """Append the neural comparison results to progress.html."""
    import base64, io
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import numpy as np
    except ImportError:
        print('matplotlib not available — skipping chart')
        return

    BG    = '#161512'
    PANEL = '#1f1e1b'
    ACCENT= '#b58863'
    TEXT  = '#d9d1c1'
    DIM   = '#7f7a70'
    GREEN = '#81b64c'
    RED   = '#c93a3a'

    labels    = [m['label'] for m in matchup_stats]
    neural_wr = []
    for m in matchup_stats:
        if m['white'] == 'neural':
            neural_wr.append(m['w_rate'])
        else:
            neural_wr.append(m['b_rate'])
    heur_wr = []
    for m in matchup_stats:
        if m['white'] == 'heuristic':
            heur_wr.append(m['w_rate'])
        elif m['black'] == 'heuristic':
            heur_wr.append(m['b_rate'])
        else:
            heur_wr.append(None)

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4), facecolor=BG)
    for ax in (ax1, ax2):
        ax.set_facecolor(PANEL)
        ax.tick_params(colors=TEXT)
        for spine in ax.spines.values():
            spine.set_edgecolor(DIM)

    x = np.arange(3)
    w_vals = [m['w_rate'] for m in matchup_stats]
    b_vals = [m['b_rate'] for m in matchup_stats]
    d_vals = [m['d_rate'] for m in matchup_stats]

    ax1.bar(x - .25, w_vals, .25, label='White wins', color=ACCENT)
    ax1.bar(x,       d_vals, .25, label='Timeout',    color=DIM)
    ax1.bar(x + .25, b_vals, .25, label='Black wins', color=GREEN)
    ax1.set_xticks(x)
    ax1.set_xticklabels(['A', 'B', 'C'], color=TEXT)
    ax1.set_title('Win rates per matchup', color=TEXT)
    ax1.set_ylabel('Rate', color=DIM)
    ax1.legend(facecolor=PANEL, labelcolor=TEXT, fontsize=9)
    ax1.set_ylim(0, 1)

    # Rough Elo from decisive games in A+B
    def _elo(wr):
        wr = max(0.01, min(0.99, wr))
        return 400 * __import__('math').log10(wr / (1 - wr))

    elo_notes = []
    for m in matchup_stats[:2]:
        if m['white'] == 'neural':
            decisive = [r for r in m['results'] if r['winner']]
            if decisive:
                n_wr = sum(1 for r in decisive if r['winner'] == 'white') / len(decisive)
                elo_notes.append(('Neural vs Heuristic [A]', _elo(n_wr)))
        else:
            decisive = [r for r in m['results'] if r['winner']]
            if decisive:
                n_wr = sum(1 for r in decisive if r['winner'] == 'black') / len(decisive)
                elo_notes.append(('Neural vs Heuristic [B]', _elo(n_wr)))

    med_turns = [m['med_turns'] for m in matchup_stats]
    ax2.bar(x, med_turns, .5, color=ACCENT)
    ax2.set_xticks(x)
    ax2.set_xticklabels(['A\nNeural/Heur', 'B\nHeur/Neural', 'C\nNeural/Neural'], color=TEXT, fontsize=8)
    ax2.set_title('Median game length (turns)', color=TEXT)
    ax2.set_ylabel('Turns', color=DIM)

    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format='png', bbox_inches='tight', facecolor=BG)
    plt.close(fig)
    b64 = base64.b64encode(buf.getvalue()).decode()
    chart = f'<img src="data:image/png;base64,{b64}" style="max-width:100%;border-radius:6px;">'

    rows = ''
    for m in matchup_stats:
        rows += (f'<tr><td>{m["label"]}</td>'
                 f'<td>{m["w_rate"]:.0%}</td>'
                 f'<td>{m["d_rate"]:.0%}</td>'
                 f'<td>{m["b_rate"]:.0%}</td>'
                 f'<td>{m["med_turns"]}</td></tr>\n')

    elo_str = ''
    for label, elo in elo_notes:
        sign = '+' if elo >= 0 else ''
        elo_str += f'<p style="color:#b58863"><b>{label}:</b> Neural est. Elo {sign}{elo:.0f} vs Heuristic</p>'

    section = f'''
<h3>Arena: Neural vs Heuristic ({total_games} games, {elapsed:.0f}s)</h3>
{chart}
<table>
<tr><th>Matchup</th><th>White wins</th><th>Timeout</th><th>Black wins</th><th>Median turns</th></tr>
{rows}
</table>
{elo_str}
'''

    # Inject into progress.html before </section> of phase4
    html_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'progress.html')
    if not os.path.exists(html_path):
        print('progress.html not found — run build_report.py first')
        return

    with open(html_path, encoding='utf-8') as f:
        html = f.read()

    # Find phase4 section and append before its closing tag
    marker = '</div>\n</section>'
    # Find the last occurrence (phase4 is last section)
    idx = html.rfind(marker)
    if idx == -1:
        print('Could not find insertion point in progress.html')
        return

    html = html[:idx] + section + html[idx:]
    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'Results appended to {html_path}')


if __name__ == '__main__':
    main()
