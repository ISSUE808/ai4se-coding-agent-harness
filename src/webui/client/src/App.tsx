import type { ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Settings as SettingsIcon, SquareTerminal } from 'lucide-react';
import designTokens from './design-tokens';
import Dashboard from './pages/Dashboard';
import SettingsPage from './pages/Settings';
import SessionDetail from './pages/SessionDetail';

/**
 * App shell: top bar with brand + view tabs, then the routed views.
 * Routes: `/` Dashboard, `/sessions/:id` SessionDetail, `/settings` Settings.
 */
export default function App() {
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
      <TopBar />
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

function TopBar() {
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
      }}
    >
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
            paddingInline: designTokens.spacing[2],
            paddingBlock: designTokens.spacing[0],
            borderRadius: designTokens.radius.pill,
            background: designTokens.colors.well,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.border,
            color: designTokens.colors.textMuted,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
          }}
        >
          webui
        </span>
      </div>

      <nav style={{ display: 'flex', alignItems: 'center', gap: designTokens.spacing[4] }}>
        <TopTab to="/" label="会话">
          <SquareTerminal size={14} />
        </TopTab>
        <TopTab to="/settings" label="设置">
          <SettingsIcon size={14} />
        </TopTab>
      </nav>
    </header>
  );
}

function TopTab({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: designTokens.spacing[1],
        paddingBlock: designTokens.spacing[2],
        paddingInline: designTokens.spacing[2],
        borderBottomWidth: 2,
        borderBottomStyle: 'solid',
        borderBottomColor: isActive ? designTokens.colors.primary : 'transparent',
        color: isActive ? designTokens.colors.text : designTokens.colors.textMuted,
        fontSize: designTokens.typography.fontSize.base,
        fontWeight: designTokens.typography.fontWeight.medium,
        textDecoration: 'none',
      })}
    >
      {children}
      {label}
    </NavLink>
  );
}
