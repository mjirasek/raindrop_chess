import type { Deck, Color, CardType } from '../types';

interface Props {
  deck: Deck;
  color: Color;
  isActive: boolean;
  canFlip: boolean;
  onFlipCard: () => void;
}

const SYMBOLS: Record<CardType, string> = {
  king: '♚', queen: '♛', rook: '♜', knight: '♞',
  'bishop-light': '♝', 'bishop-dark': '♝', pawn: '♟',
};

const NAMES: Record<CardType, string> = {
  king: 'King', queen: 'Queen', rook: 'Rook', knight: 'Knight',
  'bishop-light': 'Bishop', 'bishop-dark': 'Bishop', pawn: 'Pawn',
};

// Light/dark square colours matching the chessground brown theme
const BISHOP_SQUARE_COLOR: Record<'bishop-light' | 'bishop-dark', string> = {
  'bishop-light': '#f0d9b5',
  'bishop-dark':  '#b58863',
};

export default function CardPile({ deck, color, isActive, canFlip, onFlipCard }: Props) {
  const remaining = deck.pile.length;
  const revealed = deck.revealed;
  const isWhite = color === 'white';

  const symbolStyle: React.CSSProperties = {
    fontSize: '36px', lineHeight: 1, marginTop: '4px',
    color: isWhite ? '#f0d9b5' : '#2a1a0e',
    textShadow: isWhite ? 'none' : '0 0 4px rgba(255,255,255,0.6)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: isWhite ? 'column' : 'column-reverse', alignItems: 'center', gap: '16px' }}>

      {/* Drawn / face-up card */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6e6b67', fontWeight: 600 }}>
          Drawn
        </span>
        {revealed ? (
          <div style={{
            width: '72px', height: '100px', borderRadius: '8px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px',
            border: `2px solid ${isActive ? '#629924' : '#3d3b38'}`,
            background: isActive ? '#1e2a0f' : '#262422',
            boxShadow: isActive ? '0 0 14px rgba(98,153,36,0.35)' : 'none',
            position: 'relative', overflow: 'hidden',
          }}>
            <span style={symbolStyle}>{SYMBOLS[revealed.type]}</span>
            <span style={{ fontSize: '11px', color: '#c0b9b0', fontWeight: 600 }}>{NAMES[revealed.type]}</span>

            {/* Bishop colour circle badge */}
            {(revealed.type === 'bishop-light' || revealed.type === 'bishop-dark') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                <span style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  background: BISHOP_SQUARE_COLOR[revealed.type],
                  border: `2px solid ${revealed.type === 'bishop-light' ? '#c8a870' : '#7a5a3a'}`,
                  flexShrink: 0,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                }} />
                <span style={{ fontSize: '9px', color: '#9e9b96', fontWeight: 600 }}>
                  {revealed.type === 'bishop-light' ? 'light sq' : 'dark sq'}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div style={{
            width: '72px', height: '100px', borderRadius: '8px',
            border: '2px dashed #3d3b38', background: '#1a1816',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '10px', color: '#4a4744', textAlign: 'center' }}>No card</span>
          </div>
        )}
      </div>

      {/* Face-down deck */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6e6b67', fontWeight: 600 }}>
          Deck
        </span>
        <div
          style={{ width: '72px', height: '100px', position: 'relative', cursor: canFlip ? 'pointer' : 'default' }}
          onClick={canFlip ? onFlipCard : undefined}
          title={canFlip ? 'Click to flip a card' : undefined}
        >
          {remaining > 0 ? (
            <>
              {remaining > 2 && <div style={{ position: 'absolute', top: '4px', left: '4px', right: 0, bottom: 0, background: '#1a1816', borderRadius: '7px', border: '1px solid #2e2c2a' }} />}
              {remaining > 1 && <div style={{ position: 'absolute', top: '2px', left: '2px', right: 0, bottom: 0, background: '#222018', borderRadius: '7px', border: '1px solid #333028' }} />}
              {/* Top card face-down */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: '8px',
                border: `2px solid ${canFlip ? '#629924' : isActive ? '#4a6020' : '#3d3b38'}`,
                background: 'linear-gradient(135deg, #2c2926 0%, #1a1816 100%)',
                overflow: 'hidden',
                boxShadow: canFlip ? '0 0 16px rgba(98,153,36,0.5)' : 'none',
                transition: 'box-shadow 0.15s, border-color 0.15s, transform 0.15s',
                transform: canFlip ? 'translateY(0)' : 'none',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
              }}
              onMouseEnter={e => { if (canFlip) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(98,153,36,0.6)'; }}}
              onMouseLeave={e => { if (canFlip) { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(98,153,36,0.5)'; }}}
              >
                {/* Abstract card back pattern — 3×3 dot grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 6px)', gap: '5px', opacity: 0.25 }}>
                  {Array.from({ length: 9 }).map((_, i) => (
                    <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a09070' }} />
                  ))}
                </div>
                <span style={{ fontSize: '13px', fontWeight: 700, color: canFlip ? '#629924' : '#4a4744', marginTop: '4px' }}>
                  {remaining}
                </span>
                {canFlip && <span style={{ fontSize: '9px', color: '#629924', letterSpacing: '0.05em' }}>flip</span>}
              </div>
            </>
          ) : (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '8px',
              border: '2px dashed #3d3b38', background: '#1a1816',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '10px', color: '#4a4744' }}>Empty</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
