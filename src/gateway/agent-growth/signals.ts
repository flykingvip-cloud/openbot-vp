/**
 * Agent Growth OS — Capability Readiness 信号采集（spec: agent-growth-lifecycle, P0A 任务 2.1a）。
 *
 * 评审决策（RISK-007）：
 * - Skill：P0A 真实接入（required skill 是否安装）。数据由调用方（recompute RPC）从 robot-skills 读取后注入，
 *   本模块保持纯函数，便于单测且受 NFR-1 recompute P95<500ms 约束。
 * - OAuth / 外部权限：P0A 恒 `"unknown"`（Provider 尚未接入，不计分、不扣分、不阻塞）。
 */

import type { GrowthCapabilityGapView } from "./next-action.js";
import type { AgentTemplate, CapabilityReadinessSignals } from "./types.js";

/** 模板中 required 的 skill key 集合。 */
export function requiredSkillKeys(template: Pick<AgentTemplate, "requiredCapabilities">): string[] {
  return template.requiredCapabilities
    .filter((cap) => cap.required && cap.kind === "skill")
    .map((cap) => cap.key);
}

/** 模板中 required 的 oauth key 集合（P0A 仅用于展示缺口，不参与就绪计算）。 */
export function requiredOauthKeys(template: Pick<AgentTemplate, "requiredCapabilities">): string[] {
  return template.requiredCapabilities
    .filter((cap) => cap.required && cap.kind === "oauth")
    .map((cap) => cap.key);
}

/** 全部 required skill 是否均已安装。无 required skill 时为 true（generic_worker 降级）。 */
export function computeRequiredSkillsInstalled(
  template: Pick<AgentTemplate, "requiredCapabilities">,
  installedSkillKeys: Iterable<string>,
): boolean {
  const required = requiredSkillKeys(template);
  if (required.length === 0) {
    return true;
  }
  const installed = new Set(installedSkillKeys);
  return required.every((key) => installed.has(key));
}

/**
 * P0A 权限信号：恒 `"unknown"`（OAuth Projection 未接入）。
 * P0B+ 接入 operational-identity 后改为真实 true/false。
 */
export function collectPermissionSignal(): CapabilityReadinessSignals["requiredPermissionsGranted"] {
  return "unknown";
}

/** 组装 capabilityReadiness 信号（P0A：skill 真实，oauth unknown）。 */
export function collectCapabilityReadinessSignals(params: {
  template: Pick<AgentTemplate, "requiredCapabilities">;
  installedSkillKeys: Iterable<string>;
}): CapabilityReadinessSignals {
  return {
    requiredSkillsInstalled: computeRequiredSkillsInstalled(
      params.template,
      params.installedSkillKeys,
    ),
    requiredPermissionsGranted: collectPermissionSignal(),
  };
}

/** 缺口列表（UI Prelude 用）：未安装 required skill + 全部 required oauth（P0A 标记待接入）。 */
export function computeCapabilityGaps(params: {
  template: Pick<AgentTemplate, "requiredCapabilities">;
  installedSkillKeys: Iterable<string>;
}): Array<{ key: string; kind: "skill" | "oauth"; status: "missing" | "pending_integration" }> {
  const installed = new Set(params.installedSkillKeys);
  const gaps: Array<{
    key: string;
    kind: "skill" | "oauth";
    status: "missing" | "pending_integration";
  }> = [];
  for (const key of requiredSkillKeys(params.template)) {
    if (!installed.has(key)) {
      gaps.push({ key, kind: "skill", status: "missing" });
    }
  }
  for (const key of requiredOauthKeys(params.template)) {
    // P0A：OAuth 一律标记「待接入」，不计入未授权。
    gaps.push({ key, kind: "oauth", status: "pending_integration" });
  }
  return gaps;
}

/**
 * 模板 requiredCapabilities 全量视图（含已满足项），供 get-growth-status / Prelude 详情。
 * knowledge_binding / workflow：P0 仅展示，不进入 install 主建议强制列表。
 */
export function buildCapabilityGapViews(params: {
  template: Pick<AgentTemplate, "requiredCapabilities">;
  installedSkillKeys: Iterable<string>;
}): GrowthCapabilityGapView[] {
  const installed = new Set(params.installedSkillKeys);
  const views: GrowthCapabilityGapView[] = [];
  for (const cap of params.template.requiredCapabilities) {
    if (!cap.required) {
      continue;
    }
    if (cap.kind === "skill") {
      views.push({
        key: cap.key,
        label: cap.label,
        kind: "skill",
        status: installed.has(cap.key) ? "satisfied" : "missing",
      });
      continue;
    }
    if (cap.kind === "oauth") {
      views.push({
        key: cap.key,
        label: cap.label,
        kind: "oauth",
        status: "pending_integration",
      });
      continue;
    }
    views.push({
      key: cap.key,
      label: cap.label,
      kind: cap.kind,
      status: "missing",
    });
  }
  return views;
}
