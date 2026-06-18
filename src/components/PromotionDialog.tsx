import type { Color, CGRole } from '../types';

interface Props {
  color: Color;
  promotionsUsed: number;
  onSelect: (role: CGRole) => void;
}

const CHOICES: CGRole[] = ['queen', 'rook', 'bishop', 'knight'];

const SYMBOLS: Record<CGRole, { white: string; black: string }> = {
  queen:  { white: '♕', black: '♛' },
  rook:   { white: '♖', black: '♜' },
  bishop: { white: '♗', black: '♝' },
  knight: { white: '♘', black: '♞' },
  king:   { white: '♔', black: '♚' },
  pawn:   { white: '♙', black: '♟' },
};

export default function PromotionDialog({ color, promotionsUsed, onSelect }: Props) {
  const remainingAfterThis = Math.max(0, 8 - promotionsUsed - 1);

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <div
        style={{
          background: '#262422', border: '2px solid #629924',
          borderRadius: '12px', padding: '20px 24px', textAlign: 'center',
        }}
      >
        <div style={{ color: '#a8d060', fontWeight: 700, fontSize: '13px', marginBottom: '14px', letterSpacing: '0.05em' }}>
          PAWN PROMOTION
        </div>
        <div style={{ color: '#9e9b96', fontSize: '11px', marginBottom: '12px' }}>
          {remainingAfterThis} promotion{remainingAfterThis === 1 ? '' : 's'} left after this
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          {CHOICES.map(role => (
            <button
              key={role}
              onClick={() => onSelect(role)}
              style={{
                width: '60px', height: '72px',
                background: '#1a1816', border: '2px solid #3d3b38',
                borderRadius: '8px', cursor: 'pointer',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: '4px',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#629924';
                e.currentTarget.style.background = '#1e2a0f';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#3d3b38';
                e.currentTarget.style.background = '#1a1816';
              }}
            >
              <span style={{
                fontSize: '32px', lineHeight: 1,
                color: color === 'white' ? '#f0d9b5' : '#2a1a0e',
                textShadow: color === 'black' ? '0 0 4px rgba(255,255,255,0.7)' : 'none',
              }}>
                {SYMBOLS[role][color]}
              </span>
              <span style={{ fontSize: '9px', color: '#6e6b67', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
