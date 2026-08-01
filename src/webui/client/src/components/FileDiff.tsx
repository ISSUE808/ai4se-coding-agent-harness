/**
 * FileDiff — Monaco diff viewer for the 文件变更 column (PLAN Task 18b).
 *
 * The backend has no diff endpoint, so the component shows the last tool
 * output that touched the selected file (or a placeholder) in a read-only
 * Monaco editor themed by design tokens.
 */
import Editor from '@monaco-editor/react';
import { FileCode2 } from 'lucide-react';
import designTokens from '../design-tokens';
import { MONACO_THEME, defineCodeHarnessTheme } from '../lib/monaco-theme';
import { languageForPath } from '../lib/session-messages';

export interface FileDiffProps {
  /** Selected file path (also the Monaco language hint). */
  path: string;
  /** Tool output for the file, or null to show the placeholder. */
  content: string | null;
  /** Optional explicit Monaco language override. */
  language?: string;
}

export default function FileDiff({ path, content, language }: FileDiffProps) {
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
          预览 diff
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
          <p style={{ margin: 0 }}>无 diff 内容</p>
          <p style={{ margin: `${designTokens.spacing[1]} 0 0`, fontSize: designTokens.typography.fontSize.sm }}>
            后端未提供 diff 端点，仅展示该文件的工具输出摘要。
          </p>
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
