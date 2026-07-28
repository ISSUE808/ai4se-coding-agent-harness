import type { Config } from '../types.js';

export const DEFAULT_CONFIG: Config = Object.freeze({
  llm: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    maxTokens: 4096,
    apiKeySource: 'keytar',
    apiKeyService: 'codeharness/deepseek',
  },
  agent: {
    maxRounds: 3,
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
