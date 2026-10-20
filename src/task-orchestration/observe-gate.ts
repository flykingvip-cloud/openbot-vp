/**
 * P3 observe gate. Reads this turn's user text.
 * Empty text stays on the legacy recall_memory probe.
 * Enqueue admission requires a tenant allowlist hit and an explicit stepped kind.
 * Dispatch still defaults OFF, so admission alone does not change chat.
 */
import { ORCH_TENANT_ALLOWLIST_ENV, readOrchestrationFlags } from "./feature.js";
import type { StepIntent } from "./types.js";

export const STEPPED_TASK_KIND = "stepped" as const;

export type ExplicitTaskKind = typeof STEPPED_TASK_KIND;

export type OrchestrationObserveResolution = {
  intent: StepIntent;
  taskKind: ExplicitTaskKind | null;
  allowlistEmpty: boolean;
  /** Reply loop may run. Requires dispatch ON, allowlist, and an explicit kind. */
  admitted: boolean;
};

const STEPPED_RE = /分步骤|分步完成|按步骤/u;

const INTENT_RULES: ReadonlyArray<{ intent: StepIntent; re: RegExp }> = [
  { intent: "broadcast", re: /群发|广播给/u },
  { intent: "send_message", re: /发(?:一)?条消息|发送消息/u },
  { intent: "write_external", re: /写入外部|写到外部系统/u },
  { intent: "exec_user_machine", re: /在我的电脑上执行|本机执行/u },
  { intent: "read_user_machine", re: /读取我的电脑|本机文件/u },
  { intent: "interact_web", re: /浏览器里操作|打开网页并/u },
  { intent: "read_web", re: /检索(?:公开)?网页|https?:\/\//iu },
  { intent: "use_connector", re: /用连接器/u },
  { intent: "apply_skill", re: /使用技能|分步骤|分步完成|按步骤/u },
];

export function readOrchTenantAllowlist(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env[ORCH_TENANT_ALLOWLIST_ENV] ?? "";
  return new Set(
    raw
      .split(/[,;\s]+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

export function isOrchTenantAllowlisted(
  tenantId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const id = typeof tenantId === "string" ? tenantId.trim() : "";
  if (!id) {
    return false;
  }
  return readOrchTenantAllowlist(env).has(id);
}

export function classifyUtteranceIntent(text: string | null | undefined): {
  intent: StepIntent;
  taskKind: ExplicitTaskKind | null;
} {
  const raw = typeof text === "string" ? text.trim() : "";
  const taskKind = raw && STEPPED_RE.test(raw) ? STEPPED_TASK_KIND : null;
  if (!raw) {
    return { intent: "recall_memory", taskKind: null };
  }
  for (const rule of INTENT_RULES) {
    if (rule.re.test(raw)) {
      return { intent: rule.intent, taskKind };
    }
  }
  return { intent: "recall_memory", taskKind };
}

export function resolveOrchestrationObserve(
  input: { tenantId?: string | null; text?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): OrchestrationObserveResolution {
  const classified = classifyUtteranceIntent(input.text);
  const flags = readOrchestrationFlags(env);
  const explicit = classified.taskKind != null;
  const allowlisted = isOrchTenantAllowlisted(input.tenantId, env);
  const allowlistEmpty = !(explicit && allowlisted);
  return {
    intent: classified.intent,
    taskKind: classified.taskKind,
    allowlistEmpty,
    admitted: flags.dispatchEnabled && !allowlistEmpty,
  };
}
