import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';

vi.mock('../lib/api', () => ({
  fetchConfig: vi.fn(),
  fetchAvailableModels: vi.fn(),
  saveConfig: vi.fn(),
  getKeyStatus: vi.fn(),
  saveKey: vi.fn(),
  deleteKey: vi.fn(),
  fetchKeys: vi.fn(),
  clearSessions: vi.fn(),
}));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      aria-label="配置编辑器"
      value={props.value ?? ''}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

import {
  clearSessions,
  deleteKey,
  fetchAvailableModels,
  fetchConfig,
  fetchKeys,
  getKeyStatus,
  saveConfig,
  saveKey,
  type KeyProviderStatus,
} from '../lib/api';

const fetchConfigMock = vi.mocked(fetchConfig);
const fetchAvailableModelsMock = vi.mocked(fetchAvailableModels);
const saveConfigMock = vi.mocked(saveConfig);
const getKeyStatusMock = vi.mocked(getKeyStatus);
const saveKeyMock = vi.mocked(saveKey);
const deleteKeyMock = vi.mocked(deleteKey);
const fetchKeysMock = vi.mocked(fetchKeys);
const clearSessionsMock = vi.mocked(clearSessions);

function row(provider: string): HTMLElement {
  return screen.getByTestId(`key-row-${provider}`);
}

describe('Settings', () => {
  beforeEach(() => {
    fetchConfigMock.mockReset();
    fetchAvailableModelsMock.mockReset();
    saveConfigMock.mockReset();
    getKeyStatusMock.mockReset();
    saveKeyMock.mockReset();
    deleteKeyMock.mockReset();
    fetchKeysMock.mockReset();
    clearSessionsMock.mockReset();
    // Model list: default to empty so existing tests are unaffected; tests
    // that exercise the list mock it explicitly.
    fetchAvailableModelsMock.mockResolvedValue({ models: [] });
    getKeyStatusMock.mockImplementation(async (provider) => ({
      provider,
      status: provider === 'deepseek' ? '****-9f2c' : 'not set',
    }));
    fetchKeysMock.mockResolvedValue({
      providers: [
        {
          provider: 'deepseek',
          status: '****-9f2c',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          isActive: true,
        },
        { provider: 'openai', status: 'not set' },
        { provider: 'anthropic', status: 'not set' },
      ],
    });
    fetchConfigMock.mockResolvedValue({
      llm: { provider: 'deepseek', model: 'deepseek-chat', maxTokens: 4096, apiKeySource: 'keytar' },
      agent: { maxRounds: 3, contextThreshold: 0.8, workspaceRoot: '/work' },
      webui: { port: 3000 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    });
  });

  it('renders key rows from GET /api/keys with masked values, never plaintext', async () => {
    render(<Settings />);

    expect(await screen.findByText('****-9f2c')).toBeInTheDocument();
    expect(screen.getAllByText('未设置密钥')).toHaveLength(2);
    expect(screen.getByText('已连接')).toBeInTheDocument();
    expect(fetchKeysMock).toHaveBeenCalled();
    expect(screen.queryByText(/sk-[a-zA-Z0-9]{4,}/)).not.toBeInTheDocument();
  });

  it('renders custom providers returned by GET /api/keys (no hardcoded whitelist)', async () => {
    fetchKeysMock.mockResolvedValue({
      providers: [
        { provider: 'deepseek', status: '****-9f2c' },
        { provider: 'groq', status: '****-7777' },
      ],
    });
    render(<Settings />);

    expect(await screen.findByText('****-9f2c')).toBeInTheDocument();
    expect(screen.getByText('****-7777')).toBeInTheDocument();
    expect(screen.queryByText('openai')).not.toBeInTheDocument();
  });

  it('renders the 模型与护栏 editable form and 通用 card from the masked config', async () => {
    render(<Settings />);

    // findByLabelText waits for the form to be seeded from GET /api/config.
    expect(await screen.findByLabelText('模型名称')).toHaveValue('deepseek-chat');
    expect(screen.getByLabelText('最大 Token')).toHaveValue('4096');
    expect(screen.getByLabelText('最大轮次')).toHaveValue('3');
    expect(screen.getByLabelText('上下文阈值')).toHaveValue('0.8');
    expect(screen.getByText('prod · 需审批')).toBeInTheDocument();
    expect(screen.getByLabelText('禁止网络外呼')).toBeChecked();

    expect(screen.getAllByText('通用').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('keytar')).toBeInTheDocument();
  });

  it('shows not-set when the key list request fails, falling back to the default providers', async () => {
    fetchKeysMock.mockRejectedValue(new Error('boom'));
    getKeyStatusMock.mockRejectedValue(new Error('boom'));
    render(<Settings />);

    expect((await screen.findAllByText('未设置密钥')).length).toBeGreaterThan(0);
  });

  it('updates a key through a hidden password input, then shows the masked response', async () => {
    const user = userEvent.setup();
    saveKeyMock.mockResolvedValue({
      provider: 'deepseek',
      saved: true,
      masked: '****-abcd',
    });
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.click(within(row('deepseek')).getByRole('button', { name: '更新' }));
    const input = within(row('deepseek')).getByLabelText('新密钥');
    expect(input).toHaveAttribute('type', 'password');
    await user.type(input, 'sk-secret-new');
    await user.click(within(row('deepseek')).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      // The edit form also carries the row's registry metadata (Task 26
      // follow-up) — deepseek's defaults ride along unchanged.
      expect(saveKeyMock).toHaveBeenCalledWith('deepseek', 'sk-secret-new', {
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
      });
    });
    expect(await screen.findByText('****-abcd')).toBeInTheDocument();
    expect(screen.queryByText('sk-secret-new')).not.toBeInTheDocument();
  });

  it('deletes a key after confirmation and removes the row from the list (reviewer M2)', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteKeyMock.mockResolvedValue({ provider: 'deepseek', removed: true });
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.click(within(row('deepseek')).getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(deleteKeyMock).toHaveBeenCalledWith('deepseek');
    });
    expect(confirmSpy).toHaveBeenCalled();
    // The row is removed from the dynamic list (matches GET /api/keys).
    await waitFor(() => {
      expect(screen.queryByTestId('key-row-deepseek')).not.toBeInTheDocument();
    });
    confirmSpy.mockRestore();
  });

  it('loads the current config into the JSON editor', async () => {
    render(<Settings />);

    const editor = (await screen.findByLabelText('配置编辑器')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(editor.value).toContain('"deepseek"');
    });
  });

  it('rejects invalid JSON on save without sending a request', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const editor = await screen.findByLabelText('配置编辑器');

    fireEvent.change(editor, { target: { value: '{"agent": ' } });
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    expect(await screen.findByText(/无效的 JSON/)).toBeInTheDocument();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('saves valid JSON, shows success and a masked merged-config preview', async () => {
    const user = userEvent.setup();
    saveConfigMock.mockResolvedValue({
      llm: { provider: 'deepseek', apiKey: '****-9f2c' },
      agent: { maxRounds: 10 },
    });
    render(<Settings />);
    const editor = (await screen.findByLabelText('配置编辑器')) as HTMLTextAreaElement;
    // 等 load() 完成（编辑器被 fetchConfig 内容填充）——否则保存可能读到被
    // 异步 load 覆盖的完整 config（CI 竞态：参数变成 maxRounds:3 的完整 config）
    await waitFor(() => expect(editor.value).toContain('deepseek'));

    fireEvent.change(editor, { target: { value: '{"agent":{"maxRounds":10}}' } });
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({ agent: { maxRounds: 10 } });
    });
    expect(await screen.findByText(/配置已保存/)).toBeInTheDocument();
    // The masked merged config shows in the preview AND the editor buffer now
    // follows the saved merged config (three-panel single source).
    expect(screen.getAllByText(/"apiKey": "\*\*\*\*-9f2c"/).length).toBeGreaterThanOrEqual(2);
  });

  it('配置编辑 follows an ACTIVE-provider endpoint edit without a reload (real-test: needed one)', async () => {
    const user = userEvent.setup();
    let baseUrl = 'https://api.deepseek.com';
    fetchKeysMock.mockImplementation(async () => ({
      providers: [
        { provider: 'deepseek', status: '****-9f2c', baseUrl, defaultModel: 'deepseek-chat', isActive: true },
      ],
    }));
    fetchConfigMock.mockImplementation(async () => ({
      llm: { provider: 'deepseek', baseUrl, model: 'deepseek-chat', maxTokens: 4096, apiKeySource: 'keytar' },
      agent: { maxRounds: 3, contextThreshold: 0.8, workspaceRoot: '/work' },
      webui: { port: 3000 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    }));
    render(<Settings />);
    const editor = (await screen.findByLabelText('配置编辑器')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(editor.value).toContain('https://api.deepseek.com');
    });

    await user.click(within(row('deepseek')).getByRole('button', { name: '更新' }));
    await user.clear(within(row('deepseek')).getByLabelText('新 API 地址'));
    await user.type(within(row('deepseek')).getByLabelText('新 API 地址'), 'https://nju-mirror.example/v1');
    baseUrl = 'https://nju-mirror.example/v1';
    await user.click(within(row('deepseek')).getByRole('button', { name: '保存' }));

    // The JSON editor follows the endpoint edit without a page reload.
    await waitFor(() => {
      expect(editor.value).toContain('https://nju-mirror.example/v1');
      expect(editor.value).not.toContain('https://api.deepseek.com');
    });
  });

  it('配置编辑 keeps unsaved edits when an external config change arrives', async () => {
    const user = userEvent.setup();
    let baseUrl = 'https://api.deepseek.com';
    fetchKeysMock.mockImplementation(async () => ({
      providers: [
        { provider: 'deepseek', status: '****-9f2c', baseUrl, defaultModel: 'deepseek-chat', isActive: true },
      ],
    }));
    fetchConfigMock.mockImplementation(async () => ({
      llm: { provider: 'deepseek', baseUrl, model: 'deepseek-chat', maxTokens: 4096, apiKeySource: 'keytar' },
      agent: { maxRounds: 3, contextThreshold: 0.8, workspaceRoot: '/work' },
      webui: { port: 3000 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    }));
    render(<Settings />);
    const editor = (await screen.findByLabelText('配置编辑器')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(editor.value).toContain('https://api.deepseek.com');
    });

    // The user is mid-edit in the JSON editor (dirty buffer).
    fireEvent.change(editor, { target: { value: `${editor.value}\n  "userEdit": true\n}` } });

    // An external config change arrives (active-provider endpoint edit).
    await user.click(within(row('deepseek')).getByRole('button', { name: '更新' }));
    await user.clear(within(row('deepseek')).getByLabelText('新 API 地址'));
    await user.type(within(row('deepseek')).getByLabelText('新 API 地址'), 'https://nju-mirror.example/v1');
    baseUrl = 'https://nju-mirror.example/v1';
    await user.click(within(row('deepseek')).getByRole('button', { name: '保存' }));

    // The dirty buffer is NOT clobbered by the external update.
    await waitFor(() => {
      expect(saveKeyMock).toHaveBeenCalled();
    });
    expect(editor.value).toContain('userEdit');
  });

  it('配置编辑 save propagates to the 模型与护栏 card', async () => {
    const user = userEvent.setup();
    saveConfigMock.mockResolvedValue({
      llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4', maxTokens: 4096 },
      agent: { maxRounds: 3, contextThreshold: 0.8, workspaceRoot: '/work' },
      webui: { port: 3000 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    });
    render(<Settings />);
    const editor = await screen.findByLabelText('配置编辑器');

    fireEvent.change(editor, { target: { value: '{"llm":{"model":"deepseek-v4","maxTokens":4096}}' } });
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    // The merged config propagates to the 模型与护栏 form.
    await waitFor(() => {
      expect(screen.getByLabelText('模型名称')).toHaveValue('deepseek-v4');
    });
  });

  it('adds a custom provider and saves its key through the existing POST flow', async () => {
    const user = userEvent.setup();
    saveKeyMock.mockResolvedValue({ provider: 'groq', saved: true, masked: '****-7777' });
    // Backend state across the re-fetches the card triggers after the add and
    // after the save (the save also re-fetches the list — real-test fix).
    let rows: KeyProviderStatus[] = [
      {
        provider: 'deepseek',
        status: '****-9f2c',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-chat',
        isActive: true,
      },
      { provider: 'openai', status: 'not set' },
      { provider: 'anthropic', status: 'not set' },
    ];
    fetchKeysMock.mockImplementation(async () => ({ providers: rows }));
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.type(screen.getByLabelText('新供应商名称'), 'groq');
    await user.type(screen.getByLabelText('新供应商 API 地址'), 'https://api.groq.com/openai/v1');
    // The backend registers the provider — the re-fetch triggered by the
    // click below returns the updated list (mock state, like the pre-queued
    // responses of the original test).
    rows = [...rows, { provider: 'groq', status: 'not set', baseUrl: 'https://api.groq.com/openai/v1' }];
    await user.click(screen.getByRole('button', { name: '添加供应商' }));

    const groqRow = await screen.findByTestId('key-row-groq');
    await user.click(within(groqRow).getByRole('button', { name: '添加密钥' }));
    await user.type(within(groqRow).getByLabelText('新密钥'), 'sk-groq-key');
    await user.click(within(groqRow).getByRole('button', { name: '保存' }));

    // The key save rides with the registry metadata added above.
    await waitFor(() => {
      expect(saveKeyMock).toHaveBeenCalledWith('groq', 'sk-groq-key', {
        baseUrl: 'https://api.groq.com/openai/v1',
      });
    });
    expect(await within(groqRow).findByText('****-7777')).toBeInTheDocument();
    expect(screen.queryByText('sk-groq-key')).not.toBeInTheDocument();
  });

  it('rejects an empty or duplicate provider name when adding', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.click(screen.getByRole('button', { name: '添加供应商' }));
    expect(await screen.findByText(/请输入供应商名称/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('新供应商名称'), 'deepseek');
    await user.click(screen.getByRole('button', { name: '添加供应商' }));
    expect(await screen.findByText(/已存在/)).toBeInTheDocument();
  });

  it('模型与护栏 saves edits via PUT /api/config and reports success', async () => {
    const user = userEvent.setup();
    saveConfigMock.mockResolvedValue({
      llm: { model: 'deepseek-v4', maxTokens: 4096 },
      agent: { maxRounds: 3, contextThreshold: 0.8 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    });
    render(<Settings />);
    const modelInput = await screen.findByLabelText('模型名称');
    await user.clear(modelInput);
    await user.type(modelInput, 'deepseek-v4');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({
        llm: { model: 'deepseek-v4', maxTokens: 4096 },
        agent: { maxRounds: 3, contextThreshold: 0.8 },
        guardrails: { requireApproval: ['prod'], blockOutbound: true },
      });
    });
    expect(await screen.findByText(/设置已保存/)).toBeInTheDocument();
  });

  it('模型与护栏 adds and removes requireApproval rules before saving', async () => {
    const user = userEvent.setup();
    saveConfigMock.mockResolvedValue({});
    render(<Settings />);
    await screen.findByLabelText('模型名称');

    await user.type(screen.getByLabelText('新增审批规则'), 'network');
    await user.click(screen.getByRole('button', { name: '添加规则' }));
    expect(screen.getByText('network · 需审批')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '移除规则 prod' }));
    expect(screen.queryByText('prod · 需审批')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith(
        expect.objectContaining({
          guardrails: { requireApproval: ['network'], blockOutbound: true },
        }),
      );
    });
  });

  it('模型与护栏 shows the backend error on save failure (e.g. secret rejected)', async () => {
    const user = userEvent.setup();
    saveConfigMock.mockRejectedValue(
      new Error('llm.apiKey cannot be set via config — use POST /api/keys/:provider instead'),
    );
    render(<Settings />);
    await screen.findByLabelText('模型名称');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText(/保存失败/)).toBeInTheDocument();
    expect(screen.getByText(/llm\.apiKey cannot be set via config/)).toBeInTheDocument();
  });

  it('模型与护栏 rejects an invalid number without sending a request', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const rounds = await screen.findByLabelText('最大轮次');
    await user.clear(rounds);
    await user.type(rounds, 'abc');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText(/最大轮次必须为/)).toBeInTheDocument();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('模型与护栏 treats an EMPTY 最大轮次 as invalid — Number("") === 0 trap (reviewer M3)', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    const rounds = await screen.findByLabelText('最大轮次');
    await user.clear(rounds);
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(await screen.findByText(/最大轮次不能为空/)).toBeInTheDocument();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it('shows a read-only hint when the credential backend is env (reviewer M4)', async () => {
    fetchKeysMock.mockResolvedValue({ providers: [], backend: 'env' });
    render(<Settings />);

    expect(await screen.findByText(/当前为环境变量后端（只读）/)).toBeInTheDocument();
  });

  it('shows no env hint for the default keytar/file backends', async () => {
    render(<Settings />);
    await screen.findByText('****-9f2c');

    expect(screen.queryByText(/环境变量后端/)).not.toBeInTheDocument();
  });

  it('renders the provider model list and seeds the model field on click (Task 26 follow-up)', async () => {
    fetchAvailableModelsMock.mockResolvedValue({ models: ['deepseek-chat', 'deepseek-reasoner'] });
    render(<Settings />);
    await screen.findByText('供应商模型列表');

    // The current model (deepseek-chat from the config seed) is highlighted;
    // clicking another entry seeds the form field with it.
    expect(screen.getByRole('button', { name: 'deepseek-reasoner' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'deepseek-reasoner' }));
    expect(screen.getByLabelText('模型名称')).toHaveValue('deepseek-reasoner');
  });

  it('shows an error hint with the raw message when the model list fails to load', async () => {
    fetchAvailableModelsMock.mockRejectedValue(new Error('未配置 deepseek 的 API key'));
    render(<Settings />);

    expect(await screen.findByText(/模型列表加载失败：未配置 deepseek 的 API key/)).toBeInTheDocument();
  });

  it('marks the active provider with 当前 and offers 应用 on others (Task 26 follow-up)', async () => {
    render(<Settings />);

    const deepseekRow = await screen.findByTestId('key-row-deepseek');
    expect(within(deepseekRow).getByText('当前')).toBeInTheDocument();
    expect(within(deepseekRow).queryByRole('button', { name: '应用' })).not.toBeInTheDocument();
    const openaiRow = screen.getByTestId('key-row-openai');
    expect(within(openaiRow).getByRole('button', { name: '应用' })).toBeInTheDocument();
  });

  it('activating a provider switches llm config to it and refreshes the model list (Task 26 follow-up)', async () => {
    fetchKeysMock.mockResolvedValue({
      providers: [
        {
          provider: 'deepseek',
          status: '****-9f2c',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          isActive: true,
        },
        {
          provider: 'openai',
          status: '****-9f2c',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o',
        },
      ],
    });
    saveConfigMock.mockResolvedValue({
      llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    });
    render(<Settings />);

    const openaiRow = await screen.findByTestId('key-row-openai');
    await userEvent.click(within(openaiRow).getByRole('button', { name: '应用' }));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({
        llm: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      });
    });
    // The model list reloads for the newly activated provider (config change
    // propagates to the model/guardrail card via onConfigChanged).
    await waitFor(() => {
      expect(fetchAvailableModelsMock).toHaveBeenCalled();
    });
  });

  it('activates with the FIRST model of the list when no default is registered (Task 26 follow-up)', async () => {
    fetchKeysMock.mockResolvedValue({
      providers: [
        {
          provider: 'deepseek',
          status: '****-9f2c',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          isActive: true,
        },
        { provider: 'groq', status: 'not set', baseUrl: 'https://api.groq.com/openai/v1' },
      ],
    });
    saveConfigMock
      .mockResolvedValueOnce({ llm: { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' } })
      .mockResolvedValueOnce({
        llm: { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b' },
      });
    fetchAvailableModelsMock.mockResolvedValue({ models: ['llama-3.3-70b', 'llama-3.1-8b'] });
    render(<Settings />);

    const groqRow = await screen.findByTestId('key-row-groq');
    await userEvent.click(within(groqRow).getByRole('button', { name: '应用' }));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({
        llm: { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1' },
      });
    });
    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({ llm: { model: 'llama-3.3-70b' } });
    });
  });

  it('adds a provider with endpoint metadata (Task 26 follow-up)', async () => {
    render(<Settings />);
    await userEvent.type(await screen.findByLabelText('新供应商名称'), 'groq');
    await userEvent.type(screen.getByLabelText('新供应商 API 地址'), 'https://api.groq.com/openai/v1');
    await userEvent.type(screen.getByLabelText('新供应商默认模型'), 'llama-3.3-70b');
    await userEvent.click(screen.getByRole('button', { name: '添加供应商' }));

    await waitFor(() => {
      expect(saveKeyMock).toHaveBeenCalledWith('groq', '', {
        baseUrl: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.3-70b',
      });
    });
  });

  it('a key-only save for a provider WITHOUT registry metadata does not re-fetch (reviewer: unsaved edits survive)', async () => {
    const user = userEvent.setup();
    saveKeyMock.mockResolvedValue({ provider: 'openai', saved: true, masked: '****-7777' });
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.click(within(row('openai')).getByRole('button', { name: '添加密钥' }));
    await user.type(within(row('openai')).getByLabelText('新密钥'), 'sk-openai-key');
    await user.click(within(row('openai')).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(saveKeyMock).toHaveBeenCalledWith('openai', 'sk-openai-key', {});
    });
    expect(await within(row('openai')).findByText('****-7777')).toBeInTheDocument();
    // No registry metadata was touched — the list and the page config must
    // not be re-fetched (unsaved 模型与护栏 edits survive a key save).
    expect(fetchKeysMock).toHaveBeenCalledTimes(1);
  });

  it('shows a newly saved provider baseUrl in the row without a page reload (real-test: needed one)', async () => {
    const user = userEvent.setup();
    // Backend state after the save: openai gains registry metadata.
    let openaiBaseUrl: string | undefined;
    fetchKeysMock.mockImplementation(async () => ({
      providers: [
        {
          provider: 'deepseek',
          status: '****-9f2c',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          isActive: true,
        },
        ...(openaiBaseUrl !== undefined
          ? [{ provider: 'openai', status: 'not set', baseUrl: openaiBaseUrl }]
          : [{ provider: 'openai', status: 'not set' }]),
      ],
    }));
    render(<Settings />);
    await screen.findByText('****-9f2c');
    expect(within(row('openai')).queryByText(/https:/)).not.toBeInTheDocument();

    await user.click(within(row('openai')).getByRole('button', { name: '添加密钥' }));
    await user.type(within(row('openai')).getByLabelText('新 API 地址'), 'https://api.openai.com/v1');
    openaiBaseUrl = 'https://api.openai.com/v1';
    await user.click(within(row('openai')).getByRole('button', { name: '保存' }));

    // The row re-fetches the key list after a save — the new endpoint shows
    // immediately, no manual reload.
    await waitFor(() => {
      expect(fetchKeysMock).toHaveBeenCalledTimes(2);
    });
    expect(await within(row('openai')).findByText('https://api.openai.com/v1')).toBeInTheDocument();
  });

  it('re-points the 模型与护栏 API 地址 when the ACTIVE provider baseUrl is edited (real-test: needed re-apply + reload)', async () => {
    const user = userEvent.setup();
    // Backend state after the save: the ACTIVE provider's endpoint changed,
    // so both the registry and config.llm.baseUrl carry the new value.
    let baseUrl = 'https://api.deepseek.com';
    fetchKeysMock.mockImplementation(async () => ({
      providers: [
        {
          provider: 'deepseek',
          status: '****-9f2c',
          baseUrl,
          defaultModel: 'deepseek-chat',
          isActive: true,
        },
      ],
    }));
    fetchConfigMock.mockImplementation(async () => ({
      llm: { provider: 'deepseek', baseUrl, model: 'deepseek-chat', maxTokens: 4096, apiKeySource: 'keytar' },
      agent: { maxRounds: 3, contextThreshold: 0.8, workspaceRoot: '/work' },
      webui: { port: 3000 },
      guardrails: { requireApproval: ['prod'], blockOutbound: true },
    }));
    render(<Settings />);
    // The endpoint appears twice initially: the row and the 模型与护栏 card.
    // (Regex — the row's text node is followed by " · 默认 …", so exact-text
    // matching against the row's textContent would miss it.)
    await waitFor(() => {
      expect(screen.getAllByText(/https:\/\/api\.deepseek\.com/).length).toBeGreaterThanOrEqual(2);
    });

    await user.click(within(row('deepseek')).getByRole('button', { name: '更新' }));
    await user.clear(within(row('deepseek')).getByLabelText('新 API 地址'));
    await user.type(within(row('deepseek')).getByLabelText('新 API 地址'), 'https://nju-mirror.example/v1');
    baseUrl = 'https://nju-mirror.example/v1';
    await user.click(within(row('deepseek')).getByRole('button', { name: '保存' }));

    // The row AND the card below follow the save without re-applying the
    // provider or reloading the page (row shows one copy, the card another;
    // the JSON editor keeps its own snapshot, so it is excluded here).
    await waitFor(() => {
      expect(screen.getAllByText(/https:\/\/nju-mirror\.example\/v1/).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('clears all sessions after a two-step confirm (KNOWN_ISSUES 9)', async () => {
    clearSessionsMock.mockResolvedValue({ deleted: 2, keptRunning: [] });
    render(<Settings />);

    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: '清空会话' });
    // First click arms the confirm state; nothing is sent yet.
    await user.click(button);
    expect(clearSessionsMock).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('button', { name: '确认清空？' });
    // Second click performs the deletion.
    await user.click(confirm);
    await waitFor(() => expect(clearSessionsMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('已清空 2 个会话')).toBeInTheDocument();
  });

  it('reports kept running sessions after clearing (KNOWN_ISSUES 9)', async () => {
    clearSessionsMock.mockResolvedValue({ deleted: 1, keptRunning: ['live-1'] });
    render(<Settings />);

    const user = userEvent.setup();
    const button = await screen.findByRole('button', { name: '清空会话' });
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: '确认清空？' }));
    expect(
      await screen.findByText(/1 个运行中会话已保留/),
    ).toBeInTheDocument();
  });
});
