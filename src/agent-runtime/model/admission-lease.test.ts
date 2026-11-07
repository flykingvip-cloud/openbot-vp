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
  it("shares pending disposal and waits for asynchronous release", async () => {
    const { ports, lease } = setup();
    await lease.acquire({ runId: "run-a" });
    let finish!: () => void;
    vi.mocked(ports.release).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = lease.dispose();
    expect(lease.dispose()).toBe(first);
    expect(ports.forgetSnapshot).not.toHaveBeenCalled();
    finish();
    await first;
    expect(ports.release).toHaveBeenCalledOnce();
    expect(ports.forgetSnapshot).toHaveBeenCalledOnce();
    expect(lease.held).toBe(false);
  });
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
        await lease.dispose();
      }
      await lease.dispose();
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
    await lease.dispose();
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
    await lease.dispose();
    expect(ports.release).not.toHaveBeenCalled();
    expect(ports.forgetSnapshot).not.toHaveBeenCalled();
  });
  it("forgets the snapshot even when release fails", async () => {
    const { ports, lease } = setup();
    await lease.acquire({ runId: "run-a" });
    vi.mocked(ports.release).mockImplementation(() => {
      throw new Error("release error");
    });
    await expect(lease.dispose()).rejects.toThrow("release error");
    expect(ports.forgetSnapshot).toHaveBeenCalledOnce();
  });
});
