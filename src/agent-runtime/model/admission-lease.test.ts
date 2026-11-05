import { describe, expect, it, vi } from "vitest";
import { createRunAdmissionLease, type RunAdmissionLeasePorts } from "./admission-lease.js";

function setup() {
  const events: string[] = [];
  const ports: RunAdmissionLeasePorts = {
    acquire: vi.fn<RunAdmissionLeasePorts["acquire"]>(async () => ({
      acquired: true,
      enterpriseId: "tenant-a",
      skipped: false,
    })),
    release: vi.fn(() => {
      events.push("release");
    }),
    forgetSnapshot: vi.fn(() => {
      events.push("forget");
    }),
  };
  return { events, ports, lease: createRunAdmissionLease(ports) };
}
describe("single-turn admission lifetime", () => {
  it.each([false, true])(
    "releases and forgets once after acquired work (failure=%s)",
    async (failure) => {
      const { events, ports, lease } = setup();
      try {
        await lease.acquire({ runId: "run-a" });
        expect(lease.held).toBe(true);
        if (failure) {
          throw new Error("candidate failed");
        }
      } catch {
        /* original owner handles candidate failure */
      } finally {
        lease.dispose();
      }
      lease.dispose();
      expect(events).toEqual(["release", "forget"]);
      expect(ports.release).toHaveBeenCalledTimes(1);
    },
  );
  it("does not cache skipped admission as held and allows the owner's later retry", async () => {
    const { ports, lease } = setup();
    vi.mocked(ports.acquire).mockResolvedValueOnce({ acquired: false, skipped: true });
    await lease.acquire({ runId: "run-a" });
    expect(lease.held).toBe(false);
    await lease.acquire({ runId: "run-a" });
    expect(lease.held).toBe(true);
    lease.dispose();
    expect(ports.release).toHaveBeenCalledTimes(1);
  });
  it("does not release a denied slot", async () => {
    const { ports, lease } = setup();
    vi.mocked(ports.acquire).mockResolvedValueOnce({
      acquired: false,
      skipped: false,
      reason: "TENANT_SUSPENDED",
      message: "denied",
    });
    await lease.acquire({ runId: "run-a" });
    lease.dispose();
    expect(ports.release).not.toHaveBeenCalled();
    expect(ports.forgetSnapshot).not.toHaveBeenCalled();
  });
  it("preserves release-before-forget exception ordering", async () => {
    const { ports, lease } = setup();
    await lease.acquire({ runId: "run-a" });
    vi.mocked(ports.release).mockImplementation(() => {
      throw new Error("release error");
    });
    expect(() => lease.dispose()).toThrow("release error");
    expect(ports.forgetSnapshot).not.toHaveBeenCalled();
  });
});
