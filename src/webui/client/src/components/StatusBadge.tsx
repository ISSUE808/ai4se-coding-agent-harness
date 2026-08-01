import designTokens from '../design-tokens';
import { formatSessionStatusLabel, type SessionStatus } from '../lib/format';

/**
 * Session lifecycle badge (running/paused/completed/failed). Colors resolve
 * to designTokens status tokens — status hues are reserved for state only.
 */
const STATUS_STYLE: Record<
  SessionStatus,
  { color: string; bg: string; border: string }
> = {
  running: {
    color: designTokens.colors.statusRunning,
    bg: designTokens.colors.successSoft,
    border: designTokens.colors.successBorder,
  },
  paused: {
    color: designTokens.colors.statusPaused,
    bg: designTokens.colors.warningSoft,
    border: designTokens.colors.warningBorder,
  },
  completed: {
    color: designTokens.colors.statusCompleted,
    bg: designTokens.colors.infoSoft,
    border: designTokens.colors.infoBorder,
  },
  failed: {
    color: designTokens.colors.statusFailed,
    bg: designTokens.colors.dangerSoft,
    border: designTokens.colors.dangerBorder,
  },
};

export default function StatusBadge({ status }: { status: SessionStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: designTokens.spacing[1],
        paddingBlock: designTokens.spacing[0],
        paddingInline: designTokens.spacing[2],
        borderRadius: designTokens.radius.pill,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: s.border,
        background: s.bg,
        color: s.color,
        fontSize: designTokens.typography.fontSize.sm,
        fontWeight: designTokens.typography.fontWeight.medium,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: designTokens.radius.pill,
          background: s.color,
        }}
      />
      {formatSessionStatusLabel(status)}
    </span>
  );
}
