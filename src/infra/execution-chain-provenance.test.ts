import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createExecPolicyProvenance } from "../agents/bash-tools.exec-policy-provenance.js";
import { TenantContextError } from "../gateway/tenant-context.js";
import {
  appendProvenance,
  attachCollaborationReturnProvenance,
  attachExecutionChainProvenance,
  attachProvenanceToThrownError,
  classifyCollaborationFailure,
  classifyGatewayFailure,
  createFailClosedExternalEffectVerifier,
  decorateToolResultProvenance,
  emitExecutionChainProvenance,
  listRecentExecutionChainProvenance,
  resetExecutionChainProvenanceForTest,
  securityViolationFromProvenance,
  turnSecurityFromProvenance,
} from "./execution-chain-provenance.js";

describe("execution-chain-provenance", () => {
  it("classifies unresolved_tenant without changing TenantContextError fail-closed code", () => {
    const err = new TenantContextError(
      "tenant context required but the session has none",
      "unresolved_tenant",
    );
    expect(err.code).toBe("unresolved_tenant");
    expect(classifyGatewayFailure(err)).toMatchObject({
      class: "tenant_context_unresolved",
      code: "unresolved_tenant",
    });
  });

  it("classifies wrapped GatewayClientRequestError text as tenant_context_unresolved", () => {
    const err = new Error(
      "GatewayClientRequestError: TenantContextError: tenant context required but the session has none: code=unresolved_tenant",
    );
    expect(classifyGatewayFailure(err)).toEqual({
      class: "tenant_context_unresolved",
      code: "unresolved_tenant",
      message: err.message,
    });
  });

  it("does not invent a tenant failure for generic gateway disconnects", () => {
    expect(classifyGatewayFailure(new Error("gateway not connected"))).toMatchObject({
      class: "gateway_unavailable",
      code: null,
    });
  });

  it("attaches fallback provenance onto existing agent meta without replacing payloads", () => {
    const record = {
      kind: "gateway_fallback" as const,
      initial_path: "gateway" as const,
      initial_failure: {
        class: "tenant_context_unresolved",
        code: "unresolved_tenant",
        message: "unresolved_tenant",
      },
      fallback: {
        attempted: true,
        owner: "agent-cli" as const,
        target: "embedded-agent" as const,
        retry_count: 1,
      },
      context_preserved: {
        agent_id: "main",
        session_id: "audit-1",
        session_key: "agent:main:main",
      },
      terminal_path: "embedded" as const,
      tenant_fail_closed_unchanged: true as const,
    };
    const attached = attachExecutionChainProvenance(
      { payloads: [{ text: "hi" }], meta: { durationMs: 2 } },
      record,
    ) as unknown as {
      payloads: Array<{ text: string }>;
      meta: { durationMs: number; executionChainProvenance: unknown };
    };
    expect(attached.payloads).toEqual([{ text: "hi" }]);
    expect(attached.meta.durationMs).toBe(2);
    expect(attached.meta.executionChainProvenance).toEqual([record]);
    expect(appendProvenance(attached.meta.executionChainProvenance, record)).toHaveLength(2);
  });

  it("marks collaboration child failure as no child result and no delegated success", () => {
    const annotated = attachCollaborationReturnProvenance(
      {
        status: "error",
        error:
          "TenantContextError: tenant context required but the session has none: code=unresolved_tenant",
        childSessionKey: "agent:main:subagent:child",
        runId: "run-1",
      },
      {
        parentOwner: "agent:main:main",
        runtime: "subagent",
        mode: "run",
      },
    );
    expect(classifyCollaborationFailure(annotated.error)).toBe("tenant_context_unresolved");
    expect(annotated.execution_chain).toMatchObject({
      kind: "collaboration_return",
      parent_owner: "agent:main:main",
      dispatch: { mechanism: "sessions_spawn", runtime: "subagent", mode: "run" },
      child: { session_key: "agent:main:subagent:child", run_id: "run-1" },
      execution: { status: "failed", failure_class: "tenant_context_unresolved" },
      result: { available: false },
      aggregation: { source: "parent_session" },
      return_owner: "agent:main:main",
      completion_claim: { delegated_task_completed: false },
    });
  });

  it("does not claim delegated completion when spawn is only accepted", () => {
    const annotated = attachCollaborationReturnProvenance(
      {
        status: "accepted",
        childSessionKey: "agent:main:subagent:ok",
        runId: "run-ok",
      },
      {
        parentOwner: "agent:main:main",
        runtime: "subagent",
        mode: "run",
      },
    );
    expect(annotated.execution_chain.result.available).toBe(false);
    expect(annotated.execution_chain.completion_claim.delegated_task_completed).toBe(false);
    expect(annotated.execution_chain.aggregation.source).toBe("pending_child");
    expect(annotated.execution_chain.execution.failure_class).toBeNull();
  });

  it("decorates tool-result details without rewriting model-visible content", () => {
    const record = {
      kind: "tool_selection" as const,
      decision_owner: "model" as const,
      decision_source: "model_tool_call" as const,
      decision: { capability: "session_status", reason: "unknown" as const },
      candidate_capabilities: ["session_status", "read"],
      policy_filtered_capabilities: ["session_status"],
      selected_capability: "session_status",
      policy_result: "allowed" as const,
      execution_allowed: true,
      execution_started: true,
    };
    const decorated = decorateToolResultProvenance(
      {
        content: [{ type: "text", text: "ok" }],
        details: { ok: true },
      },
      record,
    ) as unknown as {
      content: Array<{ type: string; text: string }>;
      details: { ok: boolean; executionChainProvenance: unknown };
    };
    expect(decorated.content).toEqual([{ type: "text", text: "ok" }]);
    expect(decorated.details.ok).toBe(true);
    expect(decorated.details.executionChainProvenance).toEqual([record]);
  });

  it("attaches mutation deny provenance onto the existing thrown error", () => {
    const record = {
      kind: "mutation_attempt" as const,
      tool: "write",
      tool_call_id: "tc-1",
      session_id: "sess-1",
      session_key: "agent:f3:main",
      run_id: "run-1",
      resource: "/tmp/openbot-audit-test.txt",
      policy: {
        owner: "workspace-root-guard" as const,
        decision: "denied" as const,
        reason: "sandbox_boundary" as const,
      },
      authorization: { decision: "unknown" as const },
      approval: { decision: "not_observed" as const },
      result: "denied" as const,
    };
    const err = new Error("Path escapes sandbox root (~/.openclaw/workspace): /tmp/x");
    expect(() => attachProvenanceToThrownError(err, record)).toThrow(err);
    expect((err as Error & { execution_chain?: unknown }).execution_chain).toEqual(record);
    expect(err.message).toContain("Path escapes sandbox root");
  });

  it("decorates exec policy allow without rewriting model-visible content", () => {
    const record = {
      kind: "exec_policy" as const,
      capability: "exec" as const,
      resource: {
        scope: "host_process_filesystem" as const,
        target: "printf x > /tmp/openbot-f5.txt",
      },
      policy: {
        owner: "tools.exec" as const,
        decision: "allowed" as const,
        reason: "host=gateway security=full ask=off",
      },
      authorization: { decision: "unknown" as const },
      approval: { decision: "not_observed" as const },
      result: "success" as const,
      session_id: "sess-1",
      session_key: "agent:main:main",
      run_id: "run-1",
      tool_call_id: "tc-exec-1",
    };
    const decorated = decorateToolResultProvenance(
      {
        content: [{ type: "text", text: "ok" }],
        details: { status: "completed" },
      },
      record,
    ) as unknown as {
      content: Array<{ type: string; text: string }>;
      details: { status: string; executionChainProvenance: unknown };
    };
    expect(decorated.content).toEqual([{ type: "text", text: "ok" }]);
    expect(decorated.details.status).toBe("completed");
    expect(decorated.details.executionChainProvenance).toEqual([record]);
  });

  it("does not invent a security observation from unrelated provenance", () => {
    resetExecutionChainProvenanceForTest();
    emitExecutionChainProvenance({
      kind: "gateway_fallback",
      initial_path: "gateway",
      initial_failure: null,
      fallback: { attempted: false, owner: "agent-cli", target: "none", retry_count: 0 },
      context_preserved: { agent_id: null, session_id: null, session_key: null },
      terminal_path: "gateway",
      tenant_fail_closed_unchanged: true,
    });
    expect(securityViolationFromProvenance([])).toBeUndefined();
    expect(
      securityViolationFromProvenance([
        {
          kind: "exec_policy",
          capability: "exec",
          resource: { scope: "host_process_filesystem", target: "ls" },
          policy: { owner: "tools.exec", decision: "allowed", reason: "allowlist" },
          authorization: { decision: "unknown" },
          approval: { decision: "not_observed" },
          result: "success",
          session_id: null,
          session_key: null,
          run_id: null,
          tool_call_id: null,
        },
      ]),
    ).toBeUndefined();
  });
});

function mutation(over: {
  run_id?: string | null;
  decision?: "allowed" | "denied";
  result?: "denied" | "success" | "error";
  effectObserved?: "not_attempted" | "blocked" | "applied" | "verified" | "unknown";
}) {
  return {
    kind: "mutation_attempt" as const,
    tool: "write",
    tool_call_id: "tc-1",
    session_id: "sess-1",
    session_key: "agent:a:main",
    run_id: over.run_id === undefined ? "run-a" : over.run_id,
    resource: "notes.md",
    policy: {
      owner: "workspace-root-guard" as const,
      decision: over.decision ?? "allowed",
      reason:
        over.decision === "denied"
          ? ("sandbox_boundary" as const)
          : ("passed_existing_guard" as const),
    },
    authorization: { decision: "unknown" as const },
    approval: { decision: "not_observed" as const },
    result: over.result ?? "success",
    ...(over.effectObserved ? { effectObserved: over.effectObserved } : {}),
  };
}

describe("execution-chain-provenance run isolation", () => {
  it("keeps unlabeled rows only when no runId filter is set", () => {
    resetExecutionChainProvenanceForTest();
    const startedAt = Date.now();
    emitExecutionChainProvenance(mutation({ run_id: "run-a" }));
    emitExecutionChainProvenance(mutation({ run_id: "run-b" }));
    emitExecutionChainProvenance(mutation({ run_id: null }));
    const endedAt = Date.now();
    expect(
      listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-a" }).map((row) =>
        "run_id" in row ? row.run_id : undefined,
      ),
    ).toEqual(["run-a"]);
    expect(listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-other" })).toEqual(
      [],
    );
    expect(listRecentExecutionChainProvenance({ startedAt, endedAt })).toHaveLength(3);
  });

  it("does not let concurrent agent provenance cross into the other run", () => {
    resetExecutionChainProvenanceForTest();
    const startedAt = Date.now();
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-agent-a",
        decision: "denied",
        result: "denied",
        effectObserved: "blocked",
      }),
    );
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-agent-b",
        decision: "denied",
        result: "success",
        effectObserved: "applied",
      }),
    );
    const endedAt = Date.now();
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-agent-a" }),
      ),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      securityViolation: false,
    });
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-agent-b" }),
      ),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
    });
  });
});

describe("execution-chain-provenance security semantics", () => {
  it("treats an allowed applied mutation as inspected zero, not a violation", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "allowed", result: "success", effectObserved: "applied" }),
      ]),
    ).toEqual({
      securityViolation: false,
    });
  });

  it("treats a denied and blocked attempt as controlled, not a violation", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "denied", effectObserved: "blocked" }),
      ]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      securityViolation: false,
    });
  });

  it("treats denied+applied as a suspected bypass, not a confirmed violation", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "success", effectObserved: "applied" }),
      ]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
    });
  });

  it("treats denied+verified as a separately confirmed bypass", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "success", effectObserved: "verified" }),
      ]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
      securityViolation: true,
      authorizationBypass: true,
    });
  });

  it("does not mark bypass on denied+blocked or denied+not_attempted", () => {
    for (const effectObserved of ["blocked", "not_attempted"] as const) {
      expect(
        turnSecurityFromProvenance([
          mutation({ decision: "denied", result: "denied", effectObserved }),
        ]),
      ).toEqual({
        securityAttempt: true,
        securityControlDenied: true,
        securityViolation: false,
      });
    }
  });

  it("leaves confirmed violation unset on denied+unknown", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "error", effectObserved: "unknown" }),
      ]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
    });
  });

  it("does not mark bypass on allowed+verified without an independent violation", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "allowed", result: "success", effectObserved: "verified" }),
      ]),
    ).toEqual({
      securityViolation: false,
    });
  });

  it("lets the exec writer report applied without claiming independent verification", () => {
    const record = createExecPolicyProvenance(
      {
        session_id: "sess-1",
        session_key: "agent:main:main",
        run_id: "run-1",
        tool_call_id: "tc-exec-1",
        command: "printf x",
        host: "gateway",
        security: "full",
        ask: "off",
      },
      { decision: "allowed", result: "success" },
    );
    expect(record.effectObserved).toBe("applied");
    expect(record.effectObserved).not.toBe("verified");
  });

  it("does not let allowed+applied count as independently verified", () => {
    const record = mutation({
      decision: "allowed",
      result: "success",
      effectObserved: "applied",
    });
    expect(record.effectObserved).toBe("applied");
    expect(record.effectObserved).not.toBe("verified");
    expect(turnSecurityFromProvenance([record])).toEqual({
      securityViolation: false,
    });
  });

  it("does not upgrade a rejected operation into a bypass from result=success", () => {
    expect(
      turnSecurityFromProvenance([mutation({ decision: "denied", result: "success" })]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
    });
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "denied", effectObserved: "blocked" }),
      ]).authorizationBypass,
    ).toBeUndefined();
  });

  it("leaves violation unset on a legacy record that has no effect field", () => {
    expect(
      turnSecurityFromProvenance([mutation({ decision: "allowed", result: "success" })]),
    ).toEqual({});
    expect(
      turnSecurityFromProvenance([mutation({ decision: "denied", result: "denied" })]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
    });
  });

  it("does not infer a violation when the effect is unknown", () => {
    expect(
      turnSecurityFromProvenance([
        mutation({ decision: "denied", result: "error", effectObserved: "unknown" }),
      ]),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
    });
  });

  it("leaves every security field unset when there is no related provenance", () => {
    expect(turnSecurityFromProvenance([])).toEqual({});
  });
});

describe("execution-chain-provenance effect isolation", () => {
  it("keeps run A denied+blocked from contaminating run B", () => {
    resetExecutionChainProvenanceForTest();
    const startedAt = Date.now();
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-a",
        decision: "denied",
        result: "denied",
        effectObserved: "blocked",
      }),
    );
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-b",
        decision: "allowed",
        result: "success",
        effectObserved: "applied",
      }),
    );
    const endedAt = Date.now();
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-a" }),
      ),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      securityViolation: false,
    });
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-b" }),
      ),
    ).toEqual({
      securityViolation: false,
    });
  });

  it("keeps suspected bypass on the run that observed denied+applied", () => {
    resetExecutionChainProvenanceForTest();
    const startedAt = Date.now();
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-a",
        decision: "denied",
        result: "success",
        effectObserved: "applied",
      }),
    );
    emitExecutionChainProvenance(
      mutation({
        run_id: "run-b",
        decision: "denied",
        result: "denied",
        effectObserved: "blocked",
      }),
    );
    const endedAt = Date.now();
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-a" }),
      ),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      suspectedAuthorizationBypass: true,
    });
    expect(
      turnSecurityFromProvenance(
        listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-b" }),
      ),
    ).toEqual({
      securityAttempt: true,
      securityControlDenied: true,
      securityViolation: false,
    });
  });

  it("excludes a missing run_id from a specified-run query", () => {
    resetExecutionChainProvenanceForTest();
    const startedAt = Date.now();
    emitExecutionChainProvenance(
      mutation({
        run_id: null,
        decision: "denied",
        result: "success",
        effectObserved: "applied",
      }),
    );
    const endedAt = Date.now();
    expect(listRecentExecutionChainProvenance({ startedAt, endedAt, runId: "run-a" })).toEqual([]);
  });
});

describe("fail-closed external effect verifier", () => {
  const verifier = createFailClosedExternalEffectVerifier();

  it("never upgrades applied to verified", () => {
    expect(verifier.verify({ effectObserved: "applied" })).toBe("applied");
    expect(verifier.verify({ effectObserved: "applied", receiptRef: "receipt-1" })).toBe("applied");
  });

  it("does not accept a claimed verified stamp", () => {
    expect(verifier.verify({ effectObserved: "verified", receiptRef: "receipt-1" })).toBe(
      "unknown",
    );
  });

  it("leaves blocked and unknown unchanged", () => {
    expect(verifier.verify({ effectObserved: "blocked" })).toBe("blocked");
    expect(verifier.verify({ effectObserved: "unknown" })).toBe("unknown");
  });
});

describe("production writers never emit verified", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  it("keeps every exec-policy writer branch off verified", () => {
    expect(
      createExecPolicyProvenance(
        {
          session_id: "sess-1",
          session_key: "agent:main:main",
          run_id: "run-1",
          tool_call_id: "tc-1",
          command: "printf x",
          host: "gateway",
          security: "full",
          ask: "off",
        },
        { decision: "allowed", result: "success" },
      ).effectObserved,
    ).toBe("applied");
    expect(
      createExecPolicyProvenance(
        {
          session_id: "sess-1",
          session_key: "agent:main:main",
          run_id: "run-1",
          tool_call_id: "tc-1",
          command: "printf x",
          host: "gateway",
          security: "deny",
          ask: "off",
        },
        { decision: "denied", result: "denied" },
      ).effectObserved,
    ).toBe("blocked");
    expect(
      createExecPolicyProvenance(
        {
          session_id: "sess-1",
          session_key: "agent:main:main",
          run_id: "run-1",
          tool_call_id: "tc-1",
          command: "printf x",
          host: "gateway",
          security: "full",
          ask: "off",
        },
        { decision: "allowed", result: "error" },
      ).effectObserved,
    ).toBe("unknown");
  });

  it("does not let production wrappers assign verified", () => {
    for (const rel of [
      "src/agents/bash-tools.exec-policy-provenance.ts",
      "src/agents/pi-tools.read.ts",
    ] as const) {
      const text = readFileSync(resolve(root, rel), "utf8");
      expect(text).not.toMatch(/effectObserved:\s*"verified"/);
      expect(text).not.toMatch(/return "verified"/);
    }
  });
});
