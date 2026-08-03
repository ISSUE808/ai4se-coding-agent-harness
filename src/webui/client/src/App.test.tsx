import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { fetchSession, fetchSessions, type SessionSummary } from './lib/api';

vi.mock('./lib/api', () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchSession: vi.fn().mockRejectedValue(new Error('no backend in test')),
  fetchConfig: vi.fn().mockResolvedValue({}),
  // Task 26 follow-up: SessionDetail loads the provider model list on mount.
  fetchAvailableModels: vi.fn().mockRejectedValue(new Error('no backend in test')),
  // SessionDetail also renders the workspace file tree / preview on mount.
  fetchFsTree: vi.fn().mockRejectedValue(new Error('no backend in test')),
  fetchFsFile: vi.fn().mockRejectedValue(new Error('no backend in test')),
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
}));

describe('App shell / TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSessions).mockResolvedValue([]);
    sessionStorage.clear();
  });

  it('renders the prototype chrome: brand, segmented view tabs and ws pill (search box removed)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('CodeHarness')).toBeInTheDocument();
    expect(screen.getByText('webui')).toBeInTheDocument();

    // Segmented view tabs with indicator dots:
    expect(screen.getByRole('link', { name: '视图：会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '视图：会话详情' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '视图：设置' })).toBeInTheDocument();

    // Global WS pill (jsdom has no WebSocket → disconnected state):
    expect(screen.getByText('ws · 已断开')).toBeInTheDocument();
    // The non-functional search box is gone from the top bar.
    expect(screen.queryByPlaceholderText('搜索会话、任务、文件…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('搜索')).not.toBeInTheDocument();
  });

  it('renders the top bar on a /sessions/:id route with the 会话详情 tab active', () => {
    render(
      <MemoryRouter initialEntries={['/sessions/s_1']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: '视图：会话详情' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '视图：设置' })).toBeInTheDocument();
  });

  it('jumps into the first session when the 会话详情 tab is clicked from the dashboard', async () => {
    vi.mocked(fetchSessions).mockResolvedValue([
      {
        id: 's_1',
        task: 't',
        status: 'running',
        maxRounds: 40,
        currentRound: 1,
        workspaceRoot: '/repo/app',
        tokenCount: 0,
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    ]);
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole('button', { name: '视图：会话详情' }));
    await screen.findByText('无法加载会话');
    expect(fetchSessions).toHaveBeenCalled();
  });

  it('returns to the LAST-viewed session when 会话详情 is re-clicked (real-test: always jumped to the first)', async () => {
    const sessions: SessionSummary[] = [
      {
        id: 's_1',
        task: 'first',
        status: 'completed',
        maxRounds: 0,
        currentRound: 1,
        workspaceRoot: '/repo',
        tokenCount: 0,
        createdAt: '2026-08-02T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
      {
        id: 's_2',
        task: 'second',
        status: 'running',
        maxRounds: 0,
        currentRound: 2,
        workspaceRoot: '/repo',
        tokenCount: 0,
        createdAt: '2026-08-02T00:00:01.000Z',
        updatedAt: '2026-08-02T00:00:01.000Z',
      },
    ];
    vi.mocked(fetchSessions).mockResolvedValue(sessions);
    const fetchSessionMock = vi.mocked(fetchSession);
    fetchSessionMock.mockImplementation(async (id) => ({
      id,
      task: id === 's_2' ? 'second' : 'first',
      status: 'running',
      maxRounds: 0,
      currentRound: 1,
      workspaceRoot: '/repo',
      tokenCount: 0,
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      messages: [],
    }));

    render(
      <MemoryRouter initialEntries={['/sessions/s_2']}>
        <App />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(fetchSessionMock).toHaveBeenCalledWith('s_2');
    });

    // Leave to the dashboard, then come back via the 会话详情 tab.
    await userEvent.click(screen.getByRole('link', { name: '视图：会话' }));
    await userEvent.click(screen.getByRole('button', { name: '视图：会话详情' }));

    // The second fetch must be s_2 again — the last-viewed session, not the
    // first session in the list (s_1).
    await waitFor(() => {
      const calls = fetchSessionMock.mock.calls.map((c) => c[0]);
      expect(calls).toEqual(['s_2', 's_2']);
    });
  });
});
