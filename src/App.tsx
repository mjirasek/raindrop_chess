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
  { label: '∞',    initial: 0,    increment: 0 },
  { label: '3+2',  initial: 180,  increment: 2 },
  { label: '5+0',  initial: 300,  increment: 0 },
  { label: '10+0', initial: 600,  increment: 0 },
  { label: '15+10',initial: 900,  increment: 10 },
];

interface TimeControl { initial: number; increment: number; label: string; }

// ── Knight logo ───────────────────────────────────────────────────────────────

function KnightLogo() {
  return (
    <svg viewBox="0 0 50 50" width="32" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M 12 38 C 12 38 13 27 19 25 C 19 25 15 24 14 18 C 14 18 16 11 24 10 C 24 10 22 14 25 15 C 25 15 29 8 35 9 C 35 9 30 12 31 17 C 31 17 37 12 39 16 C 39 16 34 17 33 22 C 33 22 38 22 38 27 C 38 27 32 25 28 30 C 28 30 32 31 32 38 Z"
        fill="#629924" stroke="#4a7018" strokeWidth="1.5" strokeLinejoin="round" />
      <ellipse cx="20" cy="17" rx="2" ry="2" fill="#1a2a08" />
    </svg>
  );
}

// ── Clock display ─────────────────────────────────────────────────────────────

function ClockDisplay({ seconds, active }: { seconds: number; active: boolean }) {
  const color = seconds < 10 ? '#ff4444' : seconds < 30 ? '#ff9944' : active ? '#e0dbd4' : '#6e6b67';
  return (
    <span style={{
      fontFamily: 'monospace', fontWeight: 700, fontSize: '14px', color,
      background: active ? '#1a1816' : 'transparent',
      border: `1px solid ${active ? '#3d3b38' : 'transparent'}`,
      borderRadius: '4px', padding: '1px 6px',
      minWidth: '42px', textAlign: 'center', display: 'inline-block',
    }}>
      {formatClock(seconds)}
    </span>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const initial = createInitialState();
  const [liveGame, setLiveGame] = useState<GameState>(initial);
  const [snapshots, setSnapshots] = useState<GameState[]>([initial]);
  const [notations, setNotations] = useState<string[]>([]);
  const [snapshotCursor, setSnapshotCursor] = useState<number | null>(null);
  const [pendingNotation, setPendingNotation] = useState('');

  // Clocks
  const [timeControl, setTimeControl] = useState<TimeControl>(TIME_PRESETS[0]);
  const [clocks, setClocks] = useState({ white: 0, black: 0 });
  const [clocksActive, setClocksActive] = useState(false);
  const turnRef = useRef<Color>('white');

  const atLatest = snapshotCursor === null;
  const displayGame = atLatest ? liveGame : snapshots[snapshotCursor!];
  const interactive = atLatest && !liveGame.pendingPromotion;
  const listCursor = atLatest ? notations.length : snapshotCursor!;

  // Keep turnRef in sync for the clock interval
  useEffect(() => { turnRef.current = liveGame.turn; }, [liveGame.turn]);

  // Clock ticker — decrements active player's clock once per second
  useEffect(() => {
    if (!clocksActive || liveGame.gameOver || timeControl.initial === 0) return;
    const id = setInterval(() => {
      setClocks(prev => {
        const color = turnRef.current;
        const remaining = Math.max(0, prev[color] - 1);
        return { ...prev, [color]: remaining };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [clocksActive, liveGame.gameOver, timeControl.initial]);

  // Timeout detection
  useEffect(() => {
    if (!clocksActive || timeControl.initial === 0 || liveGame.gameOver) return;
    if (clocks[liveGame.turn] === 0) {
      const winner: Color = liveGame.turn === 'white' ? 'black' : 'white';
      setLiveGame(g => g.gameOver ? g : { ...g, gameOver: true, winner });
    }
  }, [clocks, clocksActive, liveGame.turn, liveGame.gameOver, timeControl.initial]);

  // Keyboard navigation: ← back, → forward
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
      if (timeControl.increment > 0) {
        setClocks(prev => ({ ...prev, [movedColor]: prev[movedColor] + timeControl.increment }));
      }
    }
  }

  const handleNewGame = useCallback(() => {
    const s = createInitialState();
    setLiveGame(s);
    setSnapshots([s]);
    setNotations([]);
    setSnapshotCursor(null);
    setPendingNotation('');
    setClocks({ white: timeControl.initial, black: timeControl.initial });
    setClocksActive(false);
  }, [timeControl.initial]);

  const handleTimeControlChange = useCallback((tc: TimeControl) => {
    setTimeControl(tc);
    setClocks({ white: tc.initial, black: tc.initial });
  }, []);

  const handleFlipCard = useCallback(() => {
    if (!atLatest) return;
    setLiveGame(prev => flipCard(prev));
  }, [atLatest]);

  const handleSquareClickDirect = useCallback((sq: Square) => {
    if (!interactive) return;
    if (!liveGame.cardFlipped || !liveGame.legalPlacementSquares.includes(sq)) return;
    const deck = liveGame.turn === 'white' ? liveGame.whiteDecks : liveGame.blackDecks;
    const card = deck.revealed!;
    const notation = placeNotation(card.type, liveGame.turn, sq);
    const movedColor = liveGame.turn;
    const next = placePiece(liveGame, sq);
    pushSnapshot(next, notation, movedColor);
  }, [interactive, liveGame]);

  const handleMove = useCallback((from: Square, to: Square) => {
    if (!interactive) return;
    const piece = liveGame.board.get(from);
    if (!piece) return;
    const captured = liveGame.board.has(to);
    const notation = moveNotation(piece, from, to, captured);
    const movedColor = liveGame.turn;
    const next = makeMove(liveGame, from, to);
    if (next.pendingPromotion) {
      setPendingNotation(notation);
      setLiveGame(next);
    } else {
      pushSnapshot(next, notation, movedColor);
    }
  }, [interactive, liveGame]);

  const handlePromotion = useCallback((role: CGRole) => {
    const movedColor = liveGame.turn; // turn hasn't advanced yet
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

  function PlayerLabel({ color, active }: { color: Color; active: boolean }) {
    const isBlack = color === 'black';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
          padding: '2px 8px', borderRadius: '4px',
          color: active ? '#a8d060' : '#6e6b67',
          background: active ? '#1e2a0f' : 'transparent',
          border: `1px solid ${active ? '#3a5a12' : 'transparent'}`,
        }}>{isBlack ? '⬛ Black' : '⬜ White'}</span>
        {showClocks && (
          <ClockDisplay seconds={clocks[color]} active={active && atLatest && clocksActive} />
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>

      {/* Header */}
      <header style={{ background: '#262422', borderBottom: '1px solid #3d3b38', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <KnightLogo />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '18px', letterSpacing: '0.03em' }}>Raindrop Chess</span>
          <span style={{ background: '#1e2a0f', color: '#629924', border: '1px solid #3a5a12', borderRadius: '4px', fontSize: '11px', fontWeight: 600, padding: '2px 8px' }}>hot seat</span>
        </div>
        <span style={{ fontSize: '11px', color: '#6e6b67' }}>Powered by chessground &amp; chessops</span>
      </header>

      {/* Main */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '20px' }}>

        {/* Fixed grid: [pile | board | pile] */}
        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr 96px', gap: '16px', alignItems: 'center', width: '100%', maxWidth: '752px' }}>

          {/* Black */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <PlayerLabel color="black" active={blackActive} />
            <CardPile deck={displayGame.blackDecks} color="black" isActive={blackActive} canFlip={canBlackFlip} onFlipCard={handleFlipCard} />
          </div>

          {/* Board + promotion overlay */}
          <div style={{ position: 'relative' }}>
            <ChessBoard state={displayGame} onSquareClick={handleSquareClickDirect} onMove={handleMove} interactive={interactive} />
            {liveGame.pendingPromotion && atLatest && (
              <PromotionDialog color={liveGame.turn} onSelect={handlePromotion} />
            )}
          </div>

          {/* White */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <PlayerLabel color="white" active={whiteActive} />
            <CardPile deck={displayGame.whiteDecks} color="white" isActive={whiteActive} canFlip={canWhiteFlip} onFlipCard={handleFlipCard} />
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: '1px', alignSelf: 'stretch', background: '#3d3b38', flexShrink: 0 }} />

        {/* Info panel */}
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
      </main>
    </div>
  );
}
