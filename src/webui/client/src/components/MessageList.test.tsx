import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MessageList, { shouldPauseAutoScroll } from './MessageList';
import type { SessionMessage } from '../lib/session-messages';
import designTokens from '../design-tokens';

function msg(partial: Partial<SessionMessage> & Pick<SessionMessage, 'id'>): SessionMessage {
  return {
    role: 'assistant',
    content: 'hello',
    timestamp: '2026-08-02T14:23:07.000Z',
    ...partial,
  };
}

describe('shouldPauseAutoScroll', () => {
  it('pauses auto-scroll only when the user has scrolled up past the edge', () => {
    expect(shouldPauseAutoScroll(0, 300, 1000)).toBe(true); // far from bottom
    expect(shouldPauseAutoScroll(600, 300, 1000)).toBe(true); // far from bottom
    expect(shouldPauseAutoScroll(700, 300, 1000)).toBe(false); // at bottom
  });
});

describe('MessageList', () => {
  it('renders user and assistant text messages with role labels in order', () => {
    render(
      <MessageList
        messages={[
          msg({ id: 'u1', role: 'user', content: '把认证改成刷新令牌' }),
          msg({ id: 'a1', role: 'assistant', content: '明白，先读现有实现。' }),
        ]}
      />,
    );

    expect(screen.getAllByText('你').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('助手')).toBeInTheDocument();
    expect(screen.getByText('把认证改成刷新令牌')).toBeInTheDocument();
    expect(screen.getByText('明白，先读现有实现。')).toBeInTheDocument();
    expect(screen.getAllByText('2026-08-02 14:23')).toHaveLength(2);
  });

  it('renders system messages as muted notes', () => {
    render(<MessageList messages={[msg({ id: 's1', role: 'system', content: '[HITL] Command approved: x' })]} />);
    expect(screen.getByText('[HITL] Command approved: x')).toBeInTheDocument();
  });

  it('renders a tool message collapsed by default, then expands to show params and result', async () => {
    const toolMessage = msg({
      id: 't1',
      role: 'tool',
      content: 'edited',
      metadata: {
        toolName: 'edit_file',
        toolInput: { path: 'src/auth/token.ts', edits: '…2 处…' },
        toolResult: { success: true, duration_ms: 800, filesChanged: ['src/auth/token.ts'], output: 'applied 2 edits · +84 −32' },
      },
    });
    render(<MessageList messages={[toolMessage]} />);

    expect(screen.getByText('edit_file')).toBeInTheDocument();
    expect(screen.getByText('✓ 完成 · 0.8s')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '展开工具调用 edit_file' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('applied 2 edits · +84 −32')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // The arg summary on the header row and the 参数 section both render the JSON.
    expect(screen.getAllByText('{"path":"src/auth/token.ts","edits":"…2 处…"}').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('applied 2 edits · +84 −32')).toBeInTheDocument();
  });

  it('marks a failed tool call with a danger border and shows its error when expanded', async () => {
    const failed = msg({
      id: 't2',
      role: 'tool',
      content: 'failed',
      metadata: {
        toolName: 'run_command',
        toolInput: { command: 'npm test -- auth' },
        toolResult: { success: false, duration_ms: 6400, error: '✕ refresh token rotates on use' },
      },
    });
    render(<MessageList messages={[failed]} />);

    expect(screen.getByText('✗ 失败 · 6.4s')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开工具调用 run_command' }));
    expect(screen.getByText('✕ refresh token rotates on use')).toBeInTheDocument();
    expect(screen.getByText('run_command').closest('[data-failed]')).toHaveStyle({
      borderColor: designTokens.colors.dangerBorder,
    });
  });

  it('shows a green feedback badge for passed feedback', () => {
    render(
      <MessageList
        messages={[
          msg({
            id: 'f1',
            role: 'feedback',
            content: 'auth 测试套件 · 5/5 通过',
            metadata: { feedbackResult: { passed: true, validator: 'auth 测试套件', evidence: '5/5' } },
          }),
        ]}
      />,
    );

    const badge = screen.getByText('反馈 · 通过');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle({ color: designTokens.colors.success });
    expect(screen.getByText('auth 测试套件')).toBeInTheDocument();
  });

  it('shows a red feedback badge with failure category and expandable evidence for failed feedback', async () => {
    render(
      <MessageList
        messages={[
          msg({
            id: 'f2',
            role: 'feedback',
            content: '未通过',
            metadata: {
              feedbackResult: {
                passed: false,
                validator: 'auth 测试套件',
                failureCategory: 'logic',
                evidence: 'AssertionError: expected token to rotate',
              },
            },
          }),
        ]}
      />,
    );

    const badge = screen.getByText('反馈 · 未通过');
    expect(badge).toHaveStyle({ color: designTokens.colors.danger });
    expect(screen.getByText('logic')).toBeInTheDocument();
    expect(screen.queryByText('AssertionError: expected token to rotate')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开证据' }));
    expect(screen.getByText('AssertionError: expected token to rotate')).toBeInTheDocument();
  });

  it('renders assistant markdown: heading, bold, inline code, fenced code block, list, table and link', () => {
    const md = [
      '# 修复认证刷新',
      '',
      '请把 `refresh_token` 轮换逻辑 **修好**，见 [spec](https://example.com/spec).',
      '',
      '```ts',
      'const t = await rotate(token);',
      '```',
      '',
      '- 步骤一',
      '- 步骤二',
      '',
      '| 列A | 列B |',
      '| --- | --- |',
      '| a1 | b1 |',
    ].join('\n');
    render(<MessageList messages={[msg({ id: 'a1', role: 'assistant', content: md })]} />);

    expect(screen.getByRole('heading', { level: 1, name: '修复认证刷新' })).toBeInTheDocument();
    // Inline code + bold render as real elements (not literal markdown text).
    expect(screen.getByText('refresh_token').tagName).toBe('CODE');
    expect(screen.getByText('修好').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'spec' })).toHaveAttribute('href', 'https://example.com/spec');
    // Fenced code block lives in a <pre>.
    expect(screen.getByText('const t = await rotate(token);').closest('pre')).not.toBeNull();
    // GFM list.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // GFM table with header row.
    expect(screen.getByRole('columnheader', { name: '列A' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'b1' })).toBeInTheDocument();
  });

  it('does not render raw HTML from assistant content (XSS-safe)', () => {
    render(
      <MessageList
        messages={[
          msg({
            id: 'a1',
            role: 'assistant',
            content:
              '安全文本\n\n<script>window.__xssPwned = 1</script>\n\n<img src="x" onerror="window.__xssPwned = 2" />\n\n![evil](https://example.com/pixel.png)\n\n**依然渲染**',
          }),
        ]}
      />,
    );

    // Raw HTML must never become elements nor execute.
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as { __xssPwned?: number }).__xssPwned).toBeUndefined();
    // The surrounding markdown still renders.
    expect(screen.getByText('安全文本')).toBeInTheDocument();
    expect(screen.getByText('依然渲染')).toBeInTheDocument();
  });

  it('keeps user messages as plain text (no markdown rendering)', () => {
    render(<MessageList messages={[msg({ id: 'u1', role: 'user', content: '请用 **加粗** 和 `code` 输出' })]} />);

    expect(screen.getByText('请用 **加粗** 和 `code` 输出')).toBeInTheDocument();
    expect(document.querySelector('strong')).toBeNull();
    expect(document.querySelector('code')).toBeNull();
  });

  it('styles markdown elements from design tokens (code well + link primary)', () => {
    render(
      <MessageList
        messages={[
          msg({ id: 'a1', role: 'assistant', content: '```js\nfoo()\n```\n\n看 [文档](https://example.com/doc) 与 `x`' }),
        ]}
      />,
    );

    const pre = screen.getByText('foo()').closest('pre');
    expect(pre).not.toBeNull();
    expect(pre).toHaveStyle({ backgroundColor: designTokens.colors.well });
    expect(pre).toHaveStyle({ borderColor: designTokens.colors.border });
    expect(screen.getByRole('link', { name: '文档' })).toHaveStyle({ color: designTokens.colors.primary });
    expect(screen.getByText('x')).toHaveStyle({ backgroundColor: designTokens.colors.well });
  });

  it('renders the approval card inline when an approval is pending', () => {
    render(
      <MessageList
        messages={[]}
        approval={{
          command: 'npm run migrate:prod',
          rule: 'prod-mutation',
          status: 'pending',
          onApprove: vi.fn(),
          onModify: vi.fn(),
          onDeny: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText('需要人工审批 · HITL')).toBeInTheDocument();
    expect(screen.getByLabelText('修改后的命令')).toHaveValue('npm run migrate:prod');
    expect(screen.getByRole('button', { name: '批准' })).toBeInTheDocument();
  });
});
