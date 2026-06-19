import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { LobbyMessage, Profile } from '../multiplayer';

interface Props {
  user: User | null;
  guestName: string | null;
  messages: LobbyMessage[];
  profiles: Profile[];
  status: string;
  onSendMessage: (body: string) => Promise<void>;
}

function nameFor(userId: string, profiles: Profile[]): string {
  return profiles.find(profile => profile.id === userId)?.display_name ?? 'Player';
}

function messageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LobbyChat({ user, guestName, messages, profiles, status, onSendMessage }: Props) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const canSend = Boolean(user && body.trim() && !sending);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await onSendMessage(body);
      setBody('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={shellStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={titleStyle}>Lobby chat</span>
        <span style={statusStyle}>{status || (user ? 'ready' : guestName ? 'guest read-only' : 'login')}</span>
      </div>
      <div style={messagesStyle}>
        {messages.length === 0 && <p style={mutedText}>No lobby messages yet.</p>}
        {messages.map(message => (
          <div key={message.id} style={messageStyle}>
            <span style={messageMetaStyle}>
              <span style={authorStyle}>{nameFor(message.user_id, profiles)}</span>
              <span style={timeStyle}>{messageTime(message.created_at)}</span>
            </span>
            <span style={bodyStyle}>{message.body}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' }}>
        <input
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(); }}
          placeholder={user ? 'Message the lobby' : 'Sign in to chat'}
          disabled={!user}
          style={inputStyle}
        />
        <button type="button" style={buttonStyle} disabled={!canSend} onClick={() => void send()}>
          Send
        </button>
      </div>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  display: 'grid',
  gap: '8px',
  minWidth: 0,
};

const titleStyle: React.CSSProperties = {
  color: '#8f8981',
  fontSize: '10px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const statusStyle: React.CSSProperties = {
  color: '#629924',
  fontSize: '10px',
  fontWeight: 800,
};

const messagesStyle: React.CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: '5px',
  minHeight: '136px',
  maxHeight: '220px',
  overflowY: 'auto',
  background: '#1a1816',
  border: '1px solid #34312c',
  borderRadius: '6px',
  padding: '6px',
};

const messageStyle: React.CSSProperties = {
  display: 'grid',
  gap: '3px',
  background: '#211f1c',
  border: '1px solid #302d28',
  borderRadius: '5px',
  padding: '6px 7px',
};

const messageMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  minWidth: 0,
};

const authorStyle: React.CSSProperties = {
  color: '#8f8981',
  fontSize: '10px',
  fontWeight: 800,
};

const bodyStyle: React.CSSProperties = {
  color: '#d0c9bf',
  fontSize: '12px',
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
};

const timeStyle: React.CSSProperties = {
  color: '#5f5a52',
  fontSize: '10px',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
};

const mutedText: React.CSSProperties = {
  color: '#756f67',
  fontSize: '11px',
  margin: 0,
};

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  background: '#1a1816',
  color: '#e0dbd4',
  border: '1px solid #3d3b38',
  borderRadius: '6px',
  padding: '8px',
  fontSize: '12px',
};

const buttonStyle: React.CSSProperties = {
  background: '#1e2a0f',
  color: '#a8d060',
  border: '1px solid #3a5a12',
  borderRadius: '6px',
  padding: '8px 10px',
  fontSize: '12px',
  fontWeight: 800,
  cursor: 'pointer',
};
