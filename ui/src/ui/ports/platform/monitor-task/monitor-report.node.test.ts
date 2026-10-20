import { describe, expect, it } from "vitest";
import {
  monitorReportFilename,
  monitorReportFromJob,
  renderMonitorMachineYaml,
  renderMonitorReportMarkdown,
  renderMonitorReportYaml,
} from "./monitor-report.ts";

const doc = monitorReportFromJob({
  tenantLabel: "示例企业 A",
  cadence: "daily",
  trigger: "manual",
  roundId: null,
  window: { start: "2026-10-10T00:00:00.000Z", end: "2026-10-11T00:00:00.000Z" },
  report: {
    tenantId: "tenant-a",
    runId: "run-1",
    filter: {
      agentId: "agent-a",
      groupId: null,
      failure: { enabled: true, minCount: 1 },
      efficiency: { maxTotalMs: null },
    },
    matched: [
      {
        sourceRunId: "src-1",
        eventId: "ev-1",
        agentId: "agent-a",
        groupId: null,
        failure: true,
        efficiencyBreach: false,
      },
    ],
  },
});

describe("monitor report export", () => {
  it("names the full report file from tenant and run", () => {
    expect(monitorReportFilename(doc, "md")).toBe("m1-monitor-tenant-a-run-1.md");
    expect(monitorReportFilename(doc, "yaml")).toBe("m1-monitor-tenant-a-run-1.yaml");
  });

  it("puts machine text, Chinese summary, and fix guidance in both files", () => {
    const markdown = renderMonitorReportMarkdown(doc);
    const yaml = renderMonitorReportYaml(doc);
    for (const body of [markdown, yaml]) {
      expect(body).toContain("tenantId:");
      expect(body).toContain("m1.failure");
      expect(body).toContain("失败已越界");
    }
    expect(markdown).toContain("## 机器可读");
    expect(markdown).toContain("## 中文摘要");
    expect(markdown).toContain("## 修复指引");
    expect(markdown).toContain("建议改哪里");
    expect(markdown).toContain("复现步骤");
    expect(markdown).toContain("验收标准");
    expect(yaml).toContain("# 中文摘要");
    expect(yaml).toContain("# 修复指引");
    expect(yaml).toContain("where:");
    expect(yaml).toContain("reproduce:");
    expect(yaml).toContain("accept:");
    expect(renderMonitorMachineYaml(doc)).toContain("trigger: manual");
    expect(renderMonitorMachineYaml(doc)).not.toContain("summary:");
  });

  it("omits role, correctness score, confirm, and repair entries", () => {
    const yaml = renderMonitorReportYaml(doc);
    expect(yaml).not.toMatch(/岗位|position:|diagnoseScore|confirm:|repair:/);
    expect(doc.metrics.failure.breached).toBe(true);
    expect(doc.metrics.efficiency.breached).toBe(false);
  });
});
