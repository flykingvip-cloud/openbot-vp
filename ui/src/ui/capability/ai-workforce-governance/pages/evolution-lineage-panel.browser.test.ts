/* @vitest-environment jsdom */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import type { EvolutionLineageEvent, EvolutionLineageProposal } from "../evolution-lineage.ts";
import { isGovernanceGatewayReady, setGovernanceApiClient } from "../services/governanceApi.ts";
import "./evolution-lineage-panel.ts";

type LitTestElement = HTMLElement & { updateComplete: Promise<unknown> };

type GatewayCall = { method: string; params: Record<string, unknown> };

const proposals: EvolutionLineageProposal[] = [];

function seed(status: string) {
  proposals.splice(0, proposals.length, {
    proposalId: "evo:ui-hold",
    surfaceId: "agent.working-dna",
    status,
    tenantScope: "tenant-a",
  });
}

// The panel runs the real governanceApi functions against this Gateway
// stand-in, injected with setGovernanceApiClient. Module mocking with vi.mock
// does not take effect in the chromium runner.
const gateway = {
  calls: [] as GatewayCall[],
  unexpected: [] as string[],
  events: [] as EvolutionLineageEvent[],
  /** When set, the hold transition fails with this message. */
  holdError: null as string | null,
};

const gatewayClient = {
  connected: true,
  async request(method: string, params: Record<string, unknown> = {}) {
    gateway.calls.push({ method, params });
    switch (method) {
      case "evolution.proposals.list":
        return { proposals: proposals.slice() };
      case "evolution.ledger.query":
        return { events: gateway.events.slice() };
      case "evolution.proposals.transition":
        if (gateway.holdError) {
          throw new Error(gateway.holdError);
        }
        seed("HELD");
        return { proposal: { status: "HELD" } };
      case "evolution.experiments.create":
        seed("EXPERIMENTING");
        return { experiment: { experimentId: "exp:ui-hold" } };
      default:
        gateway.unexpected.push(method);
        throw new Error(`unexpected gateway method: ${method}`);
    }
  },
} as unknown as GatewayBrowserClient;

function paramsOf(method: string): Record<string, unknown>[] {
  return gateway.calls.filter((call) => call.method === method).map((call) => call.params);
}

function createPanel(): LitTestElement & { shadowRoot: ShadowRoot | null } {
  return document.createElement("evolution-lineage-panel") as LitTestElement & {
    shadowRoot: ShadowRoot | null;
  };
}

describe("evolution-lineage-panel hold entry", () => {
  beforeAll(() => {
    if (!customElements.get("evolution-lineage-panel")) {
      throw new Error("evolution-lineage-panel element is not registered");
    }
  });

  beforeEach(() => {
    // governanceApi has no getter for its client. Its initial client is null
    // and nothing this file imports sets one, so the prior state is "no
    // connected client": check it, inject the stand-in, and restore null after.
    expect(isGovernanceGatewayReady()).toBe(false);
    gateway.calls.length = 0;
    gateway.unexpected.length = 0;
    gateway.events = [];
    gateway.holdError = null;
    seed("EXPERIMENTING");
    setGovernanceApiClient(gatewayClient);
  });

  afterEach(() => {
    setGovernanceApiClient(null);
    expect(isGovernanceGatewayReady()).toBe(false);
    expect(gateway.unexpected).toEqual([]);
  });

  it("holds and resumes from the same lineage row", async () => {
    const el = createPanel();
    document.body.append(el);
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-hold-command=hold]")).toBeTruthy(),
    );
    const hold = el.shadowRoot?.querySelector("[data-hold-command=hold]") as HTMLButtonElement;
    expect(hold.textContent?.trim()).toBe("暂停实验");
    hold.click();
    await vi.waitFor(() =>
      expect(paramsOf("evolution.proposals.transition")).toEqual([
        {
          commandId: expect.stringMatching(/^ui:hold:evo:ui-hold:/),
          proposalId: "evo:ui-hold",
          command: "hold",
        },
      ]),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-hold-command=resume]")).toBeTruthy(),
    );
    expect(el.shadowRoot?.querySelector("[data-status=HELD]")).toBeTruthy();
    const resume = el.shadowRoot?.querySelector("[data-hold-command=resume]") as HTMLButtonElement;
    expect(resume.textContent?.trim()).toBe("恢复实验");
    resume.click();
    await vi.waitFor(() =>
      expect(paramsOf("evolution.experiments.create")).toEqual([
        {
          commandId: expect.stringMatching(/^ui:resume:evo:ui-hold:/),
          proposalId: "evo:ui-hold",
        },
      ]),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-hold-command=hold]")).toBeTruthy(),
    );
    el.remove();
  });

  it("does not offer hold after canary application", async () => {
    seed("CANARY");
    const el = createPanel();
    document.body.append(el);
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-status=CANARY]")).toBeTruthy(),
    );
    expect(el.shadowRoot?.querySelector("[data-hold-command]")).toBeNull();
    el.remove();
  });

  it("keeps the row in place when hold fails", async () => {
    gateway.holdError = "hold requires an active EXPERIMENTING proposal";
    const el = createPanel();
    document.body.append(el);
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-hold-command=hold]")).toBeTruthy(),
    );
    const hold = el.shadowRoot?.querySelector("[data-hold-command=hold]");
    expect(hold).toBeInstanceOf(HTMLButtonElement);
    (hold as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector(".notice")?.textContent).toMatch(/hold requires/),
    );
    expect(el.shadowRoot?.querySelector("[data-status=EXPERIMENTING]")).toBeTruthy();
    el.remove();
  });

  it("shows observation unavailable for excluded Capsule rows, not 0% or failed", async () => {
    proposals.splice(0, proposals.length, {
      proposalId: "evo:legacy-capsule",
      surfaceId: "knowledge.experience-capsule",
      status: "HELD",
      tenantScope: "tenant-a",
    });
    gateway.events = [
      {
        eventId: "ex-1",
        type: "observation.excluded",
        proposalId: "evo:legacy-capsule",
        exclusionReason: "legacy_missing_failure_cluster",
      },
    ];
    const el = createPanel();
    document.body.append(el);
    await el.updateComplete;
    await vi.waitFor(() =>
      expect(el.shadowRoot?.querySelector("[data-observation=unavailable]")).toBeTruthy(),
    );
    const observation = el.shadowRoot?.querySelector("[data-observation=unavailable]");
    expect(observation?.textContent?.trim()).toBe("observation unavailable");
    expect(observation?.textContent).not.toMatch(/0%/);
    expect(observation?.textContent).not.toMatch(/failed|失败/i);
    expect(observation?.getAttribute("data-observation-reason")).toBe(
      "legacy_missing_failure_cluster",
    );
    expect(el.shadowRoot?.querySelector("[data-status=HELD]")?.textContent).toMatch(/已暂停/);
    expect(el.shadowRoot?.querySelector("[data-status=HELD]")?.textContent).not.toMatch(
      /failed|失败/i,
    );
    el.remove();
  });
});
