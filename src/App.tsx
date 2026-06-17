import { useState, useCallback, useEffect, useRef } from 'react';
import ChessBoard from './components/ChessBoard';
import CardPile from './components/CardPile';
import GameInfo from './components/GameInfo';
import PromotionDialog from './components/PromotionDialog';
import { createInitialState, flipCard, placePiece, makeMove, completePromotion } from './gameState';
import type { GameState, Square, CGRole, Color, CardType, CGPiece } from './types';

// ── Notation helpers ──────────────────────────────────────────────────────────

const SYM: Record<CGPiece['role'], Record<Color, string>> = {
  king:   { white: '♔', black: '♚' },
  queen:  { white: '♕', black: '♛' },
  rook:   { white: '♖', black: '♜' },
  bishop: { white: '♗', black: '♝' },
  knight: { white: '♘', black: '♞' },
  pawn:   { white: '♙', black: '♟' },
};

function sqName(sq: Square): string {
  return 'abcdefgh'[sq % 8] + String((sq >> 3) + 1);
}

function placeNotation(cardType: CardType, color: Color, sq: Square): string {
  const role: CGPiece['role'] =
    cardType === 'bishop-light' || cardType === 'bishop-dark' ? 'bishop' : cardType as CGPiece['role'];
  return `${SYM[role][color]}→${sqName(sq)}`;
}

function moveNotation(piece: CGPiece, from: Square, to: Square, captured: boolean): string {
  return `${SYM[piece.role][piece.color]}${sqName(from)}${captured ? '×' : '-'}${sqName(to)}`;
}

function formatClock(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ── Time presets ─────────────────────────────────────────────────────────────

const TIME_PRESETS = [
  { label: '∞',     initial: 0,    increment: 0 },
  { label: '3+2',   initial: 180,  increment: 2 },
  { label: '5+0',   initial: 300,  increment: 0 },
  { label: '10+0',  initial: 600,  increment: 0 },
  { label: '15+10', initial: 900,  increment: 10 },
];
interface TimeControl { initial: number; increment: number; label: string; }

// ── Responsive hook ───────────────────────────────────────────────────────────

function useIsMobile() {
  const mq = '(max-width: 767px)';
  const [mobile, setMobile] = useState(() => window.matchMedia(mq).matches);
  useEffect(() => {
    const media = window.matchMedia(mq);
    const h = (e: MediaQueryListEvent) => setMobile(e.matches);
    media.addEventListener('change', h);
    return () => media.removeEventListener('change', h);
  }, []);
  return mobile;
}

// ── Knight logo ───────────────────────────────────────────────────────────────

function KnightLogo() {
  return (
    <svg viewBox="0 0 50 50" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M 12 38 C 12 38 13 27 19 25 C 19 25 15 24 14 18 C 14 18 16 11 24 10 C 24 10 22 14 25 15 C 25 15 29 8 35 9 C 35 9 30 12 31 17 C 31 17 37 12 39 16 C 39 16 34 17 33 22 C 33 22 38 22 38 27 C 38 27 32 25 28 30 C 28 30 32 31 32 38 Z"
        fill="#629924" stroke="#4a7018" strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="20" cy="17" rx="2" ry="2" fill="#1a2a08" />
    </svg>
  );
}

// ── Clock component ───────────────────────────────────────────────────────────

function Clock({ seconds, active, large }: { seconds: number; active: boolean; large?: boolean }) {
  const col = seconds < 10 ? '#ff4444' : seconds < 30 ? '#ff9944' : active ? '#e0dbd4' : '#6e6b67';
  return (
    <span style={{
      fontFamily: 'monospace', fontWeight: 700,
      fontSize: large ? '18px' : '13px',
      color: col,
      background: active ? '#1a1816' : 'transparent',
      border: `1px solid ${active ? '#3d3b38' : 'transparent'}`,
      borderRadius: '4px',
      padding: large ? '3px 10px' : '1px 6px',
      minWidth: large ? '58px' : '42px',
      textAlign: 'center', display: 'inline-block',
    }}>
      {formatClock(seconds)}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const isMobile = useIsMobile();
  const initial = createInitialState();
  const [liveGame, setLiveGame] = useState<GameState>(initial);
  const [snapshots, setSnapshots] = useState<GameState[]>([initial]);
  const [notations, setNotations] = useState<string[]>([]);
  const [snapshotCursor, setSnapshotCursor] = useState<number | null>(null);
  const [pendingNotation, setPendingNotation] = useState('');

  const [timeControl, setTimeControl] = useState<TimeControl>(TIME_PRESETS[0]);
  const [clocks, setClocks] = useState({ white: 0, black: 0 });
  const [clocksActive, setClocksActive] = useState(false);
  const turnRef = useRef<Color>('white');

  const atLatest = snapshotCursor === null;
  const displayGame = atLatest ? liveGame : snapshots[snapshotCursor!];
  const interactive = atLatest && !liveGame.pendingPromotion;
  const listCursor = atLatest ? notations.length : snapshotCursor!;

  useEffect(() => { turnRef.current = liveGame.turn; }, [liveGame.turn]);

  useEffect(() => {
    if (!clocksActive || liveGame.gameOver || timeControl.initial === 0) return;
    const id = setInterval(() => {
      setClocks(prev => {
        const color = turnRef.current;
        return { ...prev, [color]: Math.max(0, prev[color] - 1) };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [clocksActive, liveGame.gameOver, timeControl.initial]);

  useEffect(() => {
    if (!clocksActive || timeControl.initial === 0 || liveGame.gameOver) return;
    if (clocks[liveGame.turn] === 0) {
      const winner: Color = liveGame.turn === 'white' ? 'black' : 'white';
      setLiveGame(g => g.gameOver ? g : { ...g, gameOver: true, winner });
    }
  }, [clocks, clocksActive, liveGame.turn, liveGame.gameOver, timeControl.initial]);

  const handleBack = useCallback(() => {
    const current = snapshotCursor ?? snapshots.length - 1;
    if (current > 0) setSnapshotCursor(current - 1);
  }, [snapshotCursor, snapshots.length]);

  const handleForward = useCallback(() => {
    if (snapshotCursor === null) return;
    if (snapshotCursor < snapshots.length - 1) setSnapshotCursor(snapshotCursor + 1);
    else setSnapshotCursor(null);
  }, [snapshotCursor, snapshots.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handleBack(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleForward(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack, handleForward]);

  function pushSnapshot(game: GameState, notation: string, movedColor: Color) {
    setLiveGame(game);
    setSnapshots(prev => [...prev, game]);
    setNotations(prev => [...prev, notation]);
    setSnapshotCursor(null);
    if (timeControl.initial > 0) {
      setClocksActive(true);
      if (timeControl.increment > 0)
        setClocks(prev => ({ ...prev, [movedColor]: prev[movedColor] + timeControl.increment }));
    }
  }

  const handleNewGame = useCallback(() => {
    const s = createInitialState();
    setLiveGame(s); setSnapshots([s]); setNotations([]); setSnapshotCursor(null); setPendingNotation('');
    setClocks({ white: timeControl.initial, black: timeControl.initial });
    setClocksActive(false);
  }, [timeControl.initial]);

  const handleTimeControlChange = useCallback((tc: TimeControl) => {
    setTimeControl(tc);
    setClocks({ white: tc.initial, black: tc.initial });
  }, []);

  const handleFlipCard = useCallback(() => {
    if (!atLatest) return;
    const next = flipCard(liveGame);
    if (next.gameOver && next.winner) {
      // Card couldn't resolve check — push final snapshot with loss notation
      const deck = liveGame.turn === 'white' ? liveGame.whiteDecks : liveGame.blackDecks;
      const card = deck.pile[0];
      const notation = card ? `${SYM[card.type === 'bishop-light' || card.type === 'bishop-dark' ? 'bishop' : card.type as CGPiece['role']][liveGame.turn]}→✗` : '✗';
      pushSnapshot(next, notation, liveGame.turn);
    } else {
      setLiveGame(next);
    }
  }, [atLatest, liveGame]);

  const handleSquareClickDirect = useCallback((sq: Square) => {
    if (!interactive) return;
    if (!liveGame.cardFlipped || !liveGame.legalPlacementSquares.includes(sq)) return;
    const deck = liveGame.turn === 'white' ? liveGame.whiteDecks : liveGame.blackDecks;
    const card = deck.revealed!;
    const movedColor = liveGame.turn;
    pushSnapshot(placePiece(liveGame, sq), placeNotation(card.type, liveGame.turn, sq), movedColor);
  }, [interactive, liveGame]);

  const handleMove = useCallback((from: Square, to: Square) => {
    if (!interactive) return;
    const piece = liveGame.board.get(from);
    if (!piece) return;
    const notation = moveNotation(piece, from, to, liveGame.board.has(to));
    const movedColor = liveGame.turn;
    const next = makeMove(liveGame, from, to);
    if (next.pendingPromotion) { setPendingNotation(notation); setLiveGame(next); }
    else pushSnapshot(next, notation, movedColor);
  }, [interactive, liveGame]);

  const handlePromotion = useCallback((role: CGRole) => {
    const movedColor = liveGame.turn;
    const notation = pendingNotation + '=' + SYM[role][movedColor];
    const next = completePromotion(liveGame, role);
    setPendingNotation('');
    pushSnapshot(next, notation, movedColor);
  }, [liveGame, pendingNotation]);

  const canWhiteFlip = atLatest && !liveGame.gameOver && liveGame.turn === 'white' &&
    !liveGame.cardFlipped && liveGame.turnMode !== 'must-move' && liveGame.whiteDecks.pile.length > 0;
  const canBlackFlip = atLatest && !liveGame.gameOver && liveGame.turn === 'black' &&
    !liveGame.cardFlipped && liveGame.turnMode !== 'must-move' && liveGame.blackDecks.pile.length > 0;

  const blackActive = displayGame.turn === 'black' && !displayGame.gameOver;
  const whiteActive = displayGame.turn === 'white' && !displayGame.gameOver;
  const showClocks = timeControl.initial > 0;

  // ── Board + promotion overlay (shared) ──────────────────────────────────────
  const boardEl = (
    <div style={{ position: 'relative' }}>
      <ChessBoard state={displayGame} onSquareClick={handleSquareClickDirect} onMove={handleMove} interactive={interactive} />
      {liveGame.pendingPromotion && atLatest && (
        <PromotionDialog color={liveGame.turn} onSelect={handlePromotion} />
      )}
    </div>
  );

  const gameInfoEl = (
    <GameInfo
      state={displayGame}
      notations={notations}
      cursor={listCursor}
      timePresets={TIME_PRESETS}
      timeControl={timeControl}
      onTimeControlChange={handleTimeControlChange}
      onNewGame={handleNewGame}
      onBack={handleBack}
      onForward={handleForward}
    />
  );

  // ── MOBILE layout ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
        {/* Header */}
        <header style={{ background: '#262422', borderBottom: '1px solid #3d3b38', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px' }}>
          <KnightLogo />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>Raindrop Chess</span>
          <span style={{ background: '#1e2a0f', color: '#629924', border: '1px solid #3a5a12', borderRadius: '4px', fontSize: '10px', fontWeight: 600, padding: '1px 6px', marginLeft: 'auto' }}>hot seat</span>
        </header>

        {/* Black player row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', gap: '8px' }}>
          <MobilePlayerRow color="black" active={blackActive} />
          <CardPile deck={displayGame.blackDecks} color="black" isActive={blackActive} canFlip={canBlackFlip} onFlipCard={handleFlipCard} layout="horizontal" />
          {showClocks && (
            <Clock seconds={clocks.black} active={blackActive && atLatest && clocksActive} large />
          )}
        </div>

        {/* Board — full width, no side padding */}
        <div>{boardEl}</div>

        {/* White player row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', gap: '8px' }}>
          <MobilePlayerRow color="white" active={whiteActive} />
          <CardPile deck={displayGame.whiteDecks} color="white" isActive={whiteActive} canFlip={canWhiteFlip} onFlipCard={handleFlipCard} layout="horizontal" />
          {showClocks && (
            <Clock seconds={clocks.white} active={whiteActive && atLatest && clocksActive} large />
          )}
        </div>

        {/* Game info below board */}
        <div style={{ padding: '4px 10px 16px' }}>
          {gameInfoEl}
        </div>
      </div>
    );
  }

  // ── DESKTOP layout ───────────────────────────────────────────────────────────
  function DesktopPlayerLabel({ color, active }: { color: Color; active: boolean }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '4px',
          color: active ? '#a8d060' : '#6e6b67',
          background: active ? '#1e2a0f' : 'transparent',
          border: `1px solid ${active ? '#3a5a12' : 'transparent'}`,
        }}>{color === 'black' ? '⬛ Black' : '⬜ White'}</span>
        {showClocks && (
          <Clock seconds={clocks[color]} active={active && atLatest && clocksActive} />
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
      <header style={{ background: '#262422', borderBottom: '1px solid #3d3b38', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <KnightLogo />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '18px', letterSpacing: '0.03em' }}>Raindrop Chess</span>
          <span style={{ background: '#1e2a0f', color: '#629924', border: '1px solid #3a5a12', borderRadius: '4px', fontSize: '11px', fontWeight: 600, padding: '2px 8px' }}>hot seat</span>
        </div>
        <span style={{ fontSize: '11px', color: '#6e6b67' }}>Powered by chessground &amp; chessops</span>
      </header>

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr 96px', gap: '16px', alignItems: 'center', width: '100%', maxWidth: '752px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <DesktopPlayerLabel color="black" active={blackActive} />
            <CardPile deck={displayGame.blackDecks} color="black" isActive={blackActive} canFlip={canBlackFlip} onFlipCard={handleFlipCard} layout="vertical" />
          </div>
          {boardEl}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <DesktopPlayerLabel color="white" active={whiteActive} />
            <CardPile deck={displayGame.whiteDecks} color="white" isActive={whiteActive} canFlip={canWhiteFlip} onFlipCard={handleFlipCard} layout="vertical" />
          </div>
        </div>
        <div style={{ width: '1px', alignSelf: 'stretch', background: '#3d3b38', flexShrink: 0 }} />
        {gameInfoEl}
      </main>
    </div>
  );
}

// ── Mobile player row ─────────────────────────────────────────────────────────

function MobilePlayerRow({ color, active }: { color: Color; active: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '80px' }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
        background: active ? '#629924' : '#3d3b38',
      }} />
      <span style={{ fontSize: '13px', fontWeight: active ? 700 : 400, color: active ? '#e0dbd4' : '#6e6b67' }}>
        {color === 'black' ? 'Black' : 'White'}
      </span>
    </div>
  );
}
