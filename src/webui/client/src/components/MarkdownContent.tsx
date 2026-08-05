/**
 * MarkdownContent — renders assistant message content as markdown (PLAN
 * Task 24). GFM support (tables, strikethrough, task lists, autolinks) comes
 * from remark-gfm; all colors/fonts/spacing resolve to design-tokens.ts.
 *
 * Security (content is LLM output — it must never be injected as HTML):
 * - `skipHtml` ignores raw HTML in the markdown entirely, never rendering it;
 *   no rehype-raw plugin is used, and `dangerouslySetInnerHTML` is never used.
 * - URLs pass through react-markdown's default `urlTransform` sanitizer
 *   (javascript: etc. are stripped).
 * - Markdown images (`![alt](url)`) render as plain alt text instead of
 *   fetching remote URLs (no tracking pixels / IP leaks).
 */
import type { ComponentProps } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import designTokens from '../design-tokens';

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      style={{
        fontSize: designTokens.typography.fontSize.base,
        lineHeight: designTokens.typography.lineHeight.relaxed,
        color: designTokens.colors.textSubtle,
        wordBreak: 'break-word',
      }}
    >
      <Markdown skipHtml remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </Markdown>
    </div>
  );
}

const mdHeadingBase = {
  fontWeight: designTokens.typography.fontWeight.semibold,
  color: designTokens.colors.text,
  lineHeight: designTokens.typography.lineHeight.tight,
} as const;

const mdComponents: Components = {
  h1: (props) => (
    <h1
      {...props}
      style={{
        ...mdHeadingBase,
        fontSize: designTokens.typography.fontSize.xl,
        marginTop: designTokens.spacing[4],
        marginBottom: designTokens.spacing[2],
      }}
    />
  ),
  h2: (props) => (
    <h2
      {...props}
      style={{
        ...mdHeadingBase,
        fontSize: designTokens.typography.fontSize.lg,
        marginTop: designTokens.spacing[3],
        marginBottom: designTokens.spacing[2],
      }}
    />
  ),
  h3: (props) => (
    <h3
      {...props}
      style={{
        ...mdHeadingBase,
        fontSize: designTokens.typography.fontSize.md,
        marginTop: designTokens.spacing[3],
        marginBottom: designTokens.spacing[1],
      }}
    />
  ),
  h4: mdSmallHeading('h4'),
  h5: mdSmallHeading('h5'),
  h6: mdSmallHeading('h6'),
  p: (props) => (
    <p {...props} style={{ marginTop: 0, marginBottom: designTokens.spacing[2] }} />
  ),
  a: (props) => (
    <a {...props} style={{ color: designTokens.colors.primary, textDecoration: 'underline' }} />
  ),
  // Code well — mirrors the ToolCard/SystemCard code-well style (tokens only).
  pre: (props) => (
    <pre
      {...props}
      style={{
        backgroundColor: designTokens.colors.well,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        borderRadius: designTokens.radius.md,
        padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
        marginTop: 0,
        marginBottom: designTokens.spacing[3],
        color: designTokens.colors.codeText,
        fontFamily: designTokens.typography.fontFamily.mono,
        fontSize: designTokens.typography.codeSize.md,
        lineHeight: designTokens.typography.lineHeight.normal,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflowX: 'auto',
      }}
    />
  ),
  // Inline code gets the well tint; fenced blocks inside a <pre> are unstyled
  // here because the pre already provides the well.
  code: ({ className, children, ...rest }) => {
    const fenced = typeof className === 'string' && /language-/.test(className);
    return (
      <code
        {...rest}
        className={className}
        style={
          fenced
            ? {}
            : {
                backgroundColor: designTokens.colors.well,
                borderRadius: 4,
                padding: '1px 5px',
                color: designTokens.colors.codeText,
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.codeSize.md,
              }
        }
      >
        {children}
      </code>
    );
  },
  ul: (props) => (
    <ul
      {...props}
      style={{
        marginTop: 0,
        marginBottom: designTokens.spacing[3],
        paddingInlineStart: designTokens.spacing[4],
      }}
    />
  ),
  ol: (props) => (
    <ol
      {...props}
      style={{
        marginTop: 0,
        marginBottom: designTokens.spacing[3],
        paddingInlineStart: designTokens.spacing[4],
      }}
    />
  ),
  li: (props) => <li {...props} style={{ marginBottom: designTokens.spacing[1] }} />,
  strong: (props) => (
    <strong {...props} style={{ fontWeight: designTokens.typography.fontWeight.semibold, color: designTokens.colors.text }} />
  ),
  blockquote: (props) => (
    <blockquote
      {...props}
      style={{
        marginTop: 0,
        marginBottom: designTokens.spacing[3],
        paddingLeft: designTokens.spacing[3],
        borderLeftWidth: 3,
        borderLeftStyle: 'solid',
        borderLeftColor: designTokens.colors.primaryBorder,
        color: designTokens.colors.textMuted,
      }}
    />
  ),
  hr: (props) => (
    <hr
      {...props}
      style={{
        border: 'none',
        borderTopWidth: 1,
        borderTopStyle: 'solid',
        borderTopColor: designTokens.colors.border,
        margin: `${designTokens.spacing[3]} 0`,
      }}
    />
  ),
  // GFM tables scroll horizontally instead of breaking the layout.
  table: ({ children }) => (
    <div style={{ maxWidth: '100%', overflowX: 'auto', marginBottom: designTokens.spacing[3] }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>{children}</table>
    </div>
  ),
  th: (props) => (
    <th
      {...props}
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        backgroundColor: designTokens.colors.well,
        padding: `${designTokens.spacing[1]} ${designTokens.spacing[2]}`,
        textAlign: 'left',
        color: designTokens.colors.text,
        fontSize: designTokens.typography.fontSize.sm,
        fontWeight: designTokens.typography.fontWeight.semibold,
      }}
    />
  ),
  td: (props) => (
    <td
      {...props}
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        padding: `${designTokens.spacing[1]} ${designTokens.spacing[2]}`,
        color: designTokens.colors.textSubtle,
        fontSize: designTokens.typography.fontSize.base,
      }}
    />
  ),
  // Never fetch remote images from LLM content — render the alt text instead
  // (avoids tracking pixels / IP leaks; still shows what the image meant).
  img: ({ alt }) => (
    <span style={{ color: designTokens.colors.textMuted, fontStyle: 'italic' }}>
      {alt ? `[图片: ${alt}]` : '[图片]'}
    </span>
  ),
  // GFM task-list checkboxes tint with the primary accent.
  input: (props) => <input {...props} style={{ accentColor: designTokens.colors.primary }} />,
};

function mdSmallHeading(Tag: 'h4' | 'h5' | 'h6') {
  return (props: ComponentProps<'h4'>) => (
    <Tag
      {...props}
      style={{
        ...mdHeadingBase,
        fontSize: designTokens.typography.fontSize.base,
        marginTop: designTokens.spacing[2],
        marginBottom: designTokens.spacing[1],
      }}
    />
  );
}
