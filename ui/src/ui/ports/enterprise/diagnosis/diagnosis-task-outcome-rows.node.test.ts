/** @vitest-environment jsdom */
import { render } from "lit";
import { describe, expect, it } from "vitest";
import { diagnosisSourceLabel, diagnosisTaskOutcomeRows } from "./diagnosis-task-outcome-rows.ts";
import {
  renderEnterpriseDiagnosisSurface,
  type DiagnosisViewModel,
} from "./enterprise-diagnosis-surface.ts";

function model(): DiagnosisViewModel {
  return {
    role: "enterprise",
    tenantScope: "tenant-a",
    redactionProfile: "administrator",
    permissionState: "allowed",
    health: { tone: "empty", label: "无样本", openP0: 0, openP1: 0, inconclusive: 0, expired: 0 },
    cases: [],
    drilldown: [],
    timeline: { events: [] },
    trend: { window: { from: "", to: "" }, completeness: "empty", buckets: [], missingBuckets: [] },
    graph: { nodes: [], edges: [] },
    authorizations: { rows: [], pendingApprovals: [] },
    remediations: [],
    conversationEntries: [],
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
    },
  };
}

describe("diagnosis task outcome rows", () => {
  it("uses roster labels and does not invent handling or recheck", () => {
    expect(
      diagnosisSourceLabel({
        selectedTargetId: "agent:bot",
        targets: [{ id: "agent:bot", kind: "agent", label: "客服" }],
      }),
    ).toBe("数字人 客服");
    const empty = diagnosisTaskOutcomeRows({ sourceLabel: "未声明" });
    expect(empty.map((row) => row.value)).toEqual([
      "未声明",
      "未声明",
      "未声明",
      "尚未处理",
      "未复验",
    ]);
    const corrected = diagnosisTaskOutcomeRows({
      sourceLabel: "协作小组 交付组",
      evidence: {
        ok: true,
        taskId: "task-1",
        outcomeVersion: 5,
        judgement: "failure",
        reasonCode: "correction",
        revisionKind: "correction",
      },
    });
    expect(corrected.find((row) => row.label === "当前处理")?.value).toBe("失败（correction）");
    expect(corrected.find((row) => row.label === "复验结果")?.value).toBe("未复验");
    expect(JSON.stringify(corrected)).not.toContain("已重新执行");
    const stale = diagnosisTaskOutcomeRows({
      sourceLabel: "数字人 客服",
      evidence: { ok: false, code: "outcome_version_changed", taskId: "task-1" },
    });
    expect(stale.find((row) => row.label === "结果版本")?.value).toBe("证据已过期");
    expect(stale.find((row) => row.label === "当前处理")?.value).toBe("尚未处理");

    const container = document.createElement("div");
    render(
      renderEnterpriseDiagnosisSurface(model(), {
        targets: [
          {
            id: "group:g1",
            kind: "group",
            label: "交付组",
            agentId: "bot",
            sessionKey: "s",
            steward: false,
          },
        ],
        selectedTargetId: "group:g1",
        lastDiagnose: {
          kind: "done",
          taskOutcomeEvidence: {
            ok: true,
            taskId: "task-1",
            outcomeVersion: 5,
            judgement: "failure",
            revisionKind: "correction",
            reasonCode: "correction",
          },
        },
      }),
      container,
    );
    const block =
      container.querySelector("[data-testid=diagnosis-task-outcome]")?.textContent ?? "";
    expect(block).toContain("协作小组 交付组");
    expect(block).toContain("task-1");
    expect(block).not.toContain("证据已过期");
    expect(block).toContain("失败（correction）");
    expect(block).toContain("未复验");
    expect(block).not.toContain("已重新执行");
  });
});
