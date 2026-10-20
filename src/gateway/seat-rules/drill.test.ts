import { describe, expect, it, vi } from "vitest";
import { AdapterRegistry, BUILTIN_ADAPTERS } from "../../fabric/adapter-registry.js";
import { buildExecutionRecord, type FabricExecutionRecord } from "../../fabric/audit.js";
import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "../../fabric/contract.js";
import { decide } from "../../fabric/policy-runtime.js";
import { createFabricService } from "../../fabric/service.js";
import { normalizeExecAsk } from "../../infra/exec-approvals.js";
import {
  applySeatDrillAsPreAuthorization,
  buildSeatDrillSampleRequest,
  runSeatDryRunDiffDrill,
  runSeatPolicyDrill,
  runSeatPolicyDrillViaFabric,
} from "./drill.js";

function sampleReq(): ToolRequest {
  return buildSeatDrillSampleRequest({ tenantId: "tenant-a", command: "echo seat-drill" });
}

function allowDecision(): PolicyDecision {
  return { decision: "ALLOW", matchedRules: ["r1"], decisionTrace: [] };
}

function denyDecision(reason = "blocked"): PolicyDecision {
  return { decision: "DENY", reason, matchedRules: [], decisionTrace: [] };
}

function execResult(): ToolExecutionResult {
  return {
    id: "req-1",
    status: "success",
    timing: { start: 1, end: 2 },
    trace: { policyDecisionId: "req-1", executionId: "e1" },
  };
}

describe("闸门 6 — seat policy drill", () => {
  it("policy check 只裁决、不执行工具", () => {
    const executeNode = vi.fn(async () => {
      throw new Error("should not execute");
    });
    const fabric = createFabricService({
      registry: new AdapterRegistry(BUILTIN_ADAPTERS),
      pipeline: { decideFor: () => allowDecision(), executeNode },
    });

    const result = runSeatPolicyDrillViaFabric({
      fabric,
      request: sampleReq(),
      effectiveAsk: "on-miss",
      effectiveSecurity: "allowlist",
      analysisOk: true,
      allowlistSatisfied: true,
    });

    expect(result.outcome).toBe("allow");
    expect(result.decision).toBe("ALLOW");
    expect(result.preAuthorization).toBe(false);
    expect(result.persisted).toBe(false);
    expect(executeNode).not.toHaveBeenCalled();
  });

  it("DENY / MODIFY 映射为拒绝与收紧，并标放宽", () => {
    const denyCheck = vi.fn(() => ({
      decision: "DENY" as const,
      reason: "missing_scope",
      matchedRules: [],
      decisionTrace: [],
    }));
    const denied = runSeatPolicyDrill({
      check: denyCheck,
      request: sampleReq(),
      effectiveAsk: "always",
      effectiveSecurity: "deny",
      baselineDecision: denyDecision("old"),
    });
    expect(denied.outcome).toBe("deny");
    expect(denied.relaxation).toBe(false);

    const allowFromDeny = runSeatPolicyDrill({
      check: () => ({
        decision: "ALLOW",
        matchedRules: [],
        decisionTrace: [],
      }),
      request: sampleReq(),
      effectiveAsk: "off",
      effectiveSecurity: "full",
      baselineDecision: denyDecision("old"),
      analysisOk: true,
      allowlistSatisfied: true,
    });
    expect(allowFromDeny.outcome).toBe("allow");
    expect(allowFromDeny.relaxation).toBe(true);

    // 相对基线进一步收紧沙箱（none → strict）不是放宽。
    const tighten = runSeatPolicyDrill({
      check: () => ({
        decision: "MODIFY",
        constraints: { sandboxMode: "strict", allowNetwork: false },
        matchedRules: [],
        decisionTrace: [],
      }),
      request: sampleReq(),
      effectiveAsk: "on-miss",
      effectiveSecurity: "allowlist",
      baselineDecision: {
        decision: "MODIFY",
        constraints: { sandboxMode: "none" },
        matchedRules: [],
        decisionTrace: [],
      },
    });
    expect(tighten.outcome).toBe("tighten");
    expect(tighten.relaxation).toBe(false);
  });

  it("仍用天花板算「若真执行是否要审批」，且不把 ask 改成 off", () => {
    const result = runSeatPolicyDrill({
      check: () => ({
        decision: "ALLOW",
        matchedRules: [],
        decisionTrace: [],
      }),
      request: sampleReq(),
      effectiveAsk: "always",
      effectiveSecurity: "allowlist",
      analysisOk: true,
      allowlistSatisfied: true,
    });
    expect(result.wouldRequireApprovalIfExecuted).toBe(true);
    expect(result.effectiveAsk).toBe("always");
    expect(result.effectiveAsk).not.toBe("off");

    const onMissMiss = runSeatPolicyDrill({
      check: () => ({
        decision: "DENY",
        reason: "exec_approval_unresolved",
        matchedRules: [],
        decisionTrace: [],
      }),
      request: sampleReq(),
      effectiveAsk: "on-miss",
      effectiveSecurity: "allowlist",
      analysisOk: false,
      allowlistSatisfied: false,
    });
    expect(onMissMiss.wouldRequireApprovalIfExecuted).toBe(true);
    expect(onMissMiss.effectiveAsk).toBe("on-miss");
  });

  it("dryRunDiff 演练无副作用，并标放宽", () => {
    const request = sampleReq();
    const deniedInputs = { scope: { allowed: false as const, missingScope: "operator.write" } };
    const decision = decide(request, deniedInputs);
    const record: FabricExecutionRecord = buildExecutionRecord({
      request,
      decision,
      result: execResult(),
      policyInputs: deniedInputs,
    });

    const sideEffect = vi.fn();
    const drill = runSeatDryRunDiffDrill({
      records: [record],
      candidate: (inputs) => {
        sideEffect();
        return { ...inputs, scope: { allowed: true } };
      },
    });

    expect(sideEffect).toHaveBeenCalled();
    expect(drill.diff.relaxationCount).toBe(1);
    expect(drill.relaxation).toBe(true);
    expect(drill.preAuthorization).toBe(false);
    expect(drill.persisted).toBe(false);
  });

  it("演练结果不能写成下次真执行预授权 / 允许列表", () => {
    const result = runSeatPolicyDrill({
      check: () => ({
        decision: "ALLOW",
        matchedRules: ["r1"],
        decisionTrace: [],
      }),
      request: sampleReq(),
      effectiveAsk: "off",
      effectiveSecurity: "full",
      analysisOk: true,
      allowlistSatisfied: true,
    });
    expect(result.preAuthorization).toBe(false);
    expect(result.persisted).toBe(false);
    expect(() => applySeatDrillAsPreAuthorization(result)).toThrow(
      /seat_drill_cannot_preauthorize/,
    );
    // 演练模块不提供任何写允许列表 / 审批放行的成功路径。
    expect(typeof (result as { allowlistPattern?: unknown }).allowlistPattern).toBe("undefined");
  });

  it("不新增 ExecAsk 第四值（演练 / dry-run 不是 ask）", () => {
    expect(normalizeExecAsk("off")).toBe("off");
    expect(normalizeExecAsk("on-miss")).toBe("on-miss");
    expect(normalizeExecAsk("always")).toBe("always");
    expect(normalizeExecAsk("drill")).toBeNull();
    expect(normalizeExecAsk("dry-run")).toBeNull();
    expect(normalizeExecAsk("dryRun")).toBeNull();
    expect(normalizeExecAsk("仅演练")).toBeNull();
  });

  it("FabricService.check 路径下 execute 从未被调用（即使 ALLOW）", async () => {
    const executeNode = vi.fn(async () => ({
      id: "n",
      status: "success" as const,
      timing: { start: 0, end: 0 },
      trace: { policyDecisionId: "n", executionId: "e" },
    }));
    const fabric = createFabricService({
      registry: new AdapterRegistry(BUILTIN_ADAPTERS),
      pipeline: { decideFor: () => allowDecision(), executeNode },
    });
    runSeatPolicyDrillViaFabric({
      fabric,
      request: sampleReq(),
      effectiveAsk: "on-miss",
      effectiveSecurity: "allowlist",
      allowlistSatisfied: true,
    });
    // 对比：真 execute 才会碰 executeNode
    await fabric.execute(sampleReq());
    expect(executeNode).toHaveBeenCalledTimes(1);
  });
});
