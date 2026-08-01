import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import Editor from '@monaco-editor/react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import designTokens from '../design-tokens';
import {
  deleteKey,
  fetchConfig,
  getKeyStatus,
  saveConfig,
  saveKey,
  type ConfigValue,
} from '../lib/api';
import { parseConfigJson } from '../lib/config-json';
import { defineCodeHarnessTheme, MONACO_THEME } from '../lib/monaco-theme';

/** Providers shown in key management (deepseek is the default harness LLM). */
const PROVIDERS = ['deepseek', 'openai', 'anthropic'];

const NOT_SET = 'not set';

export default function Settings() {
  return (
    <main
      style={{
        height: '100%',
        overflow: 'auto',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      <div style={{ maxWidth: 1120, marginInline: 'auto', padding: designTokens.spacing[6] }}>
        <header style={{ marginBottom: designTokens.spacing[5] }}>
          <h1
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.xl,
              fontWeight: designTokens.typography.fontWeight.semibold,
              letterSpacing: '-0.01em',
            }}
          >
            设置
          </h1>
          <p
            style={{
              margin: `${designTokens.spacing[1]} 0 0`,
              color: designTokens.colors.textMuted,
              fontSize: designTokens.typography.fontSize.base,
            }}
          >
            管理 API Key 与 agent 运行配置。密钥仅显示掩码，绝不回显明文。
          </p>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: designTokens.spacing[5] }}>
          <KeyManagementCard />
          <ConfigEditorCard />
        </div>
      </div>
    </main>
  );
}

// ─── Key management ──────────────────────────────────────────────────────────

function KeyManagementCard() {
  return (
    <section
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        borderRadius: designTokens.radius.lg,
        background: designTokens.colors.surface,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: designTokens.typography.fontSize.lg,
            fontWeight: designTokens.typography.fontWeight.semibold,
          }}
        >
          API Keys
        </h2>
        <p
          style={{
            margin: `${designTokens.spacing[1]} 0 0`,
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.sm,
          }}
        >
          按 provider 管理密钥。密钥通过 POST /api/keys/:provider 单向写入凭据库，前端不保存明文。
        </p>
      </div>
      <div>
        {PROVIDERS.map((provider) => (
          <KeyRow key={provider} provider={provider} />
        ))}
      </div>
    </section>
  );
}

function KeyRow({ provider }: { provider: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [keyText, setKeyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus((await getKeyStatus(provider)).status);
    } catch {
      setStatus(NOT_SET);
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const configured = status !== null && status !== NOT_SET;

  async function handleSave(): Promise<void> {
    if (keyText.trim() === '') {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await saveKey(provider, keyText.trim());
      setStatus(response.masked);
      setEditing(false);
      setKeyText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!window.confirm(`确认删除 ${provider} 的 API Key 吗？此操作不可恢复。`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteKey(provider);
      setStatus(NOT_SET);
    } catch {
      setStatus(NOT_SET);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid={`key-row-${provider}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: designTokens.spacing[3],
        padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 32,
          height: 32,
          borderRadius: designTokens.radius.md,
          background: designTokens.colors.primarySoft,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: designTokens.colors.primaryBorder,
          color: designTokens.colors.primary,
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.sm,
          fontWeight: designTokens.typography.fontWeight.semibold,
        }}
      >
        {provider.slice(0, 2)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: designTokens.spacing[2],
            fontSize: designTokens.typography.fontSize.md,
            fontWeight: designTokens.typography.fontWeight.medium,
          }}
        >
          {provider}
          {configured ? (
            <span
              style={{
                paddingInline: designTokens.spacing[2],
                paddingBlock: designTokens.spacing[0],
                borderRadius: designTokens.radius.pill,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.successBorder,
                background: designTokens.colors.successSoft,
                color: designTokens.colors.success,
                fontSize: designTokens.typography.fontSize.xs,
                fontWeight: designTokens.typography.fontWeight.medium,
              }}
            >
              已配置
            </span>
          ) : (
            <span
              style={{
                paddingInline: designTokens.spacing[2],
                paddingBlock: designTokens.spacing[0],
                borderRadius: designTokens.radius.pill,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.borderStrong,
                color: designTokens.colors.textMuted,
                fontSize: designTokens.typography.fontSize.xs,
                fontWeight: designTokens.typography.fontWeight.medium,
              }}
            >
              未配置
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: designTokens.spacing[1],
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.codeSize.md,
            color: configured ? designTokens.colors.textSubtle : designTokens.colors.textMuted,
          }}
        >
          {configured ? status : '未设置密钥'}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[2],
        }}
      >
        {editing ? (
          <>
            <input
              type="password"
              aria-label="新密钥"
              value={keyText}
              onChange={(e) => setKeyText(e.target.value)}
              placeholder={`${provider} 的新 API Key`}
              style={{
                width: 220,
                padding: designTokens.spacing[2],
                borderRadius: designTokens.radius.md,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.borderStrong,
                background: designTokens.colors.well,
                color: designTokens.colors.text,
                fontSize: designTokens.typography.fontSize.base,
                fontFamily: designTokens.typography.fontFamily.mono,
              }}
            />
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || keyText.trim() === ''}
              style={{ ...primaryButtonStyle, opacity: busy || keyText.trim() === '' ? 0.5 : 1 }}
            >
              {busy ? <Loader2 size={12} /> : <Save size={12} />}
              保存
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setKeyText('');
                setError(null);
              }}
              style={ghostButtonStyle}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={secondaryButtonStyle}
            >
              <Pencil size={12} />
              {configured ? '更新' : '添加密钥'}
            </button>
            {configured && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                style={dangerButtonStyle}
              >
                <Trash2 size={12} />
                删除
              </button>
            )}
          </>
        )}
      </div>

      {error !== null && (
        <span
          style={{
            color: designTokens.colors.danger,
            fontSize: designTokens.typography.fontSize.sm,
            maxWidth: 180,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

// ─── Config editor (Monaco JSON) ─────────────────────────────────────────────

function ConfigEditorCard() {
  const [text, setText] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'saved'; message: string } | null>(
    null,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const config = await fetchConfig();
      setText(JSON.stringify(config, null, 2));
      setStatus(null);
    } catch {
      setText('{\n  // 无法加载配置：请确认 WebUI 后端已启动（默认端口 3000）\n}');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function validate(textToCheck: string): ConfigValue | null {
    const parsed = parseConfigJson(textToCheck);
    if (!parsed.ok) {
      setStatus({ kind: 'error', message: `无效的 JSON：${parsed.error}` });
      setPreview(null);
      return null;
    }
    setStatus({ kind: 'ok', message: 'JSON 有效' });
    return parsed.value;
  }

  async function handleSave(): Promise<void> {
    if (text === null) {
      return;
    }
    const value = validate(text);
    if (value === null) {
      return;
    }
    setBusy(true);
    try {
      const merged = await saveConfig(value);
      setStatus({ kind: 'saved', message: '配置已保存（响应为脱敏后的合并配置）' });
      setPreview(JSON.stringify(merged, null, 2));
    } catch (err) {
      setStatus({ kind: 'error', message: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.border,
        borderRadius: designTokens.radius.lg,
        background: designTokens.colors.surface,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: designTokens.spacing[4],
          padding: `${designTokens.spacing[3]} ${designTokens.spacing[4]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.lg,
              fontWeight: designTokens.typography.fontWeight.semibold,
            }}
          >
            配置编辑
          </h2>
          <p
            style={{
              margin: `${designTokens.spacing[1]} 0 0`,
              color: designTokens.colors.textMuted,
              fontSize: designTokens.typography.fontSize.sm,
            }}
          >
            agent 运行配置（JSON）。保存前校验语法；密钥字段请通过 API Keys 管理，配置中不允许出现明文密钥。
          </p>
        </div>
        <div style={{ display: 'flex', gap: designTokens.spacing[2] }}>
          <button
            type="button"
            onClick={() => {
              if (text !== null) {
                validate(text);
              }
            }}
            style={secondaryButtonStyle}
          >
            校验
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={busy || text === null}
            style={{ ...primaryButtonStyle, opacity: busy || text === null ? 0.5 : 1 }}
          >
            {busy ? <Loader2 size={12} /> : <Save size={12} />}
            保存配置
          </button>
        </div>
      </div>

      <div style={{ padding: designTokens.spacing[4] }}>
        <div
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.border,
            borderRadius: designTokens.radius.md,
            overflow: 'hidden',
            background: designTokens.colors.well,
          }}
        >
          {text === null ? (
            <div
              style={{
                height: 360,
                display: 'grid',
                placeItems: 'center',
                color: designTokens.colors.textMuted,
                fontSize: designTokens.typography.fontSize.base,
              }}
            >
              加载配置中…
            </div>
          ) : (
            <Editor
              height={360}
              language="json"
              theme={MONACO_THEME}
              value={text}
              onChange={(value) => setText(value ?? '')}
              beforeMount={defineCodeHarnessTheme}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                tabSize: 2,
                wordWrap: 'on',
              }}
            />
          )}
        </div>

        {status !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[2],
              marginTop: designTokens.spacing[3],
              fontSize: designTokens.typography.fontSize.sm,
              color:
                status.kind === 'error'
                  ? designTokens.colors.danger
                  : status.kind === 'saved'
                    ? designTokens.colors.success
                    : designTokens.colors.info,
            }}
          >
            {status.kind === 'error' ? (
              <AlertTriangle size={14} />
            ) : (
              <CheckCircle2 size={14} />
            )}
            {status.message}
          </div>
        )}

        {preview !== null && (
          <div style={{ marginTop: designTokens.spacing[4] }}>
            <div
              style={{
                marginBottom: designTokens.spacing[2],
                fontSize: designTokens.typography.fontSize.sm,
                fontWeight: designTokens.typography.fontWeight.medium,
                color: designTokens.colors.textMuted,
              }}
            >
              配置预览（脱敏后的合并配置）
            </div>
            <pre
              style={{
                margin: 0,
                padding: designTokens.spacing[3],
                borderRadius: designTokens.radius.md,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: designTokens.colors.border,
                background: designTokens.colors.well,
                color: designTokens.colors.codeText,
                fontFamily: designTokens.typography.fontFamily.mono,
                fontSize: designTokens.typography.codeSize.md,
                overflow: 'auto',
                maxHeight: 240,
              }}
            >
              {preview}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Shared inline style primitives (token-derived, no hardcoded values) ─────

const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.primary,
  background: designTokens.colors.primary,
  color: designTokens.colors.onPrimary,
  fontSize: designTokens.typography.fontSize.base,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.borderStrong,
  background: designTokens.colors.surface,
  color: designTokens.colors.text,
  fontSize: designTokens.typography.fontSize.sm,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
};

const dangerButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: designTokens.colors.dangerBorder,
  background: designTokens.colors.dangerSoft,
  color: designTokens.colors.danger,
  fontSize: designTokens.typography.fontSize.sm,
  fontWeight: designTokens.typography.fontWeight.medium,
  cursor: 'pointer',
};

const ghostButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: designTokens.spacing[1],
  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
  borderRadius: designTokens.radius.md,
  border: 'none',
  background: 'transparent',
  color: designTokens.colors.textMuted,
  fontSize: designTokens.typography.fontSize.sm,
  cursor: 'pointer',
};
