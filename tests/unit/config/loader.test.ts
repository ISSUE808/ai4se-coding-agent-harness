import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, DEFAULT_CONFIG } from '../../../src/config/loader.js';
import type { Config } from '../../../src/types.js';

describe('loadConfig - 三层覆盖配置系统', () => {
  let tmpDir: string;
  let userConfigDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeharness-test-'));
    userConfigDir = path.join(tmpDir, 'user-home', '.codeharness');
    projectDir = path.join(tmpDir, 'project');
    fs.mkdirSync(userConfigDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- 1. 无配置文件 → 默认值 ----

  it('无任何配置文件时，应返回 DEFAULT_CONFIG 完整默认值', () => {
    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    expect(cfg.llm.provider).toBe(DEFAULT_CONFIG.llm.provider);
    expect(cfg.llm.baseUrl).toBe(DEFAULT_CONFIG.llm.baseUrl);
    expect(cfg.llm.model).toBe(DEFAULT_CONFIG.llm.model);
    expect(cfg.llm.maxTokens).toBe(DEFAULT_CONFIG.llm.maxTokens);
    expect(cfg.llm.apiKeySource).toBe(DEFAULT_CONFIG.llm.apiKeySource);
    expect(cfg.agent.maxRounds).toBe(DEFAULT_CONFIG.agent.maxRounds);
    expect(cfg.agent.contextThreshold).toBe(0.8);
    expect(cfg.agent.workspaceRoot).toBe(DEFAULT_CONFIG.agent.workspaceRoot);
    expect(cfg.feedback.validatorMode).toBe('fail_fast');
    expect(cfg.shell.timeoutSeconds).toBe(60);
    expect(cfg.memory.projectPath).toBe(DEFAULT_CONFIG.memory.projectPath);
    expect(cfg.memory.userPath).toBe(DEFAULT_CONFIG.memory.userPath);
    expect(cfg.webui.port).toBe(3000);
  });

  // ---- 2. 用户配置覆盖默认值 ----

  it('用户配置文件 (~/.codeharness/config.json) 应覆盖默认值', () => {
    const userConfig = {
      llm: { provider: 'openai', model: 'gpt-4o' },
      agent: { maxRounds: 5 },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig),
    );

    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    // 用户覆盖的值
    expect(cfg.llm.provider).toBe('openai');
    expect(cfg.llm.model).toBe('gpt-4o');
    expect(cfg.agent.maxRounds).toBe(5);
    // 未被用户覆盖的，仍为默认值
    expect(cfg.llm.baseUrl).toBe(DEFAULT_CONFIG.llm.baseUrl);
    expect(cfg.llm.maxTokens).toBe(DEFAULT_CONFIG.llm.maxTokens);
    expect(cfg.agent.contextThreshold).toBe(0.8);
  });

  // ---- 3. 项目配置覆盖用户配置 ----

  it('项目配置文件 (.codeharness.json) 应覆盖用户配置', () => {
    const userConfig = {
      llm: { provider: 'openai', model: 'gpt-4o', maxTokens: 8192 },
      agent: { maxRounds: 5, contextThreshold: 0.7 },
    };
    const projectConfig = {
      llm: { provider: 'deepseek', model: 'deepseek-chat' },
      agent: { maxRounds: 10 },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig),
    );
    fs.writeFileSync(
      path.join(projectDir, '.codeharness.json'),
      JSON.stringify(projectConfig),
    );

    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    // 项目覆盖的值
    expect(cfg.llm.provider).toBe('deepseek');
    expect(cfg.llm.model).toBe('deepseek-chat');
    expect(cfg.agent.maxRounds).toBe(10);
    // 用户设了但项目没设的值，保留用户的值
    expect(cfg.llm.maxTokens).toBe(8192);
    expect(cfg.agent.contextThreshold).toBe(0.7);
    // 两者都没设的，保留默认值
    expect(cfg.shell.timeoutSeconds).toBe(60);
  });

  // ---- 4. CLI 参数为最高优先级 ----

  it('CLI 参数应覆盖用户配置和项目配置', () => {
    const userConfig = {
      llm: { provider: 'openai' },
      agent: { maxRounds: 5 },
    };
    const projectConfig = {
      agent: { maxRounds: 10 },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig),
    );
    fs.writeFileSync(
      path.join(projectDir, '.codeharness.json'),
      JSON.stringify(projectConfig),
    );

    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
      cliArgs: {
        llm: { provider: 'deepseek', model: 'deepseek-v3' },
        agent: { maxRounds: 3 },
        webui: { port: 8080 },
      },
    });

    // CLI 覆盖
    expect(cfg.llm.provider).toBe('deepseek');
    expect(cfg.llm.model).toBe('deepseek-v3');
    expect(cfg.agent.maxRounds).toBe(3);
    expect(cfg.webui.port).toBe(8080);
    // 未被 CLI 覆盖的，保留项目/用户/默认值
    expect(cfg.llm.maxTokens).toBe(DEFAULT_CONFIG.llm.maxTokens);
  });

  // ---- 5. 深度合并 ----

  it('嵌套对象应被深度合并，而非完全替换', () => {
    const userConfig = {
      llm: { provider: 'openai' },
      feedback: {
        validators: { eslint: { enabled: true }, tsc: { enabled: false } },
      },
    };
    const projectConfig = {
      llm: { model: 'gpt-4o', maxTokens: 8192 },
      feedback: {
        validatorMode: 'collect_all',
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig),
    );
    fs.writeFileSync(
      path.join(projectDir, '.codeharness.json'),
      JSON.stringify(projectConfig),
    );

    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    // 深度合并：llm 的所有字段都保留了
    expect(cfg.llm.provider).toBe('openai');          // 仅用户设了
    expect(cfg.llm.model).toBe('gpt-4o');             // 项目覆盖
    expect(cfg.llm.maxTokens).toBe(8192);              // 项目覆盖
    expect(cfg.llm.baseUrl).toBe(DEFAULT_CONFIG.llm.baseUrl); // 默认值
    // 深度合并：feedback.validators 保留了
    expect(cfg.feedback.validatorMode).toBe('collect_all');   // 项目覆盖
    expect(cfg.feedback.validators.eslint.enabled).toBe(true);  // 用户设了
    expect(cfg.feedback.validators.tsc.enabled).toBe(false);    // 用户设了
    expect(cfg.feedback.validators.testRunner.enabled).toBe(DEFAULT_CONFIG.feedback.validators.testRunner.enabled); // 默认
    expect(cfg.feedback.validators.shellCheck.enabled).toBe(DEFAULT_CONFIG.feedback.validators.shellCheck.enabled); // 默认
  });

  // ---- 6. 仅 CLI 参数（无配置文件） ----

  it('仅提供 CLI 参数时，应在默认值之上应用 CLI 覆盖', () => {
    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
      cliArgs: {
        shell: { timeoutSeconds: 120 },
      },
    });

    expect(cfg.shell.timeoutSeconds).toBe(120);
    // 其余保持默认
    expect(cfg.agent.maxRounds).toBe(DEFAULT_CONFIG.agent.maxRounds);
    expect(cfg.webui.port).toBe(3000);
  });

  // ---- 7. 不良 JSON 应抛出明确错误 ----

  it('用户配置文件包含不良 JSON 时，应抛出明确错误', () => {
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      '这不是 JSON {{',
    );

    expect(() =>
      loadConfig({
        userConfigPath: path.join(userConfigDir, 'config.json'),
        projectConfigPath: path.join(projectDir, '.codeharness.json'),
      }),
    ).toThrow(/Failed to parse|JSON|parse/i);
  });

  // ---- 8. guardrail 配置覆盖 ----

  it('guardrail 的 allowlist/blocklist/warnlist/downgrade 也参与深度合并', () => {
    const userConfig = {
      guardrail: {
        allowlist: ['echo'],
        blocklist: ['rm'],
        warnlist: ['npm'],
        downgrade: { 'git push': 'allow' },
      },
    };
    const projectConfig = {
      guardrail: {
        blocklist: ['rm', 'dd'],
        warnlist: ['npm', 'sudo'],
      },
    };
    fs.writeFileSync(
      path.join(userConfigDir, 'config.json'),
      JSON.stringify(userConfig),
    );
    fs.writeFileSync(
      path.join(projectDir, '.codeharness.json'),
      JSON.stringify(projectConfig),
    );

    const cfg = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    expect(cfg.guardrail.allowlist).toEqual(['echo']);
    expect(cfg.guardrail.blocklist).toEqual(['rm', 'dd']);
    expect(cfg.guardrail.warnlist).toEqual(['npm', 'sudo']);
    expect(cfg.guardrail.downgrade).toEqual({ 'git push': 'allow' });
  });

  // ---- 9. DEFAULT_CONFIG 是不可变的引用 ----

  it('DEFAULT_CONFIG 应是一个冻结对象，修改不影响后续 loadConfig 调用', () => {
    const cfg1 = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    // 尝试修改返回的配置（不应影响默认值）
    cfg1.agent.maxRounds = 999;
    cfg1.llm.provider = 'changed-provider';

    const cfg2 = loadConfig({
      userConfigPath: path.join(userConfigDir, 'config.json'),
      projectConfigPath: path.join(projectDir, '.codeharness.json'),
    });

    expect(cfg2.agent.maxRounds).toBe(DEFAULT_CONFIG.agent.maxRounds);
    expect(cfg2.llm.provider).toBe(DEFAULT_CONFIG.llm.provider);
  });
});
