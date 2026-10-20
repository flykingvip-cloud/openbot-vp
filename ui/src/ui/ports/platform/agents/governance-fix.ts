/**
 * One call to `agent-runtime.governance.fix`. The UI does not expand a category
 * into `agent-runtime.update-binding-state` calls.
 */

import type { RuntimeGovernanceIssueCategory } from "../../../capability/runtime-canonical/index.ts";

export const GOVERNANCE_FIX_METHOD = "agent-runtime.governance.fix";

export const LOW_SUCCESS_FIX_DEFER_REASON =
  "低成功率不是 agent-runtime.governance.fix 的 category，没有安全的自动修复。按钮保持禁用。";

export type GovernanceFixApplied = { issueId: string; bindingId: string; action: string };
export type GovernanceFixSkipped = { issueId: string; reason: string };

export type GovernanceFixResult =
  | { ok: true; dryRun: boolean; applied: GovernanceFixApplied[]; skipped: GovernanceFixSkipped[] }
  | { ok: false; error: string };

export function describeGovernanceFix(result: {
  applied: GovernanceFixApplied[];
  skipped: GovernanceFixSkipped[];
}): string {
  const skipped = result.skipped.map((entry) => `${entry.issueId}：${entry.reason}`).join("；");
  const summary = `已修复 ${result.applied.length} 项，跳过 ${result.skipped.length} 项`;
  if (result.applied.length === 0) {
    return skipped
      ? `${summary}。没有可自动修复的项。${skipped}`
      : `${summary}。没有可自动修复的项。`;
  }
  return skipped ? `${summary}。${skipped}` : `${summary}。`;
}

export async function requestGovernanceFix(
  request: <T>(method: string, params: unknown) => Promise<T>,
  params: { category: RuntimeGovernanceIssueCategory; dryRun: boolean },
): Promise<GovernanceFixResult> {
  try {
    const payload = await request<{
      dryRun?: unknown;
      applied?: unknown;
      skipped?: unknown;
    }>(GOVERNANCE_FIX_METHOD, params);
    if (
      payload?.dryRun !== params.dryRun ||
      !Array.isArray(payload.applied) ||
      !Array.isArray(payload.skipped)
    ) {
      return { ok: false, error: "网关返回与请求不一致，未记为成功" };
    }
    const applied: GovernanceFixApplied[] = [];
    for (const entry of payload.applied) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as { issueId?: unknown }).issueId !== "string" ||
        typeof (entry as { bindingId?: unknown }).bindingId !== "string" ||
        typeof (entry as { action?: unknown }).action !== "string"
      ) {
        return { ok: false, error: "网关返回与请求不一致，未记为成功" };
      }
      applied.push({
        issueId: (entry as { issueId: string }).issueId,
        bindingId: (entry as { bindingId: string }).bindingId,
        action: (entry as { action: string }).action,
      });
    }
    const skipped: GovernanceFixSkipped[] = [];
    for (const entry of payload.skipped) {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as { issueId?: unknown }).issueId !== "string" ||
        typeof (entry as { reason?: unknown }).reason !== "string"
      ) {
        return { ok: false, error: "网关返回与请求不一致，未记为成功" };
      }
      skipped.push({
        issueId: (entry as { issueId: string }).issueId,
        reason: (entry as { reason: string }).reason,
      });
    }
    return { ok: true, dryRun: params.dryRun, applied, skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "一键修复失败";
    return { ok: false, error: message };
  }
}
