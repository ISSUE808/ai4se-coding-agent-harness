import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DirectoryPicker from './DirectoryPicker';
import { fetchFsBrowse, fetchMachineRoots } from '../lib/api';

vi.mock('../lib/api', () => ({
  fetchMachineRoots: vi.fn(),
  fetchFsBrowse: vi.fn(),
}));

const fetchMachineRootsMock = vi.mocked(fetchMachineRoots);
const fetchFsBrowseMock = vi.mocked(fetchFsBrowse);

/** Listing for C:\Users\me — one dir, one file, one symlink. */
const USER_DIR = {
  path: 'C:\\Users\\me',
  parent: 'C:\\Users',
  entries: [
    { path: 'C:\\Users\\me\\Desktop', name: 'Desktop', type: 'dir' as const },
    { path: 'C:\\Users\\me\\notes.txt', name: 'notes.txt', type: 'file' as const, size: 12 },
    { path: 'C:\\Users\\me\\alias', name: 'alias', type: 'link' as const },
  ],
};

function renderPicker(onSelect = vi.fn(), onClose = vi.fn()) {
  const utils = render(<DirectoryPicker onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose, ...utils };
}

describe('DirectoryPicker (browse: machine-wide, unrestricted)', () => {
  beforeEach(() => {
    fetchMachineRootsMock.mockReset();
    fetchFsBrowseMock.mockReset();
    fetchMachineRootsMock.mockResolvedValue(['C:\\', 'D:\\']);
  });

  it('opens on the machine roots (no path arg) and shows every drive as a selectable dir', async () => {
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    expect(fetchMachineRootsMock).toHaveBeenCalledTimes(1);
    expect(within(picker).getByText('这台电脑')).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '选择 C:\\' })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '选择 D:\\' })).toBeInTheDocument();
  });

  it('selecting a drive fills the parent form with its path and closes nothing on its own', async () => {
    const { onSelect } = renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(within(picker).getByRole('button', { name: '选择 C:\\' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\');
  });

  it('expanding a directory lazily fetches its entries via /api/fs/browse', async () => {
    fetchFsBrowseMock.mockResolvedValue(USER_DIR);
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });

    await userEvent.click(within(picker).getByRole('button', { name: '展开 C:\\' }));
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\');
    expect(await within(picker).findByText('Desktop')).toBeInTheDocument();
    expect(within(picker).getByText('notes.txt')).toBeInTheDocument();

    // Drilling down one more level fetches the next directory.
    await userEvent.click(within(picker).getByRole('button', { name: '展开 Desktop' }));
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\Users\\me\\Desktop');
  });

  it('selecting a nested directory reports its absolute path', async () => {
    fetchFsBrowseMock.mockResolvedValue(USER_DIR);
    const { onSelect } = renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(within(picker).getByRole('button', { name: '展开 C:\\' }));
    await userEvent.click(await within(picker).findByRole('button', { name: '选择 Desktop' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\Users\\me\\Desktop');
  });

  it('renders symlink entries as inert rows (no expand, no select)', async () => {
    fetchFsBrowseMock.mockResolvedValue(USER_DIR);
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(within(picker).getByRole('button', { name: '展开 C:\\' }));
    expect(await within(picker).findByText('alias')).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: '展开 alias' })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: '选择 alias' })).not.toBeInTheDocument();
  });

  it('flags truncated directories with the …截断 hint', async () => {
    fetchFsBrowseMock.mockResolvedValue({ ...USER_DIR, truncated: true });
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(within(picker).getByRole('button', { name: '展开 C:\\' }));
    expect(await within(picker).findByText('…截断')).toBeInTheDocument();
  });

  it('a branch fetch failure is non-fatal (picker keeps working, error shown)', async () => {
    fetchFsBrowseMock.mockRejectedValue(new Error('目录不可读'));
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(within(picker).getByRole('button', { name: '展开 C:\\' }));
    expect(await within(picker).findByText('目录不可读')).toBeInTheDocument();
    // The machine roots are still visible and usable.
    expect(within(picker).getByRole('button', { name: '选择 D:\\' })).toBeInTheDocument();
  });

  it('a root fetch failure shows the retry state (M: loadRoot error)', async () => {
    fetchMachineRootsMock.mockRejectedValue(new Error('服务不可达'));
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    expect(await within(picker).findByText('服务不可达')).toBeInTheDocument();

    fetchMachineRootsMock.mockResolvedValue(['C:\\']);
    await userEvent.click(within(picker).getByRole('button', { name: '重试' }));
    expect(await within(picker).findByRole('button', { name: '选择 C:\\' })).toBeInTheDocument();
  });

  it('closes on Escape (M8)', async () => {
    const { onClose } = renderPicker();
    await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
