import { afterEach, describe, expect, it } from "vitest";
import {
  ensureLocalWechatSidecarRunning,
  resetWechatSidecarSpawnForTests,
  setWechatSidecarSpawnForTests,
  shouldSpawnWechatSidecar,
  spawnLocalWechatSidecarIfNeeded,
} from "./sidecar-spawn.js";

afterEach(() => {
  resetWechatSidecarSpawnForTests();
});

describe("shouldSpawnWechatSidecar", () => {
  const spec = { proxyUrl: "http://127.0.0.1:3000", command: "/opt/sidecar" };

  it("does not spawn when already online", () => {
    expect(shouldSpawnWechatSidecar(spec, { ok: true, online: true })).toBe(false);
    expect(shouldSpawnWechatSidecar(spec, { ok: false, online: true, error: "unauthorized" })).toBe(
      false,
    );
  });

  it("does not spawn without command", () => {
    expect(
      shouldSpawnWechatSidecar(
        { proxyUrl: "http://127.0.0.1:3000" },
        { ok: false, online: false, error: "connect ECONNREFUSED" },
      ),
    ).toBe(false);
  });

  it("does not spawn a relative command", () => {
    expect(
      shouldSpawnWechatSidecar(
        { proxyUrl: "http://127.0.0.1:3000", command: "sidecar" },
        { ok: false, online: false, error: "connect ECONNREFUSED" },
      ),
    ).toBe(false);
  });

  it("does not spawn a non-loopback URL", () => {
    expect(
      shouldSpawnWechatSidecar(
        { proxyUrl: "http://example.com:3000", command: "/opt/sidecar" },
        { ok: false, online: false, error: "connect ECONNREFUSED" },
      ),
    ).toBe(false);
  });

  it("spawns on connection-refused loopback when command is set", () => {
    expect(
      shouldSpawnWechatSidecar(spec, { ok: false, online: false, error: "connect ECONNREFUSED" }),
    ).toBe(true);
    expect(
      shouldSpawnWechatSidecar(spec, { ok: false, online: false, error: "fetch failed" }),
    ).toBe(true);
  });
});

describe("ensureLocalWechatSidecarRunning", () => {
  it("does not spawn when probe is already online", async () => {
    const calls: string[] = [];
    setWechatSidecarSpawnForTests(() => {
      calls.push("spawn");
      return true;
    });
    const probe = await ensureLocalWechatSidecarRunning({
      spec: { proxyUrl: "http://127.0.0.1:3000", command: "/opt/sidecar" },
      probe: async () => ({ ok: true, online: true }),
      sleep: async () => undefined,
    });
    expect(probe).toEqual({ ok: true, online: true });
    expect(calls).toEqual([]);
  });

  it("spawns then retries probe on ECONNREFUSED", async () => {
    const launches: Array<{ command: string; args: string[]; cwd?: string | null }> = [];
    setWechatSidecarSpawnForTests((spec) => {
      launches.push(spec);
      return true;
    });
    let n = 0;
    const probe = await ensureLocalWechatSidecarRunning({
      spec: {
        proxyUrl: "http://127.0.0.1:3000",
        command: "/opt/sidecar",
        args: ["--listen"],
        cwd: "/tmp",
      },
      probe: async () => {
        n += 1;
        if (n === 1) {
          return { ok: false, online: false, error: "connect ECONNREFUSED" };
        }
        return { ok: true, online: true };
      },
      sleep: async () => undefined,
    });
    expect(probe).toEqual({ ok: true, online: true });
    expect(launches).toEqual([{ command: "/opt/sidecar", args: ["--listen"], cwd: "/tmp" }]);
    expect(n).toBe(2);
  });

  it("spawnLocalWechatSidecarIfNeeded refuses relative command", () => {
    const calls: string[] = [];
    setWechatSidecarSpawnForTests(() => {
      calls.push("spawn");
      return true;
    });
    expect(spawnLocalWechatSidecarIfNeeded({ command: "sidecar" })).toBe(false);
    expect(calls).toEqual([]);
  });
});
