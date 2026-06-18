import type { GameState, CardType, CGRole, Color } from '../types';
import MoveList from './MoveList';

interface TimeControl { initial: number; increment: number; label: string; }

interface Props {
  state: GameState;
  notations: string[];
  cursor: number;
  timePresets: TimeControl[];
  timeControl: TimeControl;
  onTimeControlChange: (tc: TimeControl) => void;
  onNewGame: () => void;
  onBack: () => void;
  onForward: () => void;
}

const CARD_NAMES: Record<CardType, string> = {
  king: 'King', queen: 'Queen', rook: 'Rook', knight: 'Knight',
  'bishop-light': 'Light Bishop', 'bishop-dark': 'Dark Bishop', pawn: 'Pawn',
};

const PROMOTION_ROLES: CGRole[] = ['queen', 'rook', 'bishop', 'knight'];

export default function GameInfo({ state, notations, cursor, timePresets, timeControl, onTimeControlChange, onNewGame, onBack, onForward }: Props) {
  const { turn, turnMode, cardFlipped, gameOver, winner, inCheck, whiteDecks, blackDecks, promotionCounts } = state;
  const myDeck = turn === 'white' ? whiteDecks : blackDecks;
  const hasCards = myDeck.pile.length > 0;
  const turnLabel = turn === 'white' ? 'White' : 'Black';
  const gameStarted = notations.length > 0;
  const promotionsLeft = {
    white: Math.max(0, 8 - promotionCounts.white),
    black: Math.max(0, 8 - promotionCounts.black),
  };

  let hint: React.ReactNode = null;
  if (!gameOver) {
    if (turnMode === 'must-place') {
      hint = cardFlipped
        ? <>Place <strong style={{ color: '#a8d060' }}>{myDeck.revealed ? CARD_NAMES[myDeck.revealed.type] : ''}</strong> on a green square</>
        : 'Click your deck to flip a card';
    } else if (turnMode === 'choose') {
      if (cardFlipped) {
        hint = <>Place <strong style={{ color: '#a8d060' }}>{myDeck.revealed ? CARD_NAMES[myDeck.revealed.type] : ''}</strong> on a green square</>;
      } else if (state.inCheck) {
        hint = <><span style={{ color: '#ff9944' }}>In check</span> — move a piece, or flip a card <span style={{ color: '#cc6633' }}>(risky!)</span></>;
      } else {
        hint = hasCards ? 'Flip deck — or click a piece to move' : 'Click a piece to move';
      }
    } else if (turnMode === 'must-move') {
      hint = cardFlipped
        ? <>Block check: place <strong style={{ color: '#a8d060' }}>{myDeck.revealed ? CARD_NAMES[myDeck.revealed.type] : ''}</strong></>
        : <span style={{ color: '#ff9944' }}>In check — no cards left, must move</span>;
    }
    if (state.pendingPromotion) hint = 'Choose a promotion piece';
  }

  const isViewingHistory = cursor < notations.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '420px' }}>

      {/* Game over */}
      {gameOver && (
        <div style={{ background: '#1e2a0f', border: '1px solid #629924', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
          <div style={{ color: '#a8d060', fontSize: '18px', fontWeight: 700 }}>
            {winner === null ? 'Draw' : winner === 'white' ? 'White wins' : 'Black wins'}
          </div>
          <div style={{ color: '#7a9a40', fontSize: '11px', marginTop: '2px' }}>
            {winner === null ? 'Game drawn by agreement' : state.inCheck ? 'Card could not resolve check' : 'Game over'}
          </div>
        </div>
      )}

      {/* Check warning */}
      {!gameOver && inCheck && (
        <div style={{ background: '#2a0a0a', border: '1px solid #cc3333', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
          <span style={{ color: '#ff5555', fontWeight: 700, fontSize: '12px' }}>⚠ {turnLabel} in check!</span>
        </div>
      )}

      {/* Turn indicator */}
      {!gameOver && !isViewingHistory && (
        <div style={{ background: '#262422', border: '1px solid #3d3b38', borderRadius: '8px', padding: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', marginBottom: '6px' }}>
            <span style={{
              width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0,
              background: turn === 'white' ? '#f0d9b5' : '#2a1a0e',
              border: `2px solid ${turn === 'white' ? '#b58863' : '#9a7050'}`,
            }} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: '#e0dbd4' }}>{turnLabel}'s turn</span>
          </div>
          <p style={{ fontSize: '11px', color: '#6e6b67', textAlign: 'center', margin: 0, lineHeight: '1.4' }}>{hint}</p>
        </div>
      )}

      {/* Viewing history banner */}
      {isViewingHistory && !gameOver && (
        <div style={{ background: '#1a1510', border: '1px solid #6e5a30', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#c8a84a' }}>Viewing history</span>
        </div>
      )}

      {/* Move list */}
      <MoveList notations={notations} cursor={cursor} onBack={onBack} onForward={onForward} />

      {/* Promotion capacity */}
      <div style={{ background: '#262422', border: '1px solid #3d3b38', borderRadius: '8px', padding: '8px' }}>
        <div style={{ fontSize: '10px', color: '#6e6b67', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
          Promotions left
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <PromotionCount label="White" color="white" value={promotionsLeft.white} active={turn === 'white' && !gameOver} />
          <PromotionCount label="Black" color="black" value={promotionsLeft.black} active={turn === 'black' && !gameOver} />
        </div>
        <div style={{ fontSize: '10px', color: '#6e6b67', lineHeight: '1.35', marginTop: '6px' }}>
          Choice is queen, rook, bishop, or knight. Piece type is not stock-limited.
        </div>
      </div>

      {/* Time control selector — only before game starts */}
      {!gameStarted && (
        <div style={{ background: '#262422', border: '1px solid #3d3b38', borderRadius: '8px', padding: '8px' }}>
          <div style={{ fontSize: '10px', color: '#6e6b67', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
            Time control
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {timePresets.map(tc => {
              const active = tc.label === timeControl.label;
              return (
                <button
                  key={tc.label}
                  onClick={() => onTimeControlChange(tc)}
                  style={{
                    padding: '3px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', border: `1px solid ${active ? '#629924' : '#3d3b38'}`,
                    background: active ? '#1e2a0f' : '#1a1816',
                    color: active ? '#a8d060' : '#6e6b67',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = '#629924'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = '#3d3b38'; }}
                >
                  {tc.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* New game */}
      <button
        onClick={onNewGame}
        style={{
          width: '100%', padding: '7px', borderRadius: '8px',
          fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          background: '#262422', color: '#9e9b96', border: '1px solid #3d3b38',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#302e2c'}
        onMouseLeave={e => e.currentTarget.style.background = '#262422'}
      >
        New Game
      </button>
    </div>
  );
}

function PromotionCount({ label, color, value, active }: { label: string; color: Color; value: number; active: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '5px',
      background: active ? '#1e2a0f' : '#1a1816',
      border: `1px solid ${active ? '#3a5a12' : '#3d3b38'}`,
      borderRadius: '6px',
      padding: '5px 7px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: active ? '#a8d060' : '#9e9b96', fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '12px', color: '#e0dbd4', fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
        {PROMOTION_ROLES.map(role => (
          <PieceIcon key={role} role={role} color={color} />
        ))}
      </div>
    </div>
  );
}

function PieceIcon({ role, color }: { role: CGRole; color: Color }) {
  return (
    <span
      className="cg-wrap promotion-piece-icon"
      title={role}
      dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${color}" aria-hidden="true"></piece>` }}
    />
  );
}
