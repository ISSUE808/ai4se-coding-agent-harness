/**
 * SessionDetail — 3-column session view (PLAN Task 18b).
 *
 * Layout: 文件变更 (file list + Monaco FileDiff) | 消息流 (MessageList +
 * composer) | 上下文信息 (status, rounds, tokens, times). The view is driven
 * by useSessionEvents over the session WebSocket channel; the REST snapshot
 * (GET /api/sessions/:id) seeds the same state and dedupes by message id.
 * All colors/fonts/spacing resolve to design-tokens.ts.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Square,
  Wifi,
  WifiOff,
} from 'lucide-react';
import designTokens from '../design-tokens';
import StatusBadge from '../components/StatusBadge';
import MessageList from '../components/MessageList';
import type { ApprovalStatus } from '../components/ApprovalCard';
import FileDiff from '../components/FileDiff';
import { useSessionEvents } from '../hooks/useSessionEvents';
import {
  fetchSession,
  postMessage,
  resolveApproval,
  sessionControl,
  type ApprovalDecision,
  type SessionControlAction,
  type SessionDetail,
} from '../lib/api';
import { formatTokens, type SessionStatus } from '../lib/format';
import { aggregateFiles, contentForFile, formatDateTime } from '../lib/session-messages';

type Phase = 'loading' | 'ready' | 'error';

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const events = useSessionEvents(
    sessionId,
    undefined,
    session
      ? {
          messages: session.messages,
          status: session.status,
          currentRound: session.currentRound,
          maxRounds: session.maxRounds,
        }
      : undefined,
  );

  const displayStatus: SessionStatus | null = events.status ?? session?.status ?? null;

  const load = useCallback(async () => {
    if (sessionId === '') {
      return;
    }
    setPhase('loading');
    try {
      setSession(await fetchSession(sessionId));
      setPhase('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '无法加载会话');
      setPhase('error');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ─── Header controls ───────────────────────────────────────────────────────

  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [stopArmed, setStopArmed] = useState(false);

  async function handleControl(action: SessionControlAction): Promise<void> {
    if (sessionId === '') {
      return;
    }
    setControlBusy(true);
    setControlError(null);
    try {
      const updated = await sessionControl(sessionId, action);
      setSession((prev) => (prev ? { ...prev, status: updated.status, updatedAt: updated.updatedAt } : prev));
      setStopArmed(false);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setControlBusy(false);
    }
  }

  // ─── Composer ──────────────────────────────────────────────────────────────

  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function send(): Promise<void> {
    const text = composer.trim();
    if (text === '' || sessionId === '' || sending) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const stored = await postMessage(sessionId, text);
      // Local append; the server also broadcasts message:added — id-deduped.
      events.appendMessage(stored);
      setComposer('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }

  // ─── Approval (HITL) ───────────────────────────────────────────────────────

  const [approvalContext, setApprovalContext] = useState<{ command: string; rule: string } | null>(null);
  const [lastDecision, setLastDecision] = useState<ApprovalDecision | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  useEffect(() => {
    if (events.pendingApproval) {
      setApprovalContext({ command: events.pendingApproval.command, rule: events.pendingApproval.rule });
      setLastDecision(null);
    }
  }, [events.pendingApproval]);

  async function handleApproval(decision: ApprovalDecision, modifiedCommand?: string): Promise<void> {
    if (sessionId === '') {
      return;
    }
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      if (decision === 'modify') {
        await resolveApproval(sessionId, decision, modifiedCommand);
      } else {
        await resolveApproval(sessionId, decision);
      }
      events.dismissApproval();
      setLastDecision(decision);
    } catch (err) {
      setApprovalError(err instanceof Error ? err.message : '审批请求失败');
    } finally {
      setApprovalBusy(false);
    }
  }

  // ─── Files column ──────────────────────────────────────────────────────────

  const files = aggregateFiles(events.messages);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // API decision values (approve/modify/deny) → card display states.
  const approvalStatus: ApprovalStatus | 'pending' = lastDecision
    ? lastDecision === 'approve'
      ? 'approved'
      : lastDecision === 'modify'
        ? 'modified'
        : 'denied'
    : 'pending';

  // ─── Rendering ─────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <main style={{ height: '100%', display: 'grid', placeItems: 'center', background: designTokens.colors.bg }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: designTokens.spacing[2], color: designTokens.colors.textMuted }}>
          <Loader2 size={22} />
          <p style={{ margin: 0, fontSize: designTokens.typography.fontSize.base }}>加载会话…</p>
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main style={{ height: '100%', display: 'grid', placeItems: 'center', background: designTokens.colors.bg }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: designTokens.spacing[2], color: designTokens.colors.danger, textAlign: 'center' }}>
          <AlertTriangle size={22} />
          <p style={{ margin: 0, fontSize: designTokens.typography.fontSize.lg, fontWeight: designTokens.typography.fontWeight.semibold, color: designTokens.colors.text }}>
            无法加载会话
          </p>
          {loadError !== null && <p style={{ margin: 0, fontSize: designTokens.typography.fontSize.base, color: designTokens.colors.textMuted }}>{loadError}</p>}
          <button
            type="button"
            onClick={() => void load()}
            style={{
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
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      </main>
    );
  }

  const statusIsTerminal = displayStatus === 'completed' || displayStatus === 'failed';
  const controlsVisible = displayStatus === 'running' || displayStatus === 'paused';
  const currentRound = events.currentRound ?? session?.currentRound ?? 0;
  const maxRounds = events.maxRounds ?? session?.maxRounds ?? 0;
  const roundPercent =
    maxRounds <= 0 ? 0 : Math.min(100, Math.max(0, (currentRound / maxRounds) * 100));

  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      {/* ── page head ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[3],
          padding: `${designTokens.spacing[3]} ${designTokens.spacing[5]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
          background: designTokens.colors.surface,
        }}
      >
        <Link
          to="/"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: designTokens.spacing[1],
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.base,
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} />
          返回
        </Link>
        <span style={{ color: designTokens.colors.borderStrong }}>/</span>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: designTokens.spacing[2], minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.lg,
              fontWeight: designTokens.typography.fontWeight.semibold,
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {session?.task ?? ''}
          </h1>
          <span
            style={{
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.codeSize.md,
              fontWeight: designTokens.typography.fontWeight.regular,
              color: designTokens.colors.textMuted,
            }}
          >
            {session?.id ?? ''}
          </span>
        </div>
        {displayStatus !== null && <StatusBadge status={displayStatus} />}

        <div style={{ flex: 1 }} />

        {controlsVisible && (
          <button
            type="button"
            onClick={() => void handleControl(displayStatus === 'running' ? 'pause' : 'resume')}
            disabled={controlBusy}
            style={headerButtonStyle('secondary')}
          >
            {displayStatus === 'running' ? <Pause size={13} /> : <Play size={13} />}
            {displayStatus === 'running' ? '暂停' : '恢复'}
          </button>
        )}
        {controlsVisible &&
          (stopArmed ? (
            <>
              <button
                type="button"
                onClick={() => void handleControl('stop')}
                disabled={controlBusy}
                style={headerButtonStyle('danger')}
              >
                <Square size={13} />
                确认停止
              </button>
              <button type="button" onClick={() => setStopArmed(false)} disabled={controlBusy} style={headerButtonStyle('ghost')}>
                取消
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setStopArmed(true)} style={headerButtonStyle('dangerOutline')}>
              <Square size={13} />
              停止
            </button>
          ))}
        {statusIsTerminal && (
          <button type="button" disabled style={headerButtonStyle('disabled')}>
            <Square size={13} />
            停止
          </button>
        )}
      </header>

      {controlError !== null && (
        <div style={{ padding: `${designTokens.spacing[2]} ${designTokens.spacing[5]}`, background: designTokens.colors.dangerSoft, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
          {controlError}
        </div>
      )}

      {/* ── three columns ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* LEFT: files changed */}
        <aside style={{ flexBasis: 280, flexShrink: 0, flexGrow: 0, display: 'flex', flexDirection: 'column', minWidth: 0, borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: designTokens.colors.border }}>
          <ColumnHead title="文件变更" count={files.length} />
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {files.length === 0 && (
              <div style={{ padding: designTokens.spacing[6], textAlign: 'center', color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
                暂无文件变更
              </div>
            )}
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: designTokens.spacing[2],
                  width: '100%',
                  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
                  border: 'none',
                  borderBottomWidth: 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: designTokens.colors.border,
                  background: selectedPath === file.path ? designTokens.colors.surfaceHover : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: designTokens.typography.fontFamily.sans,
                }}
              >
                <span
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 18,
                    height: 18,
                    borderRadius: designTokens.radius.sm,
                    background: designTokens.colors.well,
                    color: designTokens.colors.textSubtle,
                    fontFamily: designTokens.typography.fontFamily.mono,
                    fontSize: designTokens.typography.fontSize.xs,
                    fontWeight: designTokens.typography.fontWeight.semibold,
                    flexShrink: 0,
                  }}
                >
                  {file.mark}
                </span>
                <span
                  style={{
                    fontFamily: designTokens.typography.fontFamily.mono,
                    fontSize: designTokens.typography.codeSize.md,
                    color: designTokens.colors.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {file.path}
                </span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: designTokens.spacing[2], fontFamily: designTokens.typography.fontFamily.mono, fontSize: designTokens.typography.fontSize.xs }}>
                  {file.addCount > 0 && <span style={{ color: designTokens.colors.success }}>+{file.addCount}</span>}
                  {file.delCount > 0 && <span style={{ color: designTokens.colors.danger }}>−{file.delCount}</span>}
                </span>
              </button>
            ))}
            {selectedPath !== null && (
              <div style={{ padding: designTokens.spacing[3] }}>
                <FileDiff path={selectedPath} content={contentForFile(events.messages, selectedPath)} />
              </div>
            )}
          </div>
        </aside>

        {/* CENTER: message feed */}
        <section style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <ColumnHead
            title="消息流"
            extra={
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: designTokens.spacing[1],
                  fontFamily: designTokens.typography.fontFamily.mono,
                  fontSize: designTokens.typography.fontSize.xs,
                  color: events.wsConnected ? designTokens.colors.success : designTokens.colors.danger,
                }}
              >
                {events.wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {events.wsConnected ? '已连接' : '已断开'}
                {!events.wsConnected && (
                  <button
                    type="button"
                    onClick={events.reconnect}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: designTokens.spacing[1],
                      marginLeft: designTokens.spacing[1],
                      border: 'none',
                      background: designTokens.colors.well,
                      color: designTokens.colors.text,
                      borderRadius: designTokens.radius.sm,
                      padding: `${designTokens.spacing[0]} ${designTokens.spacing[2]}`,
                      fontFamily: designTokens.typography.fontFamily.sans,
                      fontSize: designTokens.typography.fontSize.xs,
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={10} />
                    重连
                  </button>
                )}
              </span>
            }
          />
          <MessageList
            messages={events.messages}
            approval={
              approvalContext
                ? {
                    command: approvalContext.command,
                    rule: approvalContext.rule,
                    status: approvalStatus,
                    busy: approvalBusy,
                    error: approvalError,
                    onApprove: () => void handleApproval('approve'),
                    onModify: (cmd) => void handleApproval('modify', cmd),
                    onDeny: () => void handleApproval('deny'),
                  }
                : null
            }
          />

          {/* composer */}
          <div
            style={{
              padding: designTokens.spacing[3],
              borderTopWidth: 1,
              borderTopStyle: 'solid',
              borderTopColor: designTokens.colors.border,
              background: designTokens.colors.surface,
            }}
          >
            {sendError !== null && (
              <p style={{ margin: `0 0 ${designTokens.spacing[2]}`, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
                {sendError}
              </p>
            )}
            <div style={{ display: 'flex', gap: designTokens.spacing[2] }}>
              <textarea
                aria-label="消息输入"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="给 agent 发消息，或追加指令…"
                style={{
                  flex: 1,
                  padding: designTokens.spacing[2],
                  borderRadius: designTokens.radius.md,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: designTokens.colors.borderStrong,
                  background: designTokens.colors.well,
                  color: designTokens.colors.text,
                  fontFamily: designTokens.typography.fontFamily.sans,
                  fontSize: designTokens.typography.fontSize.base,
                  resize: 'vertical',
                }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || composer.trim() === ''}
                style={headerButtonStyle('primary')}
              >
                {sending ? <Loader2 size={13} /> : <Send size={13} />}
                发送
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: designTokens.spacing[1],
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.fontSize.xs,
                color: designTokens.colors.textMuted,
              }}
            >
              <span>Enter 发送 · Shift+Enter 换行</span>
              {displayStatus === 'running' && <span>agent 运行中 — 消息将在下一轮注入</span>}
            </div>
          </div>
        </section>

        {/* RIGHT: context */}
        <aside style={{ flexBasis: 280, flexShrink: 0, flexGrow: 0, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: designTokens.colors.border }}>
          <ColumnHead title="上下文信息" />
          <div style={{ flex: 1, overflowY: 'auto', padding: designTokens.spacing[4] }}>
            <ContextSection label="状态">
              {displayStatus !== null && <StatusBadge status={displayStatus} />}
            </ContextSection>

            <ContextSection label="轮次进度">
              <div
                style={{
                  fontFamily: designTokens.typography.fontFamily.mono,
                  fontSize: designTokens.typography.fontSize.xl,
                  fontWeight: designTokens.typography.fontWeight.semibold,
                  color: designTokens.colors.text,
                }}
              >
                {currentRound}/{maxRounds}
              </div>
              <div
                style={{
                  height: 6,
                  marginTop: designTokens.spacing[2],
                  borderRadius: designTokens.radius.pill,
                  background: designTokens.colors.well,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${roundPercent}%`,
                    borderRadius: designTokens.radius.pill,
                    background: displayStatus === 'failed' ? designTokens.colors.statusFailed : displayStatus === 'paused' ? designTokens.colors.statusPaused : displayStatus === 'completed' ? designTokens.colors.statusCompleted : designTokens.colors.statusRunning,
                  }}
                />
              </div>
            </ContextSection>

            <ContextSection label="Token 使用">
              <span
                style={{
                  fontFamily: designTokens.typography.fontFamily.mono,
                  fontSize: designTokens.typography.fontSize.md,
                  color: designTokens.colors.text,
                }}
              >
                {formatTokens(session?.tokenCount ?? 0)}
              </span>
            </ContextSection>

            <ContextSection label="运行信息">
              <ContextKV k="开始于" v={formatDateTime(session?.createdAt ?? '')} />
              <ContextKV k="更新于" v={formatDateTime(session?.updatedAt ?? '')} />
              <ContextKV k="变更文件数" v={String(files.length)} />
            </ContextSection>
          </div>
        </aside>
      </div>
    </main>
  );
}

// ─── Local layout helpers (token-driven) ─────────────────────────────────────

function ColumnHead({ title, count, extra }: { title: string; count?: number; extra?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: designTokens.spacing[2],
        padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
        fontFamily: designTokens.typography.fontFamily.mono,
        fontSize: designTokens.typography.fontSize.xs,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: designTokens.colors.textMuted,
      }}
    >
      {title}
      {count !== undefined && (
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            color: designTokens.colors.textMuted,
          }}
        >
          {count}
        </span>
      )}
      {extra !== undefined && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </div>
  );
}

function ContextSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: designTokens.spacing[5] }}>
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: designTokens.colors.textMuted,
          marginBottom: designTokens.spacing[2],
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

function ContextKV({ k, v }: { k: string; v: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBlock: designTokens.spacing[1],
        fontSize: designTokens.typography.fontSize.base,
      }}
    >
      <span style={{ color: designTokens.colors.textMuted }}>{k}</span>
      <span
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.codeSize.md,
          color: designTokens.colors.text,
        }}
      >
        {v}
      </span>
    </div>
  );
}

type HeaderButtonTone = 'primary' | 'secondary' | 'danger' | 'dangerOutline' | 'ghost' | 'disabled';

function headerButtonStyle(tone: HeaderButtonTone) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: designTokens.spacing[1],
    padding: `${designTokens.spacing[1]} ${designTokens.spacing[3]}`,
    borderRadius: designTokens.radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    fontSize: designTokens.typography.fontSize.base,
    fontWeight: designTokens.typography.fontWeight.medium,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  } as const;
  switch (tone) {
    case 'primary':
      return { ...base, borderColor: designTokens.colors.primary, background: designTokens.colors.primary, color: designTokens.colors.onPrimary };
    case 'secondary':
      return { ...base, borderColor: designTokens.colors.borderStrong, background: designTokens.colors.surface, color: designTokens.colors.text };
    case 'danger':
      return { ...base, borderColor: designTokens.colors.danger, background: designTokens.colors.danger, color: designTokens.colors.onDanger };
    case 'dangerOutline':
      return { ...base, borderColor: designTokens.colors.danger, background: 'transparent', color: designTokens.colors.danger };
    case 'ghost':
      return { ...base, borderColor: 'transparent', background: 'transparent', color: designTokens.colors.textMuted };
    default:
      return { ...base, borderColor: designTokens.colors.border, background: designTokens.colors.well, color: designTokens.colors.textMuted, cursor: 'not-allowed' };
  }
}
