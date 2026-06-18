import type { GameState, CardType, CGRole, Color } from '../types';
import MoveList from './MoveList';

interface TimeControl { initial: number; increment: number; label: string; }

interface Props {
  state: GameState;
  notations: string[];
  cursor: number;
  clocks: Record<Color, number>;
  showClocks: boolean;
  clocksActive: boolean;
  atLatest: boolean;
  activeSeat: Color | null;
  drawOfferBy: Color | null;
  timePresets: TimeControl[];
  timeControl: TimeControl;
  onTimeControlChange: (tc: TimeControl) => void;
  onNewGame: () => void;
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
  onResign: () => Promise<void>;
  onOfferOrAcceptDraw: () => Promise<void>;
  onDeclineDraw: () => Promise<void>;
}

const CARD_NAMES: Record<CardType, string> = {
  king: 'King', queen: 'Queen', rook: 'Rook', knight: 'Knight',
  'bishop-light': 'Light Bishop', 'bishop-dark': 'Dark Bishop', pawn: 'Pawn',
};

const PROMOTION_ROLES: CGRole[] = ['queen', 'rook', 'bishop', 'knight'];

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function GameInfo({
  state,
  notations,
  cursor,
  clocks,
  showClocks,
  clocksActive,
  atLatest,
  activeSeat,
  drawOfferBy,
  timePresets,
  timeControl,
  onTimeControlChange,
  onNewGame,
  onFirst,
  onBack,
  onForward,
  onLast,
  onResign,
  onOfferOrAcceptDraw,
  onDeclineDraw,
}: Props) {
  const { turn, turnMode, cardFlipped, gameOver, winner, inCheck, whiteDecks, blackDecks } = state;
  const myDeck = turn === 'white' ? whiteDecks : blackDecks;
  const hasCards = myDeck.pile.length > 0;
  const turnLabel = turn === 'white' ? 'White' : 'Black';
  const gameStarted = notations.length > 0;
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
  const drawOfferFromOpponent = activeSeat && drawOfferBy && drawOfferBy !== activeSeat;
  const canUseGameActions = Boolean(activeSeat) && !gameOver && atLatest;

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
        <div style={{ background: '#262421', border: '1px solid #3a3732', borderRadius: '6px', padding: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', color: '#8f8981', fontWeight: 700 }}>
              {timeControl.label} · Raindrop
            </span>
            <span style={{ fontWeight: 700, fontSize: '12px', color: '#d5cec5' }}>{turnLabel} to move</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0,
              background: turn === 'white' ? '#f0d9b5' : '#2a1a0e',
              border: `2px solid ${turn === 'white' ? '#b58863' : '#9a7050'}`,
            }} />
            <p style={{ fontSize: '12px', color: '#9c958c', margin: 0, lineHeight: '1.35' }}>{hint}</p>
          </div>
        </div>
      )}

      {/* Viewing history banner */}
      {isViewingHistory && !gameOver && (
        <div style={{ background: '#1a1510', border: '1px solid #6e5a30', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
          <span style={{ fontSize: '11px', color: '#c8a84a' }}>Viewing history</span>
        </div>
      )}

      {/* Move list */}
      <div style={desktopGamePanelStyle}>
        <PlayerSideBand
          color="black"
          seconds={clocks.black}
          showClock={showClocks}
          active={turn === 'black' && !gameOver && atLatest && clocksActive}
        />
        <MoveList
          notations={notations}
          cursor={cursor}
          onFirst={onFirst}
          onBack={onBack}
          onForward={onForward}
          onLast={onLast}
          embedded
        />
        {canUseGameActions && activeSeat && (
          <GameActions
            drawOfferBy={drawOfferBy}
            activeSeat={activeSeat}
            drawOfferFromOpponent={Boolean(drawOfferFromOpponent)}
            onResign={onResign}
            onOfferOrAcceptDraw={onOfferOrAcceptDraw}
            onDeclineDraw={onDeclineDraw}
          />
        )}
        <PlayerSideBand
          color="white"
          seconds={clocks.white}
          showClock={showClocks}
          active={turn === 'white' && !gameOver && atLatest && clocksActive}
        />
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

function PromotionOption({ role, color }: { role: CGRole; color: Color }) {
  return (
    <span style={promotionOptionStyle} title={role}>
      <PieceIcon role={role} color={color} />
    </span>
  );
}

function PromotionBox({ color }: { color: Color }) {
  return (
    <div style={promotionBoxStyle}>
      <div style={promotionBoxTitleStyle}>Promotions</div>
      <div style={promotionChoicesStyle}>
        {PROMOTION_ROLES.map(role => (
          <PromotionOption key={role} role={role} color={color} />
        ))}
      </div>
    </div>
  );
}

function GameActions({
  drawOfferBy,
  activeSeat,
  drawOfferFromOpponent,
  onResign,
  onOfferOrAcceptDraw,
  onDeclineDraw,
}: {
  drawOfferBy: Color | null;
  activeSeat: Color;
  drawOfferFromOpponent: boolean;
  onResign: () => Promise<void>;
  onOfferOrAcceptDraw: () => Promise<void>;
  onDeclineDraw: () => Promise<void>;
}) {
  const drawByMe = drawOfferBy === activeSeat;
  const canCancelDraw = Boolean(drawOfferBy);
  return (
    <div style={actionRowStyle}>
      <ActionIconButton
        label="X"
        title={drawByMe ? 'Cancel draw offer' : drawOfferFromOpponent ? 'Decline draw offer' : 'No draw offer to cancel'}
        disabled={!canCancelDraw}
        onClick={onDeclineDraw}
      />
      <ActionIconButton
        label="1/2"
        title={drawOfferFromOpponent ? 'Accept draw offer' : drawByMe ? 'Draw offer pending' : 'Offer draw'}
        disabled={drawByMe}
        active={drawOfferFromOpponent}
        onClick={onOfferOrAcceptDraw}
      />
      <ActionIconButton
        label="⚑"
        title="Resign"
        danger
        onClick={onResign}
      />
    </div>
  );
}

function ActionIconButton({
  label,
  title,
  disabled = false,
  danger = false,
  active = false,
  onClick,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => void onClick()}
      style={{
        ...actionButtonStyle,
        color: disabled ? '#5f5a52' : danger ? '#c97864' : active ? '#d8e7c0' : '#aaa49d',
        background: active ? '#26321c' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function PlayerSideBand({
  color,
  seconds,
  showClock,
  active,
}: {
  color: Color;
  seconds: number;
  showClock: boolean;
  active: boolean;
}) {
  const low = seconds > 0 && seconds < 30;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: showClock ? 'minmax(0, 1fr) auto' : '1fr',
      alignItems: 'center',
      gap: '14px',
      background: active ? '#2f2d2a' : '#242320',
      borderTop: color === 'white' ? '1px solid #34312c' : 0,
      borderBottom: color === 'black' ? '1px solid #34312c' : 0,
      padding: '10px 14px',
    }}>
      <div style={{ display: 'grid', gap: '6px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
          <span style={{
            width: '9px',
            height: '9px',
            borderRadius: '50%',
            background: active ? '#77a832' : '#5a554e',
            flexShrink: 0,
          }} />
          <span style={{
            color: active ? '#e0dbd4' : '#9b958e',
            fontSize: '13px',
            fontWeight: 700,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {color === 'black' ? 'Black' : 'White'}
          </span>
        </div>
        <PromotionBox color={color} />
      </div>
      {showClock && (
      <span style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        color: low ? '#ff9944' : active ? '#e8e2da' : '#b9b2aa',
        fontSize: '48px',
        lineHeight: 1,
        fontWeight: 500,
        letterSpacing: 0,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {formatClock(seconds)}
      </span>
      )}
    </div>
  );
}

const desktopGamePanelStyle: React.CSSProperties = {
  background: '#1f1e1b',
  border: '1px solid #34312c',
  borderRadius: '6px',
  overflow: 'hidden',
  display: 'grid',
  boxShadow: '0 3px 10px rgba(0, 0, 0, 0.22)',
};

const actionRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  height: '54px',
  background: '#23211e',
  borderTop: '1px solid #34312c',
};

const actionButtonStyle: React.CSSProperties = {
  border: 0,
  borderRight: '1px solid #34312c',
  fontSize: '24px',
  fontWeight: 700,
  lineHeight: 1,
  letterSpacing: 0,
};

const promotionBoxStyle: React.CSSProperties = {
  display: 'inline-grid',
  gridTemplateColumns: 'auto auto',
  alignItems: 'center',
  gap: '4px 7px',
  width: 'fit-content',
  background: '#1b1a17',
  border: '1px solid #34312c',
  borderRadius: '5px',
  padding: '5px 6px',
};

const promotionBoxTitleStyle: React.CSSProperties = {
  color: '#77716a',
  fontSize: '10px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const promotionChoicesStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '3px',
  minWidth: 0,
};

const promotionOptionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '22px',
  height: '22px',
  borderRadius: '4px',
  background: '#191815',
  border: '1px solid #34312c',
};

function PieceIcon({ role, color }: { role: CGRole; color: Color }) {
  return (
    <span
      className="cg-wrap promotion-piece-icon"
      title={role}
      dangerouslySetInnerHTML={{ __html: `<piece class="${role} ${color}" aria-hidden="true"></piece>` }}
    />
  );
}
