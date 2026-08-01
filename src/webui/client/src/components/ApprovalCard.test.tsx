import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalCard, { type ApprovalCardProps } from './ApprovalCard';
import designTokens from '../design-tokens';

function props(overrides: Partial<ApprovalCardProps> = {}): ApprovalCardProps {
  return {
    command: 'npm run migrate:prod -- --drop-legacy-jwt-table',
    rule: 'prod-mutation',
    status: 'pending',
    onApprove: vi.fn(),
    onModify: vi.fn(),
    onDeny: vi.fn(),
    ...overrides,
  };
}

describe('ApprovalCard', () => {
  it('renders the pending command (mono) and the guardrail rule', () => {
    render(<ApprovalCard {...props()} />);

    expect(screen.getByText('需要人工审批 · HITL')).toBeInTheDocument();
    expect(screen.getByText('npm run migrate:prod -- --drop-legacy-jwt-table')).toBeInTheDocument();
    expect(screen.getByText('prod-mutation')).toBeInTheDocument();
    expect(screen.getByText('批准')).toBeInTheDocument();
    expect(screen.getByText('编辑')).toBeInTheDocument();
    expect(screen.getByText('拒绝')).toBeInTheDocument();
  });

  it('colors the warn surface from the design tokens', () => {
    render(<ApprovalCard {...props()} />);
    expect(screen.getByText('需要人工审批 · HITL')).toHaveStyle({ color: designTokens.colors.warning });
  });

  it('approve calls onApprove', async () => {
    const onApprove = vi.fn();
    render(<ApprovalCard {...props({ onApprove })} />);
    await userEvent.click(screen.getByRole('button', { name: '批准' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('deny calls onDeny', async () => {
    const onDeny = vi.fn();
    render(<ApprovalCard {...props({ onDeny })} />);
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('edit expands an inline editor pre-filled with the command and submits the modified command', async () => {
    const onModify = vi.fn();
    render(<ApprovalCard {...props({ onModify })} />);

    await userEvent.click(screen.getByRole('button', { name: '编辑' }));
    const editor = screen.getByLabelText('修改后的命令');
    expect(editor).toHaveValue('npm run migrate:prod -- --drop-legacy-jwt-table');

    await userEvent.clear(editor);
    await userEvent.type(editor, 'npm run migrate:prod -- --dry-run');
    await userEvent.click(screen.getByRole('button', { name: '提交修改' }));

    expect(onModify).toHaveBeenCalledWith('npm run migrate:prod -- --dry-run');
  });

  it('cannot submit a blank modified command', async () => {
    render(<ApprovalCard {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: '编辑' }));
    const editor = screen.getByLabelText('修改后的命令');
    await userEvent.clear(editor);
    expect(screen.getByRole('button', { name: '提交修改' })).toBeDisabled();
  });

  it('hides the action buttons and shows the decision once resolved', () => {
    render(<ApprovalCard {...props({ status: 'approved' })} />);
    expect(screen.getByText(/已批准/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '拒绝' })).not.toBeInTheDocument();
  });

  it('shows the modified command for a modify decision', () => {
    render(<ApprovalCard {...props({ status: 'modified', command: 'npm run migrate:prod -- --dry-run' })} />);
    expect(screen.getByText(/已修改/)).toBeInTheDocument();
    expect(screen.getByText('npm run migrate:prod -- --dry-run')).toBeInTheDocument();
  });

  it('disables the action buttons while a resolution request is in flight', () => {
    render(<ApprovalCard {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: '批准' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled();
  });

  it('shows a resolution error from the backend (e.g. 409)', () => {
    render(<ApprovalCard {...props({ error: 'Cannot approve in state resolved' })} />);
    expect(screen.getByText('Cannot approve in state resolved')).toBeInTheDocument();
  });
});
