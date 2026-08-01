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

import { deleteKey, fetchConfig, getKeyStatus, saveConfig, saveKey } from '../lib/api';

const fetchConfigMock = vi.mocked(fetchConfig);
const saveConfigMock = vi.mocked(saveConfig);
const getKeyStatusMock = vi.mocked(getKeyStatus);
const saveKeyMock = vi.mocked(saveKey);
const deleteKeyMock = vi.mocked(deleteKey);

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
    getKeyStatusMock.mockImplementation(async (provider) => ({
      provider,
      status: provider === 'deepseek' ? '****-9f2c' : 'not set',
    }));
    fetchConfigMock.mockResolvedValue({
      llm: { provider: 'deepseek', model: 'deepseek-chat' },
      webui: { port: 3000 },
    });
  });

  it('renders key rows with masked values and not-set placeholders, never plaintext', async () => {
    render(<Settings />);

    expect(await screen.findByText('****-9f2c')).toBeInTheDocument();
    expect(screen.getAllByText('未设置密钥')).toHaveLength(2);
    expect(screen.getByText('已配置')).toBeInTheDocument();
    expect(screen.queryByText(/sk-[a-zA-Z0-9]{4,}/)).not.toBeInTheDocument();
  });

  it('shows not-set when the key status request fails', async () => {
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
});
