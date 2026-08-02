/**
 * ApprovalCard — HITL command approval (PLAN Task 18b, prototype
 * codeharness-webui.html `.hitl` card). Rendered inline in the message feed
 * when a warn-level guardrail triggers; resolves through POST
 * /api/approvals/:id (approve | modify | deny). Structure mirrors the
 * prototype: warning-tinted head with pulsing badge, editable command
 * textarea, then 批准 / 编辑后提交 / 拒绝 actions; resolved state shows a
 * green/red note. All colors/fonts/spacing resolve to design-tokens.ts.
 */
import { useState, type CSSProperties } from 'react';
import { Check, PenLine, X } from 'lucide-react';
import designTokens from '../design-tokens';

export type ApprovalStatus = 'pending' | 'approved' | 'modified' | 'denied';

export interface ApprovalCardProps {
  /** Command awaiting (or awaiting-resolution of) a human decision. */
  command: string;
  /** Guardrail rule that triggered, e.g. `prod-mutation`. */
  rule?: string;
  status: ApprovalStatus;
  /** True while the resolution POST is in flight — buttons disabled. */
  busy?: boolean;
  /** Backend error to surface (e.g. 409 for a stale approval). */
  error?: string | null;
  onApprove(): void;
  onModify(modifiedCommand: string): void;
  onDeny(): void;
}

export default function ApprovalCard(props: ApprovalCardProps) {
  const { command, rule, status, busy = false, error = null } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(command);

  const resolved = status !== 'pending';

  function openEditor(): void {
    setDraft(command);
    setEditing(true);
  }

  function submitModify(): void {
    const trimmed = draft.trim();
    if (trimmed === '') {
      return;
    }
    props.onModify(trimmed);
    setEditing(false);
  }

  return (
    <section
      aria-label="人工审批"
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: resolved ? designTokens.colors.border : designTokens.colors.warningBorder,
        borderRadius: designTokens.radius.lg,
        background: resolved
          ? designTokens.colors.surface
          : `linear-gradient(180deg, ${designTokens.colors.warningSoft}, transparent 40%), ${designTokens.colors.surface}`,
        overflow: 'hidden',
        marginTop: 6,
        boxShadow: resolved ? 'none' : designTokens.shadows.md,
      }}
    >
      {/* head — pulsing badge + title (prototype .hitl-head) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: resolved ? designTokens.colors.border : designTokens.colors.warningBorder,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            fontWeight: designTokens.typography.fontWeight.semibold,
            letterSpacing: '0.05em',
            color: resolved ? designTokens.colors.textMuted : designTokens.colors.warning,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: designTokens.radius.pill,
              background: resolved ? designTokens.colors.textMuted : designTokens.colors.warning,
              animation: resolved ? 'none' : 'ch-pulse 1.2s infinite',
            }}
          />
          需要人工审批 · HITL
        </span>
        <span style={{ fontSize: designTokens.typography.fontSize.base, fontWeight: designTokens.typography.fontWeight.semibold }}>
          agent 请求执行高权限命令
        </span>
        {rule !== undefined && (
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
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
            {rule}
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {!resolved && (
          <>
            <div
              style={{
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.fontSize.xs,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: designTokens.colors.textMuted,
                marginBottom: 6,
              }}
            >
              待审命令（可直接编辑后再提交）
            </div>
            <textarea
              aria-label="修改后的命令"
              value={editing ? draft : command}
              onChange={(e) => {
                setDraft(e.target.value);
                setEditing(true);
              }}
              spellCheck={false}
              rows={2}
              style={{
                width: '100%',
                background: designTokens.colors.codeBg,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.warningBorder,
                borderRadius: 6,
                padding: '10px 12px',
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.codeSize.md,
                color: designTokens.colors.warning,
                resize: 'vertical',
                minHeight: 40,
                lineHeight: designTokens.typography.lineHeight.normal,
              }}
            />
            <p
              style={{
                margin: `${designTokens.spacing[2]} 0 0`,
                fontSize: designTokens.typography.fontSize.sm,
                color: designTokens.colors.textMuted,
                lineHeight: designTokens.typography.lineHeight.normal,
              }}
            >
              该命令被护栏拦截，等待你的决定。批准后 agent 将立即执行；编辑后按修改内容执行。
            </p>
          </>
        )}

        {error !== null && error !== '' && (
          <p style={{ margin: `${designTokens.spacing[2]} 0 0`, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
            {error}
          </p>
        )}
      </div>

      {resolved ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: designTokens.spacing[2],
            padding: '10px 14px',
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: 11.5,
            color: status === 'denied' ? designTokens.colors.danger : designTokens.colors.success,
          }}
        >
          {status === 'denied' ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
          {status === 'approved' && (
            <span>
              ✓ 已批准并执行：<span style={{ fontFamily: designTokens.typography.fontFamily.mono }}>{command}</span>
            </span>
          )}
          {status === 'modified' && (
            <span>
              ✓ 已修改并批准：<span style={{ fontFamily: designTokens.typography.fontFamily.mono }}>{command}</span>
            </span>
          )}
          {status === 'denied' && <span>✗ 已拒绝该命令，agent 将改用安全路径继续。</span>}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            gap: designTokens.spacing[2],
            padding: '12px 14px',
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: designTokens.colors.border,
            background: designTokens.colors.well,
          }}
        >
          {editing ? (
            <>
              <button
                type="button"
                onClick={submitModify}
                disabled={busy || draft.trim() === ''}
                style={actionButtonStyle('primary')}
              >
                <Check size={12} />
                提交修改
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                style={actionButtonStyle('ghost')}
              >
                <X size={12} />
                取消
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={props.onApprove} disabled={busy} style={actionButtonStyle('primary')}>
                <Check size={12} />
                批准
              </button>
              <button type="button" onClick={openEditor} disabled={busy} style={actionButtonStyle('secondary')}>
                <PenLine size={12} />
                编辑后提交
              </button>
              <button type="button" onClick={props.onDeny} disabled={busy} style={{ ...actionButtonStyle('danger'), marginLeft: 'auto' }}>
                拒绝
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

function actionButtonStyle(tone: ButtonTone): CSSProperties {
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
      return {
        ...base,
        borderColor: designTokens.colors.primary,
        background: designTokens.colors.primary,
        color: designTokens.colors.onPrimary,
        fontWeight: designTokens.typography.fontWeight.semibold,
        boxShadow: designTokens.shadows.primary,
      };
    case 'secondary':
      return {
        ...base,
        borderColor: designTokens.colors.borderStrong,
        background: designTokens.colors.surface,
        color: designTokens.colors.text,
      };
    case 'danger':
      return {
        ...base,
        borderColor: designTokens.colors.danger,
        background: 'transparent',
        color: designTokens.colors.danger,
      };
    default:
      return {
        ...base,
        borderColor: 'transparent',
        background: 'transparent',
        color: designTokens.colors.textMuted,
      };
  }
}
