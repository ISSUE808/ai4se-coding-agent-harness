import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import designTokens from '../design-tokens';
import Dashboard from './Dashboard';

vi.mock('../lib/api', () => ({
  fetchSessions: vi.fn(),
  createSession: vi.fn(),
}));

import { createSession, fetchSessions } from '../lib/api';

const fetchSessionsMock = vi.mocked(fetchSessions);
const createSessionMock = vi.mocked(createSession);

const RUNNING = {
  id: 's_8f3a21',
  task: '重构认证模块，把 JWT 换成旋转刷新令牌',
  status: 'running' as const,
  maxRounds: 40,
  currentRound: 12,
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
  });

  it('renders the session list with id, task, badge, rounds, duration and tokens', async () => {
    fetchSessionsMock.mockResolvedValue([RUNNING, COMPLETED]);
    renderDashboard();

    expect(await screen.findByText('s_8f3a21')).toBeInTheDocument();
    expect(screen.getByText('重构认证模块，把 JWT 换成旋转刷新令牌')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();
    expect(screen.getByText('12/40')).toBeInTheDocument();
    expect(screen.getByText('06:41')).toBeInTheDocument();
    expect(screen.getByText('128.4K')).toBeInTheDocument();

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('31/31')).toBeInTheDocument();
  });

  it('colors status badges from the design tokens', async () => {
    fetchSessionsMock.mockResolvedValue([RUNNING, COMPLETED]);
    renderDashboard();

    const running = await screen.findByText('运行中');
    expect(running).toHaveStyle({ color: designTokens.colors.statusRunning });
    expect(screen.getByText('已完成')).toHaveStyle({ color: designTokens.colors.statusCompleted });
  });

  it('shows an empty-state guide when there are no sessions', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    renderDashboard();

    expect(await screen.findByText(/还没有会话/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建会话' })).toBeInTheDocument();
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

  it('creates a session from the modal and navigates to its detail placeholder', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    createSessionMock.mockResolvedValue({ ...RUNNING, id: 's_new_1', maxRounds: 40 });
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getByRole('button', { name: '新建会话' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('任务描述'), '实现支付回调幂等');
    const rounds = within(dialog).getByLabelText('最大轮次');
    await userEvent.clear(rounds);
    await userEvent.type(rounds, '40');
    await userEvent.click(within(dialog).getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(createSessionMock).toHaveBeenCalledWith('实现支付回调幂等', 40);
    });
    expect(await screen.findByText('会话详情占位')).toBeInTheDocument();
  });

  it('does not submit an empty task from the modal', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    renderDashboard();
    await screen.findByText(/还没有会话/);

    await userEvent.click(screen.getByRole('button', { name: '新建会话' }));
    await screen.findByRole('dialog');
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});
