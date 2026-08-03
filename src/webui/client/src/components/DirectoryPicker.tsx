/**
 * DirectoryPicker — modal directory browser for the new-session 工作目录
 * field. Browsing is deliberately UNRESTRICTED (user decision): the picker
 * opens on the machine roots (Windows drive letters like `C:\`, `/` on
 * POSIX) and lazily fetches ANY directory below via GET /api/fs/browse.
 * The server returns metadata only (names/types/sizes, never file
 * contents), and picking a directory here authorizes it as the new
 * session's workspace root — the supervision model is the real control
 * (KNOWN_ISSUES). The session-detail file tree keeps using GET /api/fs/tree
 * (authorized roots only).
 */
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import designTokens from '../design-tokens';
import { fetchFsBrowse, fetchMachineRoots, type FsBrowseEntry } from '../lib/api';

interface DirectoryPickerProps {
  /** Called with the picked directory's absolute path. */
  onSelect: (path: string) => void;
  /** Called when the user dismisses the picker without choosing. */
  onClose: () => void;
}

type Phase = 'loading' | 'ready' | 'error';

/** Virtual root of the browser: lists the machine roots, not a real dir. */
const MACHINE_ROOT: FsBrowseEntry = { path: '', name: '这台电脑', type: 'dir' };

export default function DirectoryPicker({ onSelect, onClose }: DirectoryPickerProps) {
  // Dir path → its browse listing ('' = the machine roots, synthesized as a
  // pseudo-directory). Entries for a dir are only fetched on first expand.
  const [dirs, setDirs] = useState<Map<string, { entries: FsBrowseEntry[]; truncated: boolean }>>(
    new Map(),
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set([MACHINE_ROOT.path]));
  const [phase, setPhase] = useState<Phase>('loading');
  const [rootError, setRootError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    setPhase('loading');
    setRootError(null);
    try {
      const roots = await fetchMachineRoots();
      setDirs((prev) =>
        new Map(prev).set(MACHINE_ROOT.path, {
          entries: roots.map((root) => ({ path: root, name: root, type: 'dir' })),
          truncated: false,
        }),
      );
      setPhase('ready');
    } catch (err) {
      setRootError(err instanceof Error ? err.message : '无法加载目录');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void loadRoot();
  }, [loadRoot]);

  // M8: Escape dismisses the picker (document-level so it works regardless
  // of where focus sits inside the dialog).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  /** Fetch one directory's entries for expansion; failures are non-fatal. */
  function loadBranch(node: FsBrowseEntry): void {
    setBranchError(null);
    fetchFsBrowse(node.path)
      .then((listing) => {
        setDirs((prev) =>
          new Map(prev).set(node.path, { entries: listing.entries, truncated: listing.truncated === true }),
        );
      })
      .catch((err) => {
        setBranchError(err instanceof Error ? err.message : '无法展开目录');
      });
  }

  function toggleExpand(node: FsBrowseEntry): void {
    if (node.type !== 'dir') {
      return;
    }
    // M4: the fetch side effect lives OUTSIDE the state updater (an updater
    // may run twice under StrictMode → duplicate requests), and the `dirs`
    // check happens against the current render's closure.
    if (expanded.has(node.path)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(node.path);
        return next;
      });
    } else {
      if (!dirs.has(node.path)) {
        loadBranch(node);
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(node.path);
        return next;
      });
    }
  }

  function renderNode(node: FsBrowseEntry, depth: number, ancestors: ReadonlySet<string>): ReactNode {
    const listing = node.type === 'dir' ? dirs.get(node.path) : undefined;
    const children = listing?.entries ?? [];
    const isExpanded = expanded.has(node.path);
    const isDir = node.type === 'dir';
    // Cycle guard (defense in depth): the server contract says every entry
    // path is strictly deeper than its parent, but a malformed listing must
    // not stack-overflow the render — children already on this branch's
    // ancestor chain are skipped.
    const childAncestors = new Set(ancestors);
    childAncestors.add(node.path);

    return (
      <div key={node.path}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: designTokens.spacing[1],
            paddingLeft: `calc(${depth} * ${designTokens.spacing[4]})`,
            paddingRight: designTokens.spacing[2],
            minHeight: 26,
            borderRadius: designTokens.radius.sm,
          }}
        >
          {isDir ? (
            <button
              type="button"
              aria-label={isExpanded ? `折叠 ${node.name}` : `展开 ${node.name}`}
              onClick={() => toggleExpand(node)}
              style={chevronButtonStyle}
            >
              <ChevronRight
                size={12}
                style={{ transform: isExpanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.12s' }}
              />
            </button>
          ) : (
            <span style={{ width: 12, display: 'grid', placeItems: 'center', flexShrink: 0 }} />
          )}
          {isDir ? (
            isExpanded ? (
              <FolderOpen size={13} style={{ color: designTokens.colors.textMuted, flexShrink: 0 }} />
            ) : (
              <Folder size={13} style={{ color: designTokens.colors.textMuted, flexShrink: 0 }} />
            )
          ) : (
            <File size={13} style={{ color: designTokens.colors.textSubtle, flexShrink: 0 }} />
          )}
          {isDir && node.path !== '' ? (
            <button
              type="button"
              aria-label={`选择 ${node.name}`}
              onClick={() => onSelect(node.path)}
              style={selectButtonStyle}
            >
              {node.name}
            </button>
          ) : (
            <span style={fileLabelStyle}>{node.name}</span>
          )}
          {listing?.truncated === true && <span style={truncatedHintStyle}>…截断</span>}
        </div>
        {isDir && isExpanded && children.length > 0 && (
          <div>
            {children
              .filter((child) => !childAncestors.has(child.path))
              .map((child) => renderNode(child, depth + 1, childAncestors))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="选择工作目录"
      style={{
        position: 'fixed',
        inset: 0,
        background: designTokens.colors.overlay,
        backdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 80,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: `calc(100% - ${designTokens.spacing[16]})`,
          maxHeight: '72vh',
          display: 'flex',
          flexDirection: 'column',
          background: designTokens.colors.surface,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: designTokens.colors.borderStrong,
          borderRadius: designTokens.radius.lg,
          boxShadow: designTokens.shadows.md,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
            borderBottomWidth: 1,
            borderBottomStyle: 'solid',
            borderBottomColor: designTokens.colors.border,
          }}
        >
          <h3 style={{ margin: 0, fontSize: designTokens.typography.fontSize.md, fontWeight: designTokens.typography.fontWeight.semibold }}>
            选择工作目录
          </h3>
          <button type="button" onClick={onClose} aria-label="关闭" style={iconBtnStyle}>
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 160, padding: designTokens.spacing[3] }}>
          {phase === 'loading' && (
            <div style={centerStateStyle}>
              <Loader2 size={18} style={{ color: designTokens.colors.textMuted }} />
              <p style={stateTextStyle}>加载目录…</p>
            </div>
          )}
          {phase === 'error' && (
            <div style={centerStateStyle}>
              <AlertTriangle size={18} style={{ color: designTokens.colors.danger }} />
              <p style={stateTextStyle}>{rootError ?? '无法加载目录'}</p>
              <button type="button" onClick={() => void loadRoot()} style={retryButtonStyle}>
                <RefreshCw size={12} />
                重试
              </button>
            </div>
          )}
          {phase === 'ready' && renderNode(MACHINE_ROOT, 0, new Set())}
          {branchError !== null && (
            <p style={{ margin: `${designTokens.spacing[2]} 0 0`, color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
              {branchError}
            </p>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: designTokens.spacing[2],
            padding: `${designTokens.spacing[3]} ${designTokens.spacing[5]}`,
            borderTopWidth: 1,
            borderTopStyle: 'solid',
            borderTopColor: designTokens.colors.border,
            background: designTokens.colors.well,
            fontSize: designTokens.typography.fontSize.sm,
            color: designTokens.colors.textMuted,
          }}
        >
          <span>点击目录名选择，点击箭头展开</span>
          <button type="button" onClick={onClose} style={cancelButtonStyle}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline style primitives (token-derived) ─────────────────────────────────

const chevronButtonStyle: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 16,
  height: 20,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
};

const selectButtonStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.text,
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.codeSize.md,
  cursor: 'pointer',
  padding: `${designTokens.spacing[0]} ${designTokens.spacing[1]}`,
  borderRadius: designTokens.radius.sm,
};

const fileLabelStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: designTokens.typography.fontFamily.mono,
  fontSize: designTokens.typography.codeSize.md,
  color: designTokens.colors.textSubtle,
};

const truncatedHintStyle: CSSProperties = {
  flexShrink: 0,
  fontSize: designTokens.typography.fontSize.xs,
  color: designTokens.colors.warning,
};

const iconBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  borderRadius: designTokens.radius.md,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  cursor: 'pointer',
};

const centerStateStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: designTokens.spacing[2],
  padding: designTokens.spacing[6],
  textAlign: 'center',
};

const stateTextStyle: CSSProperties = {
  margin: 0,
  fontSize: designTokens.typography.fontSize.sm,
  color: designTokens.colors.textMuted,
};

const retryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[1]} ${designTokens.spacing[2]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.surface,
  color: designTokens.colors.text,
  fontSize: designTokens.typography.fontSize.sm,
  cursor: 'pointer',
};

const cancelButtonStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  fontSize: designTokens.typography.fontSize.base,
  cursor: 'pointer',
};
