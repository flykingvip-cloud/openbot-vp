// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupervisorNodeBindingRequestsCard } from "./supervisor-node-binding-requests-card.ts";
import "./supervisor-node-binding-requests-card.ts";

function mount(): SupervisorNodeBindingRequestsCard {
  const el = document.createElement("supervisor-node-binding-requests-card");
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

describe("<supervisor-node-binding-requests-card>", () => {
  it("shows pending requests and approves from enterprise overview", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi.fn(async (method: string) => {
      if (method === "supervisor.node.bindingRequest.list") {
        return {
          requests: [
            {
              requestId: "req-1",
              tenantId: "t1",
              seatId: "seat-1",
              userId: "u1",
              nodeId: "mac-1",
              nodeDisplayName: "Daniel Mac",
              status: "pending",
              requestedAt: "2026-06-27T00:00:00.000Z",
              updatedAt: "2026-06-27T00:00:00.000Z",
            },
          ],
        };
      }
      if (method === "supervisor.node.bindingRequest.resolve") {
        return { request: { requestId: "req-1", status: "approved" } };
      }
      return {};
    });
    const el = mount();
    el.client = {
      request,
      connected: true,
    } as unknown as SupervisorNodeBindingRequestsCard["client"];
    el.tenantId = "t1";
    el.detailHref = "/enterprise/t1/settings/security";
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(el.textContent).toContain("Node 连接申请");
    expect(el.textContent).toContain("Daniel Mac");
    expect(el.textContent).toContain("批准");
    const approve = Array.from(el.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("批准"),
    );
    approve?.click();
    await flush(el);
    await new Promise((r) => setTimeout(r, 0));
    await flush(el);
    expect(request).toHaveBeenCalledWith("supervisor.node.bindingRequest.resolve", {
      requestId: "req-1",
      decision: "approved",
    });
  });
});
