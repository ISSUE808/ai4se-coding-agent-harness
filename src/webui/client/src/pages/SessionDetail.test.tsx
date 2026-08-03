import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SessionDetail from './SessionDetail';
import type { SessionEventSource, SessionEventSourceHandlers } from '../lib/ws-source';
import type { SessionEventFrame } from '../lib/ws-state';
import type { SessionDetail as SessionDetailData } from '../lib/api';
import type { SessionMessage } from '../lib/session-messages';

vi.mock('../lib/api', () => ({
  fetchSession: vi.fn(),
  postMessage: vi.fn(),
  sessionControl: vi.fn(),
  resolveApproval: vi.fn(),
  // The mock must mirror the REAL config shape (src/types.ts Config): the
  // model lives at `llm.model`, never at the top level. A top-level `model`
  // here would silently hide the selector (4.1 real test regression).
  fetchConfig: vi.fn().mockResolvedValue({ llm: { model: 'deepseek-v4-pro' }, guardrails: { requireApproval: ['prod'], blockOutbound: true } }),
  fetchFsFile: vi.fn(),
  fetchFsTree: vi.fn(),
  fetchSessions: vi.fn(),
  fetchAvailableModels: vi.fn(),
  saveConfig: vi.fn(),
  updateSessionModel: vi.fn(),
}));

vi.mock('../lib/ws-source', () => ({
  createWebSocketEventSource: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; language?: string }) => (
    <textarea aria-label="diff-editor" readOnly value={props.value ?? ''} data-lang={props.language ?? ''} />
  ),
}));

import {
  fetchAvailableModels,
  fetchFsFile,
  fetchFsTree,
  fetchSession,
  fetchSessions,
  postMessage,
  resolveApproval,
  saveConfig,
  sessionControl,
  updateSessionModel,
} from '../lib/api';
import { createWebSocketEventSource } from '../lib/ws-source';

const fetchSessionMock = vi.mocked(fetchSession);
const postMessageMock = vi.mocked(postMessage);
const sessionControlMock = vi.mocked(sessionControl);
const resolveApprovalMock = vi.mocked(resolveApproval);
const fetchFsFileMock = vi.mocked(fetchFsFile);
const fetchFsTreeMock = vi.mocked(fetchFsTree);
const fetchSessionsMock = vi.mocked(fetchSessions);
const fetchAvailableModelsMock = vi.mocked(fetchAvailableModels);
const saveConfigMock = vi.mocked(saveConfig);
const updateSessionModelMock = vi.mocked(updateSessionModel);
const createSourceMock = vi.mocked(createWebSocketEventSource);

class FakeSource implements SessionEventSource {
  handlers: SessionEventSourceHandlers | null = null;
  connectCount = 0;

  connect(handlers: SessionEventSourceHandlers): () => void {
    this.connectCount += 1;
    this.handlers = handlers;
    return () => {
      this.handlers = null;
    };
  }

  emit(frame: SessionEventFrame): void {
    this.handlers?.onEvent(frame);
  }

  setConnected(connected: boolean): void {
    this.handlers?.onConnectionChange(connected);
  }
}

const SESSION: SessionDetailData = {
  id: 's_1',
  task: '重构认证模块，把 JWT 换成旋转刷新令牌',
  status: 'running' as const,
  maxRounds: 40,
  currentRound: 12,
  workspaceRoot: '/repo/auth-app',
  tokenCount: 128400,
  createdAt: '2026-08-02T07:57:00.000Z',
  updatedAt: '2026-08-02T08:06:41.000Z',
  messages: [
    { id: 'm1', role: 'user', content: '把认证模块改成刷新令牌', timestamp: '2026-08-02T07:59:55.000Z' },
    { id: 'm2', role: 'assistant', content: '明白，先读现有实现。', timestamp: '2026-08-02T08:00:05.000Z' },
    {
      id: 'm3',
      role: 'tool',
      content: 'edited',
      timestamp: '2026-08-02T08:01:00.000Z',
      metadata: {
        toolName: 'edit_file',
        toolInput: { path: 'src/auth/token.ts' },
        toolResult: { success: true, duration_ms: 800, filesChanged: ['src/auth/token.ts'], output: 'applied 2 edits · +84 −32' },
      },
    },
  ],
};

/** Tree WITHOUT src/auth/token.ts (as if the server depth/per-level caps
 *  truncated it) — for the I2 fallback-list test. */
const FS_TREE_SHALLOW = {
  path: '/repo/auth-app',
  name: 'auth-app',
  type: 'dir' as const,
  children: [
    { path: '/repo/auth-app/src', name: 'src', type: 'dir' as const, children: [] },
    { path: '/repo/auth-app/package.json', name: 'package.json', type: 'file' as const, size: 300 },
  ],
};

/** Workspace tree served by fetchFsTree for SESSION.workspaceRoot. */
const FS_TREE = {
  path: '/repo/auth-app',
  name: 'auth-app',
  type: 'dir' as const,
  children: [
    {
      path: '/repo/auth-app/src',
      name: 'src',
      type: 'dir' as const,
      children: [
        {
          path: '/repo/auth-app/src/auth',
          name: 'auth',
          type: 'dir' as const,
          children: [
            { path: '/repo/auth-app/src/auth/token.ts', name: 'token.ts', type: 'file' as const, size: 204 },
          ],
        },
        { path: '/repo/auth-app/src/index.ts', name: 'index.ts', type: 'file' as const, size: 60 },
      ],
    },
    { path: '/repo/auth-app/package.json', name: 'package.json', type: 'file' as const, size: 300 },
  ],
};

function renderDetail(session = SESSION) {
  fetchSessionMock.mockResolvedValue(session);
  return render(
    <MemoryRouter initialEntries={['/sessions/s_1']}>
      <Routes>
        <Route path="/" element={<div>回到会话列表</div>} />
        <Route path="/sessions/:id" element={<SessionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SessionDetail', () => {
  let source: FakeSource;

  beforeEach(() => {
    fetchSessionMock.mockReset();
    postMessageMock.mockReset();
    sessionControlMock.mockReset();
    resolveApprovalMock.mockReset();
    fetchFsFileMock.mockReset();
    fetchFsTreeMock.mockReset();
    // The left column always fetches the workspace tree; default to the
    // standard fixture so every test renders without stubbing.
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    // Selecting a file fetches its content from /api/fs/file (1.5).
    fetchFsFileMock.mockResolvedValue({
      path: '/repo/auth-app/src/auth/token.ts',
      name: 'token.ts',
      content: 'export const token = "rotating";\n',
      size: 33,
    });
    // Task 26: the model selector lists models used by other sessions;
    // default to the current session (no model) so recent models are empty.
    fetchSessionsMock.mockReset();
    fetchSessionsMock.mockResolvedValue([SESSION]);
    updateSessionModelMock.mockReset();
    updateSessionModelMock.mockResolvedValue(SESSION);
    // Provider model list: DEFAULT to failure so every existing test runs in
    // the fallback mode (default + recent + custom input). Tests that exercise
    // the list mode mock it resolved explicitly.
    fetchAvailableModelsMock.mockReset();
    fetchAvailableModelsMock.mockRejectedValue(new Error('未配置 API key'));
    saveConfigMock.mockReset();
    saveConfigMock.mockResolvedValue({ llm: { model: 'deepseek-v4-pro' } });
    createSourceMock.mockReset();
    createSourceMock.mockImplementation(() => {
      source = new FakeSource();
      return source;
    });
    sessionControlMock.mockImplementation(async (_id, action) => ({
      ...SESSION,
      status: action === 'pause' ? 'paused' : action === 'stop' ? 'completed' : 'running',
    }));
  });

  it('renders the three-column layout with header, session title, badge and context stats', async () => {
    renderDetail();

    expect(await screen.findByText('重构认证模块，把 JWT 换成旋转刷新令牌')).toBeInTheDocument();
    expect(screen.getByText('s_1')).toBeInTheDocument();
    // Badge appears in the page header and the context column:
    expect(screen.getAllByText('运行中').length).toBeGreaterThanOrEqual(2);
    // 文件变更 appears in the left mini-tab and the 运行信息 section.
    expect(screen.getAllByText('文件变更').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('上下文')).toBeInTheDocument();

    // REST messages land via the hook's initial-merge effect — await them:
    expect(await screen.findByText('把认证模块改成刷新令牌')).toBeInTheDocument();
    // Big round number renders as two spans (current + "/ max"):
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('/ 40')).toBeInTheDocument();
    expect(screen.getByText('128.4K')).toBeInTheDocument();
    expect(screen.getByText('2026-08-02 07:57')).toBeInTheDocument();
    // 已运行 is derived from createdAt→updatedAt (07:57→08:06:41 = 09:41), replacing the old 更新于 row:
    expect(screen.getByText('09:41')).toBeInTheDocument();
  });

  it('shows the session workspaceRoot (项目路径) in the context column (Task 19)', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');
    expect(screen.getByText('项目路径')).toBeInTheDocument();
    expect(screen.getByText('/repo/auth-app')).toBeInTheDocument();
  });

  it('renders the workspace file tree, marks changed files and opens the diff preview (Task 23)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();

    // The tree is fetched for the session workspaceRoot; the root is
    // auto-expanded so the first level is visible immediately.
    await waitFor(() => {
      expect(fetchFsTreeMock).toHaveBeenCalledWith('/repo/auth-app');
    });
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();

    // Expanding directories reveals deeper levels.
    await userEvent.click(screen.getByRole('button', { name: '展开 src' }));
    expect(await screen.findByText('auth')).toBeInTheDocument();
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '展开 auth' }));
    const changed = await screen.findByText('token.ts');
    expect(changed).toBeInTheDocument();

    // The touched file carries the A mark + line counts; only one mark exists.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('+84')).toBeInTheDocument();
    expect(screen.getByText('−32')).toBeInTheDocument();

    // Selecting the file fetches its CURRENT content (1.5) into the preview.
    await userEvent.click(changed);
    expect(await screen.findByLabelText('diff-editor')).toHaveValue('export const token = "rotating";\n');
    expect(fetchFsFileMock).toHaveBeenCalledWith('/repo/auth-app/src/auth/token.ts');
  });

  it('shows a content-preview error when the file fetch fails (1.5)', async () => {
    fetchFsFileMock.mockRejectedValue(new Error('path is outside the allowed workspace roots'));
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: '展开 src' }));
    await userEvent.click(await screen.findByRole('button', { name: '展开 auth' }));
    await userEvent.click(await screen.findByText('token.ts'));

    expect(await screen.findByText('无法读取文件内容')).toBeInTheDocument();
    expect(screen.getByText(/outside the allowed workspace roots/)).toBeInTheDocument();
    expect(screen.queryByLabelText('diff-editor')).not.toBeInTheDocument();
  });

  it('lists changed files missing from the fetched tree in a fallback list (I2)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE_SHALLOW);
    renderDetail();

    // token.ts is not in the tree payload — it appears in the fallback list
    // with its A mark and stays selectable for the diff preview.
    const fallback = await screen.findByText('变更文件（未显示在树中）');
    expect(fallback).toBeInTheDocument();
    const item = await screen.findByText('src/auth/token.ts');
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('+84')).toBeInTheDocument();
    expect(screen.getByText('−32')).toBeInTheDocument();

    await userEvent.click(item);
    expect(await screen.findByLabelText('diff-editor')).toHaveValue('export const token = "rotating";\n');
    expect(fetchFsFileMock).toHaveBeenCalledWith('/repo/auth-app/src/auth/token.ts');
  });

  it('shows no fallback list when every changed file is in the fetched tree', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();
    expect(await screen.findByText('src')).toBeInTheDocument();
    expect(screen.queryByText('变更文件（未显示在树中）')).not.toBeInTheDocument();
  });

  it('does not refetch the file tree when only the session status changes (M5)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();
    await waitFor(() => {
      expect(fetchFsTreeMock).toHaveBeenCalledTimes(1);
    });

    // Pause rebuilds the session object (same workspaceRoot) — the tree
    // effect must not refetch on that.
    await userEvent.click(screen.getByRole('button', { name: '暂停' }));
    act(() => source.emit({ type: 'session:status', data: { sessionId: 's_1', status: 'paused' } }));
    await screen.findByRole('button', { name: '恢复' });
    expect(fetchFsTreeMock).toHaveBeenCalledTimes(1);
  });

  it('refetches the file tree when a tool message with changed files arrives (new files appear live, 1.4)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();
    await waitFor(() => {
      expect(fetchFsTreeMock).toHaveBeenCalledTimes(1);
    });

    // A new tool message that changed files lands over the WS stream (the
    // 1.4 scenario: `运行命令：echo x > notes.md` creates a file the tree
    // snapshot does not know yet).
    act(() =>
      source.emit({
        type: 'message:added',
        data: {
          sessionId: 's_1',
          id: 'm4',
          role: 'tool',
          content: 'created notes.md',
          timestamp: '2026-08-02T08:07:00.000Z',
          metadata: {
            toolName: 'run_command',
            toolInput: { command: 'echo x > notes.md' },
            toolResult: { success: true, duration_ms: 10, filesChanged: ['notes.md'] },
          },
        },
      }),
    );

    // The debounced refetch lands shortly after.
    await waitFor(() => {
      expect(fetchFsTreeMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchFsTreeMock).toHaveBeenLastCalledWith('/repo/auth-app');
  });

  it('does not refetch the tree for messages that changed no files (1.4: only file changes trigger)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();
    await waitFor(() => {
      expect(fetchFsTreeMock).toHaveBeenCalledTimes(1);
    });

    act(() =>
      source.emit({
        type: 'message:added',
        data: { sessionId: 's_1', id: 'm4', role: 'user', content: '继续', timestamp: '2026-08-02T08:07:00.000Z' },
      }),
    );
    // Longer than the refresh debounce — still exactly the initial fetch.
    await new Promise((r) => setTimeout(r, 350));
    expect(fetchFsTreeMock).toHaveBeenCalledTimes(1);
  });

  it('collapses expanded directories in the file tree (Task 23)', async () => {
    fetchFsTreeMock.mockResolvedValue(FS_TREE);
    renderDetail();
    expect(await screen.findByText('src')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '展开 src' }));
    expect(await screen.findByText('auth')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '折叠 src' }));
    expect(screen.queryByText('auth')).not.toBeInTheDocument();
    expect(screen.getByText('package.json')).toBeInTheDocument();
  });

  it('sends a composer message, appends it locally and dedupes the WS broadcast', async () => {
    const stored: SessionMessage = { id: 'm4', role: 'user', content: '再跑一次测试', timestamp: '2026-08-02T08:07:00.000Z' };
    postMessageMock.mockResolvedValue(stored);
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    const input = screen.getByLabelText('消息输入');
    await userEvent.type(input, '再跑一次测试');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(postMessageMock).toHaveBeenCalledWith('s_1', '再跑一次测试');
    });

    // Local append from the POST response:
    expect(await screen.findByText('再跑一次测试')).toBeInTheDocument();
    expect(screen.getAllByText('再跑一次测试')).toHaveLength(1);

    // Server broadcasts the same message back over WS — id dedupe keeps one:
    act(() =>
      source.emit({
        type: 'message:added',
        data: { id: 'm4', role: 'user', content: '再跑一次测试', timestamp: '2026-08-02T08:07:00.000Z' },
      }),
    );
    expect(screen.getAllByText('再跑一次测试')).toHaveLength(1);
  });

  it('toggles pause/resume and stops only after an explicit confirmation', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(sessionControlMock).toHaveBeenCalledWith('s_1', 'pause');

    act(() => source.emit({ type: 'session:status', data: { sessionId: 's_1', status: 'paused' } }));
    expect(await screen.findByRole('button', { name: '恢复' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(sessionControlMock).not.toHaveBeenCalledWith('s_1', 'stop');
    await userEvent.click(screen.getByRole('button', { name: '确认停止' }));
    expect(sessionControlMock).toHaveBeenCalledWith('s_1', 'stop');
  });

  it('disables stop for a completed session', async () => {
    renderDetail({ ...SESSION, status: 'completed' });
    await screen.findAllByText('已完成');
    expect(screen.getByRole('button', { name: '停止' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '暂停' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '恢复' })).not.toBeInTheDocument();
  });

  it('updates status and rounds live over WS', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');
    expect(screen.getByText('12')).toBeInTheDocument();

    act(() => source.emit({ type: 'round:changed', data: { currentRound: 13, maxRounds: 40 } }));
    expect(screen.getByText('13')).toBeInTheDocument();

    act(() => source.emit({ type: 'session:status', data: { sessionId: 's_1', status: 'failed' } }));
    expect((await screen.findAllByText('失败')).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the HITL approval card on a warn guardrail trigger, approves it, and shows the resolved state', async () => {
    resolveApprovalMock.mockResolvedValue({ sessionId: 's_1', decision: 'approve' });
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    act(() =>
      source.emit({
        type: 'guardrail:triggered',
        data: { rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn' },
      }),
    );

    expect(await screen.findByText('需要人工审批 · HITL')).toBeInTheDocument();
    expect(screen.getByLabelText('修改后的命令')).toHaveValue('npm run migrate:prod');

    await userEvent.click(screen.getByRole('button', { name: '批准' }));
    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith('s_1', 'approve');
    });
    expect(await screen.findByText(/已批准/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准' })).not.toBeInTheDocument();
  });

  it('submits a modified command through the inline editor', async () => {
    resolveApprovalMock.mockResolvedValue({ sessionId: 's_1', decision: 'modify' });
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    act(() =>
      source.emit({
        type: 'guardrail:triggered',
        data: { rule: 'prod-mutation', command: 'npm run migrate:prod', level: 'warn' },
      }),
    );
    await screen.findByText('需要人工审批 · HITL');

    await userEvent.click(screen.getByRole('button', { name: '编辑后提交' }));
    const editor = screen.getByLabelText('修改后的命令');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'npm run migrate:prod -- --dry-run');
    await userEvent.click(screen.getByRole('button', { name: '提交修改' }));

    await waitFor(() => {
      expect(resolveApprovalMock).toHaveBeenCalledWith('s_1', 'modify', 'npm run migrate:prod -- --dry-run');
    });
    expect(await screen.findByText(/已修改/)).toBeInTheDocument();
  });

  it('shows the WS connection state and reconnects on demand', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');
    expect(source.connectCount).toBe(1);

    // Socket not open yet — the UI shows a retry affordance:
    expect(screen.getByText(/已断开/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重连' }));
    expect(source.connectCount).toBe(2);

    act(() => source.setConnected(true));
    // The disconnect banner (and its retry button) disappears once connected —
    // the connected state itself lives in the top-bar env pill (App level).
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '重连' })).not.toBeInTheDocument();
    });

    // Live event after reconnect:
    act(() => source.emit({ type: 'session:status', data: { sessionId: 's_1', status: 'paused' } }));
    expect((await screen.findAllByText('已暂停')).length).toBeGreaterThanOrEqual(1);
  });

  it('navigates back to the dashboard', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.click(screen.getByRole('link', { name: /返回/ }));
    expect(screen.getByText('回到会话列表')).toBeInTheDocument();
  });

  it('shows the default model from config in the model selector (Task 26)', async () => {
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    const select = screen.getByLabelText('选择模型');
    expect(select).toHaveValue('deepseek-v4-pro');
    expect(screen.getByText('默认模型 · deepseek-v4-pro')).toBeInTheDocument();
  });

  it('shows the session-level model when the session overrides the default (Task 26)', async () => {
    renderDetail({ ...SESSION, model: 'deepseek-r1' });
    await screen.findByText('把认证模块改成刷新令牌');

    const select = screen.getByLabelText('选择模型');
    expect(select).toHaveValue('deepseek-r1');
    // The label row distinguishes a session-level override from the default.
    expect(screen.getByText('会话模型')).toBeInTheDocument();
    expect(screen.getAllByText('deepseek-r1').length).toBeGreaterThanOrEqual(1);
  });

  it('lists models used by other sessions in the dropdown, deduplicated (Task 26)', async () => {
    fetchSessionsMock.mockResolvedValue([
      { ...SESSION, id: 's_old', model: 'deepseek-v3' },
      { ...SESSION, id: 's_older', model: 'deepseek-v3' },
      { ...SESSION, id: 's_plain' },
    ]);
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    expect(screen.getByRole('option', { name: 'deepseek-v3' })).toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'deepseek-v3' })).toHaveLength(1);
  });

  it('switching the model PATCHes the session and updates the displayed model (Task 26)', async () => {
    updateSessionModelMock.mockResolvedValue({ ...SESSION, model: 'deepseek-v3' });
    fetchSessionsMock.mockResolvedValue([{ ...SESSION, id: 's_old', model: 'deepseek-v3' }]);
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.selectOptions(screen.getByLabelText('选择模型'), 'deepseek-v3');
    await waitFor(() => {
      expect(updateSessionModelMock).toHaveBeenCalledWith('s_1', 'deepseek-v3');
    });
    // The selector now shows the switched model.
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-v3');
    });
  });

  it('selecting the default model clears the override (back to config, Task 26)', async () => {
    updateSessionModelMock.mockResolvedValue({ ...SESSION, model: undefined as unknown as string });
    fetchSessionsMock.mockResolvedValue([]);
    renderDetail({ ...SESSION, model: 'deepseek-r1' });
    await screen.findByText('把认证模块改成刷新令牌');
    expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-r1');

    await userEvent.selectOptions(screen.getByLabelText('选择模型'), 'deepseek-v4-pro');
    await waitFor(() => {
      expect(updateSessionModelMock).toHaveBeenCalledWith('s_1', '');
    });
    // Falls back to the config default.
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-v4-pro');
    });
  });

  it('supports entering a custom model via the input (Task 26)', async () => {
    updateSessionModelMock.mockResolvedValue({ ...SESSION, model: 'my-custom-llm' });
    fetchSessionsMock.mockResolvedValue([]);
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.selectOptions(screen.getByLabelText('选择模型'), '__custom__');
    const input = screen.getByLabelText('自定义模型输入');
    await userEvent.type(input, 'my-custom-llm');
    await userEvent.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() => {
      expect(updateSessionModelMock).toHaveBeenCalledWith('s_1', 'my-custom-llm');
    });
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('my-custom-llm');
    });
  });

  it('updates the model live from the session:updated WS frame (Task 26)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    act(() =>
      source.emit({
        type: 'session:updated',
        data: { sessionId: 's_1', model: 'deepseek-r1', updatedAt: '2026-08-03T00:00:00.000Z' },
      }),
    );
    expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-r1');
  });

  it('keeps a switched model in the dropdown after returning to default (review M4)', async () => {
    fetchSessionsMock.mockResolvedValue([]);
    updateSessionModelMock
      .mockResolvedValueOnce({ ...SESSION, model: 'my-custom-llm' })
      .mockResolvedValueOnce({ ...SESSION, model: undefined as unknown as string });
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    // Apply a custom model.
    await userEvent.selectOptions(screen.getByLabelText('选择模型'), '__custom__');
    await userEvent.type(screen.getByLabelText('自定义模型输入'), 'my-custom-llm');
    await userEvent.click(screen.getByRole('button', { name: '应用' }));
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('my-custom-llm');
    });

    // Switch back to the config default (clears the override).
    await userEvent.selectOptions(screen.getByLabelText('选择模型'), 'deepseek-v4-pro');
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-v4-pro');
    });

    // The custom model must remain selectable — it was folded into the
    // "recently used" list instead of disappearing with the override.
    expect(screen.getByRole('option', { name: 'my-custom-llm' })).toBeInTheDocument();
  });

  it('lists the provider models in the selector when the list loads (Task 26 follow-up)', async () => {
    fetchAvailableModelsMock.mockResolvedValue({
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    // List mode: provider models are options, the free-text custom entry is gone.
    expect(screen.getByRole('option', { name: 'deepseek-chat' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'deepseek-reasoner' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '自定义模型…' })).not.toBeInTheDocument();
  });

  it('selecting a listed model PATCHes the session AND updates the global default config', async () => {
    fetchAvailableModelsMock.mockResolvedValue({
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });
    updateSessionModelMock.mockResolvedValue({ ...SESSION, model: 'deepseek-chat' });
    saveConfigMock.mockResolvedValue({ llm: { model: 'deepseek-chat' } });
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.selectOptions(screen.getByLabelText('选择模型'), 'deepseek-chat');
    await waitFor(() => {
      expect(updateSessionModelMock).toHaveBeenCalledWith('s_1', 'deepseek-chat');
    });
    // The global default follows so the NEXT session uses the same model.
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({ llm: { model: 'deepseek-chat' } });
    });
  });

  it('shows a fallback hint when the model list fails and keeps the custom entry', async () => {
    fetchAvailableModelsMock.mockRejectedValue(new Error('未配置 deepseek 的 API key'));
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    expect(await screen.findByText(/模型列表加载失败/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '自定义模型…' })).toBeInTheDocument();
  });

  it('still switches the session model when the global config save fails, with a hint', async () => {
    fetchAvailableModelsMock.mockResolvedValue({
      models: ['deepseek-chat', 'deepseek-reasoner'],
    });
    updateSessionModelMock.mockResolvedValue({ ...SESSION, model: 'deepseek-chat' });
    saveConfigMock.mockRejectedValue(new Error('config write denied'));
    renderDetail();
    await screen.findByText('把认证模块改成刷新令牌');

    await userEvent.selectOptions(screen.getByLabelText('选择模型'), 'deepseek-chat');
    await waitFor(() => {
      expect(updateSessionModelMock).toHaveBeenCalledWith('s_1', 'deepseek-chat');
    });
    await waitFor(() => {
      expect(screen.getByLabelText('选择模型')).toHaveValue('deepseek-chat');
    });
    expect(await screen.findByText(/全局配置更新失败/)).toBeInTheDocument();
  });
});
