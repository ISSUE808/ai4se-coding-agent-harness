interface GuardResult {
  blocked: boolean;
  level: 'block' | 'warn' | 'allow';
  rule?: string;
}

interface PatternRule {
  regex: RegExp;
  level: 'block' | 'warn';
  rule: string;
}

const RULES: PatternRule[] = [
  // === BLOCK 级别 ===
  // 递归删除根目录
  { regex: /\brm\s+.*-(?:r[^-\s]*f?|f[^-\s]*r|[^-]\S*[rf]\S*[rf])\S*\s+(?:--no-preserve-root\s+)?\/(?:\s|$)/, level: 'block', rule: 'recursive_delete_root' },
  // Windows 递归删除
  { regex: /\bdel\s+\/f\s+\/s\s+\/q\b/i, level: 'block', rule: 'windows_recursive_delete' },
  { regex: /\brmdir\s+\/s\s+\/q\b/i, level: 'block', rule: 'windows_recursive_delete' },
  // 磁盘级破坏
  { regex: /\bdd\s+if=/, level: 'block', rule: 'disk_destroy' },
  { regex: /\bmkfs\./, level: 'block', rule: 'disk_destroy' },
  // 系统关机
  { regex: /\b(shutdown|reboot|halt)\b/, level: 'block', rule: 'system_power' },
  // 保护分支 force push
  { regex: /\bgit\s+push\s+--force\s+\S+\s+(main|master)\b/, level: 'block', rule: 'protect_branch_force_push' },
  // 破坏 reflog
  { regex: /\bgit\s+reflog\s+expire\b/, level: 'block', rule: 'reflog_destroy' },
  { regex: /\bgit\s+gc\s+--prune/, level: 'block', rule: 'reflog_destroy' },
  // 管道到 shell 执行
  { regex: /\b(?:curl|wget)\b.*\|\s*(?:sh|bash)\b/, level: 'block', rule: 'pipe_to_shell' },
  // netcat 反向 shell
  { regex: /\bnc\s+/, level: 'block', rule: 'netcat' },

  // === WARN 级别 ===
  // force push（非保护分支）
  { regex: /\bgit\s+push\s+--force\b/, level: 'warn', rule: 'force_push' },
  // 不可恢复清理
  { regex: /\bgit\s+clean\s+-fd/, level: 'warn', rule: 'irreversible_clean' },
  // 丢弃未提交修改
  { regex: /\bgit\s+checkout\s+--\s+\.(?:\s|$)/, level: 'warn', rule: 'discard_changes' },
  { regex: /\bgit\s+reset\s+--hard\b/, level: 'warn', rule: 'discard_changes' },
  // 重写历史
  { regex: /\bgit\s+filter-branch\b/, level: 'warn', rule: 'rewrite_history' },
  // 系统文件权限修改
  { regex: /\bchmod\s+777\b/, level: 'warn', rule: 'system_permission' },
  { regex: /\bchown\s+\S+\s+\/(?:etc|usr)\b/, level: 'warn', rule: 'system_permission' },
  // 提权
  { regex: /\b(?:sudo|su)\b/, level: 'warn', rule: 'privilege_escalation' },
  // 系统服务修改
  { regex: /\b(?:crontab|systemctl)\b/, level: 'warn', rule: 'system_service' },
  // 强制杀进程
  { regex: /\bkill\s+-9\b/, level: 'warn', rule: 'force_kill' },
  // 外发网络请求（非管道）
  { regex: /\b(?:curl|wget)\s+/, level: 'warn', rule: 'outbound_network' },
  // 全局包安装
  { regex: /\bnpm\s+install\s+-g\b/, level: 'warn', rule: 'global_install' },
  // SSH/SCP 到外部
  { regex: /\b(?:ssh|scp)\s+/, level: 'warn', rule: 'remote_access' },
  // Docker 破坏性操作
  { regex: /\bdocker\s+(?:rm\s+-f|system\s+prune)\b/, level: 'warn', rule: 'docker_destructive' },
  // 数据库破坏操作
  { regex: /\bDROP\s+(?:TABLE|DATABASE)\b/i, level: 'warn', rule: 'database_destructive' },
  { regex: /\bTRUNCATE\b/i, level: 'warn', rule: 'database_destructive' },
];

export class PatternGuard {
  check(command: string): GuardResult {
    for (const rule of RULES) {
      if (rule.regex.test(command)) {
        return {
          blocked: rule.level === 'block',
          level: rule.level,
          rule: rule.rule,
        };
      }
    }
    return { blocked: false, level: 'allow' };
  }
}
