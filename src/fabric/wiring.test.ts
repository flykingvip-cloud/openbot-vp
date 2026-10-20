import { EventEmitter } from "node:events";
import type { ToolInvoker } from "@openbot/aor-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFabricService, setFabricServiceProvider } from "../gateway/server-methods/fabric.js";
import type { ToolRequest } from "./contract.js";
import type { ResolvedExecApprovals } from "./probes.js";
import { createGatewayFabricService } from "./wiring.js";

afterEach(() => setFabricServiceProvider(null));

/** Minimal fake `spawn` that emits stdout then closes with a code. */
function fakeSpawn(code: number, stdout: string, capture?: (cmd: string) => void) {
  return ((cmd: string) => {
    capture?.(cmd);
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (stdout) {
        child.stdout.emit("data", stdout);
      }
      child.emit("close", code);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

function req(name: string, args: string[]): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor" },
    tool: { name },
    input: { args },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1" },
  };
}

// full security ⇒ exec is cleared (ALLOW) deterministically.
const fullApprovals: ResolvedExecApprovals = { ask: "off", security: "full", allowlist: [] };
const lockedApprovals: ResolvedExecApprovals = {
  ask: "on-miss",
  security: "allowlist",
  allowlist: [],
};

function fakeInvoker(result: unknown = { ok: true }) {
  const invoke = vi.fn(async () => ({ ok: true, result }));
  return { invoker: { invoke } satisfies ToolInvoker, invoke };
}

describe("wiring — createGatewayFabricService (real runner via ToolInvoker)", () => {
  it("ALLOWed exec actually executes through the ToolInvoker", async () => {
    const { invoker, invoke } = fakeInvoker({ stdout: "done" });
    const svc = createGatewayFabricService({
      toolInvoker: invoker,
      probeDeps: { resolveApprovals: () => fullApprovals },
    });
    const { result } = await svc.execute(req("exec", ["git", "status"]));
    expect(result.status).toBe("success");
    expect(invoke).toHaveBeenCalledTimes(1);
    // result stdout comes from the invoker result (JSON-encoded).
    expect(result.output?.stdout).toContain("done");
  });

  it("DENYed exec never reaches the ToolInvoker (gate short-circuit)", async () => {
    const { invoker, invoke } = fakeInvoker();
    const svc = createGatewayFabricService({
      toolInvoker: invoker,
      probeDeps: { resolveApprovals: () => lockedApprovals },
    });
    const { result } = await svc.execute(req("exec", ["rm", "-rf", "/"]));
    expect(result.status).toBe("denied");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("records audit + reports usage for executed runs", async () => {
    const { invoker } = fakeInvoker();
    const records: unknown[] = [];
    const usages: unknown[] = [];
    const svc = createGatewayFabricService({
      toolInvoker: invoker,
      probeDeps: { resolveApprovals: () => fullApprovals },
      onRecord: (r) => records.push(r),
      usage: { ingest: (u) => void usages.push(u) },
      estimateCostUsd: () => 0.01,
    });
    await svc.execute(req("exec", ["git", "status"]));
    expect(records).toHaveLength(1);
    expect(usages).toHaveLength(1);
  });

  it("is installable as the gateway service provider", async () => {
    const { invoker } = fakeInvoker();
    setFabricServiceProvider(() =>
      createGatewayFabricService({
        toolInvoker: invoker,
        probeDeps: { resolveApprovals: () => fullApprovals },
      }),
    );
    const svc = getFabricService();
    expect(svc).not.toBeNull();
    const { result } = await svc!.execute(req("exec", ["git", "status"]));
    expect(result.status).toBe("success");
  });

  it("with processRunner enabled, generic git runs as a native process (not the invoker)", async () => {
    const { invoker, invoke } = fakeInvoker();
    const spawned: string[] = [];
    const svc = createGatewayFabricService({
      toolInvoker: invoker,
      processRunner: { spawnImpl: fakeSpawn(0, "On branch main", (cmd) => spawned.push(cmd)) },
    });
    const { result } = await svc.execute(req("git", ["status"]));
    expect(result.status).toBe("success");
    expect(result.output?.stdout).toBe("On branch main");
    expect(spawned).toEqual(["git"]);
    // git went native; the /tools/invoke surface was not used.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("Stage-2: injected attributionFor flows into decisionTrace (neutral) + ownership", async () => {
    const { invoker } = fakeInvoker();
    const records: Array<{
      decision: { decision: string; decisionTrace: Array<{ stage: string; effect?: string }> };
      who?: { ownership?: { owner?: string } };
    }> = [];
    const svc = createGatewayFabricService({
      toolInvoker: invoker,
      probeDeps: { resolveApprovals: () => fullApprovals },
      attributionFor: () => ({ owner: "kiro-fabric", taskId: "openbot-fabric" }),
      onRecord: (r) =>
        records.push(
          r as unknown as {
            decision: {
              decision: string;
              decisionTrace: Array<{ stage: string; effect?: string }>;
            };
            who?: { ownership?: { owner?: string } };
          },
        ),
    });
    const { result } = await svc.execute(req("exec", ["git", "status"]));
    expect(result.status).toBe("success");
    // The compile-time decision carries the neutral Stage-2 signal but is
    // unaffected by it (D3): still ALLOW, loom.attribution entry is neutral.
    const rec = records[0];
    expect(rec?.decision.decision).toBe("ALLOW");
    const loom = rec?.decision.decisionTrace.find((e) => e.stage === "loom.attribution");
    expect(loom?.effect).toBe("neutral");
    // ownership ("who") is projected from the same attribution signal via the mapper.
    expect(rec?.who?.ownership?.owner).toBe("kiro-fabric");
  });
});
