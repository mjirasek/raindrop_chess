"""
GPU pipeline: wait for current GPU training to finish, run arena, sync data, start next GPU training.

Usage:
  python -m training.scripts.gpu_pipeline --gen 6 --epochs 60 --lr 1e-4

Expects:
  - GPU training already running in tmux session train_genN-1
  - Local selfplay running in background (produces selfplay_*expectimax*.pkl)
  - Remote selfplay running in tmux selfplay_genN

Sequence:
  1. Wait for GPU train_genN-1 to finish
  2. Download best.pt from GPU
  3. Run arena (neural vs heuristic)
  4. Wait for local selfplay output
  5. Sync local + remote Gen N data to GPU
  6. Launch GPU Gen N training
  7. Commit + push updated report
"""

import os, sys, time, subprocess, argparse
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, ROOT)

REMOTE        = 'michael@maddog2020.chem.gla.ac.uk'
REMOTE_DIR    = '/mnt/STORAGE3/michael/recursive_nn'
REMOTE_CKPT   = f'{REMOTE_DIR}/training/models/checkpoints/best.pt'
LOCAL_CKPT    = os.path.join(ROOT, 'training', 'models', 'checkpoints', 'best.pt')
LOCAL_DATA    = os.path.join(ROOT, 'training', 'data')

CONDA_PYTHON  = '/home/michael/miniconda3/envs/recursive_nn/bin/python3'
SF_PATH       = f'{REMOTE_DIR}/training/stockfish/stockfish/stockfish-ubuntu-x86-64-avx2'


def log(msg):
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)


def ssh(cmd: str, capture=False):
    full = f'ssh {REMOTE} "{cmd}"'
    if capture:
        r = subprocess.run(full, shell=True, capture_output=True, text=True)
        return r.stdout.strip()
    return subprocess.run(full, shell=True).returncode


def run(cmd: list, desc: str) -> int:
    log(desc)
    return subprocess.run(cmd, cwd=ROOT).returncode


def tmux_running(session: str) -> bool:
    out = ssh(f'tmux has-session -t {session} 2>/dev/null && echo yes || echo no', capture=True)
    return out.strip() == 'yes'


def wait_for_tmux(session: str, poll_secs=60):
    """Wait until a tmux session exits (training complete)."""
    log(f'Waiting for tmux {session} to finish...')
    while tmux_running(session):
        # Show last 3 lines of output
        tail = ssh(f'tmux capture-pane -pt {session} -S -3 2>/dev/null', capture=True)
        if tail:
            print(f'  {tail.split(chr(10))[-1]}', flush=True)
        time.sleep(poll_secs)
    log(f'tmux {session} finished')


def wait_for_local_selfplay(gen: int, poll_secs=30):
    """Wait until a Gen N selfplay pkl file appears in local data dir."""
    log(f'Waiting for local Gen{gen} selfplay data (expectimax or composite+SF)...')
    import glob
    patterns = [
        os.path.join(LOCAL_DATA, 'selfplay_fast_sf_expectimax_*.pkl'),
        os.path.join(LOCAL_DATA, 'selfplay_fast_sf_composite_*.pkl'),
    ]
    while True:
        files = sorted(f for p in patterns for f in glob.glob(p))
        if files:
            log(f'Local selfplay found: {len(files)} file(s), latest: {os.path.basename(files[-1])}')
            return files[-1]
        time.sleep(poll_secs)


def sync_data_to_remote(gen: int):
    """Copy local SF-labelled selfplay files (expectimax + composite) to remote."""
    import glob
    patterns = [
        os.path.join(LOCAL_DATA, 'selfplay_fast_sf_expectimax_*.pkl'),
        os.path.join(LOCAL_DATA, 'selfplay_fast_sf_composite_*.pkl'),
    ]
    files = sorted(f for p in patterns for f in glob.glob(p))
    if not files:
        log('No local SF-labelled selfplay files to sync')
        return
    log(f'Syncing {len(files)} local selfplay file(s) to GPU...')
    for f in files:
        r = subprocess.run(
            ['scp', f, f'{REMOTE}:{REMOTE_DIR}/training/data/'],
            capture_output=True, text=True)
        if r.returncode == 0:
            log(f'  Uploaded: {os.path.basename(f)}')
        else:
            log(f'  WARN: upload failed for {os.path.basename(f)}: {r.stderr.strip()}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gen',     type=int,   default=6,     help='Current generation being prepared')
    ap.add_argument('--epochs',  type=int,   default=60,    help='Training epochs')
    ap.add_argument('--lr',      type=float, default=1e-4,  help='Learning rate')
    ap.add_argument('--gpu',     type=int,   default=0,     help='GPU device index')
    ap.add_argument('--batch',   type=int,   default=512,   help='Batch size')
    ap.add_argument('--skip-wait-train', action='store_true', help='Skip waiting for GPU training (already done)')
    ap.add_argument('--skip-wait-selfplay', action='store_true', help='Skip waiting for local selfplay')
    args = ap.parse_args()

    gen      = args.gen
    prev_gen = gen - 1

    log(f'=== GPU Pipeline: Gen {prev_gen} -> Gen {gen} ===')

    # 1. Wait for GPU training of gen-1
    if not args.skip_wait_train:
        train_session = f'train_gen{prev_gen}'
        if tmux_running(train_session):
            wait_for_tmux(train_session)
        else:
            log(f'No tmux session {train_session} found — assuming already done')

    # 2. Download best.pt from GPU
    log('Downloading GPU best.pt...')
    os.makedirs(os.path.dirname(LOCAL_CKPT), exist_ok=True)
    r = subprocess.run(['scp', f'{REMOTE}:{REMOTE_CKPT}', LOCAL_CKPT], capture_output=True, text=True)
    if r.returncode == 0:
        log(f'best.pt downloaded -> {LOCAL_CKPT}')
    else:
        log(f'WARN: could not download best.pt: {r.stderr.strip()}')

    # 3. Arena: Gen prev neural vs heuristic
    py = sys.executable
    run([py, '-m', 'training.scripts.compare_neural'], f'Gen{prev_gen} arena')

    # 4. Build + push report
    run([py, '-m', 'training.scripts.build_report'], 'Build progress report')
    subprocess.run(['git', 'add', 'public/engine-training.html',
                    'training/data/arena_history.json',
                    'training/progress.html'], cwd=ROOT)
    subprocess.run(['git', 'commit', '-m', f'Update engine training report after Gen{prev_gen} arena'], cwd=ROOT)
    subprocess.run(['git', 'push'], cwd=ROOT)
    log('Pushed')

    # 5. Wait for local Gen N selfplay
    if not args.skip_wait_selfplay:
        wait_for_local_selfplay(gen)

    # 6. Wait for remote Gen N selfplay
    remote_session = f'selfplay_gen{gen}'
    if tmux_running(remote_session):
        log(f'Waiting for remote Gen{gen} selfplay ({remote_session})...')
        wait_for_tmux(remote_session, poll_secs=30)
    else:
        log(f'Remote selfplay session {remote_session} already done')

    # 7. Sync local expectimax data to GPU
    sync_data_to_remote(gen)

    # 8. Launch GPU Gen N training (fine-tune from Gen prev-1 best.pt)
    log(f'Launching GPU Gen{gen} training ({args.epochs} epochs, lr={args.lr})...')
    train_cmd = (
        f'cd {REMOTE_DIR} && '
        f'CUDA_VISIBLE_DEVICES={args.gpu} '
        f'{CONDA_PYTHON} -m training.scripts.train '
        f'--data training/data --out training/models/checkpoints '
        f'--epochs {args.epochs} --batch {args.batch} --lr {args.lr} '
        f'--checkpoint training/models/checkpoints/best.pt '
        f'2>&1 | tee /tmp/train_gen{gen}.log'
    )
    new_session = f'train_gen{gen}'
    ssh(f'tmux new-session -d -s {new_session} \'{train_cmd}\'')
    log(f'GPU Gen{gen} training started in tmux {new_session}')
    log(f'ALL DONE — Gen{gen} training running, check back in ~2 hours')


if __name__ == '__main__':
    main()
