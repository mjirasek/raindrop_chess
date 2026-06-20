import { useState, useCallback, useEffect, useRef } from 'react';
import ChessBoard from './components/ChessBoard';
import CardPile from './components/CardPile';
import GameInfo from './components/GameInfo';
import GameChat from './components/GameChat';
import LobbyPage from './components/LobbyPage';
import PromotionDialog from './components/PromotionDialog';
import EnginePage from './components/EnginePage';
import GameHistoryPage from './components/GameHistoryPage';
import { createInitialState, flipCard, placePiece, makeMove, completePromotion } from './gameState';
import { deserializeGameState, serializeGameState } from './gameSerialization';
import { applyEngineAction, chooseRandomEngineAction, type EngineAction } from './engine/randomEngine';
import { loadNeuralEngine, chooseNeuralAction, boardHash } from './engine/neuralEngine';
import type { InferenceSession } from 'onnxruntime-web';
import { hasSupabaseConfig, supabase } from './supabaseClient';
import {
  acceptChallenge,
  clearOpenChallengesForUser,
  createChallenge,
  declineChallenge,
  finishChallengeForGame,
  getSessionUser,
  listGameMessages,
  listLobbyMessages,
  listChallenges,
  listProfiles,
  listUserGames,
  loadGame,
  loadGameLog,
  listGameLogs,
  replaceGameForChallenge,
  registerAccount,
  saveGameLog,
  sendGameMessage,
  sendLobbyMessage,
  signIn,
  signOut,
  stateFromGame,
  touchProfileLastSeen,
  type Challenge,
  type GameLog,
  type GameLogSummary,
  type GameMessage,
  type GameRow,
  type LobbyMessage,
  type Profile,
} from './multiplayer';
import type { GameState, Square, Color, CardType, CGPiece, PromotionRole } from './types';
import type { User } from '@supabase/supabase-js';

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

function engineActionNotation(before: GameState, action: EngineAction): string | null {
  switch (action.kind) {
    case 'flip-card':
      return null;
    case 'place-piece': {
      const deck = before.turn === 'white' ? before.whiteDecks : before.blackDecks;
      const card = deck.revealed;
      return card ? placeNotation(card.type, before.turn, action.square) : null;
    }
    case 'move-piece': {
      const piece = before.board.get(action.from);
      if (!piece) return null;
      return moveNotation(piece, action.from, action.to, before.board.has(action.to));
    }
    case 'promote':
      return `=${SYM[action.role][before.turn]}`;
  }
}

function failedCardNotation(before: GameState): string {
  const deck = before.turn === 'white' ? before.whiteDecks : before.blackDecks;
  const card = deck.pile[0] ?? deck.revealed;
  if (!card) return 'failed card';
  const role = card.type === 'bishop-light' || card.type === 'bishop-dark' ? 'bishop' : card.type as CGPiece['role'];
  return `${SYM[role][before.turn]}->x`;
}

async function playNeuralEngineTurnWithNotation(
  state: GameState,
  session: InferenceSession,
  recentHashes?: Set<string>,
): Promise<{ state: GameState; notation: string } | null> {
  const movedColor = state.turn;
  let current = state;
  const notation: string[] = [];
  for (let step = 0; step < 6; step++) {
    if (current.gameOver || current.turn !== movedColor) break;
    const action = await chooseNeuralAction(current, session, recentHashes);
    if (!action) return null;
    const before = current;
    const actionNotation = engineActionNotation(before, action);
    current = applyEngineAction(current, action);
    if (actionNotation) notation.push(actionNotation);
    if (action.kind === 'flip-card' && current.gameOver) notation.push(failedCardNotation(before));
  }
  if (current === state || notation.length === 0) return null;
  return { state: current, notation: notation.join('') };
}

function playEngineTurnWithNotation(state: GameState): { state: GameState; notation: string } | null {
  const movedColor = state.turn;
  let current = state;
  const notation: string[] = [];

  for (let step = 0; step < 6; step++) {
    if (current.gameOver || current.turn !== movedColor) break;

    const action = chooseRandomEngineAction(current);
    if (!action) return null;
    const before = current;
    const actionNotation = engineActionNotation(before, action);
    current = applyEngineAction(current, action);

    if (actionNotation) notation.push(actionNotation);
    if (action.kind === 'flip-card' && current.gameOver) notation.push(failedCardNotation(before));
  }

  if (current === state || notation.length === 0) return null;
  return { state: current, notation: notation.join('') };
}

function colorName(color: Color): string {
  return color === 'white' ? 'White' : 'Black';
}

function userMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error.message.includes('row-level security policy')) {
    return 'Supabase policy blocks saving moves. Run the games update policy SQL, then reload both browsers.';
  }
  return error.message;
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
type AppView = 'lobby' | 'game' | 'engine' | 'history';
type LocalMode = 'hotseat' | 'computer';
type AuthMode = 'sign-in' | 'register';

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

function PlayerLabel({
  color,
  active,
  seconds,
  showClock,
  clockActive,
}: {
  color: Color;
  active: boolean;
  seconds: number;
  showClock: boolean;
  clockActive: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
      <span style={{
        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
        padding: '2px 8px', borderRadius: '4px',
        color: active ? '#a8d060' : '#6e6b67',
        background: active ? '#1e2a0f' : 'transparent',
        border: `1px solid ${active ? '#3a5a12' : 'transparent'}`,
      }}>{color === 'black' ? 'Black' : 'White'}</span>
      {showClock && (
        <Clock seconds={seconds} active={clockActive} />
      )}
    </div>
  );
}

export default function App() {
  const isMobile = useIsMobile();
  const [appView, setAppView] = useState<AppView>('lobby');
  const [localMode, setLocalMode] = useState<LocalMode>('hotseat');
  const [engineStatus, setEngineStatus] = useState('');
  const [engineType, setEngineType] = useState<'neural' | 'random'>('neural');
  const [neuralSession, setNeuralSession] = useState<InferenceSession | null>(null);
  const [neuralLoading, setNeuralLoading] = useState(true);
  const [playMenuOpen, setPlayMenuOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authStatus, setAuthStatus] = useState('');
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
  const [mpUser, setMpUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [games, setGames] = useState<GameRow[]>([]);
  const [activeGame, setActiveGame] = useState<GameRow | null>(null);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [mpStatus, setMpStatus] = useState('');
  const [gameSyncStatus, setGameSyncStatus] = useState('');
  const [gameMessages, setGameMessages] = useState<GameMessage[]>([]);
  const [chatStatus, setChatStatus] = useState('');
  const [guestName, setGuestName] = useState<string | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([]);
  const [lobbyChatStatus, setLobbyChatStatus] = useState('');
  const [gameLogs, setGameLogs] = useState<GameLogSummary[]>([]);
  const [historyStatus, setHistoryStatus] = useState('');
  const [viewingHistory, setViewingHistory] = useState(false);
  const activeGameRef = useRef<GameRow | null>(null);
  const savingGameRef = useRef(false);
  const engineThinkingRef = useRef(false);
  const gameLogSavedRef = useRef(false);
  const wasGameOverRef = useRef(false);
  const localGameIdRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    loadNeuralEngine()
      .then(session => { setNeuralSession(session); setNeuralLoading(false); })
      .catch(() => setNeuralLoading(false));
  }, []);

  const atLatest = snapshotCursor === null;
  const displayGame = atLatest ? liveGame : snapshots[snapshotCursor!];
  const currentProfile = mpUser ? profiles.find(profile => profile.id === mpUser.id) : null;
  const onlineSeat: Color | null =
    activeGame && mpUser?.id === activeGame.white_user_id ? 'white'
      : activeGame && mpUser?.id === activeGame.black_user_id ? 'black'
        : null;
  const activeSeat: Color | null = activeGame ? onlineSeat : localMode === 'computer' ? 'white' : null;
  const activeGameId = activeGame?.id ?? null;
  const boardOrientation: Color = activeSeat ?? 'white';
  const computerTurn = localMode === 'computer' && !activeGame && liveGame.turn === 'black';
  const canAct = activeGame ? activeSeat === liveGame.turn : localMode === 'computer' ? !computerTurn : true;
  const interactive = atLatest && !liveGame.pendingPromotion && canAct;
  const listCursor = atLatest ? notations.length : snapshotCursor!;

  useEffect(() => { turnRef.current = liveGame.turn; }, [liveGame.turn]);
  useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);

  const applySyncedGame = useCallback((row: GameRow) => {
    setActiveGame(row);
    const nextState = stateFromGame(row);
    setLiveGame(nextState);
    setSnapshots([nextState]);
    setNotations(row.notations_json ?? []);
    setSnapshotCursor(null);
    setPendingNotation('');
  }, []);

  const refreshMultiplayer = useCallback(async () => {
    if (!hasSupabaseConfig) return;
    try {
      const user = await getSessionUser();
      setMpUser(user);
      if (!user) {
        setProfiles([]);
        setChallenges([]);
        setGames([]);
        return;
      }
      const [nextProfiles, nextChallenges, nextGames] = await Promise.all([
        listProfiles(),
        listChallenges(user.id),
        listUserGames(),
      ]);
      setProfiles(nextProfiles);
      setChallenges(nextChallenges);
      setGames(nextGames);
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not refresh multiplayer');
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshMultiplayer();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [refreshMultiplayer]);

  useEffect(() => {
    if (!mpUser) return;
    const interval = window.setInterval(() => {
      void refreshMultiplayer();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [mpUser, refreshMultiplayer]);

  useEffect(() => {
    if (!mpUser) return;
    const touch = () => {
      void touchProfileLastSeen().catch(() => {
        // Older Supabase schemas do not have the heartbeat function yet.
      });
    };
    touch();
    const interval = window.setInterval(touch, 30000);

    return () => window.clearInterval(interval);
  }, [mpUser]);

  useEffect(() => {
    const client = supabase;
    if (!client || !mpUser) return;

    const channel = client
      .channel(`challenges:${mpUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'challenges' }, () => {
        void refreshMultiplayer();
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [mpUser, refreshMultiplayer]);

  useEffect(() => {
    const client = supabase;
    if (!client || !mpUser) {
      const timeout = window.setTimeout(() => setOnlineUserIds([]), 0);
      return () => window.clearTimeout(timeout);
    }

    const channel = client
      .channel('presence:lobby', { config: { presence: { key: mpUser.id } } })
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>;
        const userIds = Object.values(state)
          .flat()
          .map(meta => meta.user_id)
          .filter((id): id is string => Boolean(id));
        setOnlineUserIds(Array.from(new Set(userIds)));
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ user_id: mpUser.id });
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [mpUser]);

  useEffect(() => {
    const client = supabase;
    if (!client || (!mpUser && !guestName)) {
      const timeout = window.setTimeout(() => {
        setLobbyMessages([]);
        setLobbyChatStatus('');
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    void listLobbyMessages()
      .then(messages => {
        setLobbyMessages(messages);
        setLobbyChatStatus('connected');
      })
      .catch(() => {
        setLobbyMessages([]);
        setLobbyChatStatus('setup needed');
      });

    const channel = client
      .channel('lobby-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lobby_messages' }, payload => {
        setLobbyMessages(prev => [...prev.slice(-99), payload.new as LobbyMessage]);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setLobbyChatStatus('live');
        else if (status === 'CHANNEL_ERROR') setLobbyChatStatus('poll only');
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [guestName, mpUser]);

  useEffect(() => {
    const client = supabase;
    if (!client || !activeGameId) return;

    const channel = client
      .channel(`game:${activeGameId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${activeGameId}` }, payload => {
        const row = payload.new as GameRow;
        applySyncedGame(row);
        setGameSyncStatus(`Live sync: v${row.version}`);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setGameSyncStatus('Live sync connected');
        else if (status === 'CHANNEL_ERROR') setGameSyncStatus('Live sync error; polling backup active');
        else if (status === 'TIMED_OUT') setGameSyncStatus('Live sync timed out; polling backup active');
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [activeGameId, applySyncedGame]);

  useEffect(() => {
    if (!activeGameId) return;

    const interval = window.setInterval(() => {
      if (savingGameRef.current) return;
      void loadGame(activeGameId)
        .then(row => {
          const current = activeGameRef.current;
          if (!current || row.version !== current.version || row.updated_at !== current.updated_at) {
            applySyncedGame(row);
            setGameSyncStatus(`Polled sync: v${row.version}`);
          }
        })
        .catch(error => {
          setGameSyncStatus(error instanceof Error ? error.message : 'Polling sync failed');
        });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [activeGameId, applySyncedGame]);

  useEffect(() => {
    const client = supabase;
    if (!client || !activeChallengeId || !mpUser) {
      const timeout = window.setTimeout(() => {
        setGameMessages([]);
        setChatStatus('');
      }, 0);
      return () => window.clearTimeout(timeout);
    }

    void listGameMessages(activeChallengeId)
      .then(messages => {
        setGameMessages(messages);
        setChatStatus('connected');
      })
      .catch(error => {
        setGameMessages([]);
        setChatStatus(error instanceof Error ? 'setup needed' : 'unavailable');
      });

    const channel = client
      .channel(`game-messages:${activeChallengeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_messages', filter: `challenge_id=eq.${activeChallengeId}` }, payload => {
        setGameMessages(prev => [...prev, payload.new as GameMessage]);
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') setChatStatus('live');
        else if (status === 'CHANNEL_ERROR') setChatStatus('poll only');
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [activeChallengeId, mpUser]);

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
    if (clocks[liveGame.turn] !== 0) return;

    const timeout = window.setTimeout(() => {
      const winner: Color = liveGame.turn === 'white' ? 'black' : 'white';
      setLiveGame(g => g.gameOver ? g : { ...g, gameOver: true, winner });
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [clocks, clocksActive, liveGame.turn, liveGame.gameOver, timeControl.initial]);

  const handleBack = useCallback(() => {
    const current = snapshotCursor ?? snapshots.length - 1;
    if (current > 0) setSnapshotCursor(current - 1);
  }, [snapshotCursor, snapshots.length]);

  const handleFirst = useCallback(() => {
    setSnapshotCursor(0);
  }, []);

  const handleForward = useCallback(() => {
    if (snapshotCursor === null) return;
    if (snapshotCursor < snapshots.length - 1) setSnapshotCursor(snapshotCursor + 1);
    else setSnapshotCursor(null);
  }, [snapshotCursor, snapshots.length]);

  const handleLast = useCallback(() => {
    setSnapshotCursor(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  { e.preventDefault(); handleBack(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); handleForward(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleBack, handleForward]);

  const persistActiveGame = useCallback((game: GameState, nextNotations: string[], savingLabel = 'Saving move...') => {
    if (activeGame) {
      savingGameRef.current = true;
      setGameSyncStatus(savingLabel);
      replaceGameForChallenge(activeGame, game, nextNotations)
        .then(row => {
          setActiveGame(row);
          setGameSyncStatus(`Saved via sync v${row.version}`);
          return refreshMultiplayer();
        })
        .catch(error => {
          setMpStatus(userMessage(error, 'Could not save game'));
          setGameSyncStatus('Save failed');
        })
        .finally(() => {
          savingGameRef.current = false;
        });
    }
  }, [activeGame, refreshMultiplayer]);

  const commitSnapshot = useCallback((game: GameState, notation: string) => {
    const nextNotations = [...notations, notation];
    setLiveGame(game);
    setSnapshots(prev => [...prev, game]);
    setNotations(nextNotations);
    setSnapshotCursor(null);
    persistActiveGame(game, nextNotations);
  }, [notations, persistActiveGame]);

  const pushSnapshot = useCallback((game: GameState, notation: string, movedColor: Color) => {
    const nextGame = game.drawOfferBy ? { ...game, drawOfferBy: null } : game;
    commitSnapshot(nextGame, notation);
    if (timeControl.initial > 0) {
      setClocksActive(true);
      if (timeControl.increment > 0)
        setClocks(prev => ({ ...prev, [movedColor]: prev[movedColor] + timeControl.increment }));
    }
  }, [commitSnapshot, timeControl.initial, timeControl.increment]);

  useEffect(() => {
    if (localMode !== 'computer' || activeGame || liveGame.turn !== 'black' || liveGame.gameOver || !atLatest) return;
    if (engineThinkingRef.current) return;
    if (engineType === 'neural' && (neuralLoading || !neuralSession)) return;

    engineThinkingRef.current = true;
    setEngineStatus('Thinking...');
    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const recentHashes = new Set(snapshots.slice(-8).map(boardHash));
          const result = engineType === 'neural' && neuralSession
            ? await playNeuralEngineTurnWithNotation(liveGame, neuralSession, recentHashes)
            : playEngineTurnWithNotation(liveGame);
          if (!cancelled) {
            if (result) { pushSnapshot(result.state, `Computer ${result.notation}`, 'black'); setEngineStatus(''); }
            else setEngineStatus('No legal move');
          }
        } finally {
          if (!cancelled) engineThinkingRef.current = false;
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      engineThinkingRef.current = false;
    };
  }, [activeGame, atLatest, engineType, liveGame, localMode, neuralLoading, neuralSession, pushSnapshot]);

  // ── Game log save ────────────────────────────────────────────────────────────

  const saveCurrentGameAsLog = useCallback((status: 'finished' | 'draw' | 'ongoing') => {
    if (!hasSupabaseConfig || notations.length === 0) return;
    // For multiplayer, only white side saves to avoid duplicates
    if (activeGame && onlineSeat !== 'white') return;

    let whiteUsername: string | null = null;
    let blackUsername: string | null = null;
    let mode = 'local';
    let white_is_human = true;
    let black_is_human = true;

    if (activeGame) {
      mode = 'multiplayer';
      const wp = profiles.find(p => p.id === activeGame.white_user_id);
      const bp = profiles.find(p => p.id === activeGame.black_user_id);
      whiteUsername = wp?.display_name ?? wp?.username ?? null;
      blackUsername = bp?.display_name ?? bp?.username ?? null;
    } else if (localMode === 'computer') {
      mode = 'computer';
      black_is_human = false;
      const userProfile = profiles.find(p => p.id === mpUser?.id);
      whiteUsername = userProfile?.display_name ?? userProfile?.username ?? 'Player';
      blackUsername = engineType === 'neural' ? 'Neural Engine' : 'Random Engine';
    }

    void saveGameLog({
      game_id: activeGame?.id ?? localGameIdRef.current,
      mode,
      white_user_id: activeGame?.white_user_id ?? mpUser?.id ?? null,
      black_user_id: activeGame?.black_user_id ?? null,
      white_username: whiteUsername,
      black_username: blackUsername,
      white_is_human,
      black_is_human,
      winner: liveGame.winner ?? null,
      status,
      snapshots: snapshots.map(serializeGameState),
      notations,
      move_count: notations.length,
    }).catch(() => {});
  }, [activeGame, engineType, liveGame.winner, localMode, mpUser, notations, onlineSeat, profiles, snapshots]);

  useEffect(() => {
    if (!liveGame.gameOver) {
      wasGameOverRef.current = false;
      return;
    }
    if (wasGameOverRef.current || gameLogSavedRef.current) return;
    if (activeGame && onlineSeat !== 'white') return;

    wasGameOverRef.current = true;
    gameLogSavedRef.current = true;

    const status = liveGame.winner ? 'finished' : 'draw';
    saveCurrentGameAsLog(status);
  }, [liveGame.gameOver, liveGame.winner, activeGame, onlineSeat, saveCurrentGameAsLog]);

  const loadHistory = useCallback(async () => {
    setHistoryStatus('Loading...');
    try {
      const logs = await listGameLogs();
      setGameLogs(logs);
      setHistoryStatus('');
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : 'Could not load history');
    }
  }, []);

  const handleViewHistoryGame = useCallback(async (id: string) => {
    setHistoryStatus('Loading game...');
    try {
      const log: GameLog = await loadGameLog(id);
      const deserialized = log.snapshots.map(deserializeGameState);
      gameLogSavedRef.current = true;  // prevent re-saving this historical game
      wasGameOverRef.current = true;
      setActiveGame(null);
      setActiveChallengeId(null);
      setLocalMode('hotseat');
      setGameSyncStatus('');
      setLiveGame(deserialized[deserialized.length - 1]);
      setSnapshots(deserialized);
      setNotations(log.notations);
      setSnapshotCursor(0);
      setPendingNotation('');
      setClocksActive(false);
      setViewingHistory(true);
      setHistoryStatus('');
      setAppView('game');
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : 'Could not load game');
    }
  }, []);

  // ── New game ─────────────────────────────────────────────────────────────────

  const handleNewGame = useCallback(() => {
    // Save current game as ongoing if it had moves but didn't finish
    if (notations.length > 0 && !liveGame.gameOver && !gameLogSavedRef.current) {
      saveCurrentGameAsLog('ongoing');
    }
    gameLogSavedRef.current = false;
    wasGameOverRef.current = false;
    localGameIdRef.current = crypto.randomUUID();
    const s = createInitialState();
    setLiveGame(s); setSnapshots([s]); setNotations([]); setSnapshotCursor(null); setPendingNotation('');
    setClocks({ white: timeControl.initial, black: timeControl.initial });
    setClocksActive(false);
    setEngineStatus('');
    setViewingHistory(false);
  }, [liveGame.gameOver, notations.length, saveCurrentGameAsLog, timeControl.initial]);

  const handleStartLocalGame = useCallback(() => {
    setLocalMode('hotseat');
    setActiveGame(null);
    setActiveChallengeId(null);
    setGameSyncStatus('');
    handleNewGame();
    setAppView('game');
  }, [handleNewGame]);

  const handleStartComputerGame = useCallback(() => {
    setLocalMode('computer');
    setActiveGame(null);
    setActiveChallengeId(null);
    setGameSyncStatus('');
    setGuestName(null);
    handleNewGame();
    setAppView('game');
  }, [handleNewGame]);

  const handleStartGuest = useCallback((name: string) => {
    const trimmed = name.trim() || 'Guest';
    setGuestName(trimmed.slice(0, 24));
    setLocalMode('hotseat');
    setActiveGame(null);
    setActiveChallengeId(null);
    setGameSyncStatus('');
    handleNewGame();
    setAppView('game');
  }, [handleNewGame]);

  const handleLeaveGuest = useCallback(() => {
    setGuestName(null);
    setAppView('lobby');
  }, []);

  const handleTimeControlChange = useCallback((tc: TimeControl) => {
    setTimeControl(tc);
    setClocks({ white: tc.initial, black: tc.initial });
  }, []);

  const loadMultiplayerGame = useCallback((row: GameRow, challengeId?: string | null) => {
    setLocalMode('hotseat');
    applySyncedGame(row);
    setActiveChallengeId(challengeId ?? activeChallengeId);
    setClocksActive(false);
    localGameIdRef.current = row.id;
    gameLogSavedRef.current = false;
    wasGameOverRef.current = false;
    setAppView('game');
  }, [activeChallengeId, applySyncedGame]);

  const handleMpSignIn = useCallback(async (email: string, password: string) => {
    setMpStatus('Signing in...');
    setAuthStatus('Signing in...');
    const user = await signIn(email, password);
    setGuestName(null);
    setMpUser(user);
    setMpStatus('Signed in');
    setAuthStatus('Signed in');
    setAuthMode(null);
    setAuthPassword('');
    setAppView('lobby');
    await refreshMultiplayer();
  }, [refreshMultiplayer]);

  const handleHeaderSignIn = useCallback(async () => {
    try {
      await handleMpSignIn(authEmail, authPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign in';
      setAuthStatus(message);
      setMpStatus(message);
    }
  }, [authEmail, authPassword, handleMpSignIn]);

  const handleRegister = useCallback(async () => {
    try {
      setAuthStatus('Creating account...');
      const result = await registerAccount(authEmail, authPassword, authUsername, authDisplayName);
      if (result.needsConfirmation) {
        setAuthStatus('Account created. Check email, then sign in.');
        setAuthMode('sign-in');
        setAuthPassword('');
        return;
      }
      if (result.user) {
        setMpUser(result.user);
        setAuthStatus('Registered and signed in');
        setAuthMode(null);
        setAuthPassword('');
        setGuestName(null);
        setAppView('lobby');
        await refreshMultiplayer();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not register';
      setAuthStatus(message);
      setMpStatus(message);
    }
  }, [authDisplayName, authEmail, authPassword, authUsername, refreshMultiplayer]);

  const handleMpSignOut = useCallback(async () => {
    await signOut();
    setMpUser(null);
    setProfiles([]);
    setChallenges([]);
    setGames([]);
    setActiveGame(null);
    setActiveChallengeId(null);
    setOnlineUserIds([]);
    setLobbyMessages([]);
    setAppView('lobby');
    setGameSyncStatus('');
    setMpStatus('Signed out');
    setAuthStatus('');
    setAuthMode(null);
  }, []);

  const handleCreateChallenge = useCallback(async (opponentId: string) => {
    if (!mpUser) return;
    try {
      setMpStatus('Sending challenge...');
      await createChallenge(mpUser.id, opponentId);
      setMpStatus('Challenge sent');
      setActiveGame(null);
      setActiveChallengeId(null);
      setGameSyncStatus('');
      await refreshMultiplayer();
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not send challenge');
    }
  }, [mpUser, refreshMultiplayer]);

  const handleAcceptChallenge = useCallback(async (challenge: Challenge) => {
    try {
      setMpStatus('Creating game...');
      const row = await acceptChallenge(challenge);
      loadMultiplayerGame(row, challenge.id);
      setMpStatus('Challenge accepted');
      await refreshMultiplayer();
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not accept challenge');
    }
  }, [loadMultiplayerGame, refreshMultiplayer]);

  const handleDeclineChallenge = useCallback(async (challengeId: string) => {
    try {
      await declineChallenge(challengeId);
      setMpStatus('Challenge declined');
      await refreshMultiplayer();
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not decline challenge');
    }
  }, [refreshMultiplayer]);

  const handleOpenGame = useCallback(async (gameId: string) => {
    try {
      const row = await loadGame(gameId);
      const challenge = challenges.find(item => item.game_id === gameId);
      loadMultiplayerGame(row, challenge?.id ?? null);
      setMpStatus('Game loaded');
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not open game');
    }
  }, [challenges, loadMultiplayerGame]);

  const handleClearChallengeQueue = useCallback(async () => {
    if (!mpUser) return;
    try {
      setMpStatus('Clearing queue...');
      await clearOpenChallengesForUser(mpUser.id);
      setActiveGame(null);
      setActiveChallengeId(null);
      setGameSyncStatus('');
      handleNewGame();
      await refreshMultiplayer();
      setMpStatus('Queue cleared');
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not clear queue');
    }
  }, [handleNewGame, mpUser, refreshMultiplayer]);

  const closeActiveGameChallenge = useCallback(async () => {
    if (!activeGame) return;
    try {
      await finishChallengeForGame(activeGame.id);
      await refreshMultiplayer();
    } catch (error) {
      setMpStatus(error instanceof Error ? error.message : 'Could not close game challenge');
    }
  }, [activeGame, refreshMultiplayer]);

  const handleSendGameMessage = useCallback(async (body: string) => {
    if (!activeChallengeId || !mpUser) return;
    try {
      await sendGameMessage(activeChallengeId, mpUser.id, body);
      setChatStatus('sent');
    } catch (error) {
      setChatStatus(error instanceof Error ? 'setup needed' : 'send failed');
    }
  }, [activeChallengeId, mpUser]);

  const handleSendLobbyMessage = useCallback(async (body: string) => {
    if (!mpUser) return;
    try {
      await sendLobbyMessage(mpUser.id, body);
      setLobbyChatStatus('sent');
    } catch (error) {
      setLobbyChatStatus(error instanceof Error ? 'setup needed' : 'send failed');
    }
  }, [mpUser]);

  const handleResign = useCallback(async () => {
    if (!activeGame || !activeSeat || liveGame.gameOver) return;
    if (!window.confirm('Resign this game?')) return;
    const winner: Color = activeSeat === 'white' ? 'black' : 'white';
    commitSnapshot(
      { ...liveGame, gameOver: true, winner, drawOfferBy: null, pendingPromotion: null },
      `${colorName(activeSeat)} resigns`,
    );
    void closeActiveGameChallenge();
    setMpStatus('Game resigned');
  }, [activeGame, activeSeat, closeActiveGameChallenge, commitSnapshot, liveGame]);

  const handleOfferOrAcceptDraw = useCallback(async () => {
    if (!activeGame || !activeSeat || liveGame.gameOver) return;
    if (liveGame.drawOfferBy && liveGame.drawOfferBy !== activeSeat) {
      commitSnapshot(
        { ...liveGame, gameOver: true, winner: null, drawOfferBy: null, pendingPromotion: null },
        'Draw agreed',
      );
      void closeActiveGameChallenge();
      setMpStatus('Draw accepted');
      return;
    }
    if (liveGame.drawOfferBy === activeSeat) return;
    commitSnapshot({ ...liveGame, drawOfferBy: activeSeat }, `${colorName(activeSeat)} offers draw`);
    setMpStatus('Draw offered');
  }, [activeGame, activeSeat, closeActiveGameChallenge, commitSnapshot, liveGame]);

  const handleDeclineDraw = useCallback(async () => {
    if (!activeGame || !activeSeat || liveGame.gameOver) return;
    if (!liveGame.drawOfferBy) return;
    const notation = liveGame.drawOfferBy === activeSeat
      ? `${colorName(activeSeat)} cancels draw offer`
      : `${colorName(activeSeat)} declines draw`;
    commitSnapshot({ ...liveGame, drawOfferBy: null }, notation);
    setMpStatus(liveGame.drawOfferBy === activeSeat ? 'Draw offer cancelled' : 'Draw declined');
  }, [activeGame, activeSeat, commitSnapshot, liveGame]);

  useEffect(() => {
    if (!mpUser) return;
    const accepted = challenges.find(challenge => challenge.status === 'accepted' && challenge.game_id);
    if (!accepted?.game_id || accepted.game_id === activeGameId) return;
    const timeout = window.setTimeout(() => {
      void handleOpenGame(accepted.game_id!);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeGameId, challenges, handleOpenGame, mpUser]);

  useEffect(() => {
    if (activeChallengeId || !activeGameId) return;
    const challenge = challenges.find(item => item.game_id === activeGameId);
    if (!challenge) return;
    const timeout = window.setTimeout(() => {
      setActiveChallengeId(challenge.id);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeChallengeId, activeGameId, challenges]);

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
      persistActiveGame(next, notations, 'Saving card...');
    }
  }, [atLatest, liveGame, notations, persistActiveGame, pushSnapshot]);

  const handleSquareClickDirect = useCallback((sq: Square) => {
    if (!interactive) return;
    if (!liveGame.cardFlipped || !liveGame.legalPlacementSquares.includes(sq)) return;
    const deck = liveGame.turn === 'white' ? liveGame.whiteDecks : liveGame.blackDecks;
    const card = deck.revealed!;
    const movedColor = liveGame.turn;
    pushSnapshot(placePiece(liveGame, sq), placeNotation(card.type, liveGame.turn, sq), movedColor);
  }, [interactive, liveGame, pushSnapshot]);

  const handleMove = useCallback((from: Square, to: Square) => {
    if (!interactive) return;
    const piece = liveGame.board.get(from);
    if (!piece) return;
    const notation = moveNotation(piece, from, to, liveGame.board.has(to));
    const movedColor = liveGame.turn;
    const next = makeMove(liveGame, from, to);
    if (next.pendingPromotion) { setPendingNotation(notation); setLiveGame(next); }
    else pushSnapshot(next, notation, movedColor);
  }, [interactive, liveGame, pushSnapshot]);

  const handlePromotion = useCallback((role: PromotionRole) => {
    const movedColor = liveGame.turn;
    const notation = pendingNotation + '=' + SYM[role][movedColor];
    const next = completePromotion(liveGame, role);
    setPendingNotation('');
    pushSnapshot(next, notation, movedColor);
  }, [liveGame, pendingNotation, pushSnapshot]);

  const canWhiteFlip = atLatest && !liveGame.gameOver && liveGame.turn === 'white' &&
    canAct && !liveGame.cardFlipped && liveGame.turnMode !== 'must-move' && liveGame.whiteDecks.pile.length > 0;
  const canBlackFlip = atLatest && !liveGame.gameOver && liveGame.turn === 'black' &&
    canAct && !liveGame.cardFlipped && liveGame.turnMode !== 'must-move' && liveGame.blackDecks.pile.length > 0;

  const blackActive = displayGame.turn === 'black' && !displayGame.gameOver;
  const whiteActive = displayGame.turn === 'white' && !displayGame.gameOver;
  const showClocks = timeControl.initial > 0;

  // ── Board + promotion overlay (shared) ──────────────────────────────────────
  const boardEl = (
    <div style={{ position: 'relative' }}>
      <ChessBoard
        state={displayGame}
        onSquareClick={handleSquareClickDirect}
        onMove={handleMove}
        interactive={interactive}
        orientation={boardOrientation}
      />
      {liveGame.pendingPromotion && atLatest && (
        <PromotionDialog
          color={liveGame.turn}
          usedRoles={liveGame.promotionRolesUsed[liveGame.turn]}
          onSelect={handlePromotion}
        />
      )}
    </div>
  );

  const gameInfoEl = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '420px' }}>
      <GameInfo
        state={displayGame}
        notations={notations}
        cursor={listCursor}
        clocks={clocks}
        showClocks={showClocks && !isMobile}
        clocksActive={clocksActive}
        atLatest={atLatest}
        activeSeat={activeGame ? activeSeat : null}
        drawOfferBy={liveGame.drawOfferBy}
        timePresets={TIME_PRESETS}
        timeControl={timeControl}
        onTimeControlChange={handleTimeControlChange}
        onNewGame={handleNewGame}
        onFirst={handleFirst}
        onBack={handleBack}
        onForward={handleForward}
        onLast={handleLast}
        onResign={handleResign}
        onOfferOrAcceptDraw={handleOfferOrAcceptDraw}
        onDeclineDraw={handleDeclineDraw}
      />
      {activeGame && (
        <GameChat
          user={mpUser}
          messages={gameMessages}
          profiles={profiles}
          status={chatStatus || gameSyncStatus}
          onSendMessage={handleSendGameMessage}
        />
      )}
      {localMode === 'computer' && !activeGame && (
        <div style={{
          background: '#1f1e1b',
          border: '1px solid #34312c',
          borderRadius: '6px',
          padding: '8px 10px',
          fontSize: '12px',
          lineHeight: 1.5,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span style={{ color: '#9e9b96' }}>You play White</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['neural', 'random'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEngineType(t)}
                  style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                    background: engineType === t ? '#1e2a0f' : '#1a1816',
                    color: engineType === t ? '#a8d060' : '#6e6b67',
                    border: `1px solid ${engineType === t ? '#3a5a12' : '#34312c'}`,
                  }}
                >{t === 'neural' ? 'Neural' : 'Random'}</button>
              ))}
            </div>
          </div>
          <div style={{ color: '#6e6b67' }}>
            {engineType === 'neural'
              ? neuralLoading ? 'Loading neural engine...' : (engineStatus || 'Neural engine ready')
              : (engineStatus || 'Random legal moves')}
          </div>
        </div>
      )}
      {viewingHistory && (
        <button
          type="button"
          onClick={() => { setAppView('history'); setViewingHistory(false); }}
          style={{
            width: '100%', padding: '7px', borderRadius: '8px',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer',
            background: '#1a1e2a', color: '#60a0d0', border: '1px solid #2a3a5a',
          }}
        >
          Back to History
        </button>
      )}
      <button
        type="button"
        onClick={() => setAppView('lobby')}
        style={{
          width: '100%', padding: '7px', borderRadius: '8px',
          fontSize: '12px', fontWeight: 700, cursor: 'pointer',
          background: '#1a1816', color: '#9e9b96', border: '1px solid #3d3b38',
        }}
      >
        Lobby
      </button>
    </div>
  );

  // ── MOBILE layout ────────────────────────────────────────────────────────────
  const authName = currentProfile?.display_name ?? currentProfile?.username ?? mpUser?.email ?? '';
  const appHeader = (
    <header style={{
      position: 'relative',
      background: '#262422',
      borderBottom: '1px solid #3d3b38',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: isMobile ? '8px 12px' : '10px 24px',
      gap: '12px',
      zIndex: 20,
    }}>
      <button
        type="button"
        onClick={() => {
          setAppView('lobby');
          setPlayMenuOpen(false);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          minWidth: 0,
          background: 'transparent',
          border: 0,
          padding: 0,
          cursor: 'pointer',
        }}
      >
        <KnightLogo />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: isMobile ? '16px' : '18px', letterSpacing: '0.03em' }}>Destovky</span>
      </button>

      <nav style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: 'auto' }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => {
              setAuthMode(null);
              setPlayMenuOpen(open => !open);
            }}
            style={{
              background: playMenuOpen ? '#1e2a0f' : '#1a1816',
              color: playMenuOpen ? '#a8d060' : '#d0c9bf',
              border: `1px solid ${playMenuOpen ? '#3a5a12' : '#3d3b38'}`,
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Play
          </button>
          {playMenuOpen && (
            <div style={{
              position: 'absolute',
              top: '34px',
              left: 0,
              width: '220px',
              background: '#2b2926',
              border: '1px solid #45413b',
              borderRadius: '7px',
              boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
              padding: '6px',
              display: 'grid',
              gap: '4px',
            }}>
              <HeaderMenuButton onClick={() => { setPlayMenuOpen(false); handleStartComputerGame(); }} title="Play against computer" detail="Neural engine · switch to Random in-game" />
              <HeaderMenuButton onClick={() => { setPlayMenuOpen(false); handleStartLocalGame(); }} title="Playground" detail="Local board practice" />
              <HeaderMenuButton
                onClick={() => {
                  setPlayMenuOpen(false);
                  setAppView('lobby');
                  setMpStatus(mpUser ? 'Choose a player to challenge' : 'Sign in to challenge players');
                }}
                title="Challenge player"
                detail={mpUser ? 'Pick from online players' : 'Requires sign in'}
              />
              <HeaderMenuButton onClick={() => { setPlayMenuOpen(false); setAppView('lobby'); }} title="Lobby" detail="Players, chat, games" />
            </div>
          )}
        </div>
        <button type="button" onClick={() => setAppView('lobby')} style={{
          background: appView === 'lobby' ? '#1e2a0f' : 'transparent',
          color: appView === 'lobby' ? '#a8d060' : '#9e9b96',
          border: `1px solid ${appView === 'lobby' ? '#3a5a12' : 'transparent'}`,
          borderRadius: '6px',
          padding: '6px 9px',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}>Lobby</button>
        <button type="button" onClick={() => { setPlayMenuOpen(false); setAppView('engine'); }} style={{
          background: appView === 'engine' ? '#1a1e2a' : 'transparent',
          color: appView === 'engine' ? '#60a0d0' : '#9e9b96',
          border: `1px solid ${appView === 'engine' ? '#2a3a5a' : 'transparent'}`,
          borderRadius: '6px',
          padding: '6px 9px',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}>Engine</button>
        <button type="button" onClick={() => { setPlayMenuOpen(false); setAppView('history'); void loadHistory(); }} style={{
          background: appView === 'history' ? '#1a1e2a' : 'transparent',
          color: appView === 'history' ? '#60a0d0' : '#9e9b96',
          border: `1px solid ${appView === 'history' ? '#2a3a5a' : 'transparent'}`,
          borderRadius: '6px',
          padding: '6px 9px',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}>History</button>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
        {mpUser ? (
          <>
            <span style={{ color: '#9e9b96', fontSize: '12px', maxWidth: isMobile ? '110px' : '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              signed in as <strong style={{ color: '#d0c9bf' }}>{authName}</strong>
            </span>
            <button type="button" onClick={() => void handleMpSignOut()} style={headerGhostButtonStyle}>Sign out</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => { setPlayMenuOpen(false); setAuthMode('sign-in'); }} style={headerGhostButtonStyle}>Sign in</button>
            <button type="button" onClick={() => { setPlayMenuOpen(false); setAuthMode('register'); }} style={headerPrimaryButtonStyle}>Register</button>
          </>
        )}
        {authMode && !mpUser && (
          <div style={{
            position: 'absolute',
            top: '38px',
            right: 0,
            width: isMobile ? 'calc(100vw - 24px)' : '300px',
            background: '#2b2926',
            border: '1px solid #45413b',
            borderRadius: '7px',
            boxShadow: '0 10px 24px rgba(0,0,0,0.38)',
            padding: '10px',
            display: 'grid',
            gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <strong style={{ color: '#d0c9bf', fontSize: '13px' }}>{authMode === 'sign-in' ? 'Sign in' : 'Register'}</strong>
              <button type="button" onClick={() => setAuthMode(null)} style={headerGhostButtonStyle}>Close</button>
            </div>
            {authMode === 'register' && (
              <>
                <input value={authUsername} onChange={e => setAuthUsername(e.target.value)} placeholder="username" style={headerInputStyle} />
                <input value={authDisplayName} onChange={e => setAuthDisplayName(e.target.value)} placeholder="display name" style={headerInputStyle} />
              </>
            )}
            <input value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="email" style={headerInputStyle} />
            <input
              value={authPassword}
              onChange={e => setAuthPassword(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter') return;
                void (authMode === 'sign-in' ? handleHeaderSignIn() : handleRegister());
              }}
              placeholder="password"
              type="password"
              style={headerInputStyle}
            />
            <button
              type="button"
              onClick={() => void (authMode === 'sign-in' ? handleHeaderSignIn() : handleRegister())}
              disabled={!hasSupabaseConfig}
              style={headerPrimaryButtonStyle}
            >
              {authMode === 'sign-in' ? 'Sign in' : 'Create account'}
            </button>
            {authStatus && <span style={{ color: '#c8a84a', fontSize: '11px', lineHeight: 1.35 }}>{authStatus}</span>}
          </div>
        )}
      </div>
    </header>
  );

  if (appView === 'engine') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
        {appHeader}
        <EnginePage />
      </div>
    );
  }

  if (appView === 'history') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
        {appHeader}
        <GameHistoryPage
          logs={gameLogs}
          status={historyStatus}
          onViewGame={id => void handleViewHistoryGame(id)}
          onRefresh={() => void loadHistory()}
        />
      </div>
    );
  }

  if (appView === 'lobby') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
        {appHeader}
        <LobbyPage
          configured={hasSupabaseConfig}
          user={mpUser}
          profiles={profiles}
          challenges={challenges}
          games={games}
          activeGame={activeGame}
          guestName={guestName}
          onlineUserIds={onlineUserIds}
          lobbyMessages={lobbyMessages}
          lobbyChatStatus={lobbyChatStatus}
          status={mpStatus}
          onSignIn={handleMpSignIn}
          onSignOut={handleMpSignOut}
          onStartGuest={handleStartGuest}
          onLeaveGuest={handleLeaveGuest}
          onCreateChallenge={handleCreateChallenge}
          onAcceptChallenge={handleAcceptChallenge}
          onDeclineChallenge={handleDeclineChallenge}
          onOpenGame={handleOpenGame}
          onRefresh={refreshMultiplayer}
          onClearQueue={handleClearChallengeQueue}
          onStartLocalGame={handleStartLocalGame}
          onStartComputerGame={handleStartComputerGame}
          onSendLobbyMessage={handleSendLobbyMessage}
        />
      </div>
    );
  }

  if (isMobile) {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#161512', color: '#bababa' }}>

        {/* Header — rigid, never moves */}
        <header style={{ flexShrink: 0, background: '#262422', borderBottom: '1px solid #3d3b38', display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px' }}>
          <KnightLogo />
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>Destovky</span>
          <button
            type="button"
            onClick={() => setAppView('lobby')}
            style={{
              marginLeft: 'auto',
              background: '#1a1816',
              color: '#9e9b96',
              border: '1px solid #3d3b38',
              borderRadius: '6px',
              padding: '5px 8px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Lobby
          </button>
          <span style={{ background: '#1e2a0f', color: '#629924', border: '1px solid #3a5a12', borderRadius: '4px', fontSize: '10px', fontWeight: 600, padding: '1px 6px' }}>
            {activeGame ? 'online' : localMode === 'computer' ? 'computer' : guestName ? 'guest' : 'hot seat'}
          </span>
        </header>

        {/* Black player row — rigid */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', gap: '8px' }}>
          <MobilePlayerRow color="black" active={blackActive} />
          <CardPile deck={displayGame.blackDecks} color="black" isActive={blackActive} canFlip={canBlackFlip} onFlipCard={handleFlipCard} layout="horizontal" />
          {showClocks && <Clock seconds={clocks.black} active={blackActive && atLatest && clocksActive} large />}
        </div>

        {/* Board — rigid, never moves */}
        <div style={{ flexShrink: 0 }}>{boardEl}</div>

        {/* White player row — rigid */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', gap: '8px' }}>
          <MobilePlayerRow color="white" active={whiteActive} />
          <CardPile deck={displayGame.whiteDecks} color="white" isActive={whiteActive} canFlip={canWhiteFlip} onFlipCard={handleFlipCard} layout="horizontal" />
          {showClocks && <Clock seconds={clocks.white} active={whiteActive && atLatest && clocksActive} large />}
        </div>

        {/* Game info — scrolls in remaining space, board never shifts */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 10px 12px' }}>
          {gameInfoEl}
        </div>

      </div>
    );
  }

  // ── DESKTOP layout ───────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#161512', color: '#bababa' }}>
      {appHeader}

      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', gap: '20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr 96px', gap: '16px', alignItems: 'center', width: '100%', maxWidth: '752px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <PlayerLabel
              color="black"
              active={blackActive}
              seconds={clocks.black}
              showClock={false}
              clockActive={blackActive && atLatest && clocksActive}
            />
            <CardPile deck={displayGame.blackDecks} color="black" isActive={blackActive} canFlip={canBlackFlip} onFlipCard={handleFlipCard} layout="vertical" />
          </div>
          {boardEl}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <PlayerLabel
              color="white"
              active={whiteActive}
              seconds={clocks.white}
              showClock={false}
              clockActive={whiteActive && atLatest && clocksActive}
            />
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

function HeaderMenuButton({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'grid',
        gap: '2px',
        textAlign: 'left',
        background: '#211f1c',
        color: '#d0c9bf',
        border: '1px solid #37332e',
        borderRadius: '5px',
        padding: '8px',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 800 }}>{title}</span>
      <span style={{ color: '#8f8981', fontSize: '11px' }}>{detail}</span>
    </button>
  );
}

const headerGhostButtonStyle: React.CSSProperties = {
  background: '#1a1816',
  color: '#bcb5ad',
  border: '1px solid #3d3b38',
  borderRadius: '6px',
  padding: '6px 9px',
  fontSize: '12px',
  fontWeight: 800,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const headerPrimaryButtonStyle: React.CSSProperties = {
  background: '#1e2a0f',
  color: '#a8d060',
  border: '1px solid #3a5a12',
  borderRadius: '6px',
  padding: '6px 10px',
  fontSize: '12px',
  fontWeight: 800,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const headerInputStyle: React.CSSProperties = {
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
  background: '#1a1816',
  color: '#e0dbd4',
  border: '1px solid #3d3b38',
  borderRadius: '6px',
  padding: '8px',
  fontSize: '12px',
};

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
