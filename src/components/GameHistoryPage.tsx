import type { GameLogSummary } from '../multiplayer';

function resultLabel(winner: string | null, status: string): string {
  if (status === 'ongoing') return 'Unfinished';
  if (winner === 'white') return 'White won';
  if (winner === 'black') return 'Black won';
  return 'Draw';
}

function resultColor(winner: string | null, status: string): string {
  if (status === 'ongoing') return '#5a5753';
  if (winner === 'white') return '#d0c9bf';
  if (winner === 'black') return '#9e9b96';
  return '#c8a84a';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function modeLabel(mode: string): string {
  if (mode === 'computer') return 'vs Computer';
  if (mode === 'multiplayer') return 'Multiplayer';
  return 'Local';
}

export default function GameHistoryPage({
  logs,
  status,
  onViewGame,
  onRefresh,
}: {
  logs: GameLogSummary[];
  status: string;
  onViewGame: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#d0c9bf' }}>Game History</h2>
          <button type="button" onClick={onRefresh} style={ghostBtn}>Refresh</button>
        </div>
        {status && (
          <div style={{ color: '#c8a84a', fontSize: '12px', marginBottom: '12px' }}>{status}</div>
        )}
        {logs.length === 0 ? (
          <div style={{ color: '#6e6b67', fontSize: '13px', textAlign: 'center', padding: '48px 0' }}>
            No completed games recorded yet.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '6px' }}>
            {logs.map(log => (
              <button
                key={log.id}
                type="button"
                onClick={() => onViewGame(log.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '12px',
                  alignItems: 'center',
                  textAlign: 'left',
                  background: '#1f1e1b',
                  border: '1px solid #2e2c29',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  color: '#d0c9bf',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#4a4742')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#2e2c29')}
              >
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    {log.white_username ?? 'White'}{' '}
                    <span style={{ color: '#4a4742', fontWeight: 400 }}>vs</span>{' '}
                    {log.black_username ?? 'Black'}
                  </div>
                  <div style={{ fontSize: '11px', color: '#5a5753', marginTop: '3px' }}>
                    {modeLabel(log.mode)} · {log.move_count} moves · {formatDate(log.created_at)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: resultColor(log.winner, log.status) }}>
                    {resultLabel(log.winner, log.status)}
                  </div>
                  <div style={{ fontSize: '11px', color: '#3a3835', marginTop: '2px' }}>View →</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: '#1a1816',
  color: '#9e9b96',
  border: '1px solid #3d3b38',
  borderRadius: '6px',
  padding: '5px 10px',
  fontSize: '11px',
  fontWeight: 700,
  cursor: 'pointer',
};
