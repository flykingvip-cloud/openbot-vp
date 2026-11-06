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
