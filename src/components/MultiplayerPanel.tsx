import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Challenge, GameRow, Profile } from '../multiplayer';
import type { Color } from '../types';

interface Props {
  configured: boolean;
  user: User | null;
  profiles: Profile[];
  challenges: Challenge[];
  activeGame: GameRow | null;
  activeSeat: Color | null;
  gameOver: boolean;
  drawOfferBy: Color | null;
  status: string;
  syncStatus: string;
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onCreateChallenge: (opponentId: string) => Promise<void>;
  onAcceptChallenge: (challenge: Challenge) => Promise<void>;
  onDeclineChallenge: (challengeId: string) => Promise<void>;
  onOpenGame: (gameId: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClearQueue: () => Promise<void>;
  onResign: () => Promise<void>;
  onOfferOrAcceptDraw: () => Promise<void>;
  onDeclineDraw: () => Promise<void>;
  onLeaveGame: () => Promise<void>;
}

function nameFor(profile?: Profile): string {
  return profile?.display_name ?? profile?.username ?? 'Unknown';
}

export default function MultiplayerPanel({
  configured,
  user,
  profiles,
  challenges,
  activeGame,
  activeSeat,
  gameOver,
  drawOfferBy,
  status,
  syncStatus,
  onSignIn,
  onSignOut,
  onCreateChallenge,
  onAcceptChallenge,
  onDeclineChallenge,
  onOpenGame,
  onRefresh,
  onClearQueue,
  onResign,
  onOfferOrAcceptDraw,
  onDeclineDraw,
  onLeaveGame,
}: Props) {
  const [email, setEmail] = useState('misa@raindrop.local');
  const [password, setPassword] = useState('');
  const [opponentId, setOpponentId] = useState('');

  const opponents = user ? profiles.filter(p => p.id !== user.id) : [];
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const incoming = user ? challenges.filter(c => c.status === 'pending' && c.challenged_user_id === user.id).slice(0, 1) : [];
  const outgoing = user ? challenges.filter(c => c.status === 'pending' && c.challenger_user_id === user.id).slice(0, 1) : [];
  const accepted = activeGame ? [] : challenges.filter(c => c.status === 'accepted' && c.game_id).slice(0, 1);
  const hasQueuedGame = Boolean(activeGame) || accepted.length > 0 || incoming.length > 0 || outgoing.length > 0;
  const canChallenge = Boolean(opponentId) && !activeGame;
  const canAcceptIncoming = !activeGame && accepted.length === 0 && outgoing.length === 0;
  const drawOfferFromOpponent = activeSeat && drawOfferBy && drawOfferBy !== activeSeat;

  if (!configured) {
    return (
      <section style={panelStyle}>
        <Header title="Challenge" action="setup needed" />
        <p style={bodyText}>Playground works now. Challenge mode needs Supabase URL and anon key in local environment variables.</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section style={panelStyle}>
        <Header title="Challenge" action="login" />
        <div style={{ display: 'grid', gap: '6px' }}>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email" style={inputStyle} />
          <input value={password} onChange={e => setPassword(e.target.value)} placeholder="password" type="password" style={inputStyle} />
          <button style={buttonStyle} onClick={() => onSignIn(email, password)}>Sign in</button>
        </div>
        {status && <p style={statusStyle}>{status}</p>}
      </section>
    );
  }

  return (
    <section style={panelStyle}>
      <Header title="Challenge" action={activeGame ? `room ${activeGame.room_code}` : 'online'} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
        <span style={bodyText}>{user.email}</span>
        <button style={smallButtonStyle} onClick={onSignOut}>Sign out</button>
      </div>

      {activeGame && activeSeat && (
        <div style={{ display: 'grid', gap: '6px', background: '#1a1816', border: '1px solid #3d3b38', borderRadius: '6px', padding: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
            <span style={bodyText}>You are {activeSeat}</span>
            {drawOfferBy && !gameOver && (
              <span style={mutedText}>
                {drawOfferFromOpponent ? 'draw offered' : 'offer sent'}
              </span>
            )}
          </div>
          {!gameOver && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
              <button type="button" title="Resign game" style={resignActionButtonStyle} onClick={onResign}>
                resign
              </button>
              <button
                type="button"
                title={drawOfferFromOpponent ? 'Accept draw offer' : 'Offer draw'}
                style={{
                  ...drawActionButtonStyle,
                  opacity: drawOfferBy === activeSeat ? 0.55 : 1,
                  cursor: drawOfferBy === activeSeat ? 'default' : 'pointer',
                }}
                onClick={onOfferOrAcceptDraw}
                disabled={drawOfferBy === activeSeat}
              >
                {drawOfferFromOpponent ? 'accept draw' : drawOfferBy === activeSeat ? 'draw offered' : 'offer draw'}
              </button>
              {drawOfferFromOpponent && (
                <button type="button" style={{ ...neutralActionButtonStyle, gridColumn: '1 / -1' }} onClick={onDeclineDraw}>
                  decline draw
                </button>
              )}
            </div>
          )}
          {gameOver && (
            <button style={smallButtonStyle} onClick={onLeaveGame}>Back to lobby</button>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gap: '6px' }}>
        <select value={opponentId} onChange={e => setOpponentId(e.target.value)} style={inputStyle}>
          <option value="">{opponents.length === 0 ? 'No opponents loaded' : 'Choose opponent'}</option>
          {opponents.map(profile => (
            <option key={profile.id} value={profile.id}>{profile.display_name}</option>
          ))}
        </select>
        <button style={buttonStyle} disabled={!canChallenge} onClick={() => onCreateChallenge(opponentId)}>
          Send challenge
        </button>
        {hasQueuedGame && !activeGame && (
          <p style={statusStyle}>Sending a new challenge will clear the old pending game first.</p>
        )}
        {hasQueuedGame && (
          <button style={smallButtonStyle} onClick={onClearQueue}>Clear queue</button>
        )}
        {activeGame && !gameOver && <p style={statusStyle}>Finish or leave the current game before challenging again.</p>}
      </div>

      {incoming.length > 0 && (
        <ChallengeList title="Incoming" challenges={incoming}>
          {challenge => (
            <>
              <ChallengeName challenge={challenge} profiles={profileById} />
              <button style={smallButtonStyle} disabled={!canAcceptIncoming} onClick={() => onAcceptChallenge(challenge)}>Accept</button>
              <button style={smallButtonStyle} onClick={() => onDeclineChallenge(challenge.id)}>Decline</button>
            </>
          )}
        </ChallengeList>
      )}

      {outgoing.length > 0 && (
        <ChallengeList title="Pending" challenges={outgoing}>
          {challenge => (
            <>
              <ChallengeName challenge={challenge} profiles={profileById} />
              <span style={mutedText}>waiting</span>
            </>
          )}
        </ChallengeList>
      )}

      {accepted.length > 0 && (
        <ChallengeList title="Game" challenges={accepted}>
          {challenge => (
            <>
              <ChallengeName challenge={challenge} profiles={profileById} />
              <button style={smallButtonStyle} onClick={() => challenge.game_id && onOpenGame(challenge.game_id)}>Open</button>
            </>
          )}
        </ChallengeList>
      )}

      <button style={smallButtonStyle} onClick={onRefresh}>Refresh</button>
      {syncStatus && <p style={syncStatusStyle}>{syncStatus}</p>}
      {status && <p style={statusStyle}>{status}</p>}
    </section>
  );
}

function ChallengeList({ title, challenges, children }: { title: string; challenges: Challenge[]; children: (challenge: Challenge) => React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: '#6e6b67', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: '4px' }}>
        {challenges.map(challenge => (
          <div key={challenge.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', background: '#1a1816', border: '1px solid #3d3b38', borderRadius: '6px', padding: '5px 6px' }}>
            <span style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: 'auto' }}>{children(challenge)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChallengeName({ challenge, profiles }: { challenge: Challenge; profiles: Map<string, Profile> }) {
  return (
    <span style={{ fontSize: '11px', color: '#c0b9b0', marginRight: '4px' }}>
      {nameFor(profiles.get(challenge.challenger_user_id))} vs {nameFor(profiles.get(challenge.challenged_user_id))}
    </span>
  );
}

function Header({ title, action }: { title: string; action: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '10px', color: '#6e6b67', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</span>
      <span style={{ fontSize: '10px', color: '#629924', fontWeight: 700 }}>{action}</span>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#262422',
  border: '1px solid #3d3b38',
  borderRadius: '8px',
  padding: '8px',
  display: 'grid',
  gap: '8px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#1a1816',
  color: '#e0dbd4',
  border: '1px solid #3d3b38',
  borderRadius: '6px',
  padding: '6px 7px',
  fontSize: '12px',
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  background: '#1e2a0f',
  color: '#a8d060',
  border: '1px solid #3a5a12',
  borderRadius: '6px',
  padding: '6px 7px',
  fontSize: '12px',
  fontWeight: 700,
  cursor: 'pointer',
};

const smallButtonStyle: React.CSSProperties = {
  background: '#1a1816',
  color: '#9e9b96',
  border: '1px solid #3d3b38',
  borderRadius: '5px',
  padding: '3px 6px',
  fontSize: '10px',
  fontWeight: 700,
  cursor: 'pointer',
};

const actionButtonBaseStyle: React.CSSProperties = {
  borderRadius: '5px',
  padding: '7px 8px',
  fontSize: '11px',
  fontWeight: 800,
  cursor: 'pointer',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const resignActionButtonStyle: React.CSSProperties = {
  ...actionButtonBaseStyle,
  background: '#2b1a17',
  color: '#d78c76',
  border: '1px solid #694038',
};

const drawActionButtonStyle: React.CSSProperties = {
  ...actionButtonBaseStyle,
  background: '#20201d',
  color: '#c4beb6',
  border: '1px solid #4a463f',
};

const neutralActionButtonStyle: React.CSSProperties = {
  ...actionButtonBaseStyle,
  background: '#1a1816',
  color: '#9e9b96',
  border: '1px solid #3d3b38',
};

const bodyText: React.CSSProperties = {
  color: '#9e9b96',
  fontSize: '11px',
  lineHeight: 1.35,
  margin: 0,
};

const mutedText: React.CSSProperties = {
  color: '#6e6b67',
  fontSize: '10px',
};

const statusStyle: React.CSSProperties = {
  color: '#c8a84a',
  fontSize: '10px',
  lineHeight: 1.35,
  margin: 0,
};

const syncStatusStyle: React.CSSProperties = {
  color: '#629924',
  fontSize: '10px',
  lineHeight: 1.35,
  margin: 0,
};
