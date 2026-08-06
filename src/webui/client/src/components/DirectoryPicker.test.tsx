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

// A consistent browse tree: C:\ → Users → me → Desktop → papers, with one
// file and one symlink at the `me` level. Each level has a DISTINCT listing
// so no directory ever serves a listing that contains itself (a listing for
// `me` that also listed `me` would be a cycle, not a valid browse response).
const DRIVE_C = {
  path: 'C:\\',
  parent: '',
  entries: [
    { path: 'C:\\Users', name: 'Users', type: 'dir' as const },
    { path: 'C:\\a.txt', name: 'a.txt', type: 'file' as const, size: 3 },
  ],
};

const USERS_DIR = {
  path: 'C:\\Users',
  parent: 'C:\\',
  entries: [{ path: 'C:\\Users\\me', name: 'me', type: 'dir' as const }],
};

const USER_DIR = {
  path: 'C:\\Users\\me',
  parent: 'C:\\Users',
  entries: [
    { path: 'C:\\Users\\me\\Desktop', name: 'Desktop', type: 'dir' as const },
    { path: 'C:\\Users\\me\\notes.txt', name: 'notes.txt', type: 'file' as const, size: 12 },
    { path: 'C:\\Users\\me\\alias', name: 'alias', type: 'link' as const },
  ],
};

const DESKTOP_DIR = {
  path: 'C:\\Users\\me\\Desktop',
  parent: 'C:\\Users\\me',
  entries: [{ path: 'C:\\Users\\me\\Desktop\\papers', name: 'papers', type: 'dir' as const }],
};

/** Per-path default listings; any other path is an unexpected fetch. */
function defaultBrowse(path: string): Promise<typeof USER_DIR> {
  if (path === 'C:\\') {
    return Promise.resolve(DRIVE_C);
  }
  if (path === 'C:\\Users') {
    return Promise.resolve(USERS_DIR);
  }
  if (path === 'C:\\Users\\me') {
    return Promise.resolve(USER_DIR);
  }
  if (path === 'C:\\Users\\me\\Desktop') {
    return Promise.resolve(DESKTOP_DIR);
  }
  return Promise.reject(new Error('unexpected browse path: ' + path));
}

/**
 * Expand the given dir row inside the picker dialog. Awaits the row's
 * appearance — roots/entries load asynchronously, and the dialog element
 * renders before its content does (CI race, 2026-08-06: getByRole 会偶发
 * 查在加载态上 → 改用 findByRole 等待内容出现)。
 */
async function expand(picker: HTMLElement, name: string): Promise<void> {
  await userEvent.click(await within(picker).findByRole('button', { name: `展开 ${name}` }));
}

function renderPicker(onSelect = vi.fn(), onClose = vi.fn()) {
  const utils = render(<DirectoryPicker onSelect={onSelect} onClose={onClose} />);
  return { onSelect, onClose, ...utils };
}

describe('DirectoryPicker (browse: machine-wide, unrestricted)', () => {
  beforeEach(() => {
    fetchMachineRootsMock.mockReset();
    fetchFsBrowseMock.mockReset();
    fetchMachineRootsMock.mockResolvedValue(['C:\\', 'D:\\']);
    fetchFsBrowseMock.mockImplementation(defaultBrowse);
  });

  it('opens on the machine roots (no path arg) and shows every drive as a selectable dir', async () => {
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    expect(fetchMachineRootsMock).toHaveBeenCalledTimes(1);
    expect(await within(picker).findByText('这台电脑')).toBeInTheDocument();
    expect(await within(picker).findByRole('button', { name: '选择 C:\\' })).toBeInTheDocument();
    expect(await within(picker).findByRole('button', { name: '选择 D:\\' })).toBeInTheDocument();
  });

  it('selecting a drive fills the parent form with its path and closes nothing on its own', async () => {
    const { onSelect } = renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await userEvent.click(await within(picker).findByRole('button', { name: '选择 C:\\' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\');
  });

  it('expanding a directory lazily fetches its entries via /api/fs/browse, one level at a time', async () => {
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });

    await expand(picker, 'C:\\');
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\');
    expect(await within(picker).findByText('Users')).toBeInTheDocument();

    await expand(picker, 'Users');
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\Users');
    expect(await within(picker).findByText('me')).toBeInTheDocument();

    await expand(picker, 'me');
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\Users\\me');
    expect(await within(picker).findByText('Desktop')).toBeInTheDocument();
    expect(within(picker).getByText('notes.txt')).toBeInTheDocument();

    // Drilling down one more level fetches the next directory (distinct
    // listing, so no cycle).
    await expand(picker, 'Desktop');
    expect(fetchFsBrowseMock).toHaveBeenCalledWith('C:\\Users\\me\\Desktop');
    expect(await within(picker).findByText('papers')).toBeInTheDocument();
  });

  it('selecting a nested directory reports its absolute path', async () => {
    const { onSelect } = renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await expand(picker, 'C:\\');
    await expand(picker, 'Users');
    await expand(picker, 'me');
    await userEvent.click(await within(picker).findByRole('button', { name: '选择 Desktop' }));
    expect(onSelect).toHaveBeenCalledWith('C:\\Users\\me\\Desktop');
  });

  it('renders symlink entries as inert rows (no expand, no select)', async () => {
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await expand(picker, 'C:\\');
    await expand(picker, 'Users');
    await expand(picker, 'me');
    expect(await within(picker).findByText('alias')).toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: '展开 alias' })).not.toBeInTheDocument();
    expect(within(picker).queryByRole('button', { name: '选择 alias' })).not.toBeInTheDocument();
  });

  it('flags truncated directories with the …截断 hint', async () => {
    fetchFsBrowseMock.mockImplementation(() => Promise.resolve({ ...USER_DIR, truncated: true }));
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    // Every listing is served truncated — the hint shows on the expanded
    // directory's own row as soon as its listing loads.
    await expand(picker, 'C:\\');
    expect(await within(picker).findByText('…截断')).toBeInTheDocument();
    expect(within(picker).getByText('Desktop')).toBeInTheDocument();
  });

  it('a branch fetch failure is non-fatal (picker keeps working, error shown)', async () => {
    fetchFsBrowseMock.mockImplementation(() => Promise.reject(new Error('目录不可读')));
    renderPicker();
    const picker = await screen.findByRole('dialog', { name: '选择工作目录' });
    await expand(picker, 'C:\\');
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
