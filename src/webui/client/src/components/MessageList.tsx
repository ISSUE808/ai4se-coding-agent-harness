/**
 * MessageList — the 消息流 column (PLAN Task 18b, prototype
 * docs/webui-prototype.html). Renders the session messages in chronological
 * order: user/assistant text rows, expandable tool-call cards, green/red
 * feedback cards, muted system notes, and the inline HITL approval card.
 * Colors/fonts/spacing come exclusively from design-tokens.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Hash, TriangleAlert } from 'lucide-react';
import designTokens from '../design-tokens';
import { formatDateTime, type SessionMessage } from '../lib/session-messages';
import ApprovalCard, { type ApprovalCardProps } from './ApprovalCard';

export interface MessageListProps {
  messages: SessionMessage[];
  /** Inline HITL approval card (rendered at the end of the feed). */
  approval?: ApprovalCardProps | null;
}

/** Pause auto-scroll when the user has scrolled this far above the bottom. */
export const AUTO_SCROLL_EDGE = 48;

export function shouldPauseAutoScroll(scrollTop: number, clientHeight: number, scrollHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight > AUTO_SCROLL_EDGE;
}

export default function MessageList({ messages, approval }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [paused, setPaused] = useState(false);
  const lastCountRef = useRef(messages.length);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !paused) {
      el.scrollTop = el.scrollHeight;
    }
    lastCountRef.current = messages.length;
  }, [messages.length, paused]);

  function handleScroll(): void {
    const el = scrollRef.current;
    if (el) {
      setPaused(shouldPauseAutoScroll(el.scrollTop, el.clientHeight, el.scrollHeight));
    }
  }

  function scrollToBottom(): void {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    setPaused(false);
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-label="消息流"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: designTokens.spacing[4],
        display: 'flex',
        flexDirection: 'column',
        gap: designTokens.spacing[2],
      }}
    >
      {messages.map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
      {approval !== null && approval !== undefined && <ApprovalCard {...approval} />}
      {paused && (
        <button
          type="button"
          onClick={scrollToBottom}
          style={{
            position: 'sticky',
            bottom: designTokens.spacing[2],
            alignSelf: 'center',
            display: 'inline-flex',
            alignItems: 'center',
            gap: designTokens.spacing[1],
            padding: `${designTokens.spacing[1]} ${designTokens.spacing[3]}`,
            borderRadius: designTokens.radius.pill,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.primaryBorder,
            background: designTokens.colors.surface,
            color: designTokens.colors.primary,
            fontSize: designTokens.typography.fontSize.sm,
            cursor: 'pointer',
            boxShadow: designTokens.shadows.md,
          }}
        >
          <ChevronDown size={13} />
          滚动到底部查看新消息
        </button>
      )}
    </div>
  );
}

// ─── Message rows ─────────────────────────────────────────────────────────────

function MessageRow({ message }: { message: SessionMessage }) {
  switch (message.role) {
    case 'user':
      return <TextMessage message={message} label="你" avatar="你" avatarTone="user" />;
    case 'assistant':
      return <TextMessage message={message} label="助手" avatar="AI" avatarTone="assistant" />;
    case 'tool':
      return <ToolCard message={message} />;
    case 'feedback':
      return <FeedbackCard message={message} />;
    default:
      return (
        <div
          style={{
            textAlign: 'center',
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            color: designTokens.colors.textMuted,
            padding: `${designTokens.spacing[1]} 0`,
          }}
        >
          {message.content}
        </div>
      );
  }
}

function TextMessage({
  message,
  label,
  avatar,
  avatarTone,
}: {
  message: SessionMessage;
  label: string;
  avatar: string;
  avatarTone: 'user' | 'assistant';
}) {
  return (
    <article style={{ display: 'flex', gap: designTokens.spacing[3] }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: designTokens.radius.sm,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: designTokens.spacing[0],
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          fontWeight: designTokens.typography.fontWeight.semibold,
          background:
            avatarTone === 'user'
              ? designTokens.colors.primarySoft
              : designTokens.colors.well,
          color:
            avatarTone === 'user'
              ? designTokens.colors.primary
              : designTokens.colors.roleAssistant,
        }}
      >
        {avatar}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: designTokens.spacing[2],
          }}
        >
          <span
            style={{
              fontSize: designTokens.typography.fontSize.sm,
              fontWeight: designTokens.typography.fontWeight.semibold,
              color:
                avatarTone === 'user'
                  ? designTokens.colors.roleUser
                  : designTokens.colors.text,
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              color: designTokens.colors.textMuted,
            }}
          >
            {formatDateTime(message.timestamp)}
          </span>
        </div>
        <p
          style={{
            margin: `${designTokens.spacing[1]} 0 0`,
            fontSize: designTokens.typography.fontSize.base,
            lineHeight: designTokens.typography.lineHeight.relaxed,
            color: designTokens.colors.text,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {message.content}
        </p>
      </div>
    </article>
  );
}

/** Tool duration in seconds with one decimal (e.g. `0.8s`, `6.4s`). */
function formatDurationMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolCard({ message }: { message: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const toolName = message.metadata?.toolName ?? 'tool';
  const result = message.metadata?.toolResult;
  const failed = result !== undefined && !result.success;
  const ok = result !== undefined && result.success;
  const duration = result?.duration_ms ?? 0;

  return (
    <article
      data-failed={failed || undefined}
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: failed
          ? designTokens.colors.dangerBorder
          : designTokens.colors.border,
        borderRadius: designTokens.radius.md,
        background: failed
          ? designTokens.colors.dangerSoft
          : designTokens.colors.surface,
        overflow: 'hidden',
        marginTop: designTokens.spacing[1],
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}工具调用 ${toolName}`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[2],
          width: '100%',
          padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: designTokens.colors.text,
          fontFamily: designTokens.typography.fontFamily.sans,
          fontSize: designTokens.typography.fontSize.base,
        }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 20,
            height: 20,
            borderRadius: designTokens.radius.sm,
            background: failed ? designTokens.colors.dangerSoft : designTokens.colors.well,
            color: failed ? designTokens.colors.danger : designTokens.colors.roleTool,
            flexShrink: 0,
          }}
        >
          {failed ? <TriangleAlert size={12} /> : <Hash size={12} />}
        </span>
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.codeSize.md,
            fontWeight: designTokens.typography.fontWeight.medium,
          }}
        >
          {toolName}
        </span>
        {result !== undefined && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: designTokens.spacing[1],
              marginLeft: 'auto',
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              color: ok
                ? designTokens.colors.success
                : failed
                  ? designTokens.colors.danger
                  : designTokens.colors.textMuted,
            }}
          >
            {ok ? <CircleCheck size={12} /> : failed ? <CircleAlert size={12} /> : null}
            {ok ? '✓ 完成' : failed ? '✗ 失败' : '未知'} · {formatDurationMs(duration)}
          </span>
        )}
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>

      {open && (
        <div style={{ padding: `${designTokens.spacing[1]} ${designTokens.spacing[3]} ${designTokens.spacing[3]}` }}>
          {message.metadata?.toolInput !== undefined && (
            <ToolDetailSection label="参数">
              {JSON.stringify(message.metadata.toolInput)}
            </ToolDetailSection>
          )}
          {result?.error !== undefined && result.error !== '' && (
            <ToolDetailSection label="错误">{result.error}</ToolDetailSection>
          )}
          {result?.output !== undefined && result.output !== '' && (
            <ToolDetailSection label="结果">{result.output}</ToolDetailSection>
          )}
        </div>
      )}
    </article>
  );
}

function ToolDetailSection({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ marginTop: designTokens.spacing[2] }}>
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: designTokens.colors.textMuted,
          marginBottom: designTokens.spacing[1],
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: designTokens.spacing[2],
          borderRadius: designTokens.radius.sm,
          background: designTokens.colors.well,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: designTokens.colors.border,
          color: designTokens.colors.codeText,
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.codeSize.md,
          lineHeight: designTokens.typography.lineHeight.normal,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {children}
      </pre>
    </div>
  );
}

function FeedbackCard({ message }: { message: SessionMessage }) {
  const result = message.metadata?.feedbackResult;
  const [showEvidence, setShowEvidence] = useState(false);

  if (!result) {
    return (
      <div
        style={{
          textAlign: 'center',
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          color: designTokens.colors.textMuted,
        }}
      >
        {message.content}
      </div>
    );
  }

  const passed = result.passed;
  const toneColor = passed ? designTokens.colors.success : designTokens.colors.danger;
  const toneSoft = passed ? designTokens.colors.successSoft : designTokens.colors.dangerSoft;
  const toneBorder = passed ? designTokens.colors.successBorder : designTokens.colors.dangerBorder;

  return (
    <article
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: toneBorder,
        borderRadius: designTokens.radius.md,
        background: toneSoft,
        marginTop: designTokens.spacing[1],
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[2],
          padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: designTokens.spacing[1],
            paddingInline: designTokens.spacing[2],
            paddingBlock: designTokens.spacing[0],
            borderRadius: designTokens.radius.pill,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: toneBorder,
            background: toneSoft,
            color: toneColor,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            fontWeight: designTokens.typography.fontWeight.semibold,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: designTokens.radius.pill,
              background: toneColor,
            }}
          />
          反馈 · {passed ? '通过' : '未通过'}
        </span>
        <span
          style={{
            fontSize: designTokens.typography.fontSize.sm,
            fontWeight: designTokens.typography.fontWeight.medium,
            color: designTokens.colors.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {result.validator}
        </span>
        {!passed && result.failureCategory !== undefined && (
          <span
            style={{
              paddingInline: designTokens.spacing[2],
              borderRadius: designTokens.radius.pill,
              background: designTokens.colors.well,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: designTokens.colors.border,
              color: designTokens.colors.textMuted,
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              whiteSpace: 'nowrap',
            }}
          >
            {result.failureCategory}
          </span>
        )}
        {result.evidence !== '' && (
          <button
            type="button"
            aria-expanded={showEvidence}
            aria-label={showEvidence ? '收起证据' : '展开证据'}
            onClick={() => setShowEvidence((v) => !v)}
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: designTokens.spacing[1],
              border: 'none',
              background: 'transparent',
              color: designTokens.colors.textMuted,
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              cursor: 'pointer',
            }}
          >
            {showEvidence ? '收起证据' : '展开证据'}
            {showEvidence ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        )}
      </div>
      {showEvidence && (
        <pre
          style={{
            margin: 0,
            padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: toneBorder,
            background: designTokens.colors.well,
            color: designTokens.colors.codeText,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.codeSize.md,
            lineHeight: designTokens.typography.lineHeight.normal,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {result.evidence}
        </pre>
      )}
    </article>
  );
}
