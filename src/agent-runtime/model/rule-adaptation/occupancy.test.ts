import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import { resolveDefaultAgentRunRegistryStorePath } from "../../../gateway/billing/agent-run-registry.js";
import { fixtureUsage, noChangeOutput } from "../../command/rule-adaptation/test-support.js";
import { createAuthorizedModelSession, type ModelSessionPorts } from "../index.js";
import { createGovernedShadowModelPort } from "./model-port.js";
import { createShadowRegistryOccupancy } from "./occupancy.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRegistryPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rule-adaptation-occupancy-"));
  tempDirs.push(dir);
  return path.join(dir, "agent-run-registry.json");
}

function modelPorts(admission: ModelSessionPorts["admission"]): ModelSessionPorts {
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission,
    model: {
      resolveEmbeddedModelGovernance,
      buildRunModelSetSnapshot: vi.fn(() => undefined),
      forgetRunModelSet: vi.fn(),
      rememberRunModelSet: vi.fn(),
      snapshotCreditReportingFromGate: vi.fn(() => undefined),
      resolvePlatformModelsMode: vi.fn(() => "default"),
      runWithModelFallback: vi.fn(
        async (options: {
          run: (provider: string, model: string, extra?: unknown) => Promise<unknown>;
        }) => ({
          result: await options.run("shadow-fixture", "shadow-fixture"),
          provider: "shadow-fixture",
          model: "shadow-fixture",
          attempts: [],
        }),
      ),
    },
  } as unknown as ModelSessionPorts;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

it("keeps the governed port occupancy-unready when fixture admission is used", async () => {
  const ports = modelPorts({
    tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
      acquired: true as const,
      skipped: false as const,
      enterpriseId: "ent-fixture",
    })),
    releaseEnterpriseAgentRun: vi.fn(async () => {}),
  });
  const port = createGovernedShadowModelPort({
    runId: "unready-run",
    sessionPorts: ports,
    config: {},
    env: {},
    complete: async () => ({
      kind: "message",
      text: noChangeOutput(),
      usage: fixtureUsage(),
    }),
  });
  const result = await port.complete({
    system: "s",
    messages: [],
    tools: [],
    maxTokens: 100,
    timeoutMs: 1_000,
  });
  expect((result as { governanceOccupancyReady?: boolean }).governanceOccupancyReady).toBe(false);
});

it("bounds registry slots and held leases across repeated never-returning timeout and cancel cycles", async () => {
  const cap = 2;
  // Must stay longer than one never-returning timeout so a just-returned
  // timeout does not look stale and get reaped before the denial check.
  const staleMs = 200;
  const storePath = tempRegistryPath();
  expect(storePath).not.toBe(resolveDefaultAgentRunRegistryStorePath());
  expect(storePath.startsWith(os.tmpdir()) || storePath.includes("/tmp/")).toBe(true);

  const occupancy = createShadowRegistryOccupancy({
    storePath,
    enterpriseId: "ent-occupancy-fixture",
    maxConcurrentRuns: cap,
    staleMs,
  });
  const ports = modelPorts(occupancy.admission);
  const stats = { maxSlots: 0, maxHeld: 0, acquired: 0, denied: 0 };

  const observe = async (): Promise<{ slots: number; held: number }> => {
    const slots = await occupancy.countActiveSlots();
    const held = occupancy.countWatchedHeld();
    stats.maxSlots = Math.max(stats.maxSlots, slots);
    stats.maxHeld = Math.max(stats.maxHeld, held);
    return { slots, held };
  };

  const runIgnoringCompletion = async (
    runId: string,
    mode: "timeout" | "cancel",
  ): Promise<{ kind: string; governanceOccupancyReady?: boolean; detail?: string }> => {
    const controller = new AbortController();
    let startedComplete: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      startedComplete = resolve;
    });
    const port = createGovernedShadowModelPort({
      runId,
      sessionPorts: ports,
      occupancy,
      createSession: (id, sessionPorts) => createAuthorizedModelSession(id, sessionPorts),
      config: {},
      env: {},
      // Ignore cancel/timeout signals and never return, so the authorized
      // session stays held until official stale reap (or a real settle).
      complete: () => {
        startedComplete();
        return new Promise(() => {});
      },
    });
    const timeoutMs = mode === "timeout" ? 30 : 8_000;
    const running = port.complete({
      system: "s",
      messages: [],
      tools: [],
      signal: controller.signal,
      maxTokens: 100,
      timeoutMs,
    });
    // Abort only after the ignoring complete() has actually started. If
    // admission is denied, complete() never starts and `running` must
    // still resolve (do not await `started` in that case).
    if (mode === "cancel") {
      void started.then(() => controller.abort("owner_cancel"));
    }
    const result = await running;
    await observe();
    return result as { kind: string; governanceOccupancyReady?: boolean; detail?: string };
  };

  // Fill the cap in parallel so both held runs stay fresh relative to staleMs.
  const [first, second] = await Promise.all([
    runIgnoringCompletion("occ-timeout-1", "timeout"),
    runIgnoringCompletion("occ-timeout-2", "timeout"),
  ]);
  expect(first.kind).toBe("cancelled");
  expect(second.kind).toBe("cancelled");
  expect(first.governanceOccupancyReady).toBe(true);
  expect(second.governanceOccupancyReady).toBe(true);
  stats.acquired += 2;
  let observed = await observe();
  expect(observed.slots).toBe(cap);
  expect(observed.held).toBe(cap);
  // Caller already received timeout, but the underlying requests are still
  // running: do not early-release those slots just to shrink the count.
  expect(occupancy.countWatchedHeld()).toBe(cap);

  const deniedFresh = await runIgnoringCompletion("occ-timeout-fresh-denied", "timeout");
  expect(deniedFresh.kind).toBe("protocol_failure");
  expect(deniedFresh.detail).toBe("model_admission_denied");
  stats.denied += 1;
  observed = await observe();
  expect(observed.slots).toBe(cap);
  expect(observed.held).toBe(cap);

  // After the official stale window, a later acquire reuses the existing
  // reap helper and then disposes the matching in-memory sessions.
  const waves: Array<"timeout" | "cancel"> = ["timeout", "cancel", "timeout"];
  for (const [index, mode] of waves.entries()) {
    await sleep(staleMs + 20);
    const firstInWave = await runIgnoringCompletion(`occ-wave-${index}-a-${mode}`, mode);
    expect(firstInWave.kind).toBe("cancelled");
    expect(firstInWave.governanceOccupancyReady).toBe(true);
    stats.acquired += 1;
    const secondInWave = await runIgnoringCompletion(`occ-wave-${index}-b-${mode}`, mode);
    expect(secondInWave.kind).toBe("cancelled");
    stats.acquired += 1;
    observed = await observe();
    expect(observed.slots).toBe(cap);
    expect(observed.held).toBe(cap);
    const denied = await runIgnoringCompletion(`occ-wave-${index}-denied`, mode);
    expect(denied.kind).toBe("protocol_failure");
    expect(denied.detail).toBe("model_admission_denied");
    stats.denied += 1;
    observed = await observe();
    expect(observed.slots).toBe(cap);
    expect(observed.held).toBeLessThanOrEqual(cap);
  }

  expect(stats.maxSlots).toBe(cap);
  expect(stats.maxHeld).toBe(cap);
  expect(stats.denied).toBe(1 + waves.length);
  expect(stats.acquired).toBe(2 + waves.length * 2);
  expect(await occupancy.countActiveSlots()).toBeLessThanOrEqual(cap);
  expect(occupancy.countWatchedHeld()).toBeLessThanOrEqual(cap);
  expect(fs.existsSync(storePath)).toBe(true);
  expect(storePath).not.toBe(resolveDefaultAgentRunRegistryStorePath());
});
