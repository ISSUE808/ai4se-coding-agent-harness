import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ChevronRight, FolderOpen, Loader2, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import designTokens from '../design-tokens';
import { createSession, deleteSession, fetchConfig, fetchSessions, sessionControl, type SessionSummary } from '../lib/api';
import { formatDuration, formatTokens } from '../lib/format';
import StatusBadge from '../components/StatusBadge';
import DirectoryPicker from '../components/DirectoryPicker';

type Phase = 'loading' | 'ready' | 'error';

type Filter = 'all' | 'running' | 'paused' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '运行中' },
  { key: 'paused', label: '已暂停' },
  { key: 'done', label: '已完成' },
];

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

function matchesFilter(s: SessionSummary, filter: Filter): boolean {
  switch (filter) {
    case 'running':
      return s.status === 'running';
    case 'paused':
      return s.status === 'paused';
    case 'done':
      return s.status === 'completed' || s.status === 'failed';
    default:
      return true;
  }
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [rowBusy, setRowBusy] = useState<string | null>(null);

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

  const visible = useMemo(() => sessions.filter((s) => matchesFilter(s, filter)), [sessions, filter]);

  /** Pause/resume from a table row action, then refresh the list. */
  async function togglePause(s: SessionSummary): Promise<void> {
    if (rowBusy !== null) {
      return;
    }
    setRowBusy(s.id);
    try {
      await sessionControl(s.id, s.status === 'running' ? 'pause' : 'resume');
      await load();
    } finally {
      setRowBusy(null);
    }
  }

  /** Delete a session row (KNOWN_ISSUES 9). Running sessions are disabled —
   *  the backend refuses them with 409; stop them first. */
  async function removeRow(s: SessionSummary): Promise<void> {
    if (rowBusy !== null) {
      return;
    }
    setRowBusy(s.id);
    try {
      await deleteSession(s.id);
      await load();
    } finally {
      setRowBusy(null);
    }
  }

  const activeCount = sessions.filter((s) => s.status === 'running' || s.status === 'paused').length;
  const runningCount = sessions.filter((s) => s.status === 'running').length;
  const pausedCount = sessions.filter((s) => s.status === 'paused').length;
  const tokenTotal = sessions.reduce((sum, s) => sum + s.tokenCount, 0);
  const finished = sessions.filter((s) => s.status === 'completed' || s.status === 'failed');
  const avgDuration =
    finished.length > 0
      ? formatDuration(
          finished.reduce((sum, s) => sum + Math.max(0, new Date(s.updatedAt).getTime() - new Date(s.createdAt).getTime()), 0) /
            finished.length /
            1000,
        )
      : '—';

  return (
    <main
      style={{
        height: '100%',
        overflow: 'auto',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      <div style={{ maxWidth: 1240, marginInline: 'auto', padding: `${designTokens.spacing[6]} ${designTokens.spacing[8]} ${designTokens.spacing[10]}` }}>
        {/* page head */}
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: designTokens.spacing[4],
            marginBottom: designTokens.spacing[6],
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: designTokens.typography.fontSize.xl,
                fontWeight: designTokens.typography.fontWeight.semibold,
                letterSpacing: '-0.02em',
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

        {phase === 'ready' && (
          <>
            {/* stat cards (prototype .stat-row) */}
            <div style={statRowStyle}>
              <StatCard
                label="活跃会话"
                value={String(activeCount)}
                sub={`${runningCount} 运行中 · ${pausedCount} 已暂停`}
                accent
              />
              <StatCard label="总会话" value={String(sessions.length)} sub={`共 ${sessions.length} 个会话`} />
              <StatCard label="Token 消耗" value={formatTokens(tokenTotal)} sub="输入 + 输出" />
              <StatCard label="平均时长" value={avgDuration} sub="完成任务" ok />
            </div>

            {/* session panel */}
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
                  gap: designTokens.spacing[4],
                  padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
                  borderBottomWidth: 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: designTokens.colors.border,
                }}
              >
                <span
                  style={{
                    fontSize: designTokens.typography.fontSize.base,
                    fontWeight: designTokens.typography.fontWeight.semibold,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: designTokens.spacing[2],
                  }}
                >
                  活跃会话
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      borderRadius: designTokens.radius.pill,
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: designTokens.colors.border,
                      color: designTokens.colors.textMuted,
                      fontSize: designTokens.typography.fontSize.xs,
                      fontFamily: designTokens.typography.fontFamily.mono,
                    }}
                  >
                    {sessions.length}
                  </span>
                </span>
                <div style={{ display: 'flex', gap: designTokens.spacing[2], alignItems: 'center' }}>
                  {/* segmented filter (prototype .seg) */}
                  <div style={segStyle}>
                    {FILTERS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFilter(f.key)}
                        style={segButtonStyle(f.key === filter)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
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
              </div>

              {visible.length > 0 ? (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['会话 ID', '任务描述', '状态', '轮次', '时长', 'Token', ''].map((h, i) => (
                        <th
                          key={h === '' ? `op-${i}` : h}
                          style={{
                            textAlign: h === '时长' || h === 'Token' || h === '轮次' ? 'right' : 'left',
                            fontFamily: designTokens.typography.fontFamily.mono,
                            fontSize: designTokens.typography.fontSize.xs,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            color: designTokens.colors.textMuted,
                            fontWeight: designTokens.typography.fontWeight.medium,
                            padding: '10px 20px',
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
                    {visible.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => navigate(`/sessions/${s.id}`)}
                        style={{
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = designTokens.colors.surfaceHover;
                          const actions = e.currentTarget.querySelector<HTMLElement>('[data-row-actions]');
                          if (actions) {
                            actions.style.opacity = '1';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent';
                          const actions = e.currentTarget.querySelector<HTMLElement>('[data-row-actions]');
                          if (actions) {
                            actions.style.opacity = '0';
                          }
                        }}
                      >
                        <td style={cellStyle}>
                          <span
                            style={{
                              fontFamily: designTokens.typography.fontFamily.mono,
                              fontSize: designTokens.typography.codeSize.md,
                              color: designTokens.colors.primary,
                            }}
                          >
                            {s.id}
                          </span>
                        </td>
                        <td style={cellStyle}>
                          <span
                            style={{
                              display: 'block',
                              maxWidth: 340,
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
                        <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {s.maxRounds > 0 ? (
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
                                  width: 72,
                                  height: 5,
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
                                    borderRadius: designTokens.radius.pill,
                                    background: statusBarColor(s.status),
                                  }}
                                />
                              </span>
                              {s.currentRound}/{s.maxRounds}
                            </span>
                          ) : (
                            <span
                              style={{
                                fontFamily: designTokens.typography.fontFamily.mono,
                                fontSize: designTokens.typography.codeSize.md,
                                color: designTokens.colors.textSubtle,
                              }}
                            >
                              {s.currentRound}/∞
                            </span>
                          )}
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          <span style={numStyle}>{sessionDuration(s)}</span>
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          <span style={numStyle}>{formatTokens(s.tokenCount)}</span>
                        </td>
                        <td style={{ ...cellStyle, textAlign: 'right' }}>
                          <span data-row-actions style={rowActionsStyle}>
                            {(s.status === 'running' || s.status === 'paused') && (
                              <button
                                type="button"
                                title={s.status === 'running' ? '暂停' : '恢复'}
                                aria-label={s.status === 'running' ? `暂停 ${s.id}` : `恢复 ${s.id}`}
                                disabled={rowBusy !== null}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void togglePause(s);
                                }}
                                style={iconBtnStyle}
                              >
                                {s.status === 'running' ? <Pause size={13} /> : <Play size={13} />}
                              </button>
                            )}
                            <button
                              type="button"
                              title="打开"
                              aria-label={`打开 ${s.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/sessions/${s.id}`);
                              }}
                              style={iconBtnStyle}
                            >
                              <ChevronRight size={13} />
                            </button>
                            <button
                              type="button"
                              title={s.status === 'running' ? '运行中会话需先停止再删除' : '删除会话'}
                              aria-label={`删除 ${s.id}`}
                              disabled={rowBusy !== null || s.status === 'running'}
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeRow(s);
                              }}
                              style={{
                                ...iconBtnStyle,
                                color: s.status === 'running'
                                  ? designTokens.colors.textFaint
                                  : designTokens.colors.danger,
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState
                  title={sessions.length === 0 ? '还没有会话' : '当前筛选下没有会话'}
                  sub={
                    sessions.length === 0
                      ? '启动一个新会话，让 agent 开始工作。'
                      : '调整筛选条件，或启动一个新会话。'
                  }
                  onNewSession={() => setModalOpen(true)}
                />
              )}
            </section>
          </>
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

// ─── Stat card (prototype .stat-card) ────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
  ok,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  ok?: boolean;
}) {
  return (
    <div
      style={{
        background: designTokens.colors.surface,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        borderRadius: designTokens.radius.lg,
        padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
      }}
    >
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: designTokens.colors.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: 26,
          fontWeight: designTokens.typography.fontWeight.semibold,
          letterSpacing: '-0.02em',
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: accent
            ? designTokens.colors.primary
            : ok
              ? designTokens.colors.success
              : designTokens.colors.text,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: designTokens.colors.textMuted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ─── Empty state (prototype .empty) ──────────────────────────────────────────

function EmptyState({ title, sub, onNewSession }: { title: string; sub: string; onNewSession: () => void }) {
  return (
    <div
      style={{
        padding: `${designTokens.spacing[10]} ${designTokens.spacing[8]}`,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          margin: '0 auto 16px',
          borderRadius: designTokens.radius.lg,
          background: designTokens.colors.well,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: designTokens.colors.borderStrong,
          display: 'grid',
          placeItems: 'center',
          color: designTokens.colors.textMuted,
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: 22,
        }}
      >
        &gt;_
      </div>
      <h3 style={{ margin: 0, marginBottom: 6, fontSize: designTokens.typography.fontSize.md, fontWeight: designTokens.typography.fontWeight.semibold }}>
        {title}
      </h3>
      <p style={{ color: designTokens.colors.textMuted, margin: 0, marginBottom: designTokens.spacing[5], fontSize: designTokens.typography.fontSize.base }}>
        {sub}
      </p>
      <button type="button" onClick={onNewSession} style={primaryButtonStyle}>
        <Plus size={14} />
        新建会话
      </button>
    </div>
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
  // Unlimited by default (maxRounds = 0); checking 限制轮次 reveals the input.
  const [limitChecked, setLimitChecked] = useState(false);
  const [roundsText, setRoundsText] = useState('40');
  // 工作目录 (Task 19): defaults to the current config workspaceRoot, editable.
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  // Task 23: graphical directory picker over GET /api/fs/tree.
  const [pickerOpen, setPickerOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const maxRounds = limitChecked ? Math.max(1, Number(roundsText) || 1) : 0;

  useEffect(() => {
    fetchConfig()
      .then((config) => {
        const agent = config.agent;
        const root =
          typeof agent === 'object' && agent !== null
            ? (agent as Record<string, unknown>).workspaceRoot
            : undefined;
        if (typeof root === 'string' && root.length > 0) {
          setWorkspaceRoot((prev) => prev || root);
        }
      })
      .catch(() => {
        // Config unavailable — leave the field empty (server default applies).
      });
  }, []);

  async function submit(): Promise<void> {
    if (task.trim() === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await createSession(
        task.trim(),
        maxRounds,
        workspaceRoot.trim() || undefined,
      );
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
        backdropFilter: 'blur(3px)',
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
          boxShadow: designTokens.shadows.md,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
            borderBottomWidth: 1,
            borderBottomStyle: 'solid',
            borderBottomColor: designTokens.colors.border,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.md,
              fontWeight: designTokens.typography.fontWeight.semibold,
            }}
          >
            新建会话
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            style={ghostIconButtonStyle}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: designTokens.spacing[5] }}>
          <label
            htmlFor="new-session-task"
            style={{ ...fieldLabelStyle, marginBottom: designTokens.spacing[1] }}
          >
            任务描述
          </label>
          <textarea
            id="new-session-task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={3}
            placeholder="例如：给 /api/orders 加分页，并补全测试"
            style={inputStyle}
          />
          <span
            style={{
              display: 'block',
              marginTop: designTokens.spacing[1],
              fontSize: designTokens.typography.fontSize.sm,
              color: designTokens.colors.textMuted,
            }}
          >
            清晰描述目标与验收标准，agent 将自主规划执行。
          </span>

          <label
            htmlFor="new-session-workspace-root"
            style={{ ...fieldLabelStyle, marginTop: designTokens.spacing[4], marginBottom: designTokens.spacing[1] }}
          >
            工作目录
          </label>
          <div style={{ display: 'flex', gap: designTokens.spacing[2], alignItems: 'flex-start' }}>
            <input
              id="new-session-workspace-root"
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="agent 在此目录中执行工具（默认：当前工作区）"
              style={{ ...inputStyle, fontFamily: designTokens.typography.fontFamily.mono, flex: 1 }}
            />
            {/* Task 23: graphical directory browsing (picker fetches the fs tree). */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              title="浏览目录"
              aria-label="浏览…"
              style={browseButtonStyle}
            >
              <FolderOpen size={14} />
            </button>
          </div>
          <span
            style={{
              display: 'block',
              marginTop: designTokens.spacing[1],
              fontSize: designTokens.typography.fontSize.sm,
              color: designTokens.colors.textMuted,
            }}
          >
            文件读写、命令与护栏越界检查均以此目录为边界。可直接输入，或用浏览选择。
          </span>

          <label
            htmlFor="new-session-limit-rounds"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[2],
              marginTop: designTokens.spacing[4],
              marginBottom: designTokens.spacing[1],
              fontSize: designTokens.typography.fontSize.base,
              color: designTokens.colors.text,
              fontWeight: designTokens.typography.fontWeight.medium,
              cursor: 'pointer',
            }}
          >
            <input
              id="new-session-limit-rounds"
              type="checkbox"
              checked={limitChecked}
              onChange={(e) => setLimitChecked(e.target.checked)}
            />
            限制最大轮次（不勾选则无上限）
          </label>
          {limitChecked && (
            <label
              htmlFor="new-session-rounds"
              style={{ ...fieldLabelStyle, marginBottom: designTokens.spacing[1] }}
            >
              最大轮次
            </label>
          )}
          {limitChecked && (
            <input
              id="new-session-rounds"
              type="number"
              min={1}
              value={roundsText}
              onChange={(e) => setRoundsText(e.target.value)}
              style={{ ...inputStyle, width: 120, fontFamily: designTokens.typography.fontFamily.mono }}
            />
          )}

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
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: designTokens.spacing[2],
            padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: designTokens.colors.border,
            background: designTokens.colors.well,
          }}
        >
          <button type="button" onClick={onClose} style={ghostButtonStyle}>
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || task.trim() === ''}
            style={{ ...primaryButtonStyle, opacity: busy || task.trim() === '' ? 0.5 : 1 }}
          >
            {busy ? <Loader2 size={14} /> : <Plus size={14} />}
            创建并启动
          </button>
        </div>

        {pickerOpen && (
          <DirectoryPicker
            onSelect={(picked) => {
              setWorkspaceRoot(picked);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Shared inline style primitives (token-derived, no hardcoded values) ─────

const statRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: designTokens.spacing[4],
  marginBottom: designTokens.spacing[6],
};

const segStyle: CSSProperties = {
  display: 'flex',
  gap: '2px',
  background: designTokens.colors.well,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.border,
  borderRadius: designTokens.radius.md,
  padding: '2px',
};

function segButtonStyle(active: boolean): CSSProperties {
  return {
    border: 'none',
    background: active ? designTokens.colors.surface : 'transparent',
    color: active ? designTokens.colors.text : designTokens.colors.textMuted,
    fontSize: designTokens.typography.fontSize.sm,
    padding: '4px 11px',
    borderRadius: 6,
    cursor: 'pointer',
    boxShadow: active ? designTokens.shadows.sm : 'none',
  };
}

const cellStyle: CSSProperties = {
  padding: '13px 20px',
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: designTokens.colors.border,
  fontSize: designTokens.typography.fontSize.base,
  verticalAlign: 'middle',
};

const numStyle: CSSProperties = {
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.codeSize.md,
  fontVariantNumeric: 'tabular-nums',
  color: designTokens.colors.textSubtle,
};

/** Row actions appear on row hover (prototype .row-actions). */
const rowActionsStyle: CSSProperties = {
  display: 'inline-flex',
  gap: '2px',
  justifyContent: 'flex-end',
  opacity: 0,
  transition: 'opacity 0.12s',
};

const iconBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
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
  fontWeight: designTokens.typography.fontWeight.semibold,
  boxShadow: designTokens.shadows.primary,
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

const ghostButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  fontSize: designTokens.typography.fontSize.base,
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

const fieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: designTokens.typography.fontSize.sm,
  color: designTokens.colors.textSubtle,
  fontWeight: designTokens.typography.fontWeight.medium,
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

/** Task 23: folder button that opens the directory picker. */
const browseButtonStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.surface,
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
};
