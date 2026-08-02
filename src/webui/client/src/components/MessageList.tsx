/**
 * MessageList — the 消息流 column (PLAN Task 18b, prototype
 * codeharness-webui.html). Renders the session messages in chronological
 * order: user messages as accent-tinted bubbles, assistant text rows,
 * expandable tool-call cards (with an arg summary on the header row),
 * green/red feedback cards, muted system notes as center pills, and the
 * inline HITL approval card. Colors/fonts/spacing come exclusively from
 * design-tokens.ts.
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
        padding: `${designTokens.spacing[5]} ${designTokens.spacing[5]} ${designTokens.spacing[3]}`,
        display: 'flex',
        flexDirection: 'column',
        gap: designTokens.spacing[4],
      }}
    >
      {messages.map((message) => (
        // flexShrink: 0 — a long feed must scroll, never compress its cards
        // (overflow:hidden cards would collapse into a 1px line otherwise).
        <div key={message.id} style={{ flexShrink: 0 }}>
          <MessageRow message={message} />
        </div>
      ))}
      {approval !== null && approval !== undefined && (
        <div style={{ flexShrink: 0 }}>
          <ApprovalCard {...approval} />
        </div>
      )}
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
      // System note — center pill (prototype .sys-note).
      return (
        <div
          style={{
            textAlign: 'center',
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            color: designTokens.colors.textMuted,
            padding: '4px 0',
          }}
        >
          <span
            style={{
              background: designTokens.colors.well,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: designTokens.colors.border,
              padding: '3px 12px',
              borderRadius: designTokens.radius.pill,
            }}
          >
            {message.content}
          </span>
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
  const isUser = avatarTone === 'user';
  return (
    <article style={{ display: 'flex', gap: designTokens.spacing[3], maxWidth: '100%' }}>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: designTokens.radius.sm,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          marginTop: 2,
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          fontWeight: designTokens.typography.fontWeight.semibold,
          background: isUser ? designTokens.colors.primarySoft : designTokens.colors.surfaceHover,
          color: isUser ? designTokens.colors.roleUser : designTokens.colors.roleAssistant,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: isUser ? designTokens.colors.primaryBorder : designTokens.colors.borderStrong,
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
            marginBottom: 4,
          }}
        >
          <span
            style={{
              fontSize: designTokens.typography.fontSize.sm,
              fontWeight: designTokens.typography.fontWeight.semibold,
              color: isUser ? designTokens.colors.roleUser : designTokens.colors.text,
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
            margin: '0 0 0',
            fontSize: designTokens.typography.fontSize.base,
            lineHeight: designTokens.typography.lineHeight.relaxed,
            // User messages render as accent-tinted bubbles (prototype .r-user).
            color: isUser ? designTokens.colors.text : designTokens.colors.textSubtle,
            background: isUser ? designTokens.colors.primarySoft : 'transparent',
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: isUser ? designTokens.colors.primaryBorder : 'transparent',
            padding: isUser ? '10px 12px' : '0',
            borderRadius: isUser ? 10 : 0,
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

/** One-line arg summary for the tool header (prototype .tool-arg). */
function summarizeArg(input: unknown): string {
  try {
    const json = typeof input === 'string' ? input : JSON.stringify(input);
    return json.length > 64 ? `${json.slice(0, 64)}…` : json;
  } catch {
    return String(input);
  }
}

function ToolCard({ message }: { message: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const toolName = message.metadata?.toolName ?? 'tool';
  const result = message.metadata?.toolResult;
  const failed = result !== undefined && !result.success;
  const ok = result !== undefined && result.success;
  const duration = result?.duration_ms ?? 0;
  const hasInput = message.metadata?.toolInput !== undefined;

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
        marginTop: 6,
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
          gap: 10,
          width: '100%',
          padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: designTokens.colors.text,
          fontFamily: designTokens.typography.fontFamily.sans,
          fontSize: designTokens.typography.fontSize.base,
          userSelect: 'none',
        }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 20,
            height: 20,
            borderRadius: designTokens.radius.sm,
            background: failed ? designTokens.colors.dangerSoft : 'rgba(192, 155, 255, 0.14)',
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
            fontWeight: designTokens.typography.fontWeight.semibold,
          }}
        >
          {toolName}
        </span>
        {hasInput && (
          <span
            style={{
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              color: designTokens.colors.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              minWidth: 0,
            }}
          >
            {summarizeArg(message.metadata?.toolInput)}
          </span>
        )}
        {result !== undefined && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: designTokens.spacing[1],
              marginLeft: hasInput ? 0 : 'auto',
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              color: ok
                ? designTokens.colors.success
                : failed
                  ? designTokens.colors.danger
                  : designTokens.colors.textMuted,
              flexShrink: 0,
            }}
          >
            {ok ? <CircleCheck size={12} /> : failed ? <CircleAlert size={12} /> : null}
            {ok ? '✓ 完成' : failed ? '✗ 失败' : '未知'} · {formatDurationMs(duration)}
          </span>
        )}
        <span
          style={{
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.xs,
            transition: 'transform 0.15s',
            transform: open ? 'rotate(90deg)' : 'none',
            flexShrink: 0,
          }}
        >
          <ChevronRight size={13} />
        </span>
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
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <pre
        style={{
          margin: 0,
          padding: '10px 12px',
          borderRadius: 6,
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
          overflowX: 'auto',
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
        marginTop: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[2],
          padding: '10px 12px',
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
            fontSize: 12.5,
            fontWeight: designTokens.typography.fontWeight.semibold,
            color: toneColor,
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
