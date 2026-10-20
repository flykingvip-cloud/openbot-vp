/* @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import {
  isGovernanceGatewayReady,
  setGovernanceApiClient,
  type EvolutionGovernanceSnapshot,
} from "../services/governanceApi.ts";
import "./actions-page.ts";

type LitTestElement = HTMLElement & { updateComplete: Promise<unknown> };

type GatewayCall = { method: string; params: Record<string, unknown> };

function assistSnapshot(): EvolutionGovernanceSnapshot {
  return {
    mode: "assist",
    killSwitch: false,
    limits: {},
    redirects: {},
    effectVerifications: [],
    skillAutoJobs: {},
  };
}

// The page runs the real governanceApi functions against this Gateway
// stand-in, injected with setGovernanceApiClient. Module mocking with vi.mock
// does not take effect in the chromium runner.
const gateway = {
  calls: [] as GatewayCall[],
  unexpected: [] as string[],
  /** Served first, in order; `snapshot` answers every later read. */
  queuedSnapshots: [] as EvolutionGovernanceSnapshot[],
  snapshot: assistSnapshot(),
  workingStyleEffects: [] as Array<{ agentId: string }>,
  /** Listed for `status: "candidate"`; the approved list stays empty. */
  candidates: [] as Record<string, unknown>[],
};

const gatewayClient = {
  connected: true,
  async request(method: string, params: Record<string, unknown> = {}) {
    gateway.calls.push({ method, params });
    switch (method) {
      case "evolution-governance.snapshot":
        return gateway.queuedSnapshots.shift() ?? gateway.snapshot;
      case "governance.actions.list":
      case "evolution-governance.pending-approvals":
        return { items: [] };
      case "agents.list-working-style-effects":
        return { effects: gateway.workingStyleEffects };
      case "evolution.surfaces.list":
        return { surfaces: [] };
      case "pattern-detection.list-candidates":
        return { candidates: params.status === "candidate" ? gateway.candidates : [] };
      case "pattern-detection.approve":
        return { candidate: { candidateId: params.candidateId, status: "approved" } };
      case "evolution-governance.apply-limit":
      case "evolution-governance.apply-redirect":
        return { ok: true };
      // The page embeds <evolution-lineage-panel>, which reads these two.
      case "evolution.proposals.list":
        return { proposals: [] };
      case "evolution.ledger.query":
        return { events: [] };
      default:
        gateway.unexpected.push(method);
        throw new Error(`unexpected gateway method: ${method}`);
    }
  },
} as unknown as GatewayBrowserClient;

function paramsOf(method: string): Record<string, unknown>[] {
  return gateway.calls.filter((call) => call.method === method).map((call) => call.params);
}

type GovernanceActionsPageElement = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot | null;
};

function createGovernanceActionsPage(): GovernanceActionsPageElement {
  return document.createElement("governance-actions-page") as GovernanceActionsPageElement;
}

function findManualButton(root: ShadowRoot, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button.action-btn")).find(
    (node) => node.textContent?.trim() === label,
  );
  if (!button) {
    throw new Error(`missing button: ${label}`);
  }
  return button as HTMLButtonElement;
}

function manualInputs(root: ShadowRoot): HTMLInputElement[] {
  return Array.from(root.querySelectorAll(".manual-controls input"));
}

describe("governance-actions-page manual evolution controls", () => {
  beforeAll(() => {
    if (!customElements.get("governance-actions-page")) {
      throw new Error("governance-actions-page element not registered");
    }
  });

  beforeEach(() => {
    // governanceApi has no getter for its client. Its initial client is null
    // and nothing this file imports sets one, so the prior state is "no
    // connected client": check it, inject the stand-in, and restore null after.
    expect(isGovernanceGatewayReady()).toBe(false);
    gateway.calls.length = 0;
    gateway.unexpected.length = 0;
    gateway.queuedSnapshots = [];
    gateway.snapshot = assistSnapshot();
    gateway.workingStyleEffects = [];
    gateway.candidates = [];
    setGovernanceApiClient(gatewayClient);
  });

  afterEach(() => {
    setGovernanceApiClient(null);
    expect(isGovernanceGatewayReady()).toBe(false);
    expect(gateway.unexpected).toEqual([]);
  });

  it("click 施加限流 calls applyEvolutionLimit then reloads snapshot", async () => {
    const page = createGovernanceActionsPage();
    document.body.appendChild(page);
    await (page as LitTestElement).updateComplete;
    await vi.waitFor(() =>
      expect(paramsOf("evolution-governance.snapshot").length).toBeGreaterThan(0),
    );
    await vi.waitFor(() =>
      expect(page.shadowRoot?.querySelector(".manual-controls input")).not.toBeNull(),
    );

    const root = page.shadowRoot!;
    const [agentInput] = manualInputs(root);
    agentInput.value = "agent-a";
    agentInput.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    await (page as LitTestElement).updateComplete;

    findManualButton(root, "施加限流").click();
    await vi.waitFor(() =>
      expect(paramsOf("evolution-governance.apply-limit")).toEqual([
        { runtimeAgentId: "agent-a", reason: "ui-manual-limit" },
      ]),
    );
    await vi.waitFor(() =>
      expect(root.querySelector(".manual-note")?.textContent).toContain("已对 agent-a 施加限流"),
    );
    expect(paramsOf("evolution-governance.snapshot").length).toBeGreaterThanOrEqual(2);

    page.remove();
  });

  it("click 施加重定向 calls applyEvolutionRedirect then reloads snapshot", async () => {
    gateway.queuedSnapshots = [
      assistSnapshot(),
      {
        ...assistSnapshot(),
        redirects: {
          "agent-a": { targetAgentId: "agent-b", reason: "ui-manual-redirect" },
        },
      },
    ];

    const page = createGovernanceActionsPage();
    document.body.appendChild(page);
    await (page as LitTestElement).updateComplete;
    await vi.waitFor(() =>
      expect(paramsOf("evolution-governance.snapshot").length).toBeGreaterThan(0),
    );
    await vi.waitFor(() =>
      expect(page.shadowRoot?.querySelector(".manual-controls input")).not.toBeNull(),
    );

    const root = page.shadowRoot!;
    const [agentInput, targetInput] = manualInputs(root);
    agentInput.value = "agent-a";
    agentInput.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    targetInput.value = "agent-b";
    targetInput.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    await (page as LitTestElement).updateComplete;

    findManualButton(root, "施加重定向").click();
    await vi.waitFor(() =>
      expect(paramsOf("evolution-governance.apply-redirect")).toEqual([
        { runtimeAgentId: "agent-a", targetAgentId: "agent-b", reason: "ui-manual-redirect" },
      ]),
    );
    await vi.waitFor(() =>
      expect(root.querySelector(".manual-note")?.textContent).toContain(
        "已将 agent-a 重定向到 agent-b",
      ),
    );
    expect(paramsOf("evolution-governance.snapshot").length).toBeGreaterThanOrEqual(2);

    page.remove();
  });

  it("approve with autoInstallIntent checkbox passes flag and shows skillAutoJobs", async () => {
    gateway.workingStyleEffects = [{ agentId: "agent-a" }];
    gateway.candidates = [
      {
        agentId: "agent-a",
        candidateId: "pc_test_1",
        suggestedName: "测试模式",
        suggestedSummary: "summary",
        overallConfidence: 0.9,
        sampleCount: 3,
        status: "candidate",
      },
    ];
    gateway.snapshot = {
      ...assistSnapshot(),
      skillAutoJobs: {
        pc_test_1: {
          candidateId: "pc_test_1",
          agentId: "agent-a",
          stage: "pending_publish",
          updatedAt: "2026-07-23T00:00:00.000Z",
        },
      },
    };

    const page = createGovernanceActionsPage();
    document.body.appendChild(page);
    await (page as LitTestElement).updateComplete;
    await vi.waitFor(() =>
      expect(
        page.shadowRoot?.querySelector('[data-testid="approve-with-auto-install"]'),
      ).not.toBeNull(),
    );

    const root = page.shadowRoot!;
    const checkbox = root.querySelector(
      '[data-testid="approve-with-auto-install"]',
    ) as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    await (page as LitTestElement).updateComplete;

    findManualButton(root, "批准").click();
    await vi.waitFor(() =>
      expect(paramsOf("pattern-detection.approve")).toEqual([
        { agentId: "agent-a", candidateId: "pc_test_1", autoInstallIntent: true },
      ]),
    );

    await vi.waitFor(() =>
      expect(root.querySelector('[data-skill-auto-job="pc_test_1"]')?.textContent).toContain(
        "pending_publish",
      ),
    );

    page.remove();
  });
});
