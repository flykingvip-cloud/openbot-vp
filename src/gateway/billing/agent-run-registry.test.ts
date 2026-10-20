// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-agent-run-reg-${Date.now()}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return { ...actual, CONFIG_DIR: tmpDir };
});

const {
  registerAgentRun,
  finishAgentRun,
  countActiveAgentRuns,
  tryAcquireAgentRunSlot,
  __resetAgentRunRegistryForTest,
} = await import("./agent-run-registry.js");

describe("agent-run-registry", () => {
  beforeEach(async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    await __resetAgentRunRegistryForTest();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers and finishes runs (Property 1)", async () => {
    await registerAgentRun({ runId: "r1", enterpriseId: "ent-a" });
    expect(await countActiveAgentRuns("ent-a")).toBe(1);
    await finishAgentRun("r1");
    expect(await countActiveAgentRuns("ent-a")).toBe(0);
  });

  it("finish is idempotent (Property 2)", async () => {
    await registerAgentRun({ runId: "r2", enterpriseId: "ent-b" });
    const first = await finishAgentRun("r2");
    const second = await finishAgentRun("r2");
    expect(first?.finishedAt).toBeTruthy();
    expect(second?.finishedAt).toBe(first?.finishedAt);
  });

  it("isolates tenants", async () => {
    await registerAgentRun({ runId: "r3", enterpriseId: "ent-x" });
    await registerAgentRun({ runId: "r4", enterpriseId: "ent-y" });
    expect(await countActiveAgentRuns("ent-x")).toBe(1);
    expect(await countActiveAgentRuns("ent-y")).toBe(1);
  });

  it("tryAcquireAgentRunSlot enforces limit under lock", async () => {
    const base = {
      enterpriseId: "ent-c",
      maxConcurrentRuns: 2,
      allowBurstConcurrency: false,
    };
    expect((await tryAcquireAgentRunSlot({ ...base, runId: "a1" })).ok).toBe(true);
    expect((await tryAcquireAgentRunSlot({ ...base, runId: "a2" })).ok).toBe(true);
    const blocked = await tryAcquireAgentRunSlot({ ...base, runId: "a3" });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("CONCURRENCY_LIMIT_EXCEEDED");
    }
  });

  it("parallel acquires never exceed maxConcurrentRuns (atomic gate)", async () => {
    const limit = 3;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        tryAcquireAgentRunSlot({
          runId: `race-${i}`,
          enterpriseId: "ent-race",
          maxConcurrentRuns: limit,
          allowBurstConcurrency: false,
        }),
      ),
    );
    const okCount = results.filter((r) => r.ok).length;
    expect(okCount).toBe(limit);
    expect(await countActiveAgentRuns("ent-race")).toBe(limit);
  });

  it("allows burst up to maxBurstRuns when burst enabled", async () => {
    const base = {
      enterpriseId: "ent-burst",
      maxConcurrentRuns: 2,
      maxBurstRuns: 4,
      allowBurstConcurrency: true,
      concurrencyMode: "block" as const,
    };
    for (let i = 0; i < 4; i++) {
      expect((await tryAcquireAgentRunSlot({ ...base, runId: `burst-${i}` })).ok).toBe(true);
    }
    const blocked = await tryAcquireAgentRunSlot({ ...base, runId: "burst-blocked" });
    expect(blocked.ok).toBe(false);
  });

  it("reaps stale active runs before enforcing concurrency", async () => {
    const staleStartedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    await registerAgentRun({
      runId: "stale-1",
      enterpriseId: "ent-stale",
      startedAt: staleStartedAt,
    });
    await registerAgentRun({
      runId: "stale-2",
      enterpriseId: "ent-stale",
      startedAt: staleStartedAt,
    });
    await registerAgentRun({
      runId: "stale-3",
      enterpriseId: "ent-stale",
      startedAt: staleStartedAt,
    });
    await registerAgentRun({
      runId: "stale-4",
      enterpriseId: "ent-stale",
      startedAt: staleStartedAt,
    });
    expect(await countActiveAgentRuns("ent-stale")).toBe(4);
    const acquired = await tryAcquireAgentRunSlot({
      runId: "fresh-1",
      enterpriseId: "ent-stale",
      maxConcurrentRuns: 4,
      allowBurstConcurrency: false,
    });
    expect(acquired.ok).toBe(true);
    expect(await countActiveAgentRuns("ent-stale")).toBe(1);
  });
});
