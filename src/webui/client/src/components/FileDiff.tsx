/**
 * FileDiff — Monaco content preview for the 文件变更 column (PLAN Task 18b,
 * 1.5 real-test follow-up).
 *
 * The backend has no diff endpoint, so the pane shows the file's CURRENT
 * CONTENT (fetched by the caller from the workspace-bounded /api/fs/file) in
 * a read-only Monaco editor themed by design tokens. `content: null` means
 * the fetch is in flight; a non-null `error` shows the failure instead.
 */
import Editor from '@monaco-editor/react';
import { FileCode2 } from 'lucide-react';
import designTokens from '../design-tokens';
import { MONACO_THEME, defineCodeHarnessTheme } from '../lib/monaco-theme';
import { languageForPath } from '../lib/session-messages';

export interface FileDiffProps {
  /** Selected file path (also the Monaco language hint). */
  path: string;
  /** Fetched file content, or null while the fetch is in flight. */
  content: string | null;
  /** Content-fetch failure message; shown instead of the loading state. */
  error?: string | null;
  /** Optional explicit Monaco language override. */
  language?: string;
}

export default function FileDiff({ path, content, error, language }: FileDiffProps) {
  return (
    <section
      aria-label={`文件 diff：${path}`}
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        borderRadius: designTokens.radius.md,
        background: designTokens.colors.well,
        overflow: 'hidden',
        marginTop: designTokens.spacing[3],
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
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <FileCode2 size={13} style={{ color: designTokens.colors.textMuted }} />
        <span
          style={{
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.sm,
            color: designTokens.colors.textSubtle,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {path}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.fontSize.xs,
            color: designTokens.colors.textMuted,
          }}
        >
          文件内容预览
        </span>
      </div>

      {content === null ? (
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            padding: designTokens.spacing[8],
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.base,
            textAlign: 'center',
          }}
        >
          {error !== null && error !== undefined ? (
            <>
              <p style={{ margin: 0 }}>无法读取文件内容</p>
              <p style={{ margin: `${designTokens.spacing[1]} 0 0`, fontSize: designTokens.typography.fontSize.sm }}>
                {error}
              </p>
            </>
          ) : (
            <p style={{ margin: 0 }}>加载文件内容…</p>
          )}
        </div>
      ) : (
        <Editor
          height={260}
          language={language ?? languageForPath(path)}
          theme={MONACO_THEME}
          value={content}
          beforeMount={defineCodeHarnessTheme}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            fontSize: 12,
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
            lineNumbers: 'off',
            glyphMargin: false,
            folding: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
          }}
        />
      )}
    </section>
  );
}
