import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import designTokens from '../design-tokens';
import Dashboard from './Dashboard';

vi.mock('../lib/api', () => ({
  fetchSessions: vi.fn(),
  createSession: vi.fn(),
  fetchConfig: vi.fn(),
  fetchFsTree: vi.fn(),
}));

import { createSession, fetchConfig, fetchFsTree, fetchSessions } from '../lib/api';

const fetchSessionsMock = vi.mocked(fetchSessions);
const createSessionMock = vi.mocked(createSession);
const fetchConfigMock = vi.mocked(fetchConfig);
const fetchFsTreeMock = vi.mocked(fetchFsTree);

const RUNNING = {
  id: 's_8f3a21',
  task: '重构认证模块，把 JWT 换成旋转刷新令牌',
  status: 'running' as const,
  maxRounds: 40,
  currentRound: 12,
  workspaceRoot: '/repo/orders',
  tokenCount: 128400,
  createdAt: '2026-08-02T08:00:00.000Z',
  updatedAt: '2026-08-02T08:06:41.000Z',
};

const COMPLETED = {
  id: 's_5a91cd',
  task: '修复购物车并发下的库存超卖',
  status: 'completed' as const,
  maxRounds: 31,
  currentRound: 31,
  workspaceRoot: '/repo/cart',
  tokenCount: 212900,
  createdAt: '2026-08-02T08:00:00.000Z',
  updatedAt: '2026-08-02T08:18:27.000Z',
};

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions/:id" element={<div>会话详情占位</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Dashboard', () => {
  beforeEach(() => {
    fetchSessionsMock.mockReset();
    createSessionMock.mockReset();
    fetchConfigMock.mockReset();
    fetchFsTreeMock.mockReset();
    fetchConfigMock.mockResolvedValue({}); // no agent.workspaceRoot by default
  });

  it('browses the workspace tree in the directory picker and fills 工作目录 (Task 23)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    const rootTree = {
      path: '/repo',
      name: 'repo',
      type: 'dir' as const,
      children: [
        { path: '/repo/src', name: 'src', type: 'dir' as const, children: [] },
        { path: '/repo/README.md', name: 'README.md', type: 'file' as const, size: 8 },
      ],
    };
    const srcTree = {
      path: '/repo/src',
      name: 'src',
      type: 'dir' as const,
      children: [{ path: '/repo/src/auth', name: 'auth', type: 'dir' as const, children: [] }],
    };
    fetchFsTreeMock.mockResolvedValueOnce(rootTree).mockResolvedValueOnce(srcTree);
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '浏览…' }));

    // Picker opens on the server default root (no path arg) and renders the tree.
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    expect(fetchFsTreeMock.mock.calls[0]).toEqual([]);
    expect(await within(picker).findByText('src')).toBeInTheDocument();
    expect(within(picker).getByText('README.md')).toBeInTheDocument();

    // Expanding a directory lazily fetches its children.
    await userEvent.click(within(picker).getByRole('button', { name: '展开 src' }));
    expect(fetchFsTreeMock).toHaveBeenCalledWith('/repo/src');
    expect(await within(picker).findByText('auth')).toBeInTheDocument();

    // Selecting a directory fills the input and closes the picker.
    await userEvent.click(within(picker).getByText('src'));
    expect(screen.getByLabelText('工作目录')).toHaveValue('/repo/src');
    expect(screen.queryByRole('dialog', { name: '选择工作目录' })).not.toBeInTheDocument();

    // Manual editing still works after picking.
    const rootInput = screen.getByLabelText('工作目录');
    await userEvent.clear(rootInput);
    await userEvent.type(rootInput, '/repo/manual');
    expect(rootInput).toHaveValue('/repo/manual');
  });

  it('renders the session list with id, task, badge, rounds, duration and tokens', async () => {
    fetchSessionsMock.mockResolvedValue([RUNNING, COMPLETED]);
    renderDashboard();

    expect(await screen.findByText('s_8f3a21')).toBeInTheDocument();
    expect(screen.getByText('重构认证模块，把 JWT 换成旋转刷新令牌')).toBeInTheDocument();
    // Badge rows are scoped to the table — the filter tabs carry the same words.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('运行中')).toBeInTheDocument();
    expect(table.getByText('12/40')).toBeInTheDocument();
    expect(table.getByText('06:41')).toBeInTheDocument();
    expect(table.getByText('128.4K')).toBeInTheDocument();

    expect(table.getByText('已完成')).toBeInTheDocument();
    expect(table.getByText('31/31')).toBeInTheDocument();
  });

  it('colors status badges from the design tokens', async () => {
    fetchSessionsMock.mockResolvedValue([RUNNING, COMPLETED]);
    renderDashboard();

    const table = within(await screen.findByRole('table'));
    const running = await table.findByText('运行中');
    expect(running).toHaveStyle({ color: designTokens.colors.statusRunning });
    expect(table.getByText('已完成')).toHaveStyle({ color: designTokens.colors.statusCompleted });
  });

  it('shows an empty-state guide when there are no sessions', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText(/还没有会话/)).toBeInTheDocument();
    // The empty-state card and the page head both offer a 新建会话 button.
    expect(screen.getAllByRole('button', { name: '新建会话' }).length).toBeGreaterThanOrEqual(1);
  });

  it('shows an error state with a backend hint when the API is unreachable, and retries', async () => {
    fetchSessionsMock.mockRejectedValueOnce(new Error('fetch failed'));
    renderDashboard();

    expect(await screen.findByText(/无法连接后端服务/)).toBeInTheDocument();
    expect(screen.getByText(/启动 CodeHarness WebUI 服务/)).toBeInTheDocument();

    fetchSessionsMock.mockResolvedValueOnce([RUNNING]);
    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('s_8f3a21')).toBeInTheDocument();
  });

  it('creates a session from the modal with a custom cap and navigates to its detail placeholder', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    createSessionMock.mockResolvedValue({ ...RUNNING, id: 's_new_1', maxRounds: 40 });
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('任务描述'), '实现支付回调幂等');
    await userEvent.click(within(dialog).getByLabelText('限制最大轮次（不勾选则无上限）'));
    const rounds = within(dialog).getByLabelText('最大轮次');
    await userEvent.clear(rounds);
    await userEvent.type(rounds, '40');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并启动' }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith('实现支付回调幂等', 40, undefined);
    });
    expect(await screen.findByText('会话详情占位')).toBeInTheDocument();
  });

  it('defaults to unlimited rounds (0) when 限制轮次 is not checked', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    createSessionMock.mockResolvedValue({ ...RUNNING, id: 's_new_2' });
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('任务描述'), '无上限任务');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并启动' }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith('无上限任务', 0, undefined);
    });
  });

  it('prefills 工作目录 from the config workspaceRoot and submits the edited value (Task 19)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    fetchConfigMock.mockResolvedValue({ agent: { workspaceRoot: '/repo/current' } });
    createSessionMock.mockResolvedValue({ ...RUNNING, id: 's_new_3' });
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    const dialog = await screen.findByRole('dialog');
    const rootInput = within(dialog).getByLabelText('工作目录');
    await waitFor(() => {
      expect(rootInput).toHaveValue('/repo/current');
    });

    await userEvent.clear(rootInput);
    await userEvent.type(rootInput, '/repo/other');
    await userEvent.type(within(dialog).getByLabelText('任务描述'), '在新目录里干活');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建并启动' }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith('在新目录里干活', 0, '/repo/other');
    });
  });

  it('does not submit an empty task from the modal', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    await screen.findByRole('dialog');
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
