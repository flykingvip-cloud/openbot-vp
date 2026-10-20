/**
 * 只读/可选修复：平台套餐版本与模型绑定一致性扫描。
 *
 * 默认只读，输出 JSON 报告：
 * - current/active version 缺 binding
 * - orphan binding（引用不存在的 planVersion）
 * - binding 含目录外模型
 *
 * 用法：
 *   bun scripts/audit-plan-model-bindings.ts
 *   bun scripts/audit-plan-model-bindings.ts --delete-orphans
 *
 * 当前仅支持安全修复 orphan binding；其它问题先报告，不自动改写。
 */

import { loadConfig } from "../src/config/config.ts";
import {
  checkPlanBindingIntegrity,
  type EntitlementDoctorIssue,
} from "../src/gateway/model-entitlement/doctor-checks.ts";
import { deletePlanVersionModelBinding } from "../src/gateway/model-entitlement/plan-version-model-binding-store.ts";

type AuditReport = {
  dryRun: boolean;
  deleteOrphans: boolean;
  summary: Record<string, number>;
  issues: EntitlementDoctorIssue[];
  deletedOrphans: string[];
};

function summarize(issues: EntitlementDoctorIssue[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const issue of issues) {
    summary[issue.code] = (summary[issue.code] ?? 0) + 1;
  }
  return summary;
}

async function run(): Promise<void> {
  const deleteOrphans = process.argv.includes("--delete-orphans");
  const cfg = loadConfig();
  const issues = await checkPlanBindingIntegrity(cfg);
  const deletedOrphans: string[] = [];

  if (deleteOrphans) {
    for (const issue of issues) {
      if (issue.code !== "plan_binding_orphan" || !issue.planVersionId) {
        continue;
      }
      const deleted = await deletePlanVersionModelBinding(issue.planVersionId);
      if (deleted) {
        deletedOrphans.push(issue.planVersionId);
      }
    }
  }

  const report: AuditReport = {
    dryRun: !deleteOrphans,
    deleteOrphans,
    summary: summarize(issues),
    issues,
    deletedOrphans,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

void run();
