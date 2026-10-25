/**
 * WP-04 — Shadow compare must not mutate the exec-approvals file.
 * Proves createReadonlyResolveApprovals + FabricService.check never call saveExecApprovals.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import * as execApprovals from "../infra/exec-approvals.js";
import { AdapterRegistry } from "./adapter-registry.js";
import type { ToolRequest } from "./contract.js";
import { createProbeDecideFor, createReadonlyResolveApprovals } from "./probes.js";
import { createFabricService } from "./service.js";

const sampleExecRequest = (): ToolRequest => ({
  id: "req_shadow_compare_1",
  source: { type: "openbot", userId: "agent-shadow" },
  tool: { name: "exec" },
  input: { args: ["echo", "hello"] },
  context: {},
  trace: { sessionId: "s_shadow", correlationId: "c_shadow" },
});

describe("WP-04 shadow compare readonly approvals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("createReadonlyResolveApprovals never calls ensureExecApprovals or saveExecApprovals", () => {
    const ensureSpy = vi.spyOn(execApprovals, "ensureExecApprovals");
    const saveSpy = vi.spyOn(execApprovals, "saveExecApprovals");
    const resolve = createReadonlyResolveApprovals();
    const resolved = resolve("agent-shadow");
    expect(resolved.ask).toBeDefined();
    expect(resolved.security).toBeDefined();
    expect(Array.isArray(resolved.allowlist)).toBe(true);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  test("FabricService.check with readonly probe does not save approvals", () => {
    const ensureSpy = vi.spyOn(execApprovals, "ensureExecApprovals");
    const saveSpy = vi.spyOn(execApprovals, "saveExecApprovals");
    const fabric = createFabricService({
      registry: new AdapterRegistry(),
      pipeline: {
        decideFor: createProbeDecideFor({
          resolveApprovals: createReadonlyResolveApprovals(),
        }),
        executeNode: async () => {
          throw new Error("shadow_compare_must_not_execute");
        },
      },
    });
    const result = fabric.check(sampleExecRequest());
    expect(["ALLOW", "DENY", "MODIFY"]).toContain(result.decision);
    expect(ensureSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
