import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * User memory layer: reads the user's global preferences markdown file.
 * SPEC: 用户记忆——跨项目，~/.codeharness/preferences.md，启动时全量注入 system prompt
 */
export class UserMemory {
  private readonly preferencesPath: string;

  constructor(userPath: string) {
    // Resolve ~ to the user's home directory
    if (userPath.startsWith('~/')) {
      this.preferencesPath = path.join(os.homedir(), userPath.slice(2), 'preferences.md');
    } else {
      this.preferencesPath = path.resolve(userPath, 'preferences.md');
    }
  }

  /**
   * Load the user's preferences from ~/.codeharness/preferences.md.
   * Returns the file content as a string, or null if the file does not exist.
   */
  loadPreferences(): string | null {
    if (!fs.existsSync(this.preferencesPath)) {
      return null;
    }
    try {
      return fs.readFileSync(this.preferencesPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Get the resolved path to the preferences file.
   */
  getPreferencesPath(): string {
    return this.preferencesPath;
  }
}
