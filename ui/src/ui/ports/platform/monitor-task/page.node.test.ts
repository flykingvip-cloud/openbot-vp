// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import "./page.ts";
import { downloadTextFile } from "./monitor-report.ts";

function client() {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "diagnosis.job.describe") {
      return {
        ok: true,
        definition: {
          filters: {
            agentIds: ["agent-aa11"],
            groupId: null,
            failure: { enabled: false, minCount: null },
            efficiency: { maxTotalMs: null },
          },
        },
        binding: { paused: false },
        cadence: "daily",
        runs: [
          {
            runId: "run-0a3f",
            status: "completed",
            startedAt: "2026-10-11T08:00:00.000Z",
            finishedAt: "2026-10-11T08:05:00.000Z",
            reportId: "rpt-1",
          },
        ],
      };
    }
    if (method === "diagnosis.job.report.get") {
      return {
        report: {
          tenantId: params.tenantId,
          runId: "run-0a3f",
          filter: {
            agentId: "agent-aa11",
            failure: { enabled: true, minCount: 1 },
            efficiency: { maxTotalMs: null },
          },
          matched: [
            {
              sourceRunId: "src-1",
              eventId: "ev-1",
              agentId: "agent-aa11",
              groupId: null,
              failure: true,
              efficiencyBreach: false,
            },
          ],
        },
      };
    }
    if (method === "diagnosis.job.run") {
      return { ok: true, run: { runId: "run-manual", status: "running", reportId: null } };
    }
    if (method === "mesh.ownership.list") {
      return { agents: [] };
    }
    return { ok: true, schedule: { cadence: "daily" }, definition: {}, binding: { paused: false } };
  });
  return { connected: true, request };
}

async function mount() {
  const el = document.createElement("openbot-platform-monitor-task");
  const gateway = client();
  el.client = gateway as never;
  el.tenants = [{ tenantId: "tenant-a1b2", label: "示例企业 A" }];
  el.agents = [
    { agentId: "agent-aa11", label: "客服助手 Alpha" },
    { agentId: "agent-bb22", label: "销售助手 Beta" },
  ];
  el.groups = [{ groupId: "group-1", label: "值班组", roundId: "round-1" }];
  document.body.append(el);
  await el.updateComplete;
  return { el, gateway };
}

describe("platform monitor task page", () => {
  it("loads, saves, runs, and exports through the job methods", async () => {
    const { el, gateway } = await mount();
    (el.querySelector("[data-testid=monitor-tenant-search]") as HTMLInputElement).focus();
    await el.updateComplete;
    (el.querySelector("[data-tenant-id=tenant-a1b2]") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(el.querySelector("[data-testid=monitor-tenant-id]")?.textContent).toContain(
        "tenant-a1b2",
      );
    });
    expect(gateway.request).toHaveBeenCalledWith("diagnosis.job.describe", {
      tenantId: "tenant-a1b2",
    });
    expect(el.textContent).toContain("cadence = daily");

    (el.querySelector("[data-testid=monitor-edit]") as HTMLButtonElement).click();
    await el.updateComplete;
    (el.querySelector("[data-agent-id=agent-bb22]") as HTMLInputElement).click();
    await el.updateComplete;
    (el.querySelector("[data-testid=monitor-save]") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(gateway.request).toHaveBeenCalledWith(
        "diagnosis.schedule.apply",
        expect.objectContaining({
          tenantId: "tenant-a1b2",
          cadence: "daily",
          agentIds: ["agent-aa11", "agent-bb22"],
        }),
      );
    });
    const scheduleCall = gateway.request.mock.calls.find(
      (call) => call[0] === "diagnosis.schedule.apply",
    );
    expect(scheduleCall?.[1]).not.toHaveProperty("repair");
    expect(JSON.stringify(scheduleCall?.[1])).not.toContain("岗位");
    await vi.waitFor(() => {
      expect(el.querySelector("[data-testid=monitor-run]")).toBeTruthy();
    });

    (el.querySelector("[data-testid=monitor-run]") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(gateway.request).toHaveBeenCalledWith(
        "diagnosis.job.run",
        expect.objectContaining({ tenantId: "tenant-a1b2" }),
      );
    });

    (el.querySelector("[data-testid=monitor-open-report]") as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(el.querySelector("[data-testid=monitor-report]")).toBeTruthy();
    });
    expect(gateway.request).toHaveBeenCalledWith("diagnosis.job.report.get", {
      tenantId: "tenant-a1b2",
      reportId: "rpt-1",
    });

    const clicks: string[] = [];
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function click(this: HTMLAnchorElement) {
        clicks.push(this.download);
      });
    (el.querySelector("[data-testid=monitor-export-md]") as HTMLButtonElement).click();
    (el.querySelector("[data-testid=monitor-export-yaml]") as HTMLButtonElement).click();
    spy.mockRestore();
    expect(clicks).toEqual([
      "m1-monitor-tenant-a1b2-run-0a3f.md",
      "m1-monitor-tenant-a1b2-run-0a3f.yaml",
    ]);
    el.remove();
  });

  it("downloads a text file under the report filename", () => {
    const names: string[] = [];
    const spy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function click(this: HTMLAnchorElement) {
        names.push(this.download);
      });
    downloadTextFile("m1-monitor-tenant-a-run-1.md", "# 监测报告\n", "text/markdown");
    spy.mockRestore();
    expect(names).toEqual(["m1-monitor-tenant-a-run-1.md"]);
  });
});
