import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { readConversationTaskFlags } from "../../conversation-task/feature.js";
import type { AnyAgentTool } from "../pi-tools.types.js";
import {
  applyPreflightToTools,
  buildExecutionPreflight,
  classifyExecutionFailure,
  evaluateDeliveryEvidence,
  filterLaneTools,
  gateAssistantTexts,
  hashArtifact,
  issueValidationReceipt,
  noteConfirmationPassed,
  resetConfirmationGatesForTest,
  readExecutionDecisionCount,
  readExecutionTraces,
  readSkillContract,
  recordExecutionTrace,
  registerTrustedValidator,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
  resolveSkillFrontmatter,
  type ExecutionTraceRecord,
} from "./index.js";

const alias = {
  name: "sample-alias",
  frontmatter: { "alias-of": "sample-primary", triggers: "sample-task" },
};
const primary = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-confirmations": "stage-a",
    "required-validators": "sample-validator",
    "allowed-tools": "read,exec,process",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
  },
};

function build(taskId: string, skills = [alias, primary]) {
  return buildExecutionPreflight({
    taskId,
    sessionId: "session-review",
    message: "run sample-task",
    skills,
    policyToolNames: ["read", "exec", "process", "write"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

beforeEach(() => {
  resetExecutionTraceForTest();
  resetValidationStateForTest();
  resetConfirmationGatesForTest();
  resetDeliveryArtifactsForTest();
  registerTrustedValidator({ id: "sample-validator", version: "1" });
});

describe("execution preflight integration", () => {
  it("leaves ordinary tasks unchanged when no skill contract is bound", () => {
    const preflight = buildExecutionPreflight({
      taskId: "ordinary",
      sessionId: "session-review",
      message: "你好",
      skills: [{ name: "notes", frontmatter: { description: "prompt only" } }],
      policyToolNames: ["read", "exec"],
      qualify: () => ({ kind: "chat", reasons: ["test"] }),
    });
    expect(preflight.decisionCode).toBe("no_skill_contract");
    expect(preflight.allowedTools).toEqual(["read", "exec"]);
    const client = [
      { type: "function" as const, function: { name: "mcp_search" } },
      { type: "function" as const, function: { name: "read" } },
    ];
    expect(filterLaneTools(client, preflight, (tool) => tool.function.name)).toEqual(client);
  });

  it("binds the real primary and keeps that contract across a provider retry", () => {
    const first = build("retry-task");
    const transport = classifyExecutionFailure({ message: "503 upstream" });
    expect(transport).toMatchObject({
      failureClass: "transient_transport",
      retryable: true,
      fallbackAllowed: false,
    });
    recordExecutionTrace({
      taskId: first.taskId,
      sessionId: first.sessionId,
      attemptNumber: first.attemptNumber,
      intentClass: first.intentClass,
      primarySkill: first.primarySkill,
      decisionStage: "retry",
      decisionCode: transport.failureClass,
      toolName: "exec",
      retryable: transport.retryable,
      fallback: "none",
    });
    const second = build("retry-task");
    expect(first.primarySkill).toBe("sample-primary");
    expect(second.primarySkill).toBe("sample-primary");
    expect(second.forbiddenFinalEngines).toEqual(["legacy-engine"]);
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
  });

  it("drops client, mcp-shaped, and skill-identity tools that the contract does not allow", () => {
    const preflight = build("lane-task");
    const client = [
      { type: "function" as const, function: { name: "mcp_search" } },
      { type: "function" as const, function: { name: "skill_identity" } },
      { type: "function" as const, function: { name: "read" } },
    ];
    expect(
      filterLaneTools(client, preflight, (tool) => tool.function.name)?.map(
        (tool) => tool.function.name,
      ),
    ).toEqual(["read"]);
    const server = ["exec", "process", "skill_identity", "write"].map(
      (name) => ({ name, execute: async () => ({ ok: true }) }) as unknown as AnyAgentTool,
    );
    expect(applyPreflightToTools(server, preflight).map((tool) => tool.name)).toEqual([
      "exec",
      "process",
    ]);
  });

  it("invalidates a receipt when the artifact bytes change and blocks a completion claim", () => {
    registerTrustedValidator({ id: "sample-validator", version: "1" });
    const preflight = build("qa-task");
    noteConfirmationPassed(preflight.taskId, preflight.attemptNumber, "stage-a");
    const artifactPath = "out/output.bin";
    const original = "version-1";
    const receipt = issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: preflight.taskId,
      artifactPath,
      artifactBytes: original,
    });
    expect(receipt?.validatorVersion).toBe("1");
    const stale = evaluateDeliveryEvidence({
      preflight,
      artifactPath,
      artifactHash: hashArtifact("version-2"),
      artifactExists: true,
      artifactReadable: true,
      modelClaim: "qa_passed",
    });
    expect(stale.validationPassed).toBe(false);
    expect(stale.allowedToDeliver).toBe(false);
    expect(gateAssistantTexts(["任务完成"], stale)[0]).toBe("正在处理，结果尚未对外公布。");
    const fresh = evaluateDeliveryEvidence({
      preflight,
      artifactPath,
      artifactHash: hashArtifact(original),
      artifactExists: true,
      artifactReadable: true,
      modelClaim: "qa_passed",
    });
    expect(fresh.validationPassed).toBe(true);
    expect(fresh.allowedToDeliver).toBe(true);
    expect(
      issueValidationReceipt({
        result: "passed",
        validatorId: "unregistered-validator",
        taskId: preflight.taskId,
        artifactPath,
        artifactBytes: original,
      }),
    ).toBeUndefined();
  });

  it("classifies failures and refuses retry or privilege fallback for contract, validation, and permission stops", () => {
    const cases: Array<[string, string, boolean, boolean]> = [
      ["socket hang up", "transient_transport", true, false],
      ["429 too many requests", "rate_limit", true, false],
      ["provider failover", "provider_failover", false, true],
      ["context overflow compaction", "compaction_retry", true, false],
      ["approval required", "approval_required", false, false],
      ["exec denied", "approval_denied", false, false],
      ["ToolAuthorizationError", "authorization_denied", false, false],
      ["path escapes workspace", "resource_out_of_scope", false, false],
      ["skill_contract_violation", "skill_contract_violation", false, false],
      ["validation_failed", "validation_failed", false, false],
      ["invalid pdf", "permanent_failure", false, false],
    ];
    for (const [message, failureClass, retryable, fallbackAllowed] of cases) {
      expect(classifyExecutionFailure({ message }), message).toMatchObject({
        failureClass,
        retryable,
        fallbackAllowed,
      });
    }
    for (const message of ["skill_contract_violation", "validation_failed", "permission denied"]) {
      const classified = classifyExecutionFailure({ message });
      expect(classified.retryable).toBe(false);
      expect(classified.fallbackAllowed).toBe(false);
    }
  });

  it("records reconstructable traces without prompt text", () => {
    registerTrustedValidator({ id: "sample-validator", version: "1" });
    const success = build("trace-success");
    noteConfirmationPassed(success.taskId, success.attemptNumber, "stage-a");
    const artifactPath = "out/output.bin";
    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: success.taskId,
      artifactPath,
      artifactBytes: "ok",
    });
    const allowed = evaluateDeliveryEvidence({
      preflight: success,
      artifactPath,
      artifactHash: hashArtifact("ok"),
      artifactExists: true,
      artifactReadable: true,
    });
    recordExecutionTrace({
      taskId: success.taskId,
      sessionId: success.sessionId,
      attemptNumber: success.attemptNumber,
      intentClass: success.intentClass,
      primarySkill: success.primarySkill,
      decisionStage: "delivery",
      decisionCode: success.decisionCode,
      deliveryOutcome: allowed.allowedToDeliver ? "allowed" : "blocked",
    });
    const denied = classifyExecutionFailure({ message: "permission denied" });
    recordExecutionTrace({
      taskId: "trace-denied",
      sessionId: "session-review",
      attemptNumber: 1,
      intentClass: "short_action",
      decisionStage: "tool",
      decisionCode: denied.failureClass,
      toolName: "exec",
      retryable: denied.retryable,
      fallback: "none",
    });
    const invalid = classifyExecutionFailure({ message: "validation_failed" });
    recordExecutionTrace({
      taskId: "trace-invalid",
      sessionId: "session-review",
      attemptNumber: 1,
      intentClass: "multi_stage",
      primarySkill: "sample-primary",
      decisionStage: "delivery",
      decisionCode: invalid.failureClass,
      retryable: invalid.retryable,
      fallback: "none",
      deliveryOutcome: "blocked",
    });
    const successTrace = readExecutionTraces("trace-success");
    expect(successTrace.some((record) => record.deliveryOutcome === "allowed")).toBe(true);
    expect(JSON.stringify(successTrace)).not.toContain("run sample-task");
    expect(readExecutionTraces("trace-denied")[0]).toMatchObject({
      decisionCode: "authorization_denied",
      retryable: false,
      fallback: "none",
    } satisfies Partial<ExecutionTraceRecord>);
    expect(readExecutionTraces("trace-invalid")[0]?.deliveryOutcome).toBe("blocked");
  });

  it("parses the deck skill only as contract data", () => {
    const frontmatter = resolveSkillFrontmatter({
      filePath: fileURLToPath(new URL("../../../skills/cyber-ppt/SKILL.md", import.meta.url)),
    });
    expect(readSkillContract("cyber-ppt", frontmatter)?.requiredValidators).toEqual([]);
    expect(
      readSkillContract("cyber-ppt", frontmatter)?.forbiddenFinalEngines.length,
    ).toBeGreaterThan(0);
    const runtime = [
      "resolve.ts",
      "failure.ts",
      "delivery.ts",
      "validation.ts",
      "skill-contract.ts",
      "types.ts",
      "trace.ts",
    ]
      .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"))
      .join("\n");
    expect(runtime).not.toContain("cyber-ppt");
    expect(runtime).not.toContain("python-pptx");
    expect(runtime).not.toContain("make_deck.py");
  });

  it("keeps subagent, cron resume, and the ledger on the shared runner", () => {
    const cron = readFileSync(new URL("../../cron/isolated-agent/run.ts", import.meta.url), "utf8");
    const agent = readFileSync(new URL("../../commands/agent.ts", import.meta.url), "utf8");
    const gatewayAgent = readFileSync(
      new URL("../../gateway/server-methods/agent.ts", import.meta.url),
      "utf8",
    );
    const ledger = readFileSync(
      new URL("../../progress-ledger/cron-binding.ts", import.meta.url),
      "utf8",
    );
    const attempt = readFileSync(
      new URL("../pi-embedded-runner/run/attempt.ts", import.meta.url),
      "utf8",
    );
    const chat = readFileSync(
      new URL("../../gateway/server-methods/chat.ts", import.meta.url),
      "utf8",
    );
    expect(cron).toContain("runEmbeddedPiAgent");
    expect(agent).toContain("runCommandCandidate");
    const candidate = readFileSync(
      new URL("../../agent-runtime/execution/runner/command-candidate.ts", import.meta.url),
      "utf8",
    );
    expect(candidate).toContain("runEmbeddedPiAgent");
    expect(gatewayAgent).toContain("agentCommandFromIngress");
    expect(ledger).not.toContain("runEmbeddedPiAgent");
    expect(attempt).toContain("filterLaneTools");
    expect(attempt).toContain("resolveAttemptDelivery");
    const blockBind = attempt.indexOf("bindGatedReply(params.onBlockReply");
    const partialBind = attempt.indexOf("bindGatedReply(params.onPartialReply");
    const deliveryAt = attempt.indexOf("const deliveryEvidence = resolveAttemptDelivery");
    expect(blockBind).toBeGreaterThan(0);
    expect(partialBind).toBeGreaterThan(blockBind);
    expect(deliveryAt).toBeGreaterThan(partialBind);
    const preflightAt = attempt.indexOf("const tools = applyPreflightToTools");
    const clientAt = attempt.indexOf("const clientTools = filterLaneTools");
    const sessionAt = attempt.indexOf("await createAgentSession");
    expect(preflightAt).toBeGreaterThan(0);
    expect(clientAt).toBeGreaterThan(preflightAt);
    expect(sessionAt).toBeGreaterThan(clientAt);
    expect(attempt.indexOf("buildExecutionPreflight")).toBeLessThan(
      attempt.indexOf("waitForCompactionRetry"),
    );
    expect(attempt.split("buildExecutionPreflight(").length - 1).toBe(1);
    expect(attempt).toContain("passedToSession: customToolAllowlist");
    const embeddedRun = readFileSync(
      new URL("../../agent-runtime/execution/runner/embedded-run.ts", import.meta.url),
      "utf8",
    );
    expect(embeddedRun).toContain("assistantTexts: attempt.assistantTexts");
    expect(embeddedRun).toContain("MAX_RUN_LOOP_ITERATIONS");
    expect(attempt).not.toContain("toolMetasShowValidation");
    expect(chat).toContain('recordFocusSwitchDecision("focus_state_unavailable")');
    expect(chat).not.toContain('status: "focus_switch_blocked"');
    expect(chat).toContain('stopReason: "task-park"');
    expect(readConversationTaskFlags({})).toEqual({
      detection: false,
      qualification: false,
      activation: false,
      projection: false,
      authorization: false,
    });
    const ordinary = buildExecutionPreflight({
      taskId: "flags-off",
      sessionId: "session-review",
      message: "你好",
      skills: [],
      policyToolNames: ["read"],
      qualify: () => ({ kind: "chat", reasons: ["test"] }),
    });
    expect(ordinary.decisionCode).toBe("no_skill_contract");
    expect(ordinary.allowedTools).toEqual(["read"]);
  });

  it("hashes the written artifact inside the attempt delivery function", async () => {
    const workspace = mkdtempSync(path.join(os.tmpdir(), "delivery-chain-"));
    try {
      const preflight = build("artifact-task", [
        alias,
        {
          ...primary,
          frontmatter: { ...primary.frontmatter, "allowed-tools": "read,exec,process,write" },
        },
      ]);
      const relativePath = "out/output.bin";
      noteConfirmationPassed(preflight.taskId, preflight.attemptNumber, "stage-a");
      const absolutePath = path.join(workspace, relativePath);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      const tool = {
        name: "write",
        execute: async (_id: string, args: { content?: string }) => {
          writeFileSync(absolutePath, args.content ?? "");
          return { ok: true };
        },
      } as unknown as AnyAgentTool;
      const [guarded] = applyPreflightToTools([tool], preflight);
      await guarded?.execute?.("call-1", { path: relativePath, content: "version-1" }, undefined);
      const bytes = readFileSync(absolutePath);
      issueValidationReceipt({
        result: "passed",
        validatorId: "sample-validator",
        taskId: preflight.taskId,
        artifactPath: relativePath,
        artifactBytes: bytes,
      });
      const allowed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
      expect(allowed.decisionCode).toBe("delivery_allowed");
      expect(allowed.gateInput).toMatchObject({
        taskId: "artifact-task",
        artifactPath: relativePath,
        artifactSha256: hashArtifact(bytes),
        artifactType: "bin",
        validatorId: "sample-validator",
        validatorVersion: "1",
        validationResult: "passed",
      });
      expect(allowed.allowedToDeliver).toBe(true);

      writeFileSync(absolutePath, "version-2");
      const revised = build("artifact-task", [
        alias,
        {
          ...primary,
          frontmatter: { ...primary.frontmatter, "allowed-tools": "read,exec,process,write" },
        },
      ]);
      const revisedTool = {
        name: "write",
        execute: async () => ({ ok: true }),
      } as unknown as AnyAgentTool;
      const [revisedWrite] = applyPreflightToTools([revisedTool], revised);
      await revisedWrite?.execute?.(
        "call-2",
        { path: relativePath, content: "version-2" },
        undefined,
      );
      // Byte invalidation is independent of the confirmation required by this fixture.
      noteConfirmationPassed(revised.taskId, revised.attemptNumber, "stage-a");
      const blocked = resolveAttemptDelivery({ preflight: revised, workspaceDir: workspace });
      expect(blocked.decisionCode).toBe("artifact_changed");
      expect(blocked.allowedToDeliver).toBe(false);
      expect(revised.taskId).toBe(preflight.taskId);
      expect(revised.attemptNumber).toBe(preflight.attemptNumber + 1);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("blocks a missing validator before delivery and leaves ordinary chat alone", () => {
    resetValidationStateForTest();
    const unavailable = build("missing-validator");
    expect(unavailable.decisionCode).toBe("validator_unavailable");
    expect(unavailable.allowedTools).not.toContain("write");
    expect(readExecutionDecisionCount("validator_unavailable")).toBe(1);
    const held = resolveAttemptDelivery({ preflight: unavailable });
    expect(held.decisionCode).toBe("validator_unavailable");
    expect(held.allowedToDeliver).toBe(false);

    const ordinary = buildExecutionPreflight({
      taskId: "plain",
      sessionId: "session-review",
      message: "你好",
      skills: [],
      policyToolNames: ["read", "exec"],
      qualify: () => ({ kind: "chat", reasons: ["test"] }),
    });
    const plain = resolveAttemptDelivery({ preflight: ordinary });
    expect(plain.decisionCode).toBe("delivery_allowed");
    expect(plain.gateInput.validationResult).toBe("not_required");
  });

  it("keeps retry classes from becoming permission failures or a new primary skill", () => {
    const cases: Array<[string, string, boolean]> = [
      ["provider failover", "provider_failover", false],
      ["429 too many requests", "rate_limit", true],
      ["context overflow compaction", "compaction_retry", true],
      ["gateway timeout", "transient_transport", true],
      ["tool timeout", "transient_transport", true],
      [
        "No available auth profile for openai (all in cooldown or unavailable).",
        "permanent_failure",
        false,
      ],
    ];
    for (const [message, failureClass, retryable] of cases) {
      const classified = classifyExecutionFailure({ message });
      expect(classified.failureClass, message).toBe(failureClass);
      expect(classified.failureClass, message).not.toBe("authorization_denied");
      expect(classified.retryable, message).toBe(retryable);
      expect(classified.fallbackAllowed, message).toBe(failureClass === "provider_failover");
    }
    const first = build("same-task");
    classifyExecutionFailure({ message: "provider failover" });
    const second = build("same-task");
    expect(second.taskId).toBe(first.taskId);
    expect(second.primarySkill).toBe(first.primarySkill);
    expect(second.forbiddenFinalEngines).toEqual(first.forbiddenFinalEngines);
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
  });

  it("shows the tool sets that reach the session and treats mcporter as host exec", async () => {
    const preflight = build("lane-proof");
    const constructed = ["read", "exec", "write", "skill_identity", "process"].map(
      (name) => ({ name, execute: async () => ({ ok: true }) }) as unknown as AnyAgentTool,
    );
    const afterPreflight = applyPreflightToTools(constructed, preflight).map((tool) => tool.name);
    const client = filterLaneTools(
      [
        { type: "function" as const, function: { name: "mcp_search" } },
        { type: "function" as const, function: { name: "read" } },
      ],
      preflight,
      (tool) => tool.function.name,
    );
    const passedToSession = [
      ...afterPreflight,
      ...(client ?? []).map((tool) => tool.function.name),
    ];
    expect(afterPreflight).toEqual(["read", "exec", "process"]);
    expect(passedToSession).toEqual(["read", "exec", "process", "read"]);
    expect(passedToSession).not.toContain("mcp_search");
    expect(passedToSession).not.toContain("skill_identity");
    const exec = applyPreflightToTools(
      [{ name: "exec", execute: async () => ({ ok: true }) } as unknown as AnyAgentTool],
      preflight,
    )[0];
    await expect(
      exec?.execute?.("call", { command: "mcporter call demo.search" }, undefined),
    ).resolves.toEqual({ ok: true });
    await expect(
      exec?.execute?.("call", { command: "mcporter call demo.search legacy-engine" }, undefined),
    ).rejects.toThrow(/skill_contract_violation/);
  });
});
