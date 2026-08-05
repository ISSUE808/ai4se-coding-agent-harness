/**
 * Platform guidance injected into the agent's system context (KNOWN_ISSUES 5).
 *
 * On Windows the agent's shell is Git Bash (run_shell resolution), which is
 * mostly POSIX but lacks common Unix tools (`xxd` belongs to the vim package
 * and is absent) — without this note the LLM emits `xxd`-style commands that
 * fail on first try and burn a round. Also surfaces the encoding/npx traps
 * that were discovered by real tests (KNOWN_ISSUES 2/4). POSIX platforms get
 * no guidance — the common case stays silent.
 */
export function platformGuidance(platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') {
    return undefined;
  }
  return [
    '当前运行平台：Windows。',
    '环境提示：',
    '- run_shell 通过 Git Bash 执行（已安装时），POSIX 语法可用；Git Bash 未安装时回退 cmd，不认 POSIX 语法。',
    '  部分 Unix 工具不存在：',
    '  - `xxd` 不可用，查看原始字节用 `od -A x -t x1z <file>`',
    '  - 不确定工具是否存在时先 `command -v <tool>` 确认',
    '- Windows PowerShell 5.1 重定向创建的文件默认 UTF-16LE 编码（read_file 可自动识别 BOM）；创建文本文件建议显式 `-Encoding utf8`',
    '- 优先使用工作区内已安装的工具（node_modules/.bin）：裸 `npx <pkg>` 会在本地未安装时下载 npm 包',
    '  （`npx tsc` 会下载废弃同名包 tsc@2.0.4，不是 TypeScript——请勿使用裸 npx 跑 tsc/eslint）',
  ].join('\n');
}
