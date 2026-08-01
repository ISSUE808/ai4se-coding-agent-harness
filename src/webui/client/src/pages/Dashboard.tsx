import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2, Plus, RefreshCw, SquareTerminal, X } from 'lucide-react';
import designTokens from '../design-tokens';
import { createSession, fetchSessions, type SessionSummary } from '../lib/api';
import { formatDuration, formatTokens } from '../lib/format';
import StatusBadge from '../components/StatusBadge';

type Phase = 'loading' | 'ready' | 'error';

/** Wall-clock span between createdAt and updatedAt, as MM:SS / HH:MM:SS. */
function sessionDuration(s: SessionSummary): string {
  const ms = Math.max(0, new Date(s.updatedAt).getTime() - new Date(s.createdAt).getTime());
  return formatDuration(ms / 1000);
}

/** Round progress as a percentage string for the bar width. */
function roundPercent(s: SessionSummary): string {
  if (s.maxRounds <= 0) {
    return '0%';
  }
  const pct = Math.min(100, Math.max(0, (s.currentRound / s.maxRounds) * 100));
  return `${pct}%`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      setSessions(await fetchSessions());
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main
      style={{
        height: '100%',
        overflow: 'auto',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      <div style={{ maxWidth: 1120, marginInline: 'auto', padding: designTokens.spacing[6] }}>
        {/* page head */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: designTokens.spacing[4],
            marginBottom: designTokens.spacing[5],
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: designTokens.typography.fontSize.xl,
                fontWeight: designTokens.typography.fontWeight.semibold,
                letterSpacing: '-0.01em',
              }}
            >
              会话
            </h1>
            <p
              style={{
                margin: `${designTokens.spacing[1]} 0 0`,
                color: designTokens.colors.textMuted,
                fontSize: designTokens.typography.fontSize.base,
              }}
            >
              实时观察所有 agent 会话，或启动一个新任务。
            </p>
          </div>
          {phase === 'ready' && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={primaryButtonStyle}
            >
              <Plus size={14} />
              新建会话
            </button>
          )}
        </header>

        {phase === 'loading' && (
          <div style={centerStateStyle}>
            <Loader2 size={22} style={{ color: designTokens.colors.textMuted }} />
            <p style={stateTitleStyle}>加载中…</p>
          </div>
        )}

        {phase === 'error' && (
          <div style={centerStateStyle}>
            <AlertTriangle size={22} style={{ color: designTokens.colors.danger }} />
            <p style={stateTitleStyle}>无法连接后端服务</p>
            <p style={stateSubStyle}>
              请确认已启动 CodeHarness WebUI 服务（默认端口 3000）后再试。
            </p>
            <button
              type="button"
              onClick={() => void load()}
              style={secondaryButtonStyle}
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        )}

        {phase === 'ready' && sessions.length === 0 && (
          <div style={centerStateStyle}>
            <SquareTerminal size={22} style={{ color: designTokens.colors.textMuted }} />
            <p style={stateTitleStyle}>还没有会话</p>
            <p style={stateSubStyle}>
              创建第一个会话，让 CodeHarness 的 agent 开始为你处理任务。
            </p>
          </div>
        )}

        {phase === 'ready' && sessions.length > 0 && (
          <section
            style={{
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: designTokens.colors.border,
              borderRadius: designTokens.radius.lg,
              background: designTokens.colors.surface,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
                borderBottomWidth: 1,
                borderBottomStyle: 'solid',
                borderBottomColor: designTokens.colors.border,
              }}
            >
              <span
                style={{
                  fontWeight: designTokens.typography.fontWeight.semibold,
                  fontSize: designTokens.typography.fontSize.md,
                }}
              >
                活跃会话{' '}
                <span
                  style={{
                    fontFamily: designTokens.typography.fontFamily.mono,
                    color: designTokens.colors.textMuted,
                    fontSize: designTokens.typography.fontSize.sm,
                  }}
                >
                  {sessions.length}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void load()}
                title="刷新"
                aria-label="刷新会话列表"
                style={ghostIconButtonStyle}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['会话', '任务', '状态', '轮次', '时长', 'Token'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: `${designTokens.spacing[2]} ${designTokens.spacing[4]}`,
                        color: designTokens.colors.textMuted,
                        fontSize: designTokens.typography.fontSize.sm,
                        fontWeight: designTokens.typography.fontWeight.medium,
                        borderBottomWidth: 1,
                        borderBottomStyle: 'solid',
                        borderBottomColor: designTokens.colors.border,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => navigate(`/sessions/${s.id}`)}
                    style={{
                      cursor: 'pointer',
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: designTokens.colors.border,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = designTokens.colors.surfaceHover;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontFamily: designTokens.typography.fontFamily.mono,
                          fontSize: designTokens.typography.codeSize.md,
                          color: designTokens.colors.textSubtle,
                        }}
                      >
                        {s.id}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          display: 'block',
                          maxWidth: 320,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.task}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <StatusBadge status={s.status} />
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: designTokens.spacing[2],
                          fontFamily: designTokens.typography.fontFamily.mono,
                          fontSize: designTokens.typography.codeSize.md,
                          color: designTokens.colors.textSubtle,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-block',
                            width: 64,
                            height: 4,
                            borderRadius: designTokens.radius.pill,
                            background: designTokens.colors.well,
                            overflow: 'hidden',
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              width: roundPercent(s),
                              height: '100%',
                              background: statusBarColor(s.status),
                            }}
                          />
                        </span>
                        {s.currentRound}/{s.maxRounds}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontFamily: designTokens.typography.fontFamily.mono,
                          fontSize: designTokens.typography.codeSize.md,
                          color: designTokens.colors.textSubtle,
                        }}
                      >
                        {sessionDuration(s)}
                      </span>
                    </td>
                    <td style={cellStyle}>
                      <span
                        style={{
                          fontFamily: designTokens.typography.fontFamily.mono,
                          fontSize: designTokens.typography.codeSize.md,
                          color: designTokens.colors.textSubtle,
                        }}
                      >
                        {formatTokens(s.tokenCount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {modalOpen && (
        <NewSessionModal
          onClose={() => setModalOpen(false)}
          onCreated={(session) => navigate(`/sessions/${session.id}`)}
        />
      )}
    </main>
  );
}

/** Progress bar color for a session status (tokens only). */
function statusBarColor(status: SessionSummary['status']): string {
  switch (status) {
    case 'paused':
      return designTokens.colors.statusPaused;
    case 'completed':
      return designTokens.colors.statusCompleted;
    case 'failed':
      return designTokens.colors.statusFailed;
    default:
      return designTokens.colors.statusRunning;
  }
}

// ─── New session modal ───────────────────────────────────────────────────────

function NewSessionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (session: SessionSummary) => void;
}) {
  const [task, setTask] = useState('');
  // Keep rounds as text so typing "40" over the default is not clamped mid-edit.
  const [roundsText, setRoundsText] = useState('3');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const maxRounds = Math.max(1, Number(roundsText) || 1);

  async function submit(): Promise<void> {
    if (task.trim() === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(task.trim(), maxRounds);
      onCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会话失败');
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新建会话"
      style={{
        position: 'fixed',
        inset: 0,
        background: designTokens.colors.overlay,
        display: 'grid',
        placeItems: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480,
          maxWidth: `calc(100% - ${designTokens.spacing[16]})`,
          background: designTokens.colors.surface,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: designTokens.colors.borderStrong,
          borderRadius: designTokens.radius.lg,
          boxShadow: designTokens.shadows.lg,
          padding: designTokens.spacing[5],
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: designTokens.spacing[4],
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.lg,
              fontWeight: designTokens.typography.fontWeight.semibold,
            }}
          >
            新建会话
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={ghostIconButtonStyle}
          >
            <X size={14} />
          </button>
        </div>

        <label
          htmlFor="new-session-task"
          style={{
            display: 'block',
            marginBottom: designTokens.spacing[2],
            fontSize: designTokens.typography.fontSize.sm,
            color: designTokens.colors.textMuted,
            fontWeight: designTokens.typography.fontWeight.medium,
          }}
        >
          任务描述
        </label>
        <textarea
          id="new-session-task"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          placeholder="描述你想让 agent 完成的任务…"
          style={inputStyle}
        />

        <label
          htmlFor="new-session-rounds"
          style={{
            display: 'block',
            marginTop: designTokens.spacing[3],
            marginBottom: designTokens.spacing[2],
            fontSize: designTokens.typography.fontSize.sm,
            color: designTokens.colors.textMuted,
            fontWeight: designTokens.typography.fontWeight.medium,
          }}
        >
          最大轮次
        </label>
        <input
          id="new-session-rounds"
          type="number"
          min={1}
          value={roundsText}
          onChange={(e) => setRoundsText(e.target.value)}
          style={{ ...inputStyle, width: 120 }}
        />

        {error !== null && (
          <p
            style={{
              margin: `${designTokens.spacing[3]} 0 0`,
              color: designTokens.colors.danger,
              fontSize: designTokens.typography.fontSize.sm,
            }}
          >
            {error}
          </p>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: designTokens.spacing[2],
            marginTop: designTokens.spacing[5],
          }}
        >
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || task.trim() === ''}
            style={{ ...primaryButtonStyle, opacity: busy || task.trim() === '' ? 0.5 : 1 }}
          >
            {busy ? <Loader2 size={14} /> : <Plus size={14} />}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared inline style primitives (token-derived, no hardcoded values) ─────

const cellStyle: CSSProperties = {
  padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
  fontSize: designTokens.typography.fontSize.base,
};

const centerStateStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: designTokens.spacing[2],
  padding: designTokens.spacing[12],
  textAlign: 'center',
};

const stateTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: designTokens.typography.fontSize.lg,
  fontWeight: designTokens.typography.fontWeight.semibold,
  color: designTokens.colors.text,
};

const stateSubStyle: CSSProperties = {
  margin: 0,
  fontSize: designTokens.typography.fontSize.base,
  color: designTokens.colors.textMuted,
};

const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.primary,
  background: designTokens.colors.primary,
  color: designTokens.colors.onPrimary,
  fontSize: designTokens.typography.fontSize.base,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.surface,
  color: designTokens.colors.text,
  fontSize: designTokens.typography.fontSize.base,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
};

const ghostIconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: designTokens.radius.md,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: designTokens.spacing[2],
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.well,
  color: designTokens.colors.text,
  fontSize: designTokens.typography.fontSize.base,
  fontFamily: designTokens.typography.fontFamily.sans,
  resize: 'vertical',
};
