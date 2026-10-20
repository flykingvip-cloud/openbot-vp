import { afterEach, describe, expect, it } from "vitest";
import {
  hasActiveHandoffWaiters,
  notifyHandoffReturned,
  peekHandoffResumeReason,
  resetSecureFormHandoffWaitForTests,
  waitForHandoffReturn,
} from "./secure-form-handoff-wait.js";

afterEach(() => {
  resetSecureFormHandoffWaitForTests();
});

describe("secure-form-handoff-wait", () => {
  it("resolves await_return when handoff_returned notifies", async () => {
    const pending = waitForHandoffReturn({ sessionKey: "s1", timeoutMs: 2_000 });
    await new Promise((r) => setTimeout(r, 10));
    notifyHandoffReturned("s1");
    await expect(pending).resolves.toBe("handoff_returned");
    expect(peekHandoffResumeReason("s1")).toBe("manual_handback");
  });

  it("times out without secrets in the outcome", async () => {
    const outcome = await waitForHandoffReturn({ sessionKey: "s-timeout", timeoutMs: 30 });
    expect(outcome).toBe("handoff_timeout");
  });

  it("serves recent return within grace window", async () => {
    notifyHandoffReturned("s-grace");
    await expect(waitForHandoffReturn({ sessionKey: "s-grace", timeoutMs: 1_000 })).resolves.toBe(
      "handoff_returned",
    );
  });

  it("reports active waiters only while await_return is pending", async () => {
    expect(hasActiveHandoffWaiters()).toBe(false);
    const pending = waitForHandoffReturn({ sessionKey: "s-active", timeoutMs: 2_000 });
    await new Promise((r) => setTimeout(r, 10));
    expect(hasActiveHandoffWaiters()).toBe(true);
    notifyHandoffReturned("s-active");
    await expect(pending).resolves.toBe("handoff_returned");
    expect(hasActiveHandoffWaiters()).toBe(false);
  });

  it("auto-resumes when pollGateCleared reports signed-in (no 交给AI)", async () => {
    let autoCalls = 0;
    let n = 0;
    const pending = waitForHandoffReturn({
      sessionKey: "s-auto",
      timeoutMs: 5_000,
      pollIntervalMs: 30,
      pollGateCleared: async () => {
        n += 1;
        return n >= 2 ? { signedInAttr: "true" } : { statusText: "等待扫码…" };
      },
      onAutoGateCleared: () => {
        autoCalls += 1;
      },
    });
    await expect(pending).resolves.toBe("handoff_returned");
    expect(autoCalls).toBe(1);
    expect(peekHandoffResumeReason("s-auto")).toBe("auto_gate_cleared");
  });
});
