/**
 * SessionDetail — 3-column cockpit (PLAN Task 18b, prototype layout).
 *
 * Layout (mirrors codeharness-webui.html): 文件变更 (file list + diff
 * preview) | 消息流 (MessageList + composer, no column head) | 上下文
 * (status/rounds/tokens/runtime/guardrail chips). Driven by useSessionEvents
 * over the session WebSocket channel; the REST snapshot seeds the same state
 * and dedupes by message id. All colors/fonts/spacing resolve to
 * design-tokens.ts.
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
  Terminal,
  WifiOff,
  X,
} from 'lucide-react';
import designTokens from '../design-tokens';
import StatusBadge from '../components/StatusBadge';
import MessageList from '../components/MessageList';
import type { ApprovalStatus } from '../components/ApprovalCard';
import FileDiff from '../components/FileDiff';
import { useSessionEvents } from '../hooks/useSessionEvents';
import {
  fetchConfig,
  fetchSession,
  postMessage,
  resolveApproval,
  sessionControl,
  type ApprovalDecision,
  type ConfigValue,
  type SessionControlAction,
  type SessionDetail,
} from '../lib/api';
import { formatTokens, type SessionStatus } from '../lib/format';
import { aggregateFiles, contentForFile, formatDateTime } from '../lib/session-messages';

type Phase = 'loading' | 'ready' | 'error';

type LeftTab = 'files' | 'term';

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const sessionId = id ?? '';

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigValue | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>('files');

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

  // Model + guardrail chips come from the (masked) backend config.
  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {
        // Config unavailable — context sections just omit model/chips.
      });
  }, []);

  // ─── Header controls ───────────────────────────────────────────────────────

  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [stopModalOpen, setStopModalOpen] = useState(false);

  async function handleControl(action: SessionControlAction): Promise<void> {
    if (sessionId === '') {
      return;
    }
    setControlBusy(true);
    setControlError(null);
    try {
      const updated = await sessionControl(sessionId, action);
      setSession((prev) => (prev ? { ...prev, status: updated.status, updatedAt: updated.updatedAt } : prev));
      setStopModalOpen(false);
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

  const toolCallCount = events.messages.filter((m) => m.role === 'tool').length;

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
  const roundsLeft = maxRounds - currentRound;
  const model = typeof config?.model === 'string' ? config.model : null;
  const guardrails = config?.guardrails;

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
          gap: designTokens.spacing[4],
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
            gap: 6,
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.base,
            textDecoration: 'none',
          }}
        >
          <ArrowLeft size={14} />
          返回
        </Link>
        <span style={{ color: designTokens.colors.borderStrong }}>/</span>
        <span
          style={{
            fontSize: designTokens.typography.fontSize.md,
            fontWeight: designTokens.typography.fontWeight.semibold,
            letterSpacing: '-0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 420,
          }}
        >
          {session?.task ?? ''}
        </span>
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.codeSize.md,
            fontWeight: designTokens.typography.fontWeight.regular,
            color: designTokens.colors.primary,
          }}
        >
          {session?.id ?? ''}
        </span>
        {displayStatus !== null && <StatusBadge status={displayStatus} />}

        <div style={{ flex: 1 }} />

        {controlsVisible && (
          <button
            type="button"
            onClick={() => void handleControl(displayStatus === 'running' ? 'pause' : 'resume')}
            disabled={controlBusy}
            style={headerButtonStyle('secondary')}
          >
            {displayStatus === 'running' ? <Pause size={12} /> : <Play size={12} />}
            {displayStatus === 'running' ? '暂停' : '恢复'}
          </button>
        )}
        {controlsVisible && (
          <button type="button" onClick={() => setStopModalOpen(true)} style={headerButtonStyle('dangerOutline')}>
            <Square size={12} />
            停止
          </button>
        )}
        {statusIsTerminal && (
          <button type="button" disabled style={headerButtonStyle('disabled')}>
            <Square size={12} />
            停止
          </button>
        )}
      </header>

      {controlError !== null && (
        <div style={{ padding: `${designTokens.spacing[2]} ${designTokens.spacing[5]}`, background: designTokens.colors.dangerSoft, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
          {controlError}
        </div>
      )}

      {/* ── three columns (prototype .detail-grid) ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '296px minmax(0,1fr) 300px',
          gap: 1,
          background: designTokens.colors.border,
        }}
      >
        {/* LEFT: files changed / terminal */}
        <aside style={colStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[3],
              padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
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
            {/* mini-tabs (prototype .mini-tabs) */}
            <div style={{ display: 'flex', gap: '2px' }}>
              <button
                type="button"
                onClick={() => setLeftTab('files')}
                style={miniTabStyle(leftTab === 'files')}
              >
                文件变更 <span style={{ fontFamily: designTokens.typography.fontFamily.mono }}>{files.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setLeftTab('term')}
                style={miniTabStyle(leftTab === 'term')}
              >
                终端
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {leftTab === 'files' ? (
              <>
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
                      gap: 10,
                      width: '100%',
                      padding: `${designTokens.spacing[2]} ${designTokens.spacing[4]}`,
                      border: 'none',
                      borderBottomWidth: 1,
                      borderBottomStyle: 'solid',
                      borderBottomColor: designTokens.colors.border,
                      background:
                        selectedPath === file.path
                          ? designTokens.colors.primarySoft
                          : 'transparent',
                      boxShadow:
                        selectedPath === file.path
                          ? `inset 2px 0 0 ${designTokens.colors.primary}`
                          : 'none',
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
                        fontFamily: designTokens.typography.fontFamily.mono,
                        fontSize: designTokens.typography.fontSize.xs,
                        fontWeight: designTokens.typography.fontWeight.semibold,
                        flexShrink: 0,
                        color: markColor(file.mark).fg,
                        background: markColor(file.mark).bg,
                      }}
                    >
                      {file.mark}
                    </span>
                    <span
                      style={{
                        fontFamily: designTokens.typography.fontFamily.mono,
                        fontSize: designTokens.typography.codeSize.md,
                        color: designTokens.colors.text,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {file.path}
                    </span>
                    <span
                      style={{
                        display: 'inline-flex',
                        gap: 6,
                        fontFamily: designTokens.typography.fontFamily.mono,
                        fontSize: designTokens.typography.fontSize.xs,
                      }}
                    >
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
              </>
            ) : (
              <div
                style={{
                  padding: designTokens.spacing[6],
                  color: designTokens.colors.textMuted,
                  fontSize: designTokens.typography.fontSize.sm,
                  textAlign: 'center',
                }}
              >
                <Terminal size={20} style={{ margin: '0 auto 8px', display: 'block' }} />
                终端流将在 Task 19 接入 agent 主循环后提供。
              </div>
            )}
          </div>
        </aside>

        {/* CENTER: message feed (no column head — prototype starts the feed directly) */}
        <section style={{ ...colStyle, background: designTokens.colors.bg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!events.wsConnected && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: designTokens.spacing[2],
                padding: `${designTokens.spacing[2]} ${designTokens.spacing[4]}`,
                background: designTokens.colors.dangerSoft,
                color: designTokens.colors.danger,
                fontSize: designTokens.typography.fontSize.sm,
              }}
            >
              <WifiOff size={12} />
              连接已断开 — 实时更新已暂停
              <button
                type="button"
                onClick={events.reconnect}
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: designTokens.spacing[1],
                  border: 'none',
                  background: designTokens.colors.surface,
                  color: designTokens.colors.text,
                  borderRadius: designTokens.radius.sm,
                  padding: `${designTokens.spacing[0]} ${designTokens.spacing[2]}`,
                  fontFamily: designTokens.typography.fontFamily.sans,
                  fontSize: designTokens.typography.fontSize.sm,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={10} />
                重连
              </button>
            </div>
          )}
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

          {/* composer (prototype .composer-box) */}
          <div
            style={{
              borderTopWidth: 1,
              borderTopStyle: 'solid',
              borderTopColor: designTokens.colors.border,
              padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
              background: designTokens.colors.surface,
            }}
          >
            {sendError !== null && (
              <p style={{ margin: `0 0 ${designTokens.spacing[2]}`, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
                {sendError}
              </p>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: designTokens.colors.well,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.borderStrong,
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
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
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: designTokens.colors.text,
                  resize: 'none',
                  fontSize: designTokens.typography.fontSize.base,
                  lineHeight: designTokens.typography.lineHeight.normal,
                  minHeight: 20,
                  maxHeight: 120,
                  fontFamily: designTokens.typography.fontFamily.sans,
                }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || composer.trim() === ''}
                style={{ ...headerButtonStyle('primary'), opacity: sending || composer.trim() === '' ? 0.5 : 1 }}
              >
                {sending ? <Loader2 size={12} /> : <Send size={12} />}
                发送
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 6,
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
        <aside style={{ ...colStyle, background: designTokens.colors.bg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[3],
              padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
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
            上下文
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {/* status */}
            <ContextSection label="状态">
              {displayStatus !== null && <StatusBadge status={displayStatus} />}
              <ContextKV
                k="护栏"
                v={events.pendingApproval !== null ? 'HITL · 已触发' : '未触发'}
                vColor={events.pendingApproval !== null ? designTokens.colors.warning : undefined}
              />
              {model !== null && <ContextKV k="模型" v={model} mono />}
            </ContextSection>

            {/* rounds progress */}
            <ContextSection label="轮次进度">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: designTokens.typography.fontFamily.mono,
                    fontSize: 30,
                    fontWeight: designTokens.typography.fontWeight.semibold,
                    color: designTokens.colors.text,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {currentRound}
                </span>
                <span
                  style={{
                    fontFamily: designTokens.typography.fontFamily.mono,
                    fontSize: designTokens.typography.fontSize.md,
                    color: designTokens.colors.textMuted,
                  }}
                >
                  / {maxRounds > 0 ? maxRounds : '∞'}
                </span>
              </div>
              {maxRounds > 0 && (
                <div
                  style={{
                    height: 6,
                    marginTop: 10,
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
                      transition: 'width 0.6s ease',
                    }}
                  />
                </div>
              )}
              {roundsLeft > 0 && (
                <ContextKV k="预计剩余" v={`~${roundsLeft} 轮`} />
              )}
            </ContextSection>

            {/* token usage */}
            <ContextSection label="Token 使用">
              <span
                style={{
                  fontFamily: designTokens.typography.fontFamily.mono,
                  fontSize: designTokens.typography.fontSize.md,
                  fontVariantNumeric: 'tabular-nums',
                  color: designTokens.colors.text,
                }}
              >
                {formatTokens(session?.tokenCount ?? 0)}
              </span>
            </ContextSection>

            {/* runtime info */}
            <ContextSection label="运行信息">
              <ContextKV
                k="已运行"
                v={session ? formatDurationBetween(session.createdAt, session.updatedAt) : '—'}
                mono
              />
              <ContextKV k="开始于" v={formatDateTime(session?.createdAt ?? '')} mono />
              <ContextKV k="文件变更" v={String(files.length)} mono />
              <ContextKV k="工具调用" v={String(toolCallCount)} mono />
            </ContextSection>

            {/* guardrail chips */}
            <ContextSection label="能力护栏">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Array.isArray(guardrails?.requireApproval) &&
                  guardrails.requireApproval.map((item) => (
                    <span
                      key={String(item)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        borderRadius: designTokens.radius.pill,
                        borderWidth: 1,
                        borderStyle: 'solid',
                        borderColor: designTokens.colors.warningBorder,
                        color: designTokens.colors.warning,
                        fontSize: designTokens.typography.fontSize.xs,
                      }}
                    >
                      {String(item)} · 需审批
                    </span>
                  ))}
                {guardrails?.blockOutbound === true && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '2px 8px',
                      borderRadius: designTokens.radius.pill,
                      borderWidth: 1,
                      borderStyle: 'solid',
                      borderColor: designTokens.colors.dangerBorder,
                      color: designTokens.colors.danger,
                      fontSize: designTokens.typography.fontSize.xs,
                    }}
                  >
                    禁止 · 网络外呼
                  </span>
                )}
                {!(Array.isArray(guardrails?.requireApproval) && guardrails.requireApproval.length > 0) &&
                  guardrails?.blockOutbound !== true && (
                    <span style={{ color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
                      配置中未声明护栏规则
                    </span>
                  )}
              </div>
            </ContextSection>
          </div>
        </aside>
      </div>

      {/* ── stop confirmation modal (prototype modal-stop) ── */}
      {stopModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认停止"
          style={{
            position: 'fixed',
            inset: 0,
            background: designTokens.colors.overlay,
            backdropFilter: 'blur(3px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
          }}
          onClick={() => setStopModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 420,
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
              <h3 style={{ margin: 0, fontSize: designTokens.typography.fontSize.md, fontWeight: designTokens.typography.fontWeight.semibold, color: designTokens.colors.danger }}>
                确认停止
              </h3>
              <button
                type="button"
                onClick={() => setStopModalOpen(false)}
                aria-label="关闭"
                style={iconBtnStyle}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: designTokens.spacing[5] }}>
              <p style={{ margin: 0, color: designTokens.colors.textSubtle, fontSize: designTokens.typography.fontSize.base, lineHeight: 1.6 }}>
                此操作将立即终止 agent 执行，并放弃当前未保存的变更。该操作不可撤销。
              </p>
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
              <button type="button" onClick={() => setStopModalOpen(false)} style={headerButtonStyle('ghost')}>
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleControl('stop')}
                disabled={controlBusy}
                style={headerButtonStyle('dangerSolid')}
              >
                {controlBusy ? <Loader2 size={12} /> : <Square size={12} />}
                确认停止
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Local layout helpers (token-driven) ─────────────────────────────────────

const colStyle: CSSProperties = {
  background: designTokens.colors.bg,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

function miniTabStyle(active: boolean): CSSProperties {
  return {
    border: 'none',
    background: active ? designTokens.colors.surfaceHover : 'transparent',
    color: active ? designTokens.colors.text : designTokens.colors.textMuted,
    font: 'inherit',
    textTransform: 'inherit',
    letterSpacing: 'inherit',
    padding: '3px 8px',
    borderRadius: 6,
    cursor: 'pointer',
  };
}

/** File-change mark colors (M=warning / A=success / D=danger). */
function markColor(mark: string): { fg: string; bg: string } {
  switch (mark) {
    case 'A':
      return { fg: designTokens.colors.success, bg: designTokens.colors.successSoft };
    case 'D':
      return { fg: designTokens.colors.danger, bg: designTokens.colors.dangerSoft };
    default:
      return { fg: designTokens.colors.warning, bg: designTokens.colors.warningSoft };
  }
}

function formatDurationBetween(fromIso: string, toIso: string): string {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function ContextSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      style={{
        padding: designTokens.spacing[4],
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
      }}
    >
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: designTokens.colors.textMuted,
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      {children}
    </section>
  );
}

function ContextKV({
  k,
  v,
  mono,
  vColor,
}: {
  k: string;
  v: string;
  mono?: boolean;
  vColor?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBlock: designTokens.spacing[1],
        fontSize: 12.5,
      }}
    >
      <span style={{ color: designTokens.colors.textMuted }}>{k}</span>
      <span
        style={{
          fontFamily: mono ? designTokens.typography.fontFamily.mono : designTokens.typography.fontFamily.sans,
          fontVariantNumeric: 'tabular-nums',
          color: vColor ?? designTokens.colors.text,
        }}
      >
        {v}
      </span>
    </div>
  );
}

type HeaderButtonTone = 'primary' | 'secondary' | 'dangerOutline' | 'dangerSolid' | 'ghost' | 'disabled';

function headerButtonStyle(tone: HeaderButtonTone): CSSProperties {
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: designTokens.spacing[1],
    padding: '5px 10px',
    borderRadius: designTokens.radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    fontSize: designTokens.typography.fontSize.sm,
    fontWeight: designTokens.typography.fontWeight.medium,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
  switch (tone) {
    case 'primary':
      return { ...base, borderColor: designTokens.colors.primary, background: designTokens.colors.primary, color: designTokens.colors.onPrimary, fontWeight: designTokens.typography.fontWeight.semibold, boxShadow: designTokens.shadows.primary };
    case 'secondary':
      return { ...base, borderColor: designTokens.colors.borderStrong, background: designTokens.colors.surface, color: designTokens.colors.text };
    case 'dangerOutline':
      return { ...base, borderColor: designTokens.colors.dangerBorder, background: 'transparent', color: designTokens.colors.danger };
    case 'dangerSolid':
      return { ...base, borderColor: designTokens.colors.danger, background: designTokens.colors.danger, color: designTokens.colors.onDanger, fontWeight: designTokens.typography.fontWeight.semibold };
    case 'ghost':
      return { ...base, borderColor: 'transparent', background: 'transparent', color: designTokens.colors.textMuted };
    default:
      return { ...base, borderColor: designTokens.colors.border, background: designTokens.colors.well, color: designTokens.colors.textMuted, cursor: 'not-allowed' };
  }
}

const iconBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
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
