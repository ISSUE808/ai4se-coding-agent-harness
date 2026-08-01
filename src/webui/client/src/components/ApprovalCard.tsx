/**
 * ApprovalCard — HITL command approval (PLAN Task 18b, prototype
 * docs/webui-prototype.html). Rendered inline in the message feed when a
 * warn-level guardrail triggers; resolves through POST /api/approvals/:id
 * (approve | modify | deny). All colors/fonts/spacing resolve to
 * design-tokens.ts — no literals.
 */
import { useState, type CSSProperties } from 'react';
import { Check, PenLine, ShieldAlert, X } from 'lucide-react';
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

const RESOLVED_LABEL: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  approved: '已批准',
  modified: '已修改并批准',
  denied: '已拒绝',
};

export default function ApprovalCard(props: ApprovalCardProps) {
  const { command, rule, status, busy = false, error = null } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(command);

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

  const resolved = status !== 'pending';

  return (
    <section
      aria-label="人工审批"
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: resolved
          ? designTokens.colors.borderStrong
          : designTokens.colors.warningBorder,
        borderRadius: designTokens.radius.lg,
        background: resolved ? designTokens.colors.surface : designTokens.colors.warningSoft,
        overflow: 'hidden',
        margin: `${designTokens.spacing[3]} 0`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[2],
          padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: resolved ? designTokens.colors.border : designTokens.colors.warningBorder,
        }}
      >
        <ShieldAlert
          size={14}
          style={{ color: resolved ? designTokens.colors.textMuted : designTokens.colors.warning }}
        />
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.sm,
            fontWeight: designTokens.typography.fontWeight.semibold,
            color: resolved ? designTokens.colors.textMuted : designTokens.colors.warning,
          }}
        >
          {resolved ? 'HITL · 已处理' : '需要人工审批 · HITL'}
        </span>
        {rule !== undefined && (
          <span
            style={{
              marginLeft: designTokens.spacing[1],
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
            {rule}
          </span>
        )}
      </div>

      <div style={{ padding: designTokens.spacing[3] }}>
        <div
          style={{
            margin: 0,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.base,
            color: designTokens.colors.text,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {command}
        </div>
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

        {editing && (
          <div style={{ marginTop: designTokens.spacing[3] }}>
            <textarea
              aria-label="修改后的命令"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              rows={2}
              style={{
                width: '100%',
                padding: designTokens.spacing[2],
                borderRadius: designTokens.radius.md,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.borderStrong,
                background: designTokens.colors.well,
                color: designTokens.colors.text,
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.fontSize.base,
                resize: 'vertical',
              }}
            />
            <div
              style={{
                display: 'flex',
                gap: designTokens.spacing[2],
                marginTop: designTokens.spacing[2],
              }}
            >
              <button
                type="button"
                onClick={submitModify}
                disabled={busy || draft.trim() === ''}
                style={actionButtonStyle('primary')}
              >
                <Check size={13} />
                提交修改
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={busy}
                style={actionButtonStyle('ghost')}
              >
                <X size={13} />
                取消
              </button>
            </div>
          </div>
        )}

        {error !== null && error !== '' && (
          <p style={{ margin: `${designTokens.spacing[2]} 0 0`, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
            {error}
          </p>
        )}

        {resolved ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[2],
              marginTop: designTokens.spacing[3],
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.sm,
              color:
                status === 'denied' ? designTokens.colors.danger : designTokens.colors.success,
            }}
          >
            <Check size={13} />
            {RESOLVED_LABEL[status]}
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: designTokens.spacing[2],
              marginTop: designTokens.spacing[3],
            }}
          >
            <button type="button" onClick={props.onApprove} disabled={busy} style={actionButtonStyle('primary')}>
              <Check size={13} />
              批准
            </button>
            <button type="button" onClick={openEditor} disabled={busy} style={actionButtonStyle('secondary')}>
              <PenLine size={13} />
              编辑
            </button>
            <button type="button" onClick={props.onDeny} disabled={busy} style={actionButtonStyle('danger')}>
              拒绝
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost';

function actionButtonStyle(tone: ButtonTone): CSSProperties {
  const base: CSSProperties = {
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
  };
  switch (tone) {
    case 'primary':
      return {
        ...base,
        borderColor: designTokens.colors.primary,
        background: designTokens.colors.primary,
        color: designTokens.colors.onPrimary,
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
