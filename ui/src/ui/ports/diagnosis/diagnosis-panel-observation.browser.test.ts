import { html, render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../gateway.ts";
import { clearRuntimeObservations, recordRuntimeObservation } from "../../runtime-observation.ts";
import "./diagnosis-panel.ts";
import type { OpenBotDiagnosisPanel } from "./diagnosis-panel.ts";

function waitFor(assertion: () => void, at = performance.now()): Promise<void> {
  try {
    assertion();
    return Promise.resolve();
  } catch (error) {
    if (performance.now() - at > 3000) {
      return Promise.reject(error);
    }
    return new Promise<void>((resolve) => setTimeout(resolve, 20)).then(() =>
      waitFor(assertion, at),
    );
  }
}

describe("diagnosis panel observation origin", () => {
  it("keeps the selected session and sends its real runId, then renders returned experiment state", async () => {
    const host = {};
    clearRuntimeObservations(host);
    const request = vi.fn(async (method: string) => {
      if (method === "diagnosis.diagnose") {
        return {
          reportId: "report-run-1",
          completion: "done",
          findingCount: 1,
          findings: [{ findingId: "f1", severity: "warn", status: "open" }],
          evolutionProjections: [
            {
              candidateVersion: "candidate-run-1",
              found: false,
              liveStatus: null,
              experimentId: null,
              canRequestExperiment: true,
              requestExperimentHint: "申请开实验",
            },
          ],
        };
      }
      if (method === "diagnosis.reports.query") {
        return {
          items: [],
          nextCursor: null,
          authorization: { outcome: "allow" },
          audit: { decision: "allow" },
        };
      }
      throw new Error(`Unexpected method ${method}`);
    });
    const client = { connected: true, request } as unknown as GatewayBrowserClient;
    const targets = [
      {
        id: "agent:main",
        kind: "agent",
        label: "运行目标",
        agentId: "main",
        sessionKey: "agent:main:main",
        steward: false,
      },
    ] as const;
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<openbot-diagnosis-panel
      role="enterprise" tenant-id="t1"
      .client=${client} .targets=${targets} .observationHost=${host} connected
    ></openbot-diagnosis-panel>`,
      container,
    );
    await customElements.whenDefined("openbot-diagnosis-panel");
    const component = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await component.updateComplete;
    await waitFor(() => expect(component.querySelector('[aria-label="观测目标"]')).not.toBeNull());
    const select = component.querySelector<HTMLSelectElement>('[aria-label="观测目标"]')!;
    expect(select).not.toBeNull();
    select.value = "agent:main:main";
    select.dispatchEvent(new Event("change"));
    await component.updateComplete;
    await waitFor(() =>
      expect(
        component.querySelector<HTMLSelectElement>('[data-testid="diagnosis-target-select"]')
          ?.value,
      ).toBe("agent:main"),
    );
    recordRuntimeObservation(
      host,
      "agent:main:main",
      {
        runId: "run_from_event",
        sourceRunId: "engine_from_event",
        sessionKey: "agent:main:main",
        seq: 1,
        ts: 10,
        stream: "lifecycle",
        data: { phase: "start" },
      },
      100,
    );
    await component.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const run = [...component.querySelectorAll<HTMLButtonElement>(".obs-run")].find((row) =>
      row.dataset.runId?.includes("run_from_event"),
    )!;
    run.click();
    await component.updateComplete;
    component.querySelector<HTMLButtonElement>('[aria-label="关闭证据"]')!.click();
    await component.updateComplete;
    component.querySelector<HTMLButtonElement>(".obs-improvement .obs-primary")!.click();
    await waitFor(() =>
      expect(request.mock.calls.some(([method]) => method === "diagnosis.diagnose")).toBe(true),
    );
    const call = request.mock.calls.find(([method]) => method === "diagnosis.diagnose");
    expect(call).toBeDefined();
    const [method, params] = call as unknown as [string, Record<string, unknown>];
    expect(method).toBe("diagnosis.diagnose");
    expect(params).toMatchObject({
      sessionKey: "agent:main:main",
      agentId: "main",
      runId: "run_from_event",
      scope: "target",
    });
    await waitFor(() =>
      expect(
        component.querySelector('[data-testid="diagnosis-evolution-projection"]')?.textContent,
      ).toContain("preview only · 未提交"),
    );
    expect(component.textContent).toContain("申请开实验");
    expect(
      request.mock.calls.filter(([name]) =>
        /evolution\.|authorization\.|config\./.test(String(name)),
      ),
    ).toHaveLength(0);
    container.remove();
  });
});

describe("observation evidence query", () => {
  it("uses an exact result version and drops responses after permission revocation", async () => {
    let resolveEvidence: ((value: unknown) => void) | undefined;
    const request = vi.fn((method: string) => {
      if (method === "diagnosis.observation.query") {
        return new Promise((resolve) => {
          resolveEvidence = resolve;
        });
      }
      return Promise.resolve({
        items: [],
        nextCursor: null,
        authorization: { outcome: "allow" },
        audit: { decision: "allow" },
      });
    });
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<openbot-diagnosis-panel role="enterprise" tenant-id="t1" .client=${{ connected: true, request }} .scopes=${["operator.read"]} .gatewayMethods=${["diagnosis.observation.query"]} .taskOutcomeRef=${{ taskId: "task1", agentId: "main", outcomeVersion: 3 }} connected></openbot-diagnosis-panel>`,
      container,
    );
    const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await waitFor(() => expect(resolveEvidence).toBeDefined());
    const call = request.mock.calls.find(
      ([method]) => method === "diagnosis.observation.query",
    ) as unknown as [string, Record<string, unknown>];
    expect(call[1]).toMatchObject({ taskId: "task1", agentId: "main", outcomeVersion: 3 });
    expect(Number(call[1].from)).toBeLessThan(Number(call[1].to));
    panel.scopes = [];
    await panel.updateComplete;
    resolveEvidence!({ schemaVersion: 1, metricDictVersion: 1, samples: [{ sampleId: "stale" }] });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
    expect(panel.textContent).toContain("业务结果未知");
    expect(
      request.mock.calls.filter(([method]) => method === "diagnosis.observation.query"),
    ).toHaveLength(1);
    container.remove();
  });
});

describe("evidence response races", () => {
  it.each(["methods", "client", "tenant", "version", "reattach", "reconnect"])(
    "drops old business evidence after %s changes",
    async (change) => {
      const pending: ((value: unknown) => void)[] = [];
      const request = vi.fn((method: string) =>
        method === "diagnosis.observation.query"
          ? new Promise((resolve) => pending.push(resolve))
          : Promise.resolve({
              items: [],
              authorization: { outcome: "allow" },
              audit: { decision: "allow" },
            }),
      );
      const container = document.createElement("div");
      document.body.append(container);
      render(
        html`<openbot-diagnosis-panel role="enterprise" tenant-id="t1" .client=${{ connected: true, request }} .scopes=${["operator.read"]} .gatewayMethods=${["diagnosis.observation.query"]} .taskOutcomeRef=${{ taskId: "task1", agentId: "main", outcomeVersion: 3 }} connected></openbot-diagnosis-panel>`,
        container,
      );
      const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
      await waitFor(() => expect(pending.length).toBe(1));
      if (change === "methods") {
        panel.gatewayMethods = [];
      }
      if (change === "client") {
        panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
      }
      if (change === "tenant") {
        panel.tenantId = "t2";
      }
      if (change === "version") {
        panel.taskOutcomeRef = { taskId: "task1", agentId: "main", outcomeVersion: 4 };
      }
      if (change === "reattach") {
        panel.remove();
        container.append(panel);
      }
      if (change === "reconnect") {
        panel.connected = false;
        await panel.updateComplete;
        expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
        panel.connected = true;
      }
      const fixture = (taskId: string) => ({
        schemaVersion: 1,
        metricDictVersion: 1,
        projectedAt: 1,
        sourceWatermark: null,
        window: { from: 0, to: 2 },
        coverage: null,
        samples: [
          {
            sampleId: taskId,
            qualification: "outcome_only",
            provenance: ["unknown"],
            reasons: [],
            evidence: {
              resource: "unknown",
              technical: "unknown",
              execution: "unknown",
              business: "present",
            },
            evidenceReasons: { resource: [], technical: [], execution: [], business: [] },
            outcome: {
              taskId,
              outcomeVersion: 3,
              isCurrentTip: true,
              taskJudgement: "success",
              lifecycle: "closed",
              acceptanceStatus: "accepted",
              deliveryStatus: "delivered",
            },
            executionRefs: [],
            attributedCost: null,
          },
        ],
      });
      await panel.updateComplete;
      if (change !== "methods") {
        await waitFor(() => expect(pending.length).toBe(2));
        pending[1](fixture("new-result"));
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      pending[0](fixture("stale-result"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(panel.textContent).not.toContain("stale-result");
      if (change !== "methods") {
        expect(panel.textContent).toContain("new-result");
      }
      container.remove();
    },
  );
});

describe("platform observation boundary", () => {
  it("does not query without a precise reference and stays unknown after denial", async () => {
    const request = vi.fn((method: string) => {
      if (method === "diagnosis.observation.query") {
        return Promise.reject(new Error("forbidden"));
      }
      return Promise.resolve({
        items: [],
        authorization: { outcome: "allow" },
        audit: { decision: "allow" },
      });
    });
    const panel = document.createElement("openbot-diagnosis-panel");
    panel.role = "platform";
    panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
    panel.scopes = ["operator.read"];
    panel.gatewayMethods = ["diagnosis.observation.query"];
    panel.connected = true;
    document.body.append(panel);
    await waitFor(() => expect(panel.querySelector('[aria-label="运行证据投影"]')).not.toBeNull());
    expect(request.mock.calls.some(([method]) => method === "diagnosis.observation.query")).toBe(
      false,
    );
    panel.taskOutcomeRef = { taskId: "restricted-task", agentId: "main", outcomeVersion: 1 };
    await waitFor(() => expect(panel.textContent).toContain("查询失败或读取权限不可用"));
    expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
    panel.remove();
  });
});

describe("explicit outcome draft observation", () => {
  it("does not fall back on partial draft and rejects unsafe versions", async () => {
    const request = vi.fn((method: string) =>
      Promise.resolve(
        method === "diagnosis.observation.query"
          ? {
              schemaVersion: 1,
              metricDictVersion: 1,
              samples: [],
              projectedAt: 1,
              sourceWatermark: null,
              window: { from: 0, to: 2 },
              coverage: null,
            }
          : { items: [], authorization: { outcome: "allow" }, audit: { decision: "allow" } },
      ),
    );
    const panel = document.createElement("openbot-diagnosis-panel");
    panel.role = "enterprise";
    panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
    panel.scopes = ["operator.read"];
    panel.gatewayMethods = ["diagnosis.observation.query"];
    panel.connected = true;
    panel.taskOutcomeRef = { taskId: "host-task", agentId: "main", outcomeVersion: 1 };
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector('[data-testid="diagnosis-task-id"]')).not.toBeNull(),
    );
    const calls = () =>
      request.mock.calls.filter(([method]) => method === "diagnosis.observation.query");
    const set = async (id: string, value: string) => {
      const input = panel.querySelector<HTMLInputElement>('[data-testid="' + id + '"]')!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await panel.updateComplete;
    };
    const before = calls().length;
    await set("diagnosis-task-id", "explicit-task");
    expect(calls()).toHaveLength(before);
    expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
    await set("diagnosis-task-agent", "explicit-agent");
    await set("diagnosis-task-version", "9007199254740993");
    expect(calls()).toHaveLength(before);
    await set("diagnosis-task-version", "2");
    await waitFor(() => expect(calls()).toHaveLength(before + 1));
    const call = calls().at(-1) as unknown as [string, Record<string, unknown>];
    expect(call[1]).toMatchObject({
      taskId: "explicit-task",
      agentId: "explicit-agent",
      outcomeVersion: 2,
    });
    await set("diagnosis-task-version", "");
    expect(calls()).toHaveLength(before + 1);
    panel.remove();
  });
});
