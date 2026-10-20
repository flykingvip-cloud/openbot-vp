// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./fabric-panel.ts";
import type { FabricGovernanceSection } from "./fabric-panel.ts";

function mount(): FabricGovernanceSection {
  const el = document.createElement("fabric-governance-section") as FabricGovernanceSection;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  // Let connectedCallback + lit's async render settle.
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
}

describe("<fabric-governance-section>", () => {
  it("renders the status card (not empty) even with no client / no data", async () => {
    const el = mount();
    await flush(el);
    expect(el.textContent).toContain("Fabric 执行治理");
    // disabled state shows the enable button + enablement guidance.
    expect(el.textContent).toContain("启用");
    expect(el.textContent).toContain("未启用");
  });

  it("fetches status + audit when a client is provided and reflects enabled state", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "fabric.status") {
        return {
          enabled: true,
          serviceInstalled: true,
          auditRetained: 1,
          stats: {
            total: 1,
            byDecision: { ALLOW: 1, DENY: 0, MODIFY: 0 },
            byStatus: {},
            costUsd: 0,
          },
        };
      }
      if (method === "fabric.audit.query") {
        return {
          enabled: true,
          records: [
            {
              correlationId: "corr1234",
              sessionId: "s1",
              tenantId: "tenant-1",
              what: { tool: { name: "git" } },
              decision: { decision: "ALLOW" },
              result: { status: "success" },
              timing: { start: 0, end: 42 },
              occurredAt: new Date().toISOString(),
            },
          ],
          stats: null,
        };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request } as unknown;
    await flush(el);
    // give the async load() a tick to resolve + re-render.
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith("fabric.status", {});
    expect(request).toHaveBeenCalledWith("fabric.audit.query", { limit: 20 });
    expect(el.textContent).toContain("已启用");
    expect(el.textContent).toContain("git");
  });

  it("toggles enablement via fabric.feature.set", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "fabric.status") {
        return { enabled: false, serviceInstalled: true, auditRetained: 0, stats: null };
      }
      if (method === "fabric.audit.query") {
        return { enabled: false, records: [], stats: null };
      }
      return { enabled: true };
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    const enableBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "启用",
    );
    expect(enableBtn).toBeTruthy();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    enableBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(confirm).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("fabric.feature.set", { enabled: true });
    confirm.mockRestore();
  });

  it("does not enable fabric when confirmation is cancelled", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "fabric.status") {
        return { enabled: false, serviceInstalled: true, auditRetained: 0, stats: null };
      }
      if (method === "fabric.audit.query") {
        return { enabled: false, records: [], stats: null };
      }
      return { enabled: false };
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request } as unknown;
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    const enableBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "启用",
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    enableBtn?.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(request).not.toHaveBeenCalledWith("fabric.feature.set", { enabled: true });
    confirm.mockRestore();
  });
});
