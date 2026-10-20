/**
 * 席位规则保存与运行时注入共用的失败关闭扫描。
 * 命中即整段拒绝或从本回合剔除，不截断后生效。
 */
export type SeatRuleContentReason =
  | "secret"
  | "disable_approval"
  | "skip_security"
  | "elevate"
  | "change_host"
  | "credential_policy"
  | "execution_placement"
  | "skip_confirmation"
  | "cross_scope";

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
  /\b(api[_-]?key|secret|access[_-]?token|token|password|passwd|pwd)\b\s*[:=]\s*\S+/i,
  /\bsk-[A-Za-z0-9]{8,}\b/,
  /\bAKIA[0-9A-Z]{8,}\b/,
  /\b(?:mongodb|mongodb\+srv|postgres|postgresql|mysql|redis|amqp):\/\/\S+/i,
  /\bServer\s*=\s*[^;]+;[^;\n]*Password\s*=/i,
];

const RELAXATION_PATTERNS: readonly { reason: SeatRuleContentReason; pattern: RegExp }[] = [
  {
    reason: "disable_approval",
    pattern: /关闭审批|停用审批|disable approvals?|turn off approvals?|ask\s*=\s*off/i,
  },
  {
    reason: "skip_security",
    pattern: /跳过安全|skip security|bypass security|security\s*=\s*full/i,
  },
  {
    reason: "elevate",
    pattern: /提升权限|elevate(?:d)? privileges?|\belevated\s*=\s*full\b/i,
  },
  {
    reason: "change_host",
    pattern: /改\s*host|修改\s*host|change\s+(?:the\s+)?host|tools\.exec\.host/i,
  },
  {
    reason: "credential_policy",
    pattern: /凭证策略|credential policy|seat_personal/i,
  },
  {
    reason: "execution_placement",
    pattern: /执行落点|execution placement/i,
  },
  {
    reason: "skip_confirmation",
    pattern:
      /不用确认就执行|无需确认就执行|不用确认|无需确认|execute without confirm|without confirmation|skip confirmation|avoid unnecessary confirmation|confirmationPreference/i,
  },
  {
    reason: "cross_scope",
    pattern:
      /其他租户|其它租户|其他席位|其它席位|其他员工|其它员工|another tenant|other tenant|cross-tenant|another seat|other seat|another employee|other employee/i,
  },
];

export function inspectSeatRuleText(text: string): SeatRuleContentReason | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return "secret";
    }
  }
  for (const entry of RELAXATION_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.reason;
    }
  }
  return null;
}

const PROHIBITION =
  /(?:\b(?:do not|don't|dont|never|must not|cannot|can't)\b|禁止|不得|不要|不能)/i;

function guidanceSubject(text: string): string {
  return text
    .toLowerCase()
    .replace(PROHIBITION, " ")
    .replace(/请|务必|应该|\b(?:please|kindly)\b/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 更高层禁止、更低层允许同一主题时视为冲突。
 * 纯文本没有安全全序，冲突则失败关闭，不让模型自己挑。
 */
export function guidanceLinesConflict(higher: string, lower: string): boolean {
  const higherProhibits = PROHIBITION.test(higher);
  const lowerProhibits = PROHIBITION.test(lower);
  if (higherProhibits === lowerProhibits) {
    return false;
  }
  const higherSubject = guidanceSubject(higher);
  const lowerSubject = guidanceSubject(lower);
  if (higherSubject.length >= 4 && lowerSubject.includes(higherSubject)) {
    return true;
  }
  if (lowerSubject.length >= 4 && higherSubject.includes(lowerSubject)) {
    return true;
  }
  return false;
}
