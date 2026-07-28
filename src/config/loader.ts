import * as fs from 'fs';
import { DEFAULT_CONFIG } from './schema.js';
import type { Config } from '../types.js';

export { DEFAULT_CONFIG } from './schema.js';

export interface LoadConfigOptions {
  userConfigPath?: string;
  projectConfigPath?: string;
  cliArgs?: DeepPartial<Config>;
}

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  ...overrides: DeepPartial<T>[]
): T {
  const result = structuredClone(base) as Record<string, unknown>;

  for (const override of overrides) {
    if (!override) continue;
    for (const key of Object.keys(override) as (keyof typeof override)[]) {
      const overrideVal = override[key];
      const baseVal = result[key as string];

      if (isObject(baseVal) && isObject(overrideVal as Record<string, unknown>)) {
        result[key as string] = deepMerge(
          baseVal as Record<string, unknown>,
          overrideVal as Record<string, unknown>,
        );
      } else if (overrideVal !== undefined) {
        result[key as string] = overrideVal;
      }
    }
  }

  return result as T;
}

function readJsonFile(path: string): Record<string, unknown> | null {
  if (!fs.existsSync(path)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Failed to parse config file "${path}": ${err.message}`);
    }
    throw err;
  }
}

export function loadConfig(options: LoadConfigOptions = {}): Config {
  const userConfigPath = options.userConfigPath;
  const projectConfigPath = options.projectConfigPath;

  // Layer 1: DEFAULT_CONFIG (built-in defaults)
  let merged = { ...DEFAULT_CONFIG } as unknown as Record<string, unknown>;

  // Layer 2: ~/.codeharness/config.json (user-level)
  if (userConfigPath) {
    const userConfig = readJsonFile(userConfigPath);
    if (userConfig) {
      merged = deepMerge(merged, userConfig);
    }
  }

  // Layer 3: ./.codeharness.json (project-level)
  if (projectConfigPath) {
    const projectConfig = readJsonFile(projectConfigPath);
    if (projectConfig) {
      merged = deepMerge(merged, projectConfig);
    }
  }

  // Layer 4: CLI args (highest priority)
  if (options.cliArgs) {
    merged = deepMerge(merged, options.cliArgs as Record<string, unknown>);
  }

  return merged as unknown as Config;
}
