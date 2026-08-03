import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from './Settings';

vi.mock('../lib/api', () => ({
  fetchConfig: vi.fn(),
  saveConfig: vi.fn(),
  getKeyStatus: vi.fn(),
  saveKey: vi.fn(),
  deleteKey: vi.fn(),
  fetchKeys: vi.fn(),
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

import { deleteKey, fetchConfig, fetchKeys, getKeyStatus, saveConfig, saveKey } from '../lib/api';

const fetchConfigMock = vi.mocked(fetchConfig);
const saveConfigMock = vi.mocked(saveConfig);
const getKeyStatusMock = vi.mocked(getKeyStatus);
const saveKeyMock = vi.mocked(saveKey);
const deleteKeyMock = vi.mocked(deleteKey);
const fetchKeysMock = vi.mocked(fetchKeys);

function row(provider: string): HTMLElement {
  return screen.getByTestId(`key-row-${provider}`);
}

describe('Settings', () => {
  beforeEach(() => {
    fetchConfigMock.mockReset();
    saveConfigMock.mockReset();
    getKeyStatusMock.mockReset();
    saveKeyMock.mockReset();
    deleteKeyMock.mockReset();
    fetchKeysMock.mockReset();
    getKeyStatusMock.mockImplementation(async (provider) => ({
      provider,
      status: provider === 'deepseek' ? '****-9f2c' : 'not set',
    }));
    fetchKeysMock.mockResolvedValue({
      providers: [
        { provider: 'deepseek', status: '****-9f2c' },
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
      expect(saveKeyMock).toHaveBeenCalledWith('deepseek', 'sk-secret-new');
    });
    expect(await screen.findByText('****-abcd')).toBeInTheDocument();
    expect(screen.queryByText('sk-secret-new')).not.toBeInTheDocument();
  });

  it('deletes a key after confirmation', async () => {
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
    expect(await within(row('deepseek')).findByText('未设置密钥')).toBeInTheDocument();
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
    const editor = await screen.findByLabelText('配置编辑器');

    fireEvent.change(editor, { target: { value: '{"agent":{"maxRounds":10}}' } });
    await user.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => {
      expect(saveConfigMock).toHaveBeenCalledWith({ agent: { maxRounds: 10 } });
    });
    expect(await screen.findByText(/配置已保存/)).toBeInTheDocument();
    expect(screen.getByText(/"apiKey": "\*\*\*\*-9f2c"/)).toBeInTheDocument();
  });

  it('adds a custom provider and saves its key through the existing POST flow', async () => {
    const user = userEvent.setup();
    saveKeyMock.mockResolvedValue({ provider: 'groq', saved: true, masked: '****-7777' });
    render(<Settings />);
    await screen.findByText('****-9f2c');

    await user.type(screen.getByLabelText('新供应商名称'), 'groq');
    await user.click(screen.getByRole('button', { name: '添加供应商' }));

    const groqRow = row('groq');
    await user.click(within(groqRow).getByRole('button', { name: '添加密钥' }));
    await user.type(within(groqRow).getByLabelText('新密钥'), 'sk-groq-key');
    await user.click(within(groqRow).getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(saveKeyMock).toHaveBeenCalledWith('groq', 'sk-groq-key');
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
});
