import { html, render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCapacitySnapshot } from "../../../../../src/observation/capacity-snapshot.js";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { OpenBotObservationWorkbench } from "../../observation/workbench.ts";
import "./diagnosis-panel.ts";
import { clearRuntimeObservations, recordRuntimeObservation } from "../../runtime-observation.ts";
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

function clearDiagnosisHash() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

async function revealOriginalDiagnosis(panel: OpenBotDiagnosisPanel) {
  window.location.hash = "#original-diagnosis";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  await panel.updateComplete;
  await waitFor(() => expect(panel.querySelector("#original-diagnosis")).not.toBeNull());
}

afterEach(() => {
  clearDiagnosisHash();
});

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
      .client=${client} .targets=${targets} .observationHost=${host}
      .scopes=${["operator.read"]} connected
    ></openbot-diagnosis-panel>`,
      container,
    );
    await customElements.whenDefined("openbot-diagnosis-panel");
    const component = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await component.updateComplete;
    await waitFor(() => expect(component.querySelector('[aria-label="会话筛选"]')).not.toBeNull());
    const select = component.querySelector<HTMLSelectElement>('[aria-label="会话筛选"]')!;
    expect(select).not.toBeNull();
    select.value = "agent:main:main";
    select.dispatchEvent(new Event("change"));
    await component.updateComplete;
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
    expect(component.querySelector("#original-diagnosis")).not.toBeNull();
    expect(
      component.querySelector<HTMLSelectElement>('[data-testid="diagnosis-target-select"]')
        ?.value,
    ).toBe("agent:main");
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
    await waitFor(() => expect(panel.textContent).toContain("当前授权范围内未找到匹配记录"));
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

describe("governance intent query host", () => {
  it("requests summary and exact detail, then clears both on permission withdrawal", async () => {
    const summary = {
      ok: true as const,
      mode: "summary" as const,
      state: "present" as const,
      detail: null,
      nextCursor: null,
      reasons: [],
      readOnly: true as const,
      items: [
        {
          actionIntentId: "intent-host",
          revision: 2,
          state: "effective",
          createdAt: 1,
          updatedAt: 2,
          target: { controlPlane: "test", targetType: "policy", targetId: "target" },
          source: { environment: "test", provenance: "injected", nonProduction: true },
          receipts: [],
          readback: null,
          verification: null,
        },
      ],
    };
    const request = vi.fn((method: string, params?: Record<string, unknown>) => {
      if (method !== "diagnosis.observation.query") {
        return Promise.resolve({
          items: [],
          authorization: { outcome: "allow" },
          audit: { decision: "allow" },
        });
      }
      const selection = params?.actionIntents as { intentId?: string };
      return Promise.resolve({
        schemaVersion: 1,
        metricDictVersion: 1,
        samples: [],
        projectedAt: 1,
        sourceWatermark: null,
        window: { from: 0, to: 2 },
        coverage: null,
        actionIntents: selection.intentId ? { ...summary, mode: "detail", detail: null } : summary,
      });
    });
    const panel = document.createElement("openbot-diagnosis-panel");
    panel.role = "enterprise";
    panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
    panel.scopes = ["operator.read"];
    panel.gatewayMethods = ["diagnosis.observation.query"];
    panel.connected = true;
    panel.taskOutcomeRef = { taskId: "task", agentId: "main", outcomeVersion: 1 };
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    const workbench = panel.querySelector("openbot-observation-workbench")!;
    const tabs = workbench.querySelectorAll<HTMLButtonElement>(
      '[role="tablist"][aria-label="观测视图"] button',
    );
    tabs[2].click();
    await waitFor(() =>
      expect(workbench.querySelector('[data-intent-id="intent-host"]')).not.toBeNull(),
    );
    expect(
      request.mock.calls.find(([method]) => method === "diagnosis.observation.query")?.[1]
        ?.actionIntents,
    ).toEqual({});
    expect(workbench.textContent).toContain("记录状态：effective");
    workbench.querySelector<HTMLButtonElement>('[data-intent-id="intent-host"]')!.click();
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([method, params]) =>
            method === "diagnosis.observation.query" &&
            (params?.actionIntents as { intentId?: string })?.intentId === "intent-host",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(workbench.querySelector('[aria-label="改善动作关联记录"]')).not.toBeNull(),
    );
    expect(workbench.textContent).toContain("状态未核验");
    panel.scopes = [];
    await panel.updateComplete;
    await waitFor(() =>
      expect(workbench.querySelector('[data-intent-id="intent-host"]')).toBeNull(),
    );
    expect(workbench.querySelector('[aria-label="改善动作关联记录"]')).toBeNull();
    panel.remove();
  });
});

describe("capacity and comparison host safety", () => {
  it("requests capacity only with an exact authorized ref and clears results on revocation", async () => {
    const request = vi.fn((method: string, params?: Record<string, unknown>) =>
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
              ...(params?.comparison
                ? {
                    capacity: {
                      ok: true,
                      snapshot: buildCapacitySnapshot({
                        scopeRef: "t1",
                        projectedAt: 1,
                        maxAgeMs: 10,
                      }),
                      sources: {
                        registry: { state: "missing", provenance: "unknown" },
                        entitlement: { state: "unknown", provenance: "unknown" },
                        quota: { state: "unknown", reason: "authoritative_balance_not_collected" },
                      },
                      reasons: ["capacity-source-marker"],
                    },
                  }
                : {}),
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
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    expect(request.mock.calls.some(([method]) => method === "diagnosis.observation.query")).toBe(
      false,
    );
    panel.taskOutcomeRef = { taskId: "task", agentId: "main", outcomeVersion: 1 };
    await waitFor(() =>
      expect(request.mock.calls.some(([method]) => method === "diagnosis.observation.query")).toBe(
        true,
      ),
    );
    const first = request.mock.calls.find(
      ([method]) => method === "diagnosis.observation.query",
    )![1]!;
    expect(first.capacity).toBe(true);
    expect(first).not.toHaveProperty("comparison");
    const workbench = panel.querySelector("openbot-observation-workbench")!;
    workbench
      .querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="观测视图"] button')[1]
      .click();
    await waitFor(() => expect(workbench.querySelector('[aria-label="分析维度"]')).not.toBeNull());
    workbench.querySelectorAll<HTMLButtonElement>('[aria-label="分析维度"] button')[3].click();
    await waitFor(() => expect(workbench.textContent).toContain("source_unavailable"));
    const explicit = {
      baseline: {
        refs: [{ agentId: "main", taskId: "baseline", outcomeVersion: 1 }],
        window: { from: 0, to: 10 },
      },
      candidate: {
        refs: [{ agentId: "main", taskId: "candidate", outcomeVersion: 2 }],
        window: { from: 10, to: 20 },
      },
    };
    panel.comparisonRefs = explicit;
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([method, params]) =>
            method === "diagnosis.observation.query" && params?.comparison === explicit,
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(workbench.textContent).toContain("capacity-source-marker"));
    panel.scopes = [];
    await panel.updateComplete;
    await waitFor(() => expect(workbench.textContent).not.toContain("capacity-source-marker"));
    await waitFor(() => expect(workbench.textContent).toContain("缺少显式baseline/candidate"));
    expect(workbench.textContent).toContain("登记快照不是在线率");
    panel.remove();
  });
});

describe("explicit comparison user entry host", () => {
  it("uses only user-entered baseline anchor and submits no comparison while editing", async () => {
    const request = vi.fn((method: string, _params?: Record<string, unknown>) =>
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
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    const workbench = panel.querySelector("openbot-observation-workbench")!;
    workbench.querySelectorAll<HTMLButtonElement>('[aria-label="观测视图"] button')[1].click();
    await waitFor(() => expect(workbench.querySelector('[aria-label="分析维度"]')).not.toBeNull());
    workbench.querySelectorAll<HTMLButtonElement>('[aria-label="分析维度"] button')[3].click();
    await waitFor(() =>
      expect(workbench.querySelector('[aria-label="baseline 数字人"]')).not.toBeNull(),
    );
    const set = async (label: string, value: string) => {
      const input = workbench.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    for (const side of ["baseline", "candidate"]) {
      await set(side + " 数字人", "explicit-agent");
      await set(side + " 任务", side + "-task");
      await set(side + " 结果版本", "1");
      await set(
        side + " 开始UTC",
        side === "baseline" ? "2026-11-01T00:00:00Z" : "2026-11-02T00:00:00Z",
      );
      await set(
        side + " 结束UTC",
        side === "baseline" ? "2026-11-02T00:00:00Z" : "2026-11-03T00:00:00Z",
      );
    }
    expect(request.mock.calls.some(([method]) => method === "diagnosis.observation.query")).toBe(
      false,
    );
    [...workbench.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "读取对照")!
      .click();
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([method, params]) =>
            method === "diagnosis.observation.query" && Boolean(params?.comparison),
        ),
      ).toBe(true),
    );
    const call = request.mock.calls.find(
      ([method, params]) => method === "diagnosis.observation.query" && Boolean(params?.comparison),
    )![1]!;
    expect(call).toMatchObject({
      taskId: "baseline-task",
      agentId: "explicit-agent",
      outcomeVersion: 1,
      comparison: {
        candidate: {
          refs: [{ taskId: "candidate-task", agentId: "explicit-agent", outcomeVersion: 1 }],
        },
      },
    });
    await set("baseline 任务", "");
    expect(panel.comparisonRefs).toBeNull();
    panel.remove();
  });
});

describe("explicit reasoning hypothesis UI", () => {
  const base = {
    schemaVersion: 1,
    metricDictVersion: 1,
    samples: [],
    projectedAt: 1,
    sourceWatermark: null,
    window: { from: 0, to: 2 },
    coverage: null,
  };
  async function mount(
    request: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
  ) {
    const panel = document.createElement("openbot-diagnosis-panel");
    panel.role = "enterprise";
    panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
    panel.scopes = ["operator.read"];
    panel.gatewayMethods = ["diagnosis.observation.query"];
    panel.connected = true;
    panel.taskOutcomeRef = { taskId: "task", agentId: "main", outcomeVersion: 1 };
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector('[data-testid="observation-read-reasoning"]')).not.toBeNull(),
    );
    return panel;
  }
  it("requests only after explicit click and labels hypotheses separately", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) =>
      method === "diagnosis.observation.query"
        ? {
            ...base,
            ...(params?.reasoning
              ? {
                  reasoningPass: {
                    scoringMethod: "rule_v1_with_hypotheses",
                    reason: "hypotheses_only",
                    items: [
                      {
                        id: "h",
                        kind: "hypothesis",
                        text: "Possible evidence gap",
                        source: "reasoning",
                        modelRef: "trusted-role",
                        evidenceIds: ["e"],
                      },
                    ],
                  },
                }
              : {}),
          }
        : { items: [], authorization: { outcome: "allow" }, audit: { decision: "allow" } },
    );
    const panel = await mount(request);
    expect(request.mock.calls.some(([, params]) => Boolean(params?.reasoning))).toBe(false);
    panel.querySelector<HTMLButtonElement>('[data-testid="observation-read-reasoning"]')!.click();
    await waitFor(() =>
      expect(panel.querySelector('[aria-label="推理假设旁路"]')?.textContent).toContain(
        "Possible evidence gap",
      ),
    );
    const call = request.mock.calls.find(([, params]) => Boolean(params?.reasoning))![1]!;
    expect(call).toMatchObject({
      taskId: "task",
      agentId: "main",
      outcomeVersion: 1,
      reasoning: { requested: true },
    });
    expect(panel.textContent).toContain("trusted-role");
    expect(panel.textContent).toContain("不代表确诊");
    panel.remove();
  });
  it.each([
    "reasoning_disabled",
    "reasoning_unconfigured",
    "reasoning_timeout",
    "reasoning_schema_invalid",
    "legacy",
  ])("renders %s fallback without inventing hypotheses", async (reason) => {
    const panel = await mount(async (method, params) =>
      method === "diagnosis.observation.query"
        ? {
            ...base,
            ...(params?.reasoning && reason !== "legacy"
              ? { reasoningPass: { scoringMethod: "rule_v1", reason, items: [] } }
              : {}),
          }
        : { items: [], authorization: { outcome: "allow" }, audit: { decision: "allow" } },
    );
    panel.querySelector<HTMLButtonElement>('[data-testid="observation-read-reasoning"]')!.click();
    await waitFor(() =>
      expect(panel.querySelector('[aria-label="推理假设旁路"]')?.textContent).toContain(
        reason === "legacy" ? "推理旁路未供给" : reason,
      ),
    );
    expect(panel.querySelector('[aria-label="推理假设旁路"] article')).toBeNull();
    panel.remove();
  });
  it.each(["permission", "version"])("drops stale hypotheses after %s changes", async (change) => {
    let resolve: ((value: unknown) => void) | undefined;
    const panel = await mount(async (method, params) =>
      method === "diagnosis.observation.query"
        ? params?.reasoning
          ? new Promise((done) => {
              resolve = done;
            })
          : base
        : { items: [], authorization: { outcome: "allow" }, audit: { decision: "allow" } },
    );
    panel.querySelector<HTMLButtonElement>('[data-testid="observation-read-reasoning"]')!.click();
    await waitFor(() => expect(resolve).toBeDefined());
    if (change === "permission") {
      panel.scopes = [];
    } else {
      panel.taskOutcomeRef = { taskId: "task", agentId: "main", outcomeVersion: 2 };
    }
    resolve!({
      ...base,
      reasoningPass: {
        scoringMethod: "rule_v1_with_hypotheses",
        reason: "hypotheses_only",
        items: [
          {
            id: "stale",
            kind: "hypothesis",
            text: "stale-secret",
            source: "reasoning",
            modelRef: "trusted",
            evidenceIds: ["e"],
          },
        ],
      },
    });
    await panel.updateComplete;
    await new Promise((done) => setTimeout(done, 20));
    expect(panel.textContent).not.toContain("stale-secret");
    expect(panel.querySelector('[aria-label="推理假设旁路"] article')).toBeNull();
    panel.remove();
  });
});

describe("platform explicit task input", () => {
  it("queries only a complete explicit version and clears partial input without falling back", async () => {
    const request = vi.fn(async (method: string, _params?: Record<string, unknown>) =>
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
    );
    const panel = document.createElement("openbot-diagnosis-panel");
    panel.role = "platform";
    panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
    panel.scopes = ["operator.read"];
    panel.gatewayMethods = ["diagnosis.observation.query"];
    panel.connected = true;
    document.body.append(panel);
    await waitFor(() =>
      expect(panel.querySelector('[data-testid="diagnosis-task-id"]')).not.toBeNull(),
    );
    const set = async (key: string, value: string) => {
      const input = panel.querySelector<HTMLInputElement>(
        '[data-testid="diagnosis-task-' + key + '"]',
      )!;
      input.value = value;
      input.dispatchEvent(new Event("input"));
      await panel.updateComplete;
    };
    const calls = () =>
      request.mock.calls.filter(([method]) => method === "diagnosis.observation.query");
    await set("agent", "explicit-agent");
    await set("id", "explicit-task");
    await set("version", "9007199254740993");
    expect(calls()).toHaveLength(0);
    await set("version", "2");
    await waitFor(() => expect(calls()).toHaveLength(1));
    expect(calls()[0][1]).toMatchObject({
      agentId: "explicit-agent",
      taskId: "explicit-task",
      outcomeVersion: 2,
    });
    expect(panel.textContent).toContain("平台身份不代表跨租户读取授权");
    expect(panel.textContent).toContain("不受连接工作台样例选择影响");
    await set("id", "");
    expect(calls()).toHaveLength(1);
    expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
    panel.remove();
  });
});

describe("platform explicit input response isolation", () => {
  const payload = (taskId: string, version: number) => ({
    schemaVersion: 1,
    metricDictVersion: 1,
    samples: [
      {
        sampleId: taskId,
        qualification: "outcome_only",
        provenance: ["injected"],
        reasons: [],
        executionRefs: [],
        evidence: {
          resource: "unknown",
          technical: "unknown",
          execution: "unknown",
          business: "present",
        },
        evidenceReasons: { resource: [], technical: [], execution: [], business: [] },
        outcome: {
          taskId,
          outcomeVersion: version,
          isCurrentTip: true,
          taskJudgement: "success",
          lifecycle: "closed",
          acceptanceStatus: "passed",
          deliveryStatus: "delivered",
        },
      },
    ],
    projectedAt: 1,
    sourceWatermark: null,
    window: { from: 0, to: 2 },
    coverage: null,
  });
  it.each(["version", "permission"])(
    "does not restore old evidence after %s changes",
    async (change) => {
      const pending: ((value: unknown) => void)[] = [];
      const request = vi.fn((method: string, _params?: Record<string, unknown>) =>
        method === "diagnosis.observation.query"
          ? new Promise((resolve) => pending.push(resolve))
          : Promise.resolve({
              items: [],
              authorization: { outcome: "allow" },
              audit: { decision: "allow" },
            }),
      );
      const panel = document.createElement("openbot-diagnosis-panel");
      panel.role = "platform";
      panel.client = { connected: true, request } as unknown as GatewayBrowserClient;
      panel.scopes = ["operator.read"];
      panel.gatewayMethods = ["diagnosis.observation.query"];
      panel.connected = true;
      document.body.append(panel);
      await waitFor(() =>
        expect(panel.querySelector('[data-testid="diagnosis-task-id"]')).not.toBeNull(),
      );
      const set = async (key: string, value: string) => {
        const input = panel.querySelector<HTMLInputElement>(
          '[data-testid="diagnosis-task-' + key + '"]',
        )!;
        input.value = value;
        input.dispatchEvent(new Event("input"));
        await panel.updateComplete;
      };
      await set("agent", "main");
      await set("id", "explicit-task");
      await set("version", "1");
      await waitFor(() => expect(pending).toHaveLength(1));
      if (change === "version") {
        await set("version", "2");
        await waitFor(() => expect(pending).toHaveLength(2));
        pending[1](payload("current-result", 2));
        await waitFor(() => expect(panel.textContent).toContain("current-result"));
        pending[0](payload("old-secret", 1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(panel.textContent).not.toContain("old-secret");
        expect(panel.textContent).toContain("current-result");
      } else {
        pending[0](payload("old-secret", 1));
        await waitFor(() => expect(panel.textContent).toContain("old-secret"));
        panel.scopes = [];
        await panel.updateComplete;
        await waitFor(() => expect(panel.textContent).not.toContain("old-secret"));
        await set("version", "2");
        expect(pending).toHaveLength(1);
        expect(panel.querySelector('[aria-label="运行证据投影"] article')).toBeNull();
      }
      panel.remove();
    },
  );
});

it("discards a report response after switching the authorized tenant", async () => {
  let releaseOld: ((value: unknown) => void) | undefined;
  const request = vi.fn((method: string) => {
    if (method !== "diagnosis.reports.query") {
      throw new Error(method);
    }
    return new Promise<unknown>((resolve) => {
      releaseOld = resolve;
    });
  });
  const container = document.createElement("div");
  document.body.append(container);
  const client = { connected: true, request } as unknown as GatewayBrowserClient;
  render(
    html`<openbot-diagnosis-panel role="enterprise" tenant-id="old" .client=${client} connected></openbot-diagnosis-panel>`,
    container,
  );
  const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
  await panel.updateComplete;
  await waitFor(() => expect(releaseOld).toBeDefined());
  const old = releaseOld!;
  panel.tenantId = "new";
  await panel.updateComplete;
  const current = releaseOld!;
  current({
    authorization: { outcome: "allow" },
    items: [],
    nextCursor: null,
    audit: { decision: "allow" },
    redactionProfile: "user",
  });
  await waitFor(() => expect((panel as unknown as { loading: boolean }).loading).toBe(false));
  old({
    authorization: { outcome: "deny", reason: "old-tenant" },
    items: [],
    audit: { decision: "deny" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    (panel as unknown as { model: { tenantScope: string; permissionState: string } }).model
      .tenantScope,
  ).toBe("new");
  expect(
    (panel as unknown as { model: { permissionState: string } }).model.permissionState,
  ).not.toBe("forbidden");
  container.remove();
});

it("shows the paused-job handling preview in admin language and never offers 立即修复", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "diagnosis.reports.query") {
      return {
        authorization: { outcome: "allow" },
        items: [
          {
            reportId: "report-1",
            generatedAt: "2026-11-11T00:00:00.000Z",
            tenantId: "tenant-a",
            completion: "done",
            cases: [{ caseId: "case-1", status: "open", completion: "done" }],
            findings: [],
            impactScope: ["tenant-a"],
            confidence: { findingCount: 0, acceptedCauseCount: 0, candidateCauseCount: 0 },
          },
        ],
        nextCursor: null,
        audit: { decision: "allow" },
        redactionProfile: "user",
      };
    }
    if (method === "diagnosis.reports.get") {
      return {
        authorization: { outcome: "allow" },
        report: {
          reportId: "report-1",
          generatedAt: "2026-11-11T00:00:00.000Z",
          tenantId: "tenant-a",
          cases: [
            {
              caseId: "case-1",
              tenantId: "tenant-a",
              status: "open",
              findingIds: [],
            },
          ],
          findings: [],
          evidenceRefs: [],
          graphEdges: [],
        },
        audit: { decision: "allow" },
        redactionProfile: "user",
      };
    }
    if (method === "diagnosis.handling.preview") {
      return {
        ok: true,
        preview: {
          actionable: true,
          issueId: "issue:diagnosis_job_paused:tenant-a",
          suggestedIdempotencyKey: "diagnosis_job_paused:tenant-a:t1",
          evidence: { paused: true, pausedAt: "2026-11-11T00:00:00.000Z", cadence: "tick" },
        },
        admin: {
          whatHappened: "该租户的诊断定时任务已暂停，新的巡检运行无法启动。",
          whoIsAffected: "租户 tenant-a 的诊断定时任务及其待执行的巡检。",
          suggestedHandling: "经授权后调用已有受控接口 diagnosis.job.resume 恢复该任务。",
          whoCanApprove: "持有 operator.approvals 或 operator.admin 的管理员。",
          currentStep: "尚未立案",
          howToConfirmRecovery: "执行后重新采集同一对象的 diagnosis.job.describe 证据。",
        },
      };
    }
    if (method === "diagnosis.handling.list") {
      return { ok: true, records: [] };
    }
    throw new Error(method);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const client = { connected: true, request } as unknown as GatewayBrowserClient;
  render(
    html`<openbot-diagnosis-panel
      role="enterprise"
      tenant-id="tenant-a"
      .client=${client}
      .scopes=${["operator.read", "operator.write"]}
      connected
    ></openbot-diagnosis-panel>`,
    container,
  );
  const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
  await panel.updateComplete;
  await waitFor(() =>
    expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
  );
  expect(panel.querySelector("#original-diagnosis")).toBeNull();
  await revealOriginalDiagnosis(panel);
  await waitFor(() =>
    expect(container.querySelector("[data-testid=diagnosis-handling-card]")).not.toBeNull(),
  );
  expect(container.textContent).toContain("该租户的诊断定时任务已暂停");
  expect(container.textContent).toContain("持有 operator.approvals");
  expect(container.textContent).toContain("当前步骤：尚未立案");
  expect(container.textContent).toContain("申请恢复任务");
  expect(container.textContent).not.toContain("立即修复");
  expect(container.querySelector("[data-testid=diagnosis-resolution-actions]")).not.toBeNull();
  expect(container.textContent).toContain("交给所选数字人处理");
  const original = panel.querySelector("#original-diagnosis");
  expect(original).not.toBeNull();
  expect(original?.querySelector("[data-testid=diagnosis-handling-card]")).not.toBeNull();
  expect(original?.querySelector("[data-testid=diagnosis-resolution-actions]")).not.toBeNull();
  expect(panel.firstElementChild?.tagName.toLowerCase()).toBe("openbot-observation-workbench");
  container.remove();
});

describe("diagnosis panel tenant grant host wiring", () => {
  it("forwards server-confirmed tenantGrants to the workbench and does not invent them when omitted", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<openbot-diagnosis-panel
        role="enterprise"
        tenant-id="t1"
        .scopes=${["operator.read"]}
        .tenantGrants=${{ t1: "granted", t2: "none", t3: "unknown" }}
        connected
      ></openbot-diagnosis-panel>`,
      container,
    );
    await customElements.whenDefined("openbot-diagnosis-panel");
    const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await panel.updateComplete;
    await waitFor(() =>
      expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    const workbench = panel.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await workbench.updateComplete;
    expect(workbench.tenantGrants).toEqual({ t1: "granted", t2: "none", t3: "unknown" });
    container.remove();

    const omitted = document.createElement("div");
    document.body.append(omitted);
    render(
      html`<openbot-diagnosis-panel
        role="enterprise"
        tenant-id="t1"
        .scopes=${["operator.read"]}
        connected
      ></openbot-diagnosis-panel>`,
      omitted,
    );
    const omittedPanel = omitted.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await omittedPanel.updateComplete;
    await waitFor(() =>
      expect(omittedPanel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    const omittedWorkbench = omittedPanel.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await omittedWorkbench.updateComplete;
    expect(omittedWorkbench.tenantGrants).toBeNull();
    omitted.remove();
  });
});

describe("enterprise diagnosis first-screen close", () => {
  async function mountEnterprisePanel(taskOutcomeRef?: {
    taskId: string;
    agentId: string;
    outcomeVersion: number;
  }) {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      html`<openbot-diagnosis-panel
        role="enterprise"
        tenant-id="t1"
        .scopes=${["operator.read"]}
        .taskOutcomeRef=${taskOutcomeRef ?? null}
        connected
      ></openbot-diagnosis-panel>`,
      container,
    );
    await customElements.whenDefined("openbot-diagnosis-panel");
    const panel = container.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
    await panel.updateComplete;
    await waitFor(() =>
      expect(panel.querySelector("openbot-observation-workbench")).not.toBeNull(),
    );
    const workbench = panel.querySelector(
      "openbot-observation-workbench",
    ) as OpenBotObservationWorkbench;
    await workbench.updateComplete;
    return { container, panel, workbench };
  }

  function expectNoEvidenceDump(root: ParentNode) {
    expect(root.querySelector('[data-testid="observation-query-scope"]')).toBeNull();
    expect(root.querySelector('[data-testid="observation-evidence-status"]')).toBeNull();
    expect(root.querySelector('[aria-label="运行证据投影"]')).toBeNull();
    expect(root.querySelector('[aria-label="推理假设旁路"]')).toBeNull();
    expect(root.textContent).not.toContain("精确任务真实查询，不受连接工作台样例选择影响");
    expect(root.textContent).not.toContain("execution_only");
    expect(root.textContent).not.toContain("executor_source_unavailable");
    expect(root.textContent).not.toContain("执行器技术调用");
    expect(root.textContent).not.toContain("推理假设 · 只读旁路");
    expect(root.textContent).not.toContain("业务结果未知 · 无可用授权证据");
  }

  it("keeps the workbench as the only first screen and hides diagnose modules until original diagnosis or a named query", async () => {
    const { container, panel, workbench } = await mountEnterprisePanel();

    expect(panel.firstElementChild).toBe(workbench);
    expect(panel.querySelector("h2")?.textContent).not.toBe("原诊断工作区");
    expect(
      [...panel.querySelectorAll("h1, h2, h3")].map((node) => node.textContent?.trim()),
    ).not.toContain("原诊断工作区");
    expect(panel.textContent).not.toContain(
      "下面的数据来自真实诊断接口，不受上方样例模式影响。",
    );
    expect(panel.querySelector("#original-diagnosis")).toBeNull();
    expectNoEvidenceDump(panel);

    const guide = workbench.querySelector('[aria-label="观测闭环说明"]');
    expect(guide).not.toBeNull();
    expect(guide?.querySelector("[data-action=toggle-guide]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(guide?.querySelector(".obs-guide__body")).toBeNull();

    const filters = workbench.querySelector('[aria-label="连接工作台筛选"]');
    expect(filters?.querySelector('[aria-label="观测数据源"]')).not.toBeNull();
    expect(filters?.querySelector('[data-action="pause"]')?.textContent).toContain("暂停刷新");
    expect(panel.querySelector(".obs-plat-toolbar")).toBeNull();

    const tabs = [
      ...workbench.querySelectorAll<HTMLButtonElement>(
        '[role="tablist"][aria-label="观测视图"] button',
      ),
    ];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "态势总览",
      "运行分析",
      "治理与验证",
    ]);
    for (const tab of tabs) {
      tab.click();
      await workbench.updateComplete;
      await panel.updateComplete;
      expect(panel.querySelector("#original-diagnosis")).toBeNull();
      expectNoEvidenceDump(panel);
    }
    tabs[0].click();
    await workbench.updateComplete;

    const source = workbench.querySelector<HTMLSelectElement>('[aria-label="观测数据源"]')!;
    source.value = "sample";
    source.dispatchEvent(new Event("change"));
    await workbench.updateComplete;
    await waitFor(() => expect(workbench.querySelectorAll(".obs-run").length).toBeGreaterThan(0));
    workbench.querySelector<HTMLButtonElement>(".obs-run")!.click();
    await workbench.updateComplete;
    const links = [
      ...workbench.querySelectorAll<HTMLAnchorElement>('a[href="#original-diagnosis"]'),
    ];
    expect(links.length).toBeGreaterThan(0);
    expect(
      links.some(
        (link) =>
          link.textContent?.includes("进入原诊断并选择目标") ||
          link.textContent?.includes("进入针对性诊断"),
      ),
    ).toBe(true);
    expect(links[0].getAttribute("href")).toBe("#original-diagnosis");
    expect(panel.querySelector("#original-diagnosis")).toBeNull();

    links[0].click();
    await panel.updateComplete;
    await waitFor(() => expect(panel.querySelector("#original-diagnosis")).not.toBeNull());
    const original = panel.querySelector("#original-diagnosis");
    expect(original?.getAttribute("data-testid")).toBe("original-diagnosis");
    expect(
      workbench.compareDocumentPosition(original!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(workbench.contains(original)).toBe(false);
    expect(original?.querySelector('[data-testid="enterprise-diagnosis"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="diagnosis-target-picker"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="diagnosis-run-now"]')).not.toBeNull();
    expect(workbench.querySelector('[data-testid="enterprise-diagnosis"]')).toBeNull();
    expect(workbench.querySelector('[data-testid="diagnosis-run-now"]')).toBeNull();
    expect(workbench.querySelector('[data-testid="observation-query-scope"]')).toBeNull();
    expectNoEvidenceDump(original!);

    tabs[1].click();
    await workbench.updateComplete;
    await panel.updateComplete;
    expect(panel.querySelector("#original-diagnosis")).toBeNull();
    expect(window.location.hash).not.toBe("#original-diagnosis");
    expectNoEvidenceDump(panel);
    container.remove();
  });

  it("shows evidence and reasoning modules when a named query is in effect", async () => {
    const { container, panel, workbench } = await mountEnterprisePanel({
      taskId: "task1",
      agentId: "main",
      outcomeVersion: 3,
    });
    const original = panel.querySelector("#original-diagnosis");
    expect(original).not.toBeNull();
    expect(
      workbench.compareDocumentPosition(original!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(original?.querySelector('[data-testid="enterprise-diagnosis"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="diagnosis-target-picker"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="observation-evidence-status"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="observation-query-scope"]')?.textContent).toContain(
      "精确任务真实查询，不受连接工作台样例选择影响；仍按当前身份授权读取。",
    );
    expect(original?.querySelector('[aria-label="运行证据投影"]')).not.toBeNull();
    expect(original?.querySelector('[aria-label="推理假设旁路"]')).not.toBeNull();
    container.remove();
  });
});
