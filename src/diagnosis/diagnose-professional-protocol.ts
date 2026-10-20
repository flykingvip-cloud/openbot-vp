/**
 * Frozen contracts for professional diagnosis.
 * diagnose() is READ_ONLY. Growth facts are injected. Prescriptions are
 * server objects. Confirm writes cron ownership for the target, not the caller.
 * next-heartbeat is a cron wake mode, not an agent heartbeat config change.
 */
import { createHash } from "node:crypto";

export const DIAGNOSIS_DIAGNOSE_PERSIST_SCHEDULE = false as const;

/** Path B CONFIRM exception 2026-10-19 (pathb-confirm-exception): gray confirm opened. */
export const DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED = true as const;

export const DIAGNOSIS_PROFESSIONAL_REPORT_ARTIFACT = "diagnosis_professional_report" as const;

export const DIAGNOSIS_ZERO_FINDINGS_TEXT =
  "本窗完成运行证据扫描，未形成可展示故障结论；这表示当前证据不足，不代表系统正常或问题已恢复。" as const;

export const GROWTH_LOCATOR_LIMITATION =
  "成长评估只接受服务端注入的 canonical locator；客户端路径和 session 参数不是权威。" as const;

/** Track D / M1 — locator_failed is a structured finding, not zero-findings prose. */
export const DATA_PLANE_LOCATOR_FAILED_TEXT =
  "定位失败：未能解析权威工作区 locator。这是显式失败，不得当作证据不足或系统正常。" as const;

/** Track D / M1 — evidence SLO failures ask for 补观测. */
export const DATA_PLANE_EVIDENCE_SLO_TEXT =
  "证据SLO未达标：需补观测（空采样 / 近窗无产出 / 技能事件缺失），不得呈现为健康。" as const;

export const DATA_PLANE_MEMBER_EXPAND_EMPTY_TEXT = "成员展开：无成员绑定" as const;

export const IDENTITY_PRESCRIPTION_WAKE_TEXT =
  "向主人请求补充未确认字段。不要自行编造 IDENTITY 或 USER。" as const;

export const NO_ACTIVITY_MEMORY_TEXT = "本窗无任务活动，不据此判断记忆缺失。" as const;

export const NO_INSTALLED_SKILLS_TEXT = "未安装技能，不是本窗未使用。" as const;

export const ROLE_BASELINE_NOT_INJECTED_TEXT = "角色基线未注入，不据此判断预期缺口。" as const;

export const BOOTSTRAP_COMPLETE_TEXT = "入职引导：已收起（完成态，不是缺损）" as const;
export const BOOTSTRAP_PENDING_TEXT = "入职引导：未完成（BOOTSTRAP.md 仍在）" as const;

export const NEXT_ACTION_GATE_TEXT =
  "对话任务。被诊断数字人走 1:1 会话交接，不是协作小组共享。主人事项仍由大白代为收集。不是定时写入，确认灰度未开。" as const;

export const EVOLUTION_PRESCRIPTION_SCHEMA_VERSION = 1 as const;
export const EVOLUTION_PRESCRIPTION_PAYLOAD_VERSION = 1 as const;

export const EVOLUTION_PRESCRIPTION_STATES = [
  "PENDING_CONFIRMATION",
  "ALREADY_SCHEDULED",
  "APPLYING",
  "APPLIED",
  "EXPIRED",
  "REVOKED",
  "NOT_CONFIRMABLE",
  "FAILED",
] as const;
export type EvolutionPrescriptionState = (typeof EVOLUTION_PRESCRIPTION_STATES)[number];

/** Both kinds are cron jobs. Neither edits agent heartbeat cadence or config. */
export const EVOLUTION_CRON_KINDS = ["scheduled_agent_turn", "next_heartbeat_cron"] as const;
export type EvolutionCronKind = (typeof EVOLUTION_CRON_KINDS)[number];

export const CAPABILITY_EVIDENCE_CLASSES = [
  "evidenced_success",
  "evidenced_unstable",
  "installed_unobserved",
  "baseline_gap_candidate",
] as const;

export function memoryMayBeJudgedMissing(input: {
  hadTaskActivity: boolean;
  fresh: boolean;
}): boolean {
  return input.hadTaskActivity && !input.fresh;
}

export function evolutionPrescriptionId(input: {
  schemaVersion: number;
  tenantId: string;
  agentAssetId: string;
  purpose: string;
  normalizedSchedule: string;
  payloadVersion: number;
}): string {
  const material = [
    String(input.schemaVersion),
    input.tenantId.trim(),
    input.agentAssetId.trim(),
    input.purpose.trim(),
    input.normalizedSchedule.trim(),
    String(input.payloadVersion),
  ].join("\n");
  return createHash("sha256").update(material).digest("hex").slice(0, 24);
}

export function normalizeEvolutionSchedule(kind: EvolutionCronKind, scheduleExpr: string): string {
  return `${kind}|${scheduleExpr.trim()}`;
}

export function professionalReportId(input: {
  tenantId: string | null;
  sourceReportIds: readonly string[];
  windowId: string;
  mode: string;
}): string {
  const sources = [...input.sourceReportIds];
  const material = [
    "professional-report/v1",
    input.tenantId ?? "",
    sources.join("\n"),
    input.windowId,
    input.mode,
  ].join("\n");
  return `pdr-${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}
