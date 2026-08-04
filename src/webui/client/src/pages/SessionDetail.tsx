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
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
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
  fetchAvailableModels,
  fetchConfig,
  fetchFsFile,
  fetchFsTree,
  fetchSession,
  fetchSessions,
  postMessage,
  resolveApproval,
  saveConfig,
  sessionControl,
  updateSessionModel,
  type ApprovalDecision,
  type ConfigValue,
  type FsTreeNode,
  type SessionControlAction,
  type SessionDetail,
} from '../lib/api';
import type { TerminalLine } from '../lib/ws-state';
import { formatTokens, type SessionStatus } from '../lib/format';
import {
  aggregateFiles,
  formatDateTime,
  toolFiles,
  type FileEntry,
} from '../lib/session-messages';

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
          model: session.model,
        }
      : undefined,
  );

  const displayStatus: SessionStatus | null = events.status ?? session?.status ?? null;

  // Status of the session the CURRENT snapshot reflects (set inside load).
  // Acceptance feedback: the WS streams status/rounds but NOT tokenUsage (it
  // is finalized only when the loop ends), so the REST snapshot — which does
  // carry it — is re-fetched exactly once when the session flips to completed.
  // Without this, the Token 使用 breakdown appears only after a manual refresh.
  const snapshotStatusRef = useRef<SessionStatus | null>(null);

  const load = useCallback(async () => {
    if (sessionId === '') {
      return;
    }
    setPhase('loading');
    try {
      const fresh = await fetchSession(sessionId);
      snapshotStatusRef.current = fresh.status;
      setSession(fresh);
      setPhase('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '无法加载会话');
      setPhase('error');
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refetch exactly once per completion: the guard is set BEFORE the await so
  // a second effect run during the in-flight fetch cannot double-fire, and
  // re-armed when the session leaves completed (a resumed session may complete
  // again). A history view already completed at mount never refetches.
  useEffect(() => {
    const s = events.status;
    if (s === null || session === null) {
      return;
    }
    if (s === 'completed' && snapshotStatusRef.current !== 'completed') {
      snapshotStatusRef.current = 'completed';
      void load();
    } else if (s !== 'completed' && snapshotStatusRef.current === 'completed') {
      snapshotStatusRef.current = null;
    }
  }, [events.status, session, load]);

  // Model + guardrail chips come from the (masked) backend config.
  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {
        // Config unavailable — context sections just omit model/chips.
      });
  }, []);

  // Task 26: "recently used models" = distinct session-level models across
  // every known session (fetched once; the dropdown dedupes against the
  // config default).
  const [recentModels, setRecentModels] = useState<string[]>([]);
  useEffect(() => {
    fetchSessions()
      .then((sessions) => {
        const seen = new Set<string>();
        for (const s of sessions) {
          if (typeof s.model === 'string' && s.model !== '' && !seen.has(s.model)) {
            seen.add(s.model);
          }
        }
        setRecentModels([...seen]);
      })
      .catch(() => {
        // Sessions unavailable — the selector falls back to default + custom.
      });
  }, []);

  // ─── Model selector (Task 26) ─────────────────────────────────────────────

  // Task 26 follow-up: the provider's model list (from GET /api/llm/models).
  // `null` = not loaded / failed → the selector falls back to the free-text
  // custom entry with a hint; a loaded list restricts options to its models.
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  useEffect(() => {
    fetchAvailableModels()
      .then(({ models }) => {
        setAvailableModels(models);
        setModelsError(null);
      })
      .catch((err) => {
        setAvailableModels(null);
        setModelsError(err instanceof Error ? err.message : '模型列表加载失败');
      });
  }, []);

  const [customMode, setCustomMode] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  /**
   * Task 26 follow-up: applying a model also updates the GLOBAL default
   * (`llm.model`) so the next session uses it too. The session PATCH is the
   * primary action (it takes effect immediately, restarting a live run); a
   * failed config save does NOT undo the switch — the user is told.
   */
  async function applyModelSync(model: string): Promise<void> {
    const updated = await updateSessionModel(sessionId, model);
    events.updateModel(updated.model ?? null);
    setSession((prev) => (prev ? { ...prev, model: updated.model } : prev));
    rememberRecentModel(updated.model);
    try {
      // The merged config the server returns becomes the new baseline for
      // the "默认模型" option and the config-default comparison below.
      const merged = await saveConfig({ llm: { model } });
      setConfig(merged);
    } catch (err) {
      setModelError(
        `已切换会话模型，但全局配置更新失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function handleModelSelect(value: string): Promise<void> {
    if (value === CUSTOM_MODEL_VALUE) {
      setCustomMode(true);
      return;
    }
    // Picking the default option clears the override ('' = config default).
    const next = value === configModel ? '' : value;
    if (sessionId === '' || modelBusy) {
      return;
    }
    setModelBusy(true);
    setModelError(null);
    try {
      if (next === '') {
        // Clearing the override — the config default stays as it is.
        const updated = await updateSessionModel(sessionId, '');
        events.updateModel(updated.model ?? null);
        setSession((prev) => (prev ? { ...prev, model: updated.model } : prev));
      } else {
        await applyModelSync(next);
      }
    } catch (err) {
      setModelError(err instanceof Error ? err.message : '切换模型失败');
    } finally {
      setModelBusy(false);
    }
  }

  async function applyCustomModel(): Promise<void> {
    const trimmed = customModel.trim();
    if (trimmed === '' || sessionId === '' || modelBusy) {
      return;
    }
    setModelBusy(true);
    setModelError(null);
    try {
      await applyModelSync(trimmed);
      setCustomMode(false);
      setCustomModel('');
    } catch (err) {
      setModelError(err instanceof Error ? err.message : '切换模型失败');
    } finally {
      setModelBusy(false);
    }
  }

  /**
   * Review M4: fold a successfully applied model into the "recently used"
   * list — switching AWAY from it (back to the default) must not make the
   * option vanish from the dropdown.
   */
  function rememberRecentModel(model: string | undefined): void {
    if (typeof model !== 'string' || model === '') {
      return;
    }
    setRecentModels((prev) => (prev.includes(model) ? prev : [...prev, model]));
  }

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
  // Changed-file marks (A/M) overlaid on the workspace tree (Task 23).
  // Tool metadata reports paths relative to the workspace root while fs tree
  // nodes carry absolute paths — join against the root and normalize
  // separators so the overlay matches on every platform.
  const fileMarks = new Map(
    files.map((f) => [normalizePath(absoluteWithin(session?.workspaceRoot ?? '', f.path)), f] as const),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const fileRequestRef = useRef(0);

  // 1.5 real-test follow-up: selecting a file fetches its CURRENT CONTENT
  // from GET /api/fs/file (workspace-bounded) instead of showing tool-output
  // summaries — write_file carries no output, so the old preview was always
  // empty for freshly written files. A generation counter makes a stale
  // response (quickly re-clicked files) a no-op.
  function selectFile(absPath: string): void {
    setSelectedPath(absPath);
    setSelectedContent(null);
    setSelectedError(null);
    const requestId = ++fileRequestRef.current;
    fetchFsFile(absPath)
      .then((file) => {
        if (requestId !== fileRequestRef.current) {
          return;
        }
        setSelectedContent(file.content);
      })
      .catch((err) => {
        if (requestId !== fileRequestRef.current) {
          return;
        }
        setSelectedError(err instanceof Error ? err.message : '无法读取文件内容');
      });
  }

  // Task 23: workspace file tree in the left column, fetched from the fs
  // endpoint (bounded to the session workspaceRoot). The workspaceRoot
  // effect fetches once per session (M5: status changes rebuild the session
  // object but must not refetch the tree); a second effect refetches after
  // NEW file-changing tool messages so freshly created files appear without
  // a manual page refresh (1.4). A request generation counter makes a stale
  // response (switched root, superseded refetch) a no-op.
  const workspaceRoot = session?.workspaceRoot ?? '';
  const [tree, setTree] = useState<FsTreeNode | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(new Set());
  const treeRequestRef = useRef(0);

  const loadTree = useCallback(() => {
    if (workspaceRoot === '') {
      return;
    }
    const requestId = ++treeRequestRef.current;
    fetchFsTree(workspaceRoot)
      .then((node) => {
        if (requestId !== treeRequestRef.current) {
          return; // a newer request (or a root switch) superseded this one
        }
        setTree(node);
        setTreeError(null);
        // Root starts expanded so the first level is visible immediately.
        setTreeExpanded((prev) => new Set(prev).add(node.path));
      })
      .catch((err) => {
        if (requestId !== treeRequestRef.current) {
          return;
        }
        setTreeError(err instanceof Error ? err.message : '无法加载文件树');
      });
  }, [workspaceRoot]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  // 1.4: refetch the tree when the live message stream reports a NEW
  // file-changing tool message (a file the snapshot does not know yet must
  // appear without refreshing the page). The first non-empty message list —
  // the REST snapshot merged once by the hook — is absorbed without a
  // refetch (the workspaceRoot effect already covered it); only messages
  // arriving after that trigger, debounced so a burst of tool calls costs
  // one fetch.
  const treeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeSnapshotSeenRef = useRef(false);
  const treeLastMessageRef = useRef<string | null>(null);
  useEffect(() => {
    const messages = events.messages;
    const last = messages[messages.length - 1];
    if (last === undefined) {
      return;
    }
    if (!treeSnapshotSeenRef.current) {
      treeSnapshotSeenRef.current = true;
      treeLastMessageRef.current = last.id;
      return;
    }
    if (last.id === treeLastMessageRef.current) {
      return;
    }
    treeLastMessageRef.current = last.id;
    if (last.role !== 'tool' || toolFiles(last).length === 0) {
      return;
    }
    if (treeRefreshTimerRef.current !== null) {
      clearTimeout(treeRefreshTimerRef.current);
    }
    treeRefreshTimerRef.current = setTimeout(() => {
      treeRefreshTimerRef.current = null;
      loadTree();
    }, 300);
  }, [events.messages, loadTree]);

  useEffect(
    () => () => {
      if (treeRefreshTimerRef.current !== null) {
        clearTimeout(treeRefreshTimerRef.current);
      }
    },
    [],
  );

  // CR I2: changed files that the fetched tree hides (depth/per-level caps)
  // stay reachable through a fallback list below the tree.
  const treeFilePaths = collectTreeFilePaths(tree);
  const hiddenChangedFiles = files.filter(
    (f) => !treeFilePaths.has(normalizePath(absoluteWithin(workspaceRoot, f.path))),
  );

  function toggleTreeDir(dirPath: string): void {
    setTreeExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }

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
  // Task 26: effective model = session override (WS/PATCH state) → REST
  // snapshot → config default. The selector options are the config default,
  // distinct models from other sessions, and a custom entry.
  // Task 26 real-test fix (4.1): the config model lives at `config.llm.model`
  // (src/types.ts Config) — a top-level `model` never exists in the masked
  // config response, so reading it made configModel always null and the
  // selector never rendered. The test mock's wrong shape (top-level model)
  // is what hid this; narrowed like `guardrails` below.
  const llmRaw = config?.llm;
  const llm =
    typeof llmRaw === 'object' && llmRaw !== null
      ? (llmRaw as Record<string, unknown>)
      : undefined;
  const configModel = typeof llm?.model === 'string' ? llm.model : null;
  const effectiveModel = events.model ?? session?.model ?? configModel;
  const sessionModel = typeof session?.model === 'string' ? session.model : null;
  // Task 26 follow-up: when the provider model list loaded, ONLY its models
  // are selectable (plus the config default and any session override not in
  // the list) — the free-text custom entry is hidden. When the list is
  // unavailable/empty, fall back to recently-used models + the custom entry.
  const listMode = availableModels !== null && availableModels.length > 0;
  const optionPool = listMode
    ? availableModels
    : recentModels.concat(
        effectiveModel !== null && effectiveModel !== configModel ? [effectiveModel] : [],
      );
  const otherModels = Array.from(
    new Set(
      optionPool
        .concat(sessionModel !== null ? [sessionModel] : [])
        .filter((m): m is string => typeof m === 'string' && m !== '' && m !== configModel),
    ),
  );
  // guardrails is unknown (Record<string, unknown>); narrow before member access.
  const guardrailsRaw = config?.guardrails;
  const guardrails =
    typeof guardrailsRaw === 'object' && guardrailsRaw !== null
      ? (guardrailsRaw as Record<string, unknown>)
      : undefined;

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
                {treeError !== null && (
                  <div
                    style={{
                      padding: designTokens.spacing[5],
                      textAlign: 'center',
                      color: designTokens.colors.danger,
                      fontSize: designTokens.typography.fontSize.sm,
                    }}
                  >
                    无法加载文件树 — {treeError}
                  </div>
                )}
                {treeError === null && tree === null && (
                  <div style={{ padding: designTokens.spacing[6], textAlign: 'center', color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
                    加载文件树…
                  </div>
                )}
                {tree !== null && treeError === null && (
                  <>
                    {Array.isArray(tree.children) && tree.children.length === 0 && (
                      <div style={{ padding: designTokens.spacing[6], textAlign: 'center', color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
                        工作目录为空
                      </div>
                    )}
                    {renderFileTreeNode(tree, 0, treeExpanded, fileMarks, selectedPath, selectFile, toggleTreeDir)}
                  </>
                )}
                {hiddenChangedFiles.length > 0 && (
                  <div
                    style={{
                      padding: designTokens.spacing[3],
                      borderTopWidth: 1,
                      borderTopStyle: 'solid',
                      borderTopColor: designTokens.colors.border,
                    }}
                  >
                    <div style={fallbackLabelStyle}>变更文件（未显示在树中）</div>
                    {hiddenChangedFiles.map((file) => {
                      const absPath = absoluteWithin(workspaceRoot, file.path);
                      const selected = selectedPath === absPath;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => selectFile(absPath)}
                          style={fallbackRowStyle(selected)}
                        >
                          <MarkBadge mark={file.mark} />
                          <span style={fallbackPathStyle}>{file.path}</span>
                          <span style={fallbackCountsStyle}>
                            {file.addCount > 0 && <span style={{ color: designTokens.colors.success }}>+{file.addCount}</span>}
                            {file.delCount > 0 && <span style={{ color: designTokens.colors.danger }}>−{file.delCount}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {selectedPath !== null && (
                  <div style={{ padding: designTokens.spacing[3], borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: designTokens.colors.border }}>
                    {/* 1.5: the preview shows the file's CURRENT CONTENT,
                        fetched from the workspace-bounded /api/fs/file. */}
                    <FileDiff path={selectedPath} content={selectedContent} error={selectedError} />
                  </div>
                )}
              </>
            ) : events.terminal.length === 0 ? (
              <div
                style={{
                  padding: designTokens.spacing[6],
                  color: designTokens.colors.textMuted,
                  fontSize: designTokens.typography.fontSize.sm,
                  textAlign: 'center',
                }}
              >
                <Terminal size={20} style={{ margin: '0 auto 8px', display: 'block' }} />
                暂无终端输出 — 运行中产生的工具调用、反馈与护栏事件会实时显示在这里。
              </div>
            ) : (
              <div
                style={{
                  padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
                  fontFamily: designTokens.typography.fontFamily.mono,
                  fontSize: designTokens.typography.codeSize.sm,
                  lineHeight: 1.75,
                  overflowWrap: 'anywhere',
                }}
              >
                {events.terminal.map((line) => (
                  <div key={line.id} style={{ display: 'flex', gap: designTokens.spacing[2] }}>
                    <span
                      style={{
                        color: designTokens.colors.textFaint,
                        flexShrink: 0,
                        userSelect: 'none',
                      }}
                    >
                      {formatDateTime(line.timestamp)}
                    </span>
                    <span style={{ color: terminalKindColor(line.kind) }}>{line.text}</span>
                  </div>
                ))}
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
            </ContextSection>

            {/* model (Task 26: session-level override selector) */}
            {configModel !== null && (
              <ContextSection label="模型">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: designTokens.spacing[2] }}>
                    <span style={{ color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
                      {sessionModel !== null ? '会话模型' : '默认模型'}
                    </span>
                    <span
                      style={{
                        fontFamily: designTokens.typography.fontFamily.mono,
                        fontSize: designTokens.typography.codeSize.md,
                        color: sessionModel !== null ? designTokens.colors.primary : designTokens.colors.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {effectiveModel}
                    </span>
                  </div>
                  <select
                    aria-label="选择模型"
                    value={effectiveModel ?? ''}
                    onChange={(e) => void handleModelSelect(e.target.value)}
                    disabled={modelBusy}
                    style={modelSelectStyle}
                  >
                    <option value={configModel}>默认模型 · {configModel}</option>
                    {otherModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {!listMode && <option value={CUSTOM_MODEL_VALUE}>自定义模型…</option>}
                  </select>
                  {!listMode && customMode && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        aria-label="自定义模型输入"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void applyCustomModel();
                          }
                        }}
                        placeholder="模型名称，如 deepseek-v3"
                        style={modelInputStyle}
                      />
                      <button
                        type="button"
                        onClick={() => void applyCustomModel()}
                        disabled={modelBusy || customModel.trim() === ''}
                        style={modelApplyStyle}
                      >
                        {modelBusy ? <Loader2 size={12} /> : '应用'}
                      </button>
                    </div>
                  )}
                  {modelsError !== null && (
                    <span style={{ color: designTokens.colors.warning, fontSize: designTokens.typography.fontSize.sm }}>
                      模型列表加载失败：{modelsError}（可手动输入）
                    </span>
                  )}
                  {modelError !== null && (
                    <span style={{ color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
                      {modelError}
                    </span>
                  )}
                </div>
              </ContextSection>
            )}

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

            {/* token usage — billed totals (KNOWN_ISSUES 9 明细) plus the
                memory layer's context estimate */}
            <ContextSection label="Token 使用">
              {session?.tokenUsage !== undefined ? (
                <>
                  <ContextKV k="输入" v={formatTokens(session.tokenUsage.prompt)} mono />
                  <ContextKV k="输出" v={formatTokens(session.tokenUsage.completion)} mono />
                  {session.tokenUsage.cached !== undefined && (
                    <ContextKV k="缓存命中" v={formatTokens(session.tokenUsage.cached)} mono />
                  )}
                  <ContextKV
                    k="总计"
                    v={formatTokens(session.tokenUsage.prompt + session.tokenUsage.completion)}
                    mono
                  />
                  <ContextKV k="上下文估计" v={formatTokens(session?.tokenCount ?? 0)} mono vColor={designTokens.colors.textMuted} />
                </>
              ) : (
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
              )}
            </ContextSection>

            {/* runtime info */}
            <ContextSection label="运行信息">
              <ContextKV k="项目路径" v={session?.workspaceRoot ?? '—'} mono />
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

/** Small A/M/D badge used by the tree rows and the fallback change list. */
function MarkBadge({ mark }: { mark: string }) {
  const colors = markColor(mark);
  return (
    <span
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 16,
        height: 16,
        borderRadius: designTokens.radius.sm,
        fontFamily: designTokens.typography.fontFamily.mono,
        fontSize: designTokens.typography.fontSize.xs,
        fontWeight: designTokens.typography.fontWeight.semibold,
        flexShrink: 0,
        color: colors.fg,
        background: colors.bg,
      }}
    >
      {mark}
    </span>
  );
}

/** Normalized absolute paths of every file node in the fetched tree. */
function collectTreeFilePaths(tree: FsTreeNode | null): Set<string> {
  const paths = new Set<string>();
  if (tree === null) {
    return paths;
  }
  const walk = (node: FsTreeNode): void => {
    if (node.type === 'file') {
      paths.add(normalizePath(node.path));
    }
    if (node.type === 'dir' && Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  };
  walk(tree);
  return paths;
}

// ─── Fallback change-list styles (CR I2) ────────────────────────────────────

const fallbackLabelStyle: CSSProperties = {
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.fontSize.xs,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: designTokens.colors.textMuted,
  marginBottom: designTokens.spacing[1],
};

function fallbackRowStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: designTokens.spacing[1],
    width: '100%',
    padding: `${designTokens.spacing[1]} ${designTokens.spacing[2]}`,
    border: 'none',
    borderRadius: designTokens.radius.sm,
    background: selected ? designTokens.colors.primarySoft : 'transparent',
    boxShadow: selected ? `inset 2px 0 0 ${designTokens.colors.primary}` : 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: designTokens.typography.fontFamily.sans,
    marginBottom: designTokens.spacing[0],
  };
}

const fallbackPathStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.codeSize.md,
  color: designTokens.colors.text,
};

const fallbackCountsStyle: CSSProperties = {
  display: 'inline-flex',
  gap: designTokens.spacing[1],
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.fontSize.xs,
  flexShrink: 0,
};

/**
 * Recursive workspace file tree (Task 23): directories expand/collapse via
 * chevrons; files carry the A/M change badge + line counts when touched, and
 * selecting one opens the diff preview. Indentation scales per depth.
 */
function renderFileTreeNode(
  node: FsTreeNode,
  depth: number,
  treeExpanded: Set<string>,
  fileMarks: Map<string, FileEntry>,
  selectedPath: string | null,
  onSelect: (path: string) => void,
  onToggleDir: (path: string) => void,
): ReactNode {
  const isExpanded = treeExpanded.has(node.path);
  const children =
    node.type === 'dir' && Array.isArray(node.children) ? node.children : [];
  const mark = node.type === 'file' ? fileMarks.get(normalizePath(node.path)) : undefined;

  return (
    <div key={node.path}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[1],
          paddingLeft: `calc(${depth} * ${designTokens.spacing[3]})`,
          paddingRight: designTokens.spacing[2],
          paddingBlock: designTokens.spacing[0],
          minHeight: 26,
          borderRadius: designTokens.radius.sm,
          background:
            node.type === 'file' && selectedPath === node.path
              ? designTokens.colors.primarySoft
              : 'transparent',
          boxShadow:
            node.type === 'file' && selectedPath === node.path
              ? `inset 2px 0 0 ${designTokens.colors.primary}`
              : 'none',
        }}
      >
        {node.type === 'dir' ? (
          children.length > 0 ? (
            <button
              type="button"
              aria-label={isExpanded ? `折叠 ${node.name}` : `展开 ${node.name}`}
              onClick={() => onToggleDir(node.path)}
              style={treeChevronStyle}
            >
              <ChevronRight
                size={12}
                style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.12s' }}
              />
            </button>
          ) : (
            <span style={treeSpacerStyle} />
          )
        ) : (
          <span style={treeSpacerStyle} />
        )}
        {node.type === 'dir' ? (
          isExpanded ? (
            <FolderOpen size={13} style={{ color: designTokens.colors.textMuted, flexShrink: 0 }} />
          ) : (
            <Folder size={13} style={{ color: designTokens.colors.textMuted, flexShrink: 0 }} />
          )
        ) : (
          <File size={13} style={{ color: designTokens.colors.textSubtle, flexShrink: 0 }} />
        )}
        {node.type === 'file' ? (
          <button
            type="button"
            onClick={() => onSelect(node.path)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[1],
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: designTokens.typography.fontFamily.sans,
              padding: `${designTokens.spacing[0]} ${designTokens.spacing[1]}`,
              borderRadius: designTokens.radius.sm,
              overflow: 'hidden',
            }}
          >
            {mark !== undefined && <MarkBadge mark={mark.mark} />}
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
              {node.name}
            </span>
            <span
              style={{
                display: 'inline-flex',
                gap: designTokens.spacing[1],
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.fontSize.xs,
                flexShrink: 0,
              }}
            >
              {mark !== undefined && mark.addCount > 0 && (
                <span style={{ color: designTokens.colors.success }}>+{mark.addCount}</span>
              )}
              {mark !== undefined && mark.delCount > 0 && (
                <span style={{ color: designTokens.colors.danger }}>−{mark.delCount}</span>
              )}
            </span>
          </button>
        ) : (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.codeSize.md,
              color: designTokens.colors.text,
            }}
          >
            {node.name}
          </span>
        )}
        {node.truncated === true && (
          <span style={{ flexShrink: 0, fontSize: designTokens.typography.fontSize.xs, color: designTokens.colors.warning }}>
            …截断
          </span>
        )}
      </div>
      {node.type === 'dir' && isExpanded && children.length > 0 && (
        <div>
          {children.map((child) =>
            renderFileTreeNode(child, depth + 1, treeExpanded, fileMarks, selectedPath, onSelect, onToggleDir),
          )}
        </div>
      )}
    </div>
  );
}

const treeChevronStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 16,
  height: 20,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
};

const treeSpacerStyle: CSSProperties = {
  width: 16,
  flexShrink: 0,
};

/** Unify path separators (fs tree paths come from the server OS). */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Absolute form of a tool-reported path (relative → joined to the root). */
function absoluteWithin(root: string, rel: string): string {
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel)) {
    return rel;
  }
  return `${root.replace(/[\\/]+$/, '')}/${rel}`;
}

function formatDurationBetween(fromIso: string, toIso: string): string {
  const ms = Math.max(0, new Date(toIso).getTime() - new Date(fromIso).getTime());
  const total = Math.floor(ms / 1000);
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

/** Terminal line color by event kind (KNOWN_ISSUES 9 终端 tab). */
function terminalKindColor(kind: TerminalLine['kind']): string {
  switch (kind) {
    case 'tool':
      return designTokens.colors.primary;
    case 'guardrail':
      return designTokens.colors.danger;
    case 'status':
      return designTokens.colors.success;
    case 'round':
      return designTokens.colors.warning;
    default:
      return designTokens.colors.textMuted;
  }
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

/** Sentinel option value for the model selector's custom entry (Task 26). */
const CUSTOM_MODEL_VALUE = '__custom__';

/** Model selector dropdown (Task 26) — token-driven, matches the composer. */
const modelSelectStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.well,
  color: designTokens.colors.text,
  fontFamily: designTokens.typography.fontFamily.sans,
  fontSize: designTokens.typography.fontSize.sm,
  cursor: 'pointer',
};

const modelInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.well,
  color: designTokens.colors.text,
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.codeSize.md,
  outline: 'none',
};

const modelApplyStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: '5px 10px',
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.primary,
  background: designTokens.colors.primary,
  color: designTokens.colors.onPrimary,
  fontSize: designTokens.typography.fontSize.sm,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
