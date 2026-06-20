import type { User } from '@supabase/supabase-js';
import { createInitialState } from './gameState';
import { deserializeGameState, serializeGameState, type SerializedGameState } from './gameSerialization';
import { supabase } from './supabaseClient';
import type { Color, GameState } from './types';

export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type PreferredColor = Color | 'random';

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  active: boolean;
  last_seen_at?: string | null;
}

export interface Challenge {
  id: string;
  challenger_user_id: string;
  challenged_user_id: string;
  preferred_color: PreferredColor | null;
  status: ChallengeStatus;
  game_id: string | null;
  created_at: string;
  updated_at: string;
  challenger?: Profile;
  challenged?: Profile;
}

export interface GameRow {
  id: string;
  room_code: string;
  white_user_id: string | null;
  black_user_id: string | null;
  state_json: SerializedGameState;
  notations_json: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GameMessage {
  id: string;
  challenge_id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: Profile;
}

export interface LobbyMessage {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  profile?: Profile;
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

function roomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function assignSeats(challenge: Challenge): Pick<GameRow, 'white_user_id' | 'black_user_id'> {
  if (challenge.preferred_color === 'black') {
    return { white_user_id: challenge.challenged_user_id, black_user_id: challenge.challenger_user_id };
  }

  return { white_user_id: challenge.challenger_user_id, black_user_id: challenge.challenged_user_id };
}

export async function getSessionUser(): Promise<User | null> {
  const client = requireSupabase();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const client = requireSupabase();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('No user returned after sign in');
  return data.user;
}

export async function registerAccount(
  email: string,
  password: string,
  username: string,
  displayName: string,
): Promise<{ user: User | null; needsConfirmation: boolean }> {
  const client = requireSupabase();
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
  const cleanDisplayName = (displayName.trim() || cleanUsername || email.split('@')[0]).slice(0, 40);
  if (!cleanUsername) throw new Error('Username must use letters, numbers, or underscores');

  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        username: cleanUsername,
        display_name: cleanDisplayName,
      },
    },
  });
  if (error) throw error;

  if (data.user && data.session) {
    const { error: profileError } = await client
      .from('profiles')
      .upsert({
        id: data.user.id,
        username: cleanUsername,
        display_name: cleanDisplayName,
        active: true,
      }, { onConflict: 'id' });
    if (profileError) throw profileError;
  }

  return { user: data.user, needsConfirmation: Boolean(data.user && !data.session) };
}

export async function signOut(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function listProfiles(): Promise<Profile[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('active', true)
    .order('display_name');
  if (error) throw error;
  return data ?? [];
}

export async function touchProfileLastSeen(): Promise<void> {
  const client = requireSupabase();
  const { error } = await client.rpc('touch_my_profile_last_seen');
  if (error) throw error;
}

export async function listChallenges(userId: string): Promise<Challenge[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('challenges')
    .select('*')
    .or(`challenger_user_id.eq.${userId},challenged_user_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listUserGames(): Promise<GameRow[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('games')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return data ?? [];
}

export async function createChallenge(challengerUserId: string, challengedUserId: string): Promise<Challenge> {
  const client = requireSupabase();
  await cancelOpenChallengesForUser(challengerUserId);
  const { data, error } = await client
    .from('challenges')
    .insert({
      challenger_user_id: challengerUserId,
      challenged_user_id: challengedUserId,
      preferred_color: 'white',
      status: 'pending',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function declineChallenge(challengeId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('challenges')
    .update({ status: 'declined' })
    .eq('id', challengeId);
  if (error) throw error;
}

export async function finishChallengeForGame(gameId: string): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('challenges')
    .update({ status: 'cancelled' })
    .eq('game_id', gameId);
  if (error) throw error;
}

export async function clearOpenChallengesForUser(userId: string): Promise<void> {
  await cancelOpenChallengesForUser(userId);
}

export async function acceptChallenge(challenge: Challenge): Promise<GameRow> {
  const client = requireSupabase();
  await cancelOpenChallengesForUser(challenge.challenged_user_id, challenge.id);
  const seats = assignSeats(challenge);
  const initialState = createInitialState();

  const { data: game, error: gameError } = await client
    .from('games')
    .insert({
      room_code: roomCode(),
      ...seats,
      state_json: serializeGameState(initialState),
      notations_json: [],
      version: 1,
    })
    .select('*')
    .single();
  if (gameError) throw gameError;

  const { error: challengeError } = await client
    .from('challenges')
    .update({ status: 'accepted', game_id: game.id })
    .eq('id', challenge.id);
  if (challengeError) throw challengeError;

  return game;
}

async function cancelOpenChallengesForUser(userId: string, exceptChallengeId?: string): Promise<void> {
  const client = requireSupabase();
  let query = client
    .from('challenges')
    .update({ status: 'cancelled' })
    .in('status', ['pending', 'accepted'])
    .or(`challenger_user_id.eq.${userId},challenged_user_id.eq.${userId}`);

  if (exceptChallengeId) {
    query = query.neq('id', exceptChallengeId);
  }

  const { error } = await query;
  if (error) throw error;
}

export async function loadGame(gameId: string): Promise<GameRow> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();
  if (error) throw error;
  return data;
}

export async function listGameMessages(challengeId: string): Promise<GameMessage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('game_messages')
    .select('*')
    .eq('challenge_id', challengeId)
    .order('created_at', { ascending: true })
    .limit(80);
  if (error) throw error;
  return data ?? [];
}

export async function listLobbyMessages(): Promise<LobbyMessage[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('lobby_messages')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function sendLobbyMessage(userId: string, body: string): Promise<LobbyMessage> {
  const client = requireSupabase();
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message is empty');
  const { data, error } = await client
    .from('lobby_messages')
    .insert({ user_id: userId, body: trimmed.slice(0, 500) })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function sendGameMessage(challengeId: string, userId: string, body: string): Promise<GameMessage> {
  const client = requireSupabase();
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Message is empty');
  const { data, error } = await client
    .from('game_messages')
    .insert({ challenge_id: challengeId, user_id: userId, body: trimmed.slice(0, 500) })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function saveGame(row: GameRow, state: GameState, notations: string[]): Promise<GameRow> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('games')
    .update({
      state_json: serializeGameState(state),
      notations_json: notations,
      version: row.version + 1,
    })
    .eq('id', row.id)
    .eq('version', row.version)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function replaceGameForChallenge(
  row: GameRow,
  state: GameState,
  notations: string[],
): Promise<GameRow> {
  const client = requireSupabase();
  const challenge = await findAcceptedChallengeForGame(row);
  const { data: game, error: gameError } = await client
    .from('games')
    .insert({
      room_code: roomCode(),
      white_user_id: row.white_user_id,
      black_user_id: row.black_user_id,
      state_json: serializeGameState(state),
      notations_json: notations,
      version: row.version + 1,
    })
    .select('*')
    .single();
  if (gameError) throw gameError;

  const { error: challengeError } = await client
    .from('challenges')
    .update({ game_id: game.id, status: 'accepted' })
    .eq('id', challenge.id);
  if (challengeError) throw challengeError;

  return game;
}

async function findAcceptedChallengeForGame(row: GameRow): Promise<Challenge> {
  const client = requireSupabase();
  const byGame = await client
    .from('challenges')
    .select('*')
    .eq('status', 'accepted')
    .eq('game_id', row.id)
    .maybeSingle();
  if (byGame.error) throw byGame.error;
  if (byGame.data) return byGame.data;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('No signed-in user for game save fallback');

  const byUser = await client
    .from('challenges')
    .select('*')
    .eq('status', 'accepted')
    .or(`challenger_user_id.eq.${userData.user.id},challenged_user_id.eq.${userData.user.id}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (byUser.error) throw byUser.error;
  if (byUser.data) return byUser.data;

  throw new Error('No accepted challenge found for game save fallback');
}

export function stateFromGame(row: GameRow): GameState {
  return deserializeGameState(row.state_json);
}

// ── Game logs ─────────────────────────────────────────────────────────────────

export interface GameLog {
  id: string;
  game_id: string | null;
  mode: string;                   // 'multiplayer' | 'computer' | 'local'
  white_user_id: string | null;
  black_user_id: string | null;
  white_username: string | null;
  black_username: string | null;
  white_is_human: boolean;
  black_is_human: boolean;
  winner: string | null;          // 'white' | 'black' | null
  status: string;                 // 'finished' | 'draw' | 'ongoing'
  snapshots: SerializedGameState[];
  notations: string[];
  move_count: number;
  created_at: string;
}

export type GameLogSummary = Omit<GameLog, 'snapshots'>;

export async function saveGameLog(entry: Omit<GameLog, 'id' | 'created_at'>): Promise<void> {
  const client = requireSupabase();
  const { error } = await client
    .from('game_logs')
    .upsert(entry, { onConflict: 'game_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function listGameLogs(limit = 60): Promise<GameLogSummary[]> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('game_logs')
    .select('id, game_id, mode, white_user_id, black_user_id, white_username, black_username, white_is_human, black_is_human, winner, status, notations, move_count, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function loadGameLog(id: string): Promise<GameLog> {
  const client = requireSupabase();
  const { data, error } = await client
    .from('game_logs')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}
