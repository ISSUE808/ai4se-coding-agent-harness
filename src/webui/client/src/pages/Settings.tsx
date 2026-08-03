import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
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
  fetchKeys,
  getKeyStatus,
  saveConfig,
  saveKey,
  type ConfigValue,
} from '../lib/api';
import { parseConfigJson } from '../lib/config-json';
import { defineCodeHarnessTheme, MONACO_THEME } from '../lib/monaco-theme';

/**
 * Providers shown when GET /api/keys is unreachable — a fallback only, never
 * a whitelist: the live list is enumerated from the credential store (Task 25),
 * so custom providers added at runtime show up after a reload.
 */
const DEFAULT_PROVIDERS = ['deepseek', 'openai', 'anthropic'];

const NOT_SET = 'not set';

/** Left-nav entries (prototype .settings-nav). */
const NAV_ITEMS: { label: string; target: string }[] = [
  { label: 'API Keys', target: 'settings-keys' },
  { label: '配置编辑', target: 'settings-config' },
  { label: '模型与护栏', target: 'settings-model' },
  { label: '通用', target: 'settings-general' },
];

export default function Settings() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Masked backend config for the 模型与护栏 / 通用 cards (fetched once here;
  // the JSON editor card loads its own copy for editing).
  const [config, setConfig] = useState<ConfigValue | null>(null);
  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(() => {
        // Backend unreachable — the cards render their empty/loading states.
      });
  }, []);

  return (
    <main
      style={{
        height: '100%',
        overflow: 'auto',
        background: designTokens.colors.bg,
        color: designTokens.colors.text,
      }}
    >
      <div style={{ maxWidth: 1240, marginInline: 'auto', padding: `${designTokens.spacing[6]} ${designTokens.spacing[8]} ${designTokens.spacing[10]}` }}>
        <header style={{ marginBottom: designTokens.spacing[6] }}>
          <h1
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.xl,
              fontWeight: designTokens.typography.fontWeight.semibold,
              letterSpacing: '-0.02em',
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

        {/* prototype .settings-grid: 200px nav + content column */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '200px minmax(0,1fr)',
            gap: designTokens.spacing[8],
            alignItems: 'start',
          }}
        >
          <nav
            aria-label="设置导航"
            style={{
              position: 'sticky',
              top: designTokens.spacing[6],
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            }}
          >
            {NAV_ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => scrollTo(item.target)}
                style={{
                  padding: `${designTokens.spacing[2]} ${designTokens.spacing[3]}`,
                  borderRadius: designTokens.radius.md,
                  color: designTokens.colors.textMuted,
                  fontSize: designTokens.typography.fontSize.base,
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  borderLeftWidth: 2,
                  borderLeftStyle: 'solid',
                  borderLeftColor: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: designTokens.spacing[6], minWidth: 0 }}>
            <KeyManagementCard />
            <ConfigEditorCard />
            <ModelGuardrailCard config={config} />
            <GeneralCard config={config} />
            <DangerZone />
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Key management ──────────────────────────────────────────────────────────

function KeyManagementCard() {
  const [providers, setProviders] = useState<string[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [newProvider, setNewProvider] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchKeys();
      setStatuses(Object.fromEntries(list.providers.map((p) => [p.provider, p.status])));
      setProviders(list.providers.map((p) => p.provider));
    } catch {
      // Backend unreachable — fall back to the well-known set (rows fetch
      // their own status via getKeyStatus).
      setProviders(DEFAULT_PROVIDERS);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleAddProvider(): void {
    const name = newProvider.trim();
    if (name === '') {
      setAddError('请输入供应商名称');
      return;
    }
    if (name.includes('/')) {
      setAddError('供应商名称不能包含 "/"');
      return;
    }
    if ((providers ?? []).some((p) => p.toLowerCase() === name.toLowerCase())) {
      setAddError(`供应商 ${name} 已存在`);
      return;
    }
    setAddError(null);
    setProviders((prev) => [...(prev ?? []), name]);
    setNewProvider('');
  }

  return (
    <section
      id="settings-keys"
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
          padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: designTokens.typography.fontSize.md,
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
          按 provider 管理密钥（列表来自凭据库枚举，支持任意自定义供应商）。密钥通过 POST /api/keys/:provider
          单向写入，前端不保存明文。
        </p>
      </div>
      <div>
        {providers === null ? (
          <div style={{ padding: designTokens.spacing[5], color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
            加载供应商列表…
          </div>
        ) : (
          providers.map((provider) => (
            <KeyRow
              key={provider}
              provider={provider}
              initialStatus={statuses[provider]}
            />
          ))
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: designTokens.spacing[3],
          padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
        }}
      >
        <span style={{ color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
          添加供应商
        </span>
        <input
          aria-label="新供应商名称"
          value={newProvider}
          onChange={(e) => setNewProvider(e.target.value)}
          placeholder="如 groq、mistral"
          style={{
            width: 180,
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
        <button type="button" onClick={handleAddProvider} style={secondaryButtonStyle}>
          添加供应商
        </button>
        {addError !== null && (
          <span style={{ color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
            {addError}
          </span>
        )}
      </div>
    </section>
  );
}

/** Provider logo tint (prototype .key-logo): deepseek=accent, openai=success, anthropic=warning. */
function logoColors(provider: string): { fg: string; bg: string } {
  switch (provider) {
    case 'openai':
      return { fg: designTokens.colors.success, bg: designTokens.colors.successSoft };
    case 'anthropic':
      return { fg: designTokens.colors.warning, bg: designTokens.colors.warningSoft };
    default:
      return { fg: designTokens.colors.primary, bg: designTokens.colors.primarySoft };
  }
}

function KeyRow({ provider, initialStatus }: { provider: string; initialStatus?: string }) {
  const [status, setStatus] = useState<string | null>(initialStatus ?? null);
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
    // When the card supplied a status from GET /api/keys, trust it (avoids an
    // N+1 of status requests); fallback rows (backend unreachable, or a just
    // added custom provider) fetch their own status.
    if (initialStatus === undefined) {
      void load();
    }
  }, [load, initialStatus]);

  const configured = status !== null && status !== NOT_SET;
  const logo = logoColors(provider);

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
        gap: designTokens.spacing[4],
        padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          width: 34,
          height: 34,
          borderRadius: designTokens.radius.md,
          background: logo.bg,
          color: logo.fg,
          fontFamily: designTokens.typography.fontFamily.mono,
          fontWeight: designTokens.typography.fontWeight.semibold,
          fontSize: designTokens.typography.fontSize.sm,
          flexShrink: 0,
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
            fontSize: designTokens.typography.fontSize.base,
            fontWeight: designTokens.typography.fontWeight.semibold,
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
              已连接
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
            marginTop: 3,
            fontFamily: designTokens.typography.fontFamily.mono,
            fontSize: designTokens.typography.codeSize.md,
            color: configured ? designTokens.colors.textMuted : designTokens.colors.textMuted,
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
      // Strip secret fields from the editor buffer: the masked response
      // carries webui.token ("not set") which PUT would reject — the editor
      // must never round-trip a secret-shaped field back into the config.
      const cleaned = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
      const webui = cleaned.webui as Record<string, unknown> | undefined;
      if (webui) {
        delete webui.token;
      }
      setText(JSON.stringify(cleaned, null, 2));
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
      id="settings-config"
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
          padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: designTokens.typography.fontSize.md,
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

      <div style={{ padding: designTokens.spacing[5] }}>
        <div
          style={{
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: designTokens.colors.border,
            borderRadius: designTokens.radius.md,
            overflow: 'hidden',
            background: designTokens.colors.codeBg,
          }}
        >
          {/* editor chrome bar (prototype .editor-bar) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: designTokens.spacing[2],
              padding: '8px 12px',
              background: designTokens.colors.well,
              borderBottomWidth: 1,
              borderBottomStyle: 'solid',
              borderBottomColor: designTokens.colors.border,
              fontFamily: designTokens.typography.fontFamily.mono,
              fontSize: designTokens.typography.fontSize.xs,
              color: designTokens.colors.textMuted,
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: designTokens.radius.pill, background: designTokens.colors.danger }} />
            <span style={{ width: 10, height: 10, borderRadius: designTokens.radius.pill, background: designTokens.colors.warning }} />
            <span style={{ width: 10, height: 10, borderRadius: designTokens.radius.pill, background: designTokens.colors.success }} />
            <span style={{ marginLeft: 6 }}>config.json — Monaco</span>
            <span style={{ marginLeft: 'auto' }}>UTF-8 · JSON</span>
          </div>

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

// ─── 模型与护栏 (editable form over llm/agent/guardrails config) ────────────

/** Result of validating the form: the PUT /api/config patch, or null + error. */
interface FormValidation {
  patch: ConfigValue;
  error: string | null;
}

function ModelGuardrailCard({ config }: { config: ConfigValue | null }) {
  const llm = asRecord(config?.llm);
  const agent = asRecord(config?.agent);

  const [model, setModel] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [maxRounds, setMaxRounds] = useState('');
  const [contextThreshold, setContextThreshold] = useState('');
  const [approvalRules, setApprovalRules] = useState<string[]>([]);
  const [blockOutbound, setBlockOutbound] = useState(false);
  const [ruleText, setRuleText] = useState('');
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'saved'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the form once from GET /api/config (the parent fetches it on mount).
  useEffect(() => {
    if (config === null) {
      return;
    }
    const seedLlm = asRecord(config.llm);
    const seedAgent = asRecord(config.agent);
    const seedGuardrails = asRecord(config.guardrails);
    setModel(typeof seedLlm?.model === 'string' ? seedLlm.model : '');
    setMaxTokens(typeof seedLlm?.maxTokens === 'number' ? String(seedLlm.maxTokens) : '');
    setMaxRounds(typeof seedAgent?.maxRounds === 'number' ? String(seedAgent.maxRounds) : '');
    setContextThreshold(
      typeof seedAgent?.contextThreshold === 'number' ? String(seedAgent.contextThreshold) : '',
    );
    setApprovalRules(
      Array.isArray(seedGuardrails?.requireApproval)
        ? (seedGuardrails.requireApproval as unknown[]).map(String)
        : [],
    );
    setBlockOutbound(seedGuardrails?.blockOutbound === true);
  }, [config]);

  function validate(): FormValidation {
    if (model.trim() === '') {
      return { patch: {}, error: '模型名称不能为空' };
    }
    const tokens = Number(maxTokens);
    const rounds = Number(maxRounds);
    const threshold = Number(contextThreshold);
    if (!Number.isInteger(tokens) || tokens <= 0) {
      return { patch: {}, error: '最大 Token 必须为正整数' };
    }
    if (!Number.isInteger(rounds) || rounds < 0) {
      return { patch: {}, error: '最大轮次必须为不小于 0 的整数（0 = 无上限）' };
    }
    if (Number.isNaN(threshold) || threshold <= 0 || threshold > 1) {
      return { patch: {}, error: '上下文阈值必须在 (0, 1] 之间' };
    }
    return {
      patch: {
        llm: { model: model.trim(), maxTokens: tokens },
        agent: { maxRounds: rounds, contextThreshold: threshold },
        guardrails: { requireApproval: [...approvalRules], blockOutbound },
      },
      error: null,
    };
  }

  async function handleSave(): Promise<void> {
    const { patch, error } = validate();
    if (error !== null) {
      setStatus({ kind: 'error', message: error });
      return;
    }
    setBusy(true);
    try {
      await saveConfig(patch);
      setStatus({ kind: 'saved', message: '设置已保存，配置已生效' });
    } catch (err) {
      setStatus({ kind: 'error', message: `保存失败：${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  function handleAddRule(): void {
    const rule = ruleText.trim();
    if (rule === '') {
      setRuleError('请输入规则名称');
      return;
    }
    if (approvalRules.includes(rule)) {
      setRuleError(`规则 ${rule} 已在列表中`);
      return;
    }
    setApprovalRules([...approvalRules, rule]);
    setRuleText('');
    setRuleError(null);
  }

  return (
    <section
      id="settings-model"
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
          padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: designTokens.typography.fontSize.md,
            fontWeight: designTokens.typography.fontWeight.semibold,
          }}
        >
          模型与护栏
        </h2>
        <p
          style={{
            margin: `${designTokens.spacing[1]} 0 0`,
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.sm,
          }}
        >
          直接编辑 LLM 与 agent 运行参数，保存后写入配置（PUT /api/config）。密钥字段不接受——请通过 API Keys 管理。
        </p>
      </div>

      {config === null ? (
        <div style={{ padding: designTokens.spacing[5], color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
          加载配置中…（请确认后端已启动）
        </div>
      ) : (
        <div>
          <SettingSection label="模型">
            <SettingField k="模型名称" value={model} onChange={setModel} placeholder="如 deepseek-chat" mono />
            <SettingField k="最大 Token" value={maxTokens} onChange={setMaxTokens} placeholder="如 4096" mono />
            <SettingKV k="提供商" v={typeof llm?.provider === 'string' ? llm.provider : '—'} mono />
            <SettingKV k="API 地址" v={typeof llm?.baseUrl === 'string' ? llm.baseUrl : '—'} mono />
          </SettingSection>
          <SettingSection label="Agent 参数">
            <SettingField k="最大轮次" value={maxRounds} onChange={setMaxRounds} placeholder="0 = 无上限" mono />
            <SettingField k="上下文阈值" value={contextThreshold} onChange={setContextThreshold} placeholder="如 0.8" mono />
            <SettingKV
              k="工作目录"
              v={typeof agent?.workspaceRoot === 'string' ? agent.workspaceRoot : '—'}
              mono
            />
          </SettingSection>
          <SettingSection label="护栏">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {approvalRules.map((item) => (
                <span
                  key={item}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: designTokens.spacing[1],
                    padding: '2px 8px',
                    borderRadius: designTokens.radius.pill,
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: designTokens.colors.warningBorder,
                    color: designTokens.colors.warning,
                    fontSize: designTokens.typography.fontSize.xs,
                  }}
                >
                  {item} · 需审批
                  <button
                    type="button"
                    aria-label={`移除规则 ${item}`}
                    onClick={() => setApprovalRules(approvalRules.filter((r) => r !== item))}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: designTokens.typography.fontSize.xs,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: designTokens.spacing[2], marginTop: designTokens.spacing[2] }}>
              <input
                aria-label="新增审批规则"
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                placeholder="规则名（如 prod、network）"
                style={{
                  width: 200,
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
              <button type="button" onClick={handleAddRule} style={secondaryButtonStyle}>
                添加规则
              </button>
              {ruleError !== null && (
                <span style={{ color: designTokens.colors.danger, fontSize: designTokens.typography.fontSize.sm }}>
                  {ruleError}
                </span>
              )}
            </div>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: designTokens.spacing[2],
                marginTop: designTokens.spacing[3],
                fontSize: designTokens.typography.fontSize.sm,
                color: designTokens.colors.text,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                aria-label="禁止网络外呼"
                checked={blockOutbound}
                onChange={(e) => setBlockOutbound(e.target.checked)}
              />
              禁止网络外呼
            </label>
          </SettingSection>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: designTokens.spacing[3],
              padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
            }}
          >
            {status !== null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: designTokens.spacing[2],
                  fontSize: designTokens.typography.fontSize.sm,
                  color: status.kind === 'error' ? designTokens.colors.danger : status.kind === 'saved' ? designTokens.colors.success : designTokens.colors.info,
                }}
              >
                {status.kind === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
                {status.message}
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              style={{ ...primaryButtonStyle, opacity: busy ? 0.5 : 1 }}
            >
              {busy ? <Loader2 size={12} /> : <Save size={12} />}
              保存设置
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── 通用 (webui runtime facts + credentials channel note) ───────────────────

function GeneralCard({ config }: { config: ConfigValue | null }) {
  const webui = asRecord(config?.webui);
  const llm = asRecord(config?.llm);

  return (
    <section
      id="settings-general"
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
          padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: designTokens.colors.border,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: designTokens.typography.fontSize.md,
            fontWeight: designTokens.typography.fontWeight.semibold,
          }}
        >
          通用
        </h2>
        <p
          style={{
            margin: `${designTokens.spacing[1]} 0 0`,
            color: designTokens.colors.textMuted,
            fontSize: designTokens.typography.fontSize.sm,
          }}
        >
          WebUI 运行时信息与凭据通道说明。
        </p>
      </div>

      {config === null ? (
        <div style={{ padding: designTokens.spacing[5], color: designTokens.colors.textMuted, fontSize: designTokens.typography.fontSize.sm }}>
          加载配置中…（请确认后端已启动）
        </div>
      ) : (
        <div>
          <SettingSection label="WebUI">
            <SettingKV k="端口" v={typeof webui?.port === 'number' ? String(webui.port) : '—'} mono />
            <SettingKV
              k="会话存储"
              v="内存（InMemorySessionStore）"
            />
          </SettingSection>
          <SettingSection label="凭据通道">
            <SettingKV
              k="Key 来源"
              v={typeof llm?.apiKeySource === 'string' ? llm.apiKeySource : '—'}
              mono
            />
            <p
              style={{
                margin: `${designTokens.spacing[1]} 0 0`,
                fontSize: designTokens.typography.fontSize.sm,
                color: designTokens.colors.textMuted,
                lineHeight: designTokens.typography.lineHeight.normal,
              }}
            >
              API Key 不进入配置文件——通过独立凭据通道
              （keytar → 加密文件 → 环境变量）管理，WebUI 仅显示掩码。
            </p>
          </SettingSection>
        </div>
      )}
    </section>
  );
}

// ─── Shared section primitives for the read-only cards ───────────────────────

/** Narrow an unknown config value to a record for safe member access. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function SettingSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        padding: `${designTokens.spacing[3]} ${designTokens.spacing[5]}`,
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: designTokens.colors.border,
      }}
    >
      <div
        style={{
          fontFamily: designTokens.typography.fontFamily.mono,
          fontSize: designTokens.typography.fontSize.xs,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: designTokens.colors.textMuted,
          marginBottom: designTokens.spacing[1],
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function SettingKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: designTokens.spacing[4],
        paddingBlock: designTokens.spacing[1],
        fontSize: 12.5,
      }}
    >
      <span style={{ color: designTokens.colors.textMuted }}>{k}</span>
      <span
        style={{
          fontFamily: mono ? designTokens.typography.fontFamily.mono : designTokens.typography.fontFamily.sans,
          color: designTokens.colors.text,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: '70%',
        }}
        title={v}
      >
        {v}
      </span>
    </div>
  );
}

/** Editable single-line field for the 模型与护栏 form (token-derived styles). */
function SettingField({
  k,
  value,
  onChange,
  placeholder,
  mono,
}: {
  k: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: designTokens.spacing[4],
        paddingBlock: designTokens.spacing[1],
        fontSize: 12.5,
      }}
    >
      <span style={{ color: designTokens.colors.textMuted, flexShrink: 0 }}>{k}</span>
      <input
        aria-label={k}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: 200,
          padding: designTokens.spacing[1],
          borderRadius: designTokens.radius.md,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: designTokens.colors.borderStrong,
          background: designTokens.colors.well,
          color: designTokens.colors.text,
          fontSize: designTokens.typography.fontSize.base,
          fontFamily: mono ? designTokens.typography.fontFamily.mono : designTokens.typography.fontFamily.sans,
          textAlign: 'right',
        }}
      />
    </div>
  );
}

// ─── Danger zone (prototype .danger-zone) ────────────────────────────────────

function DangerZone() {
  return (
    <div
      style={{
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: designTokens.colors.dangerBorder,
        borderRadius: designTokens.radius.lg,
        background: designTokens.colors.dangerSoft,
        padding: `${designTokens.spacing[4]} ${designTokens.spacing[5]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: designTokens.spacing[4],
      }}
    >
      <div>
        <div style={{ fontWeight: designTokens.typography.fontWeight.semibold, fontSize: designTokens.typography.fontSize.base, color: designTokens.colors.danger }}>
          清空所有会话
        </div>
        <div style={{ fontSize: designTokens.typography.fontSize.sm, color: designTokens.colors.textMuted, marginTop: 2 }}>
          永久删除全部会话历史与日志，不可恢复。该操作将在 Task 19 集成主循环后提供。
        </div>
      </div>
      <button type="button" disabled style={{ ...dangerButtonStyle, cursor: 'not-allowed', opacity: 0.55 }}>
        <Trash2 size={12} />
        清空会话
      </button>
    </div>
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
  fontSize: designTokens.typography.fontSize.sm,
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
  background: 'transparent',
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
