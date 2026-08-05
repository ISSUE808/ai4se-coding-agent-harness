import type { Config } from '../types.js';

export const DEFAULT_CONFIG: Config = Object.freeze({
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    maxTokens: 4096,
    apiKeySource: 'keytar',
    apiKeyService: 'codeharness/deepseek',
    // Docker/headless 预置口令（方案 B）：keytar 不可用且无交互环境时，
    // 用此口令激活 encrypted-file 后端；缺省 undefined 走交互提示。
    masterPassword: undefined,
    // Task 26 follow-up: the built-in registry entry mirrors the active
    // values, so the Settings "应用" action has metadata to switch back to.
    providers: {
      deepseek: { baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
    },
  },
  agent: {
    // 0 = unlimited, mirroring Claude Code `--max-turns` default (no cap
    // unless a number is configured). Set a number to cap runaway loops;
    // the HITL upgrade path (maxRounds exceeded) only triggers with a cap.
    maxRounds: 0,
    contextThreshold: 0.8,
    workspaceRoot: process.cwd(),
  },
  feedback: {
    validatorMode: 'fail_fast',
    validators: {
      eslint: { enabled: true },
      tsc: { enabled: true },
      testRunner: { enabled: true },
      shellCheck: { enabled: true },
    },
  },
  guardrail: {
    allowlist: [],
    blocklist: [],
    warnlist: [],
    downgrade: {},
  },
  shell: {
    timeoutSeconds: 60,
  },
  memory: {
    projectPath: '.harness/',
    userPath: '~/.codeharness/',
  },
  webui: {
    port: 3000,
  },
} as Config);
