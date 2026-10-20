// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseSystemNoticesCard } from "./enterprise-system-notices-card.ts";
import "./enterprise-system-notices-card.ts";

function mount(): EnterpriseSystemNoticesCard {
  const el = document.createElement("enterprise-system-notices-card");
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
}

function clientReturning(result: unknown) {
  const request = vi.fn(async (method: string) => {
    if (method === "enterprise.notices.list") {
      return result;
    }
    return {};
  });
  return { request, connected: true } as unknown as EnterpriseSystemNoticesCard["client"];
}

describe("<enterprise-system-notices-card>", () => {
  it("renders billing + channel alerts for an enterprise admin", async () => {
    const client = clientReturning({
      totalCount: 2,
      billingCount: 1,
      channelOfflineCount: 1,
      items: [
        { id: "budget", kind: "budget", severity: "critical", code: "budget-exceeded" },
        {
          id: "channel-offline:telegram:default",
          kind: "channel-offline",
          severity: "warning",
          code: "channel-offline",
          source: "telegram:default",
        },
      ],
    });
    const el = mount();
    el.client = client;
    el.tenantId = "tenant-a";
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);

    expect(
      (client as unknown as { request: ReturnType<typeof vi.fn> }).request,
    ).toHaveBeenCalledWith("enterprise.notices.list", { tenantId: "tenant-a" });
    expect(el.textContent).toContain("系统告警");
    expect(el.textContent).toContain("预算已超限");
    expect(el.textContent).toContain("渠道掉线：telegram:default");
  });

  it("renders nothing when there are no alerts (additive, non-intrusive)", async () => {
    const el = mount();
    el.client = clientReturning({
      totalCount: 0,
      billingCount: 0,
      channelOfflineCount: 0,
      items: [],
    });
    el.tenantId = "tenant-a";
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent?.trim()).toBe("");
  });

  it("hides itself when the RPC is rejected (e.g. non-admin session)", async () => {
    const request = vi.fn(async () => {
      throw new Error("enterprise admin scope required");
    });
    const el = mount();
    el.client = { request, connected: true } as unknown as EnterpriseSystemNoticesCard["client"];
    el.tenantId = "tenant-a";
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent?.trim()).toBe("");
  });
});
