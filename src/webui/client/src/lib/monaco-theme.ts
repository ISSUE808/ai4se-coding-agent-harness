import type * as MonacoType from 'monaco-editor';
import designTokens from '../design-tokens';

/**
 * Monaco theme keyed off the design tokens (defined in the editor's
 * beforeMount, where the monaco instance is handed to us). Every color here
 * is a token reference — no literals.
 */
export const MONACO_THEME = 'codeharness-dark';

export function defineCodeHarnessTheme(monaco: typeof MonacoType): void {
  monaco.editor.defineTheme(MONACO_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': designTokens.colors.well,
      'editor.foreground': designTokens.colors.codeText,
      'editorLineNumber.foreground': designTokens.colors.textMuted,
      'editorLineNumber.activeForeground': designTokens.colors.textSubtle,
      'editorCursor.foreground': designTokens.colors.primary,
      'editor.selectionBackground': designTokens.colors.primarySoft,
      'editor.lineHighlightBackground': designTokens.colors.surfaceHover,
      'editorWidget.background': designTokens.colors.surface,
      'editorWidget.border': designTokens.colors.borderStrong,
    },
  });
}
