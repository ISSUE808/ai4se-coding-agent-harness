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
  fetchMachineRoots: vi.fn(),
  fetchFsBrowse: vi.fn(),
  deleteSession: vi.fn(),
}));

import {
  createSession,
  deleteSession,
  fetchConfig,
  fetchFsBrowse,
  fetchMachineRoots,
  fetchSessions,
} from '../lib/api';

const fetchSessionsMock = vi.mocked(fetchSessions);
const createSessionMock = vi.mocked(createSession);
const fetchConfigMock = vi.mocked(fetchConfig);
const fetchMachineRootsMock = vi.mocked(fetchMachineRoots);
const fetchFsBrowseMock = vi.mocked(fetchFsBrowse);
const deleteSessionMock = vi.mocked(deleteSession);

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

/** Machine root + listings served by the browse endpoints when the picker opens. */
const MACHINE_ROOTS = ['/repo'];

const REPO_LISTING = {
  path: '/repo',
  parent: '/',
  entries: [
    { path: '/repo/src', name: 'src', type: 'dir' as const },
    { path: '/repo/README.md', name: 'README.md', type: 'file' as const, size: 8 },
  ],
};

const SRC_LISTING = {
  path: '/repo/src',
  parent: '/repo',
  entries: [{ path: '/repo/src/auth', name: 'auth', type: 'dir' as const }],
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
    fetchMachineRootsMock.mockReset();
    fetchFsBrowseMock.mockReset();
    fetchConfigMock.mockResolvedValue({}); // no agent.workspaceRoot by default
  });

  it('browses the whole machine in the directory picker and fills 工作目录 (browse)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    fetchMachineRootsMock.mockResolvedValue(MACHINE_ROOTS);
    fetchFsBrowseMock.mockResolvedValueOnce(REPO_LISTING).mockResolvedValueOnce(SRC_LISTING);
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '浏览…' }));

    // Picker opens on the machine roots (no path arg) and shows the drive.
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    expect(fetchMachineRootsMock).toHaveBeenCalledTimes(1);
    expect(await within(picker).findByRole('button', { name: '选择 /repo' })).toBeInTheDocument();

    // Expanding a directory lazily browses its entries.
    await userEvent.click(within(picker).getByRole('button', { name: '展开 /repo' }));
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('/repo');
    expect(await within(picker).findByText('src')).toBeInTheDocument();
    expect(within(picker).getByText('README.md')).toBeInTheDocument();

    // Expanding the nested directory fetches one more level.
    await userEvent.click(within(picker).getByRole('button', { name: '展开 src' }));
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('/repo/src');
    expect(await within(picker).findByText('auth')).toBeInTheDocument();

    // Selecting a directory fills the input and closes the picker.
    await userEvent.click(within(picker).getByRole('button', { name: '选择 src' }));
    expect(screen.getByLabelText('工作目录')).toHaveValue('/repo/src');
    expect(screen.queryByRole('dialog', { name: '选择工作目录' })).not.toBeInTheDocument();

    // Manual editing still works after picking.
    const rootInput = screen.getByLabelText('工作目录');
    await userEvent.clear(rootInput);
    await userEvent.type(rootInput, '/repo/manual');
    expect(rootInput).toHaveValue('/repo/manual');
  });

  it('closes the directory picker with Escape (M8)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    fetchMachineRootsMock.mockResolvedValue(MACHINE_ROOTS);
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getAllByRole('button', { name: '新建会话' })[0]);
    await screen.findByRole('dialog');
    await userEvent.click(screen.getByRole('button', { name: '浏览…' }));
    await screen.findByRole('dialog', { name: '选择工作目录' });

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '选择工作目录' })).not.toBeInTheDocument();
    // The new-session modal itself stays open.
    expect(screen.getByRole('dialog', { name: '新建会话' })).toBeInTheDocument();
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

  it('deletes a completed session after a two-step confirm and refreshes the list (KNOWN_ISSUES 9 + acceptance feedback)', async () => {
    fetchSessionsMock.mockResolvedValue([COMPLETED]);
    deleteSessionMock.mockResolvedValue({ removed: true });
    renderDashboard();

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('删除 s_5a91cd'));
    // First click only arms the confirm — the API is untouched.
    expect(deleteSessionMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('确认删除 s_5a91cd')).toBeInTheDocument();
    await user.click(screen.getByLabelText('确认删除 s_5a91cd'));
    await waitFor(() => expect(deleteSessionMock).toHaveBeenCalledWith('s_5a91cd'));
    expect(fetchSessionsMock).toHaveBeenCalledTimes(2);
  });

  it('disables deletion for a running session (KNOWN_ISSUES 9)', async () => {
    fetchSessionsMock.mockResolvedValue([RUNNING]);
    renderDashboard();
    await screen.findByLabelText('删除 s_8f3a21');
    expect(screen.getByLabelText('删除 s_8f3a21')).toBeDisabled();
  });

  it('shows an inline error when row deletion fails (reviewer Important)', async () => {
    fetchSessionsMock.mockResolvedValue([COMPLETED]);
    deleteSessionMock.mockRejectedValue(new Error('Cannot delete a running session'));
    renderDashboard();

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('删除 s_5a91cd'));
    await user.click(screen.getByLabelText('确认删除 s_5a91cd'));
    expect(await screen.findByRole('alert')).toHaveTextContent('删除会话失败');
    // The list stays — no refresh was triggered by the failed delete.
    expect(fetchSessionsMock).toHaveBeenCalledTimes(1);
  });
});
