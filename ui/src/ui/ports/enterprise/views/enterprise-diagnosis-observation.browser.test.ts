import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { OpenBotDiagnosisPanel } from "../../diagnosis/diagnosis-panel.ts";
import type { EnterpriseSurfaceProps } from "./enterprise-surface-types.ts";
import { renderEnterpriseSurface } from "./enterprise-surfaces-core.ts";
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
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts) {
    render(null, host);
    host.remove();
  }
  hosts.length = 0;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
});
async function mount(extra: Partial<EnterpriseSurfaceProps> = {}) {
  const request = vi.fn(async (_method: string) => ({
    items: [],
    nextCursor: null,
    authorization: { outcome: "allow" },
    audit: { decision: "allow" },
  }));
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const props = {
    tab: "enterpriseDiagnosis",
    basePath: "",
    readModel: {
      currentTenantId: "tenant",
      currentTenantLabel: "Tenant",
      meshAgents: [],
      meshGroups: [],
    },
    actions: { organization: {} },
    authPanelProps: null,
    ...extra,
    client: { connected: true, request },
  } as unknown as EnterpriseSurfaceProps;
  render(renderEnterpriseSurface(props), host);
  const panel = host.querySelector("openbot-diagnosis-panel") as OpenBotDiagnosisPanel;
  await panel.updateComplete;
  await Promise.resolve();
  return { panel, request, client: props.client as GatewayBrowserClient };
}
describe("enterprise diagnosis observation host wiring", () => {
  it("passes explicit connection, granted scopes and advertised methods without guessing task identity", async () => {
    const { panel, request } = await mount({
      connected: true,
      scopes: ["operator.read"],
      sessionKind: "enterprise-admin",
      gatewayMethods: ["diagnosis.observation.query"],
    });
    expect(panel.connected).toBe(true);
    expect(panel.scopes).toEqual(["operator.read"]);
    expect(panel.sessionKind).toBe("enterprise-admin");
    expect(panel.gatewayMethods).toEqual(["diagnosis.observation.query"]);
    expect(panel.taskOutcomeRef).toBeNull();
    expect(panel.tenantGrants).toBeNull();
    expect(request.mock.calls.some((call) => call[0] === "diagnosis.observation.query")).toBe(
      false,
    );
  });
  it("defaults absent host authorization and capabilities to false/null", async () => {
    const { panel, request } = await mount();
    expect(panel.connected).toBe(false);
    expect(panel.scopes).toBeNull();
    expect(panel.tenantGrants).toBeNull();
    expect(panel.sessionKind).toBeNull();
    expect(panel.gatewayMethods).toBeNull();
    expect(request.mock.calls.some((call) => call[0] === "diagnosis.observation.query")).toBe(
      false,
    );
  });
  it("does not query an explicit task when the host has no read grant", async () => {
    const { panel, request } = await mount({
      connected: true,
      gatewayMethods: ["diagnosis.observation.query"],
      sessionKind: "enterprise-admin",
    });
    panel.taskOutcomeRef = { taskId: "task", agentId: "agent", outcomeVersion: 1 };
    await panel.updateComplete;
    await Promise.resolve();
    expect(request.mock.calls.some((call) => call[0] === "diagnosis.observation.query")).toBe(
      false,
    );
  });

  it("keeps the workbench as the first screen and reveals the downstream surface from #original-diagnosis", async () => {
    const { panel } = await mount({
      connected: true,
      scopes: ["operator.read"],
      sessionKind: "enterprise-admin",
    });
    await customElements.whenDefined("openbot-observation-workbench");
    const workbench = panel.querySelector("openbot-observation-workbench");
    expect(workbench).not.toBeNull();
    expect(panel.firstElementChild).toBe(workbench);
    expect(
      [...panel.querySelectorAll("h1, h2, h3")].map((node) => node.textContent?.trim()),
    ).not.toContain("原诊断工作区");
    expect(panel.textContent).not.toContain(
      "下面的数据来自真实诊断接口，不受上方样例模式影响。",
    );
    expect(panel.querySelector("#original-diagnosis")).toBeNull();
    expect(panel.querySelector('[data-testid="observation-query-scope"]')).toBeNull();
    expect(panel.textContent).not.toContain("执行器技术调用");
    expect(panel.textContent).not.toContain("推理假设 · 只读旁路");
    expect(workbench?.querySelector('[aria-label="观测数据源"]')).not.toBeNull();
    expect(workbench?.querySelector('[data-action="pause"]')?.textContent).toContain("暂停刷新");

    window.location.hash = "#original-diagnosis";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await panel.updateComplete;
    await waitFor(() => expect(panel.querySelector("#original-diagnosis")).not.toBeNull());
    const original = panel.querySelector("#original-diagnosis");
    expect(original).not.toBeNull();
    expect(original?.querySelector('[data-testid="enterprise-diagnosis"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="diagnosis-run-now"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="diagnosis-target-picker"]')).not.toBeNull();
    expect(original?.querySelector('[data-testid="observation-query-scope"]')).toBeNull();
  });
});
