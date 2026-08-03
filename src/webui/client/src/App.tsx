/**
 * App shell — top bar with brand + segmented view tabs (mirrors the
 * codeharness-webui.html prototype), then the routed views.
 * Routes: `/` Dashboard, `/sessions/:id` SessionDetail, `/settings` Settings.
 *
 * Top bar carries the prototype's chrome: the segmented 会话/会话详情/设置 tabs
 * with indicator dots and the live WebSocket status pill (global `/ws` channel).
 * (The prototype's search box was removed in Task 24 — it had no function.)
 * All colors/fonts/spacing resolve to design-tokens.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon, SquareTerminal } from 'lucide-react';
import designTokens from './design-tokens';
import { fetchSessions } from './lib/api';
import Dashboard from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SessionDetail from './pages/SessionDetail';

export default function App() {
  const wsConnected = useGlobalWsStatus();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      <TopBar wsConnected={wsConnected} />
      <div style={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
        </Routes>
      </div>
    </div>
  );
}

/**
 * Global WebSocket status — connect to the backend's `/ws` channel once and
 * track connection state; auto-reconnects every 3s after a drop. The pill in
 * the top bar reflects this (prototype's `ws · 已连接 · <n>ms` env pill).
 */
function useGlobalWsStatus(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (typeof WebSocket === 'undefined') {
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const connect = (): void => {
      try {
        ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      } catch {
        return;
      }
      ws.onopen = () => {
        if (!disposed) {
          setConnected(true);
        }
      };
      ws.onclose = () => {
        if (disposed) {
          return;
        }
        setConnected(false);
        retry = window.setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          // close() on a closing socket throws — status follows onclose.
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== undefined) {
        window.clearTimeout(retry);
      }
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };
  }, []);
  return connected;
}

function TopBar({ wsConnected }: { wsConnected: boolean }) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: designTokens.spacing[5],
        height: 56,
        paddingInline: designTokens.spacing[5],
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
        background: designTokens.colors.bg,
        position: 'relative',
        zIndex: 30,
      }}
    >
      {/* brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: designTokens.spacing[3] }}>
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 28,
            height: 28,
            borderRadius: designTokens.radius.sm,
            background: designTokens.colors.primarySoft,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.primaryBorder,
            color: designTokens.colors.primary,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.md,
            fontWeight: designTokens.typography.fontWeight.semibold,
          }}
        >
          &gt;_
        </span>
        <span
          style={{
            fontWeight: designTokens.typography.fontWeight.semibold,
            fontSize: designTokens.typography.fontSize.md,
            letterSpacing: '-0.01em',
          }}
        >
          CodeHarness
        </span>
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            color: designTokens.colors.textMuted,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.border,
            padding: '2px 6px',
            borderRadius: designTokens.radius.pill,
            letterSpacing: '0.04em',
          }}
        >
          webui
        </span>
      </div>

      {/* segmented view tabs (prototype .view-tabs) */}
      <nav style={viewTabsStyle} aria-label="视图切换">
        <ViewTab to="/" label="会话">
          <SquareTerminal size={14} />
        </ViewTab>
        <SessionDetailTab />
        <ViewTab to="/settings" label="设置">
          <SettingsIcon size={14} />
        </ViewTab>
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: designTokens.spacing[4] }}>
        {/* live ws status pill */}
        <span style={envPillStyle} title={wsConnected ? 'WebSocket 已连接' : 'WebSocket 已断开'}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: designTokens.radius.pill,
              background: wsConnected ? designTokens.colors.success : designTokens.colors.danger,
              boxShadow: wsConnected ? `0 0 0 3px ${designTokens.colors.successSoft}` : 'none',
              animation: wsConnected ? 'ch-pulse 2s infinite' : 'none',
            }}
          />
          ws · {wsConnected ? '已连接' : '已断开'}
        </span>
      </div>
    </header>
  );
}

/** Ordinary route tab (会话 / 设置). */
function ViewTab({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => viewTabStyle(isActive)}
      aria-label={`视图：${label}`}
    >
      {({ isActive }) => (
        <>
          <span style={viewTabDotStyle(isActive)} />
          {children}
          {label}
        </>
      )}
    </NavLink>
  );
}

/**
 * 会话详情 tab — active while on any `/sessions/:id` route. Clicking it from
 * elsewhere jumps into the first existing session (or back to the dashboard
 * when there are none), mirroring the prototype's demo tab.
 */
function SessionDetailTab() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = pathname.startsWith('/sessions');
  return (
    <button
      type="button"
      aria-label="视图：会话详情"
      onClick={() => {
        if (active) {
          return;
        }
        void fetchSessions()
          .then((sessions) => {
            navigate(sessions[0] ? `/sessions/${sessions[0].id}` : '/');
          })
          .catch(() => navigate('/'));
      }}
      style={viewTabStyle(active)}
    >
      <span style={viewTabDotStyle(active)} />
      <SquareTerminal size={14} />
      会话详情
    </button>
  );
}

// ─── Top bar style primitives (token-derived) ────────────────────────────────

const viewTabsStyle = {
  display: 'flex',
  gap: '2px',
  background: designTokens.colors.well,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.border,
  borderRadius: designTokens.radius.md,
  padding: '3px',
} as const;

function viewTabStyle(active: boolean) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '6px 14px',
    border: 'none',
    background: active ? designTokens.colors.surface : 'transparent',
    color: active ? designTokens.colors.text : designTokens.colors.textMuted,
    borderRadius: designTokens.radius.sm,
    fontSize: designTokens.typography.fontSize.base,
    fontWeight: designTokens.typography.fontWeight.medium,
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    cursor: 'pointer',
    boxShadow: active ? designTokens.shadows.sm : 'none',
  } as const;
}

function viewTabDotStyle(active: boolean) {
  return {
    width: 6,
    height: 6,
    borderRadius: designTokens.radius.pill,
    background: active ? designTokens.colors.primary : designTokens.colors.textMuted,
  } as const;
}

const envPillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.fontSize.xs,
  color: designTokens.colors.textMuted,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.border,
  padding: '5px 10px',
  borderRadius: designTokens.radius.pill,
  whiteSpace: 'nowrap',
} as const;
