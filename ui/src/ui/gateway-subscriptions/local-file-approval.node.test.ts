import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayHost } from "../gateway-host.ts";
import type { GatewayEventFrame } from "../gateway.ts";
import { handleLocalFileApprovalGatewayEvent } from "./local-file-approval.ts";

const NOW = 1_800_000_000_000;

function host(): GatewayHost {
  return {
    localFileApprovalQueue: [],
    localFileApprovalError: null,
  } as unknown as GatewayHost;
}

function requested(overrides: Record<string, unknown> = {}): GatewayEventFrame {
  return {
    event: "localFiles.approval.requested",
    payload: {
      id: "ap-1",
      canonicalPath: "/Users/demo/Desktop/pack.zip",
      targetKind: "file",
      task: "inspect-archive",
      taskDescription: "inspect this archive",
      agentId: "bot-skill",
      userId: "u1",
      tenantId: "t1",
      createdAtMs: NOW,
      expiresAtMs: NOW + 90_000,
      ...overrides,
    },
  } as unknown as GatewayEventFrame;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("local file approval subscription", () => {
  it("queues a requested card and claims the event", () => {
    const h = host();
    expect(handleLocalFileApprovalGatewayEvent(h, requested())).toBe(true);
    expect(h.localFileApprovalQueue).toHaveLength(1);
    expect(h.localFileApprovalQueue[0].id).toBe("ap-1");
  });

  it("clears the error when a new card arrives", () => {
    const h = host();
    h.localFileApprovalError = "stale failure";
    handleLocalFileApprovalGatewayEvent(h, requested());
    expect(h.localFileApprovalError).toBeNull();
  });

  it("removes the card when the gateway reports it resolved", () => {
    const h = host();
    handleLocalFileApprovalGatewayEvent(h, requested());
    const consumed = handleLocalFileApprovalGatewayEvent(h, {
      event: "localFiles.approval.resolved",
      payload: { id: "ap-1", decision: "deny" },
    } as unknown as GatewayEventFrame);
    expect(consumed).toBe(true);
    expect(h.localFileApprovalQueue).toHaveLength(0);
  });

  it("auto-clears the card once its window elapses", () => {
    // The gateway treats a timeout as a denial, so a card left on screen would be
    // offering buttons that no longer decide anything.
    const h = host();
    handleLocalFileApprovalGatewayEvent(h, requested());
    expect(h.localFileApprovalQueue).toHaveLength(1);
    vi.advanceTimersByTime(90_000 + 600);
    expect(h.localFileApprovalQueue).toHaveLength(0);
  });

  it("ignores a malformed payload but still claims the event", () => {
    const h = host();
    expect(handleLocalFileApprovalGatewayEvent(h, requested({ canonicalPath: undefined }))).toBe(
      true,
    );
    expect(h.localFileApprovalQueue).toHaveLength(0);
  });

  it("does not claim unrelated events", () => {
    const h = host();
    for (const event of ["exec.approval.requested", "presence", "localFiles.redeem"]) {
      expect(
        handleLocalFileApprovalGatewayEvent(h, {
          event,
          payload: {},
        } as unknown as GatewayEventFrame),
      ).toBe(false);
    }
  });
});
