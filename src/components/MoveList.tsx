import { forwardRef, useEffect, useRef, type CSSProperties } from 'react';

interface Props {
  notations: string[];
  cursor: number;
  onFirst: () => void;
  onBack: () => void;
  onForward: () => void;
  onLast: () => void;
}

export default function MoveList({ notations, cursor, onFirst, onBack, onForward, onLast }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor]);

  const rows: Array<{ n: number; white: string; black?: string }> = [];
  for (let i = 0; i < notations.length; i += 2) {
    rows.push({ n: Math.floor(i / 2) + 1, white: notations[i], black: notations[i + 1] });
  }

  const canBack = cursor > 0;
  const canForward = cursor < notations.length;

  return (
    <div style={panelStyle}>
      <div style={navStyle}>
        <NavButton label="|<" title="First position" disabled={!canBack} onClick={onFirst} />
        <NavButton label="<" title="Back" disabled={!canBack} onClick={onBack} />
        <NavButton label=">" title="Forward" disabled={!canForward} onClick={onForward} />
        <NavButton label=">|" title="Latest position" disabled={!canForward} onClick={onLast} />
        <button type="button" title="Moves" style={{ ...navButtonStyle, cursor: 'default' }}>list</button>
      </div>

      <div style={tableStyle}>
        {rows.length === 0 && (
          <div style={{ color: '#68645f', textAlign: 'center', padding: '28px 0', fontSize: '12px' }}>No moves yet</div>
        )}
        {rows.map(row => {
          const whiteIdx = (row.n - 1) * 2 + 1;
          const blackIdx = (row.n - 1) * 2 + 2;
          return (
            <div key={row.n} style={rowStyle}>
              <span style={moveNumberStyle}>{row.n}</span>
              <MoveCell
                ref={cursor === whiteIdx ? activeRef : undefined}
                active={cursor === whiteIdx}
                text={row.white}
              />
              <MoveCell
                ref={cursor === blackIdx ? activeRef : undefined}
                active={cursor === blackIdx}
                text={row.black ?? ''}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...navButtonStyle,
        color: disabled ? '#4b4742' : '#aaa49d',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
    </button>
  );
}

const MoveCell = forwardRef<HTMLButtonElement, {
  text: string;
  active: boolean;
}>(({ text, active }, ref) => (
  <button
    ref={ref}
    type="button"
    style={{
      minWidth: 0,
      height: '26px',
      border: 0,
      borderRadius: '0',
      padding: '0 10px',
      textAlign: 'left',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      background: active ? '#2f4556' : 'transparent',
      color: active ? '#dce8f3' : text ? '#d3cec7' : '#5b5650',
      fontSize: '13px',
      fontWeight: active ? 700 : 600,
      cursor: 'default',
    }}
  >
    {text}
  </button>
));

MoveCell.displayName = 'MoveCell';

const panelStyle: CSSProperties = {
  background: '#1f1e1b',
  border: '1px solid #33302c',
  borderRadius: '6px',
  overflow: 'hidden',
};

const navStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  background: '#302e2a',
  borderBottom: '1px solid #26231f',
};

const navButtonStyle: CSSProperties = {
  height: '34px',
  border: 0,
  borderRight: '1px solid #3a3732',
  background: 'transparent',
  color: '#aaa49d',
  fontSize: '11px',
  fontWeight: 700,
};

const tableStyle: CSSProperties = {
  height: '186px',
  overflowY: 'auto',
  fontFamily: 'Arial, sans-serif',
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '46px minmax(0, 1fr) minmax(0, 1fr)',
  minHeight: '26px',
};

const moveNumberStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#26231f',
  color: '#8a847d',
  fontSize: '12px',
  fontWeight: 600,
};
