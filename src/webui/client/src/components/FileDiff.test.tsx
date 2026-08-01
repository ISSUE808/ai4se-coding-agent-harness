import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileDiff from './FileDiff';

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; language?: string }) => (
    <textarea aria-label="diff-editor" readOnly value={props.value ?? ''} data-lang={props.language ?? ''} />
  ),
}));

describe('FileDiff', () => {
  it('renders the file content in a Monaco editor with the language derived from the path', () => {
    render(<FileDiff path="src/auth/token.ts" content={'+ const access = jwt.sign(payload, SECRET, { expiresIn: "15m" });\n'} />);

    expect(screen.getByText('src/auth/token.ts')).toBeInTheDocument();
    const editor = screen.getByLabelText('diff-editor');
    expect(editor).toHaveValue('+ const access = jwt.sign(payload, SECRET, { expiresIn: "15m" });\n');
    expect(editor).toHaveAttribute('data-lang', 'typescript');
  });

  it('shows a placeholder when there is no diff content (backend has no diff endpoint)', () => {
    render(<FileDiff path="src/auth/refresh.ts" content={null} />);
    expect(screen.getByText(/无 diff 内容/)).toBeInTheDocument();
    expect(screen.queryByLabelText('diff-editor')).not.toBeInTheDocument();
  });

  it('uses the explicit language override when provided', () => {
    render(<FileDiff path="Makefile" content="lint:" language="makefile" />);
    expect(screen.getByLabelText('diff-editor')).toHaveAttribute('data-lang', 'makefile');
  });
});
