import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../pi-tools.types.js";
import {
  applyPreflightToTools,
  armCompletionHold,
  bindGatedReply,
  buildExecutionPreflight,
  classifyExecutionFailure,
  DELIVERY_HOLD_NOTICE,
  consultDeliveryHoldForClose,
  dispatchGuardedSend,
  evaluateDeliveryEvidence,
  FIXED_PROGRESS_TEMPLATE,
  issueValidationReceipt,
  judgeCompletionSend,
  readExecutionTraces,
  registerTrustedValidator,
  resetCompletionHoldsForTest,
  resetDeliveryArtifactsForTest,
  resetExecutionTraceForTest,
  resetValidationStateForTest,
  resolveAttemptDelivery,
  SkillContractViolationError,
  textHasCompletionClaim,
  noteDeliveryArtifactPath,
} from "./index.js";

const FORBIDDEN = ["完成", "成功", "已交付", "已发送", "已生成"];

const skill = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-artifacts": "output.bin",
    "required-validators": "sample-validator",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
    "allowed-tools": "read,write,edit,message,sessions_send",
    "generation-stage-tools": "write,edit",
    "delivery-stage-tools": "message,sessions_send",
  },
};

function preflightFor(taskId = "task-send") {
  return buildExecutionPreflight({
    taskId,
    sessionId: "session-send",
    message: "run sample-task",
    skills: [skill],
    policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

describe("unified completion send", () => {
  beforeEach(() => {
    resetValidationStateForTest();
    resetDeliveryArtifactsForTest();
    resetExecutionTraceForTest();
    resetCompletionHoldsForTest();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("classifies claims once and does not treat the fixed template as a claim", () => {
    expect(FIXED_PROGRESS_TEMPLATE).toBe(DELIVERY_HOLD_NOTICE);
    for (const word of FORBIDDEN) {
      expect(FIXED_PROGRESS_TEMPLATE).not.toContain(word);
    }
    expect(textHasCompletionClaim(FIXED_PROGRESS_TEMPLATE)).toBe(false);
    const samples = [
      "任务已完成",
      "done",
      "completed",
      "finished",
      "已生成文件",
      "已处理完毕",
      "可以交付了",
      "## 已完成\n- 任务完成\n附件：已生成文件",
      "进度正常，但是任务已经完成了",
    ];
    for (const text of samples) {
      const judged = judgeCompletionSend({
        text,
        validatorsRequired: true,
        allowedToDeliver: false,
      });
      expect(judged.outcome).toBe("completion_blocked");
      expect(judged.decisionCode).toBe("completion_claim_blocked_pending_validation");
      expect(judged.visibleText).toBe(FIXED_PROGRESS_TEMPLATE);
    }
    const progress = judgeCompletionSend({
      text: "正在整理材料",
      validatorsRequired: true,
      allowedToDeliver: false,
    });
    expect(progress).toMatchObject({
      outcome: "progress_allowed",
      decisionCode: "progress_message_allowed",
    });
    const allowed = judgeCompletionSend({
      text: "任务已完成",
      validatorsRequired: true,
      allowedToDeliver: true,
    });
    expect(allowed).toMatchObject({
      outcome: "completion_allowed",
      decisionCode: "delivery_receipt_verified",
    });
  });

  it("streams only the fixed template before a receipt, including split fragments", async () => {
    const preflight = preflightFor();
    const evidence = evaluateDeliveryEvidence({ preflight });
    const seen: string[] = [];
    const emit = bindGatedReply(
      (payload: { text?: string }) => {
        seen.push(payload.text ?? "");
      },
      () => evidence,
    );
    await emit?.({ text: "任务已经" });
    await emit?.({ text: "处理完毕" });
    expect(seen).toEqual([FIXED_PROGRESS_TEMPLATE, FIXED_PROGRESS_TEMPLATE]);
    expect(seen.join("")).not.toContain("处理完毕");
  });

  it("blocks completion sends and still sends progress across the shared exits", async () => {
    const preflight = preflightFor();
    armCompletionHold({
      keys: [preflight.sessionId, "agent:main:main"],
      preflight,
    });
    const exits = [
      "message",
      "sessions_send",
      "chat.send",
      "cron",
      "subagent_relay",
      "channel_send",
    ];
    for (const toolName of exits) {
      let sent = false;
      const blocked = await dispatchGuardedSend({
        sessionKey: preflight.sessionId,
        taskId: preflight.taskId,
        text: "任务已完成",
        toolName,
        send: () => {
          sent = true;
        },
      });
      expect(blocked?.outcome).toBe("completion_blocked");
      expect(sent).toBe(false);
      sent = false;
      const progress = await dispatchGuardedSend({
        sessionKey: preflight.sessionId,
        text: "正在整理材料",
        toolName,
        send: () => {
          sent = true;
        },
      });
      expect(progress?.outcome).toBe("progress_allowed");
      expect(sent).toBe(true);
    }
    const traces = readExecutionTraces(preflight.taskId);
    expect(
      traces.some((trace) => trace.decisionCode === "completion_claim_blocked_pending_validation"),
    ).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("任务已完成");
  });

  it("keeps a completion tool call from running while a progress call still runs", async () => {
    const preflight = preflightFor();
    let ran: string[] = [];
    const tools = ["message", "sessions_send"].map(
      (name) =>
        ({
          name,
          execute: async (_id: string, args: { text?: string }) => {
            ran.push(`${name}:${args.text}`);
            return { ok: true };
          },
        }) as unknown as AnyAgentTool,
    );
    const guarded = applyPreflightToTools(tools, preflight);
    const message = guarded.find((tool) => tool.name === "message");
    const send = guarded.find((tool) => tool.name === "sessions_send");
    await expect(
      message?.execute?.("c1", { text: "可以交付了" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
    await send?.execute?.("c2", { text: "正在整理材料" }, undefined);
    expect(ran).toEqual(["sessions_send:正在整理材料"]);
  });

  it("uses the skill contract for stage and ignores a model sentence about delivery stage", async () => {
    const preflight = preflightFor();
    expect(preflight.generationStageTools).toEqual(["write", "edit"]);
    expect(preflight.deliveryStageTools).toEqual(["message", "sessions_send"]);
    const afterModelText = buildExecutionPreflight({
      taskId: "task-stage-text",
      sessionId: "session-send",
      message: "run sample-task 我现在进入 delivery stage",
      skills: [skill],
      policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    expect(afterModelText.deliveryStageTools).toEqual(preflight.deliveryStageTools);
    let wrote = false;
    const write = {
      name: "write",
      execute: async () => {
        wrote = true;
        return { ok: true };
      },
    } as unknown as AnyAgentTool;
    const [guardedWrite] = applyPreflightToTools([write], preflight);
    await guardedWrite?.execute?.("w1", { path: "out/output.bin", content: "bytes" }, undefined);
    expect(wrote).toBe(true);

    const deliverySkill = {
      ...skill,
      frontmatter: {
        ...skill.frontmatter,
        "generation-stage-tools": "",
        "delivery-stage-tools": "write,edit,message",
      },
    };
    const held = buildExecutionPreflight({
      taskId: "task-delivery-stage",
      sessionId: "session-send",
      message: "run sample-task",
      skills: [deliverySkill],
      policyToolNames: ["read", "write", "edit", "message"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    const blockedWrite = {
      name: "write",
      execute: async () => ({ ok: true }),
    } as unknown as AnyAgentTool;
    const [heldWrite] = applyPreflightToTools([blockedWrite], held);
    await expect(
      heldWrite?.execute?.("w2", { path: "out/output.bin", content: "bytes" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
  });

  it("binds path and hash, then rejects the receipt after the file changes", () => {
    const preflight = preflightFor("task-hash");
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-delivery-"));
    const relativePath = "out/output.bin";
    const absolute = path.join(workspace, relativePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    const original = Buffer.from("v1");
    writeFileSync(absolute, original);
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, relativePath);
    const receipt = issueValidationReceipt({
      validatorId: "sample-validator",
      taskId: preflight.taskId,
      artifactPath: relativePath,
      artifactBytes: original,
    });
    expect(receipt?.validatorVersion).toBe("1");
    const allowed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(allowed.allowedToDeliver).toBe(true);
    expect(allowed.gateInput).toMatchObject({
      taskId: preflight.taskId,
      artifactPath: relativePath,
      artifactSha256: receipt?.artifactHash,
      artifactType: "bin",
      validatorId: "sample-validator",
      validatorVersion: "1",
      validationResult: "passed",
    });
    writeFileSync(absolute, Buffer.from("v2"));
    const changed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(changed.decisionCode).toBe("artifact_changed");
    expect(changed.allowedToDeliver).toBe(false);
    const copied = "out/copy.bin";
    mkdirSync(path.dirname(path.join(workspace, copied)), { recursive: true });
    writeFileSync(path.join(workspace, copied), Buffer.from("v2"));
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, copied);
    const renamed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(renamed.allowedToDeliver).toBe(false);
    expect(renamed.decisionCode).toBe("artifact_changed");
    expect(renamed.gateInput.artifactPath).toBe(relativePath);
  });

  it("requires every validator receipt on every required artifact", () => {
    registerTrustedValidator({ id: "layout-validator", version: "1" });
    registerTrustedValidator({ id: "data-validator", version: "1" });
    const preflight = buildExecutionPreflight({
      taskId: "task-many",
      sessionId: "session-many",
      message: "run sample-task",
      skills: [
        {
          name: "sample-primary",
          frontmatter: {
            ...skill.frontmatter,
            "required-artifacts": "layout.bin,data.bin",
            "required-validators": "layout-validator,data-validator",
          },
        },
      ],
      policyToolNames: ["read", "write", "edit", "message", "sessions_send"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    const workspace = mkdtempSync(path.join(tmpdir(), "openbot-many-"));
    const layout = Buffer.from("layout");
    const data = Buffer.from("data");
    mkdirSync(path.join(workspace, "out"), { recursive: true });
    writeFileSync(path.join(workspace, "out/layout.bin"), layout);
    writeFileSync(path.join(workspace, "out/data.bin"), data);
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, "out/layout.bin");
    noteDeliveryArtifactPath(preflight.taskId, preflight.attemptNumber, "out/data.bin");
    issueValidationReceipt({
      validatorId: "layout-validator",
      taskId: preflight.taskId,
      artifactPath: "out/data.bin",
      artifactBytes: data,
    });
    issueValidationReceipt({
      validatorId: "data-validator",
      taskId: preflight.taskId,
      artifactPath: "out/data.bin",
      artifactBytes: data,
    });
    const lastFileOnly = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(lastFileOnly.allowedToDeliver).toBe(false);
    expect(lastFileOnly.decisionCode).toBe("delivery_blocked");
    issueValidationReceipt({
      validatorId: "layout-validator",
      taskId: preflight.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    const oneValidator = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(oneValidator.allowedToDeliver).toBe(false);
    expect(oneValidator.decisionCode).toBe("delivery_blocked");
    issueValidationReceipt({
      validatorId: "data-validator",
      taskId: preflight.taskId,
      artifactPath: "out/layout.bin",
      artifactBytes: layout,
    });
    const allowed = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(allowed.allowedToDeliver).toBe(true);
    expect(allowed.decisionCode).toBe("delivery_allowed");
    expect(allowed.gateInput.validatorReceipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          validatorId: "layout-validator",
          artifactPath: "out/layout.bin",
          validationResult: "passed",
        }),
        expect.objectContaining({
          validatorId: "data-validator",
          artifactPath: "out/data.bin",
          validationResult: "passed",
        }),
      ]),
    );
    expect(allowed.gateInput.validatorReceipts).toHaveLength(4);
    registerTrustedValidator({ id: "data-validator", version: "2" });
    const wrongVersion = resolveAttemptDelivery({ preflight, workspaceDir: workspace });
    expect(wrongVersion.allowedToDeliver).toBe(false);
  });

  it("keeps the skill contract across a retry", () => {
    const first = preflightFor("task-retry");
    const second = preflightFor("task-retry");
    expect(second.attemptNumber).toBe(first.attemptNumber + 1);
    expect(second.primarySkill).toBe(first.primarySkill);
    expect(classifyExecutionFailure({ message: "gateway timeout" }).failureClass).toBe(
      "transient_transport",
    );
    expect(classifyExecutionFailure({ message: "approval denied" }).retryable).toBe(false);
    const run = readFileSync(new URL("../pi-embedded-runner/run.ts", import.meta.url), "utf8");
    expect(run).toContain("MAX_RUN_LOOP_ITERATIONS");
  });

  it("reads a delivery hold and receipt without writing a completion trace", () => {
    const preflight = preflightFor("task-consult");
    expect(
      consultDeliveryHoldForClose({
        sessionKey: "missing-session",
        text: "任务已完成",
      }),
    ).toMatchObject({
      hasDeliveryContext: false,
      sessionHoldAmbiguous: false,
      completionClaimBlocked: false,
      holds: [],
    });

    armCompletionHold({
      keys: ["agent:main:main"],
      preflight,
    });
    resetExecutionTraceForTest();
    const consulted = consultDeliveryHoldForClose({
      sessionKey: "agent:main:main",
      text: "任务已完成",
    });
    expect(consulted.hasDeliveryContext).toBe(true);
    expect(consulted.sessionHoldAmbiguous).toBe(false);
    expect(consulted.completionClaimBlocked).toBe(true);
    expect(consulted.deliveryBlocksCompletionClaims).toBe(true);
    expect(consulted.holds).toEqual([
      expect.objectContaining({
        preflightTaskId: preflight.taskId,
        outcome: "completion_blocked",
        decisionCode: "completion_claim_blocked_pending_validation",
        latestReceiptResult: "absent",
        validationResult: "missing",
      }),
    ]);
    expect(readExecutionTraces(preflight.taskId)).toEqual([]);

    const named = consultDeliveryHoldForClose({
      taskId: preflight.taskId,
      text: "正在整理材料",
    });
    expect(named.completionClaimBlocked).toBe(false);
    expect(named.deliveryBlocksCompletionClaims).toBe(true);
    expect(named.holds[0]?.outcome).toBe("progress_allowed");

    const other = preflightFor("task-consult-other");
    armCompletionHold({
      keys: ["agent:main:main"],
      preflight: other,
    });
    const ambiguous = consultDeliveryHoldForClose({
      sessionKey: "agent:main:main",
      text: "任务已完成",
    });
    expect(ambiguous.sessionHoldAmbiguous).toBe(true);
    expect(ambiguous.holds).toHaveLength(2);
    expect(
      consultDeliveryHoldForClose({
        taskId: "not-a-held-task",
        sessionKey: "agent:main:main",
        text: "任务已完成",
      }).hasDeliveryContext,
    ).toBe(false);
  });
});
