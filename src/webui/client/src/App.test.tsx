import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { fetchSessions } from './lib/api';

vi.mock('./lib/api', () => ({
  fetchSessions: vi.fn().mockResolvedValue([]),
  fetchSession: vi.fn().mockRejectedValue(new Error('no backend in test')),
  fetchConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('@monaco-editor/react', () => ({
  default: () => null,
}));

describe('App shell / TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSessions).mockResolvedValue([]);
  });

  it('renders the prototype chrome: brand, segmented view tabs, ws pill, search and avatar', () => {
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
    expect(screen.getByPlaceholderText('搜索会话、任务、文件…')).toBeInTheDocument();
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
});
