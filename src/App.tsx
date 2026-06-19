import { useState, useCallback, useEffect, useRef } from 'react';
import ChessBoard from './components/ChessBoard';
import CardPile from './components/CardPile';
import GameInfo from './components/GameInfo';
import GameChat from './components/GameChat';
import LobbyPage from './components/LobbyPage';
import PromotionDialog from './components/PromotionDialog';
import { createInitialState, flipCard, placePiece, makeMove, completePromotion } from './gameState';
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
  replaceGameForChallenge,
  sendGameMessage,
  sendLobbyMessage,
  signIn,
  signOut,
  stateFromGame,
  touchProfileLastSeen,
  type Challenge,
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
type AppView = 'lobby' | 'game';

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
  const activeGameRef = useRef<GameRow | null>(null);
  const savingGameRef = useRef(false);

  const atLatest = snapshotCursor === null;
  const displayGame = atLatest ? liveGame : snapshots[snapshotCursor!];
  const activeSeat: Color | null =
    activeGame && mpUser?.id === activeGame.white_user_id ? 'white'
      : activeGame && mpUser?.id === activeGame.black_user_id ? 'black'
        : null;
  const activeGameId = activeGame?.id ?? null;
  const boardOrientation: Color = activeSeat ?? 'white';
  const canAct = !activeGame || activeSeat === liveGame.turn;
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

  const handleNewGame = useCallback(() => {
    const s = createInitialState();
    setLiveGame(s); setSnapshots([s]); setNotations([]); setSnapshotCursor(null); setPendingNotation('');
    setClocks({ white: timeControl.initial, black: timeControl.initial });
    setClocksActive(false);
  }, [timeControl.initial]);

  const handleStartLocalGame = useCallback(() => {
    setActiveGame(null);
    setActiveChallengeId(null);
    setGameSyncStatus('');
    handleNewGame();
    setAppView('game');
  }, [handleNewGame]);

  const handleStartGuest = useCallback((name: string) => {
    const trimmed = name.trim() || 'Guest';
    setGuestName(trimmed.slice(0, 24));
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
    applySyncedGame(row);
    setActiveChallengeId(challengeId ?? activeChallengeId);
    setClocksActive(false);
    setAppView('game');
  }, [activeChallengeId, applySyncedGame]);

  const handleMpSignIn = useCallback(async (email: string, password: string) => {
    setMpStatus('Signing in...');
    const user = await signIn(email, password);
    setGuestName(null);
    setMpUser(user);
    setMpStatus('Signed in');
    setAppView('lobby');
    await refreshMultiplayer();
  }, [refreshMultiplayer]);

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
        activeSeat={activeSeat}
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
  const appHeader = (
    <header style={{ background: '#262422', borderBottom: '1px solid #3d3b38', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 24px', gap: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <KnightLogo />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: '18px', letterSpacing: '0.03em' }}>Destovky</span>
      </div>
      <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button type="button" onClick={() => setAppView('lobby')} style={{
          background: appView === 'lobby' ? '#1e2a0f' : '#1a1816',
          color: appView === 'lobby' ? '#a8d060' : '#9e9b96',
          border: `1px solid ${appView === 'lobby' ? '#3a5a12' : '#3d3b38'}`,
          borderRadius: '6px',
          padding: '6px 9px',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}>Lobby</button>
        <button type="button" onClick={() => setAppView('game')} style={{
          background: appView === 'game' ? '#1e2a0f' : '#1a1816',
          color: appView === 'game' ? '#a8d060' : '#9e9b96',
          border: `1px solid ${appView === 'game' ? '#3a5a12' : '#3d3b38'}`,
          borderRadius: '6px',
          padding: '6px 9px',
          fontSize: '12px',
          fontWeight: 800,
          cursor: 'pointer',
        }}>Game</button>
      </nav>
    </header>
  );

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
            {activeGame ? 'online' : guestName ? 'guest' : 'hot seat'}
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
