import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../pi-tools.types.js";
import {
  applyPreflightToTools,
  bindGatedReply,
  buildExecutionPreflight,
  classifyExecutionFailure,
  DELIVERY_HOLD_NOTICE,
  evaluateDeliveryEvidence,
  gateAssistantTexts,
  hashArtifact,
  issueValidationReceipt,
  readSkillContract,
  registerTrustedValidator,
  resetValidationStateForTest,
  SkillContractViolationError,
  type PreflightSkillInput,
} from "./index.js";

const alias = {
  name: "sample-alias",
  frontmatter: {
    "alias-of": "sample-primary",
    triggers: "sample-task",
  },
};

const primary = {
  name: "sample-primary",
  frontmatter: {
    aliases: "sample-alias",
    "primary-engine": "sample-engine",
    "forbidden-final-engines": "legacy-engine",
    "required-confirmations": "stage-a,stage-b",
    "required-artifacts": "output.bin",
    "required-validators": "sample-validator",
    "delivery-conditions": "validator_passed",
    "delivery-blocked-until": "validator_passed",
    triggers: "sample-task",
  },
};

const policyTools = ["read", "write", "exec", "browser"];

function preflightFor(message: string, skills: PreflightSkillInput[] = [alias, primary]) {
  return buildExecutionPreflight({
    taskId: "task-1",
    sessionId: "session-1",
    message,
    skills,
    policyToolNames: policyTools,
    catalogToolNames: [...policyTools, "nodes"],
    qualify: () => ({ kind: "short_action", reasons: ["test"] }),
  });
}

describe("execution preflight", () => {
  beforeEach(() => {
    resetValidationStateForTest();
    registerTrustedValidator({ id: "sample-validator", version: "1" });
  });

  it("resolves an alias to one primary skill", () => {
    const result = preflightFor("run sample-task");
    expect(result.primarySkill).toBe("sample-primary");
    expect(result.skillAliases).toEqual(["sample-alias"]);
    expect(result.intentClass).toBe("multi_stage");
    expect(result.decisionCode).toBe("skill_alias_resolved");
    expect(result.candidateSkills.filter((name) => name === "sample-primary")).toHaveLength(1);
    expect(result.attemptNumber).toBeGreaterThan(0);
  });

  it("degrades pptx alias when cyber-ppt is missing instead of skill_alias_unresolved", () => {
    const pptxOnly = {
      name: "pptx",
      frontmatter: {
        "alias-of": "cyber-ppt",
        triggers: "pptx,ppt,演示文稿,幻灯片,路演",
      },
    };
    const result = preflightFor("请做一份路演 PPTX", [pptxOnly]);
    expect(result.decisionCode).not.toBe("skill_alias_unresolved");
    expect(result.primarySkill).toBe("pptx");
    expect(result.skillAliases).toContain("pptx");
  });

  it("allows a second preflight after alias degrade (retry not blocked as unresolved)", () => {
    const pptxOnly = {
      name: "pptx",
      frontmatter: {
        "alias-of": "cyber-ppt",
        triggers: "pptx,ppt,演示文稿",
      },
    };
    const first = preflightFor("帮我做演示文稿", [pptxOnly]);
    const second = preflightFor("帮我做演示文稿", [pptxOnly]);
    expect(first.decisionCode).not.toBe("skill_alias_unresolved");
    expect(second.decisionCode).not.toBe("skill_alias_unresolved");
    expect(second.primarySkill).toBe("pptx");
  });

  it("routes PDF→PPT / 做成 PPT utterances to cyber-ppt via expanded triggers", () => {
    const skills: PreflightSkillInput[] = [
      {
        name: "pptx",
        frontmatter: {
          "alias-of": "cyber-ppt",
          triggers:
            "pptx,ppt,演示文稿,幻灯片,路演,转成ppt,做成ppt,生成ppt,pdf转ppt,转ppt,做ppt,改成ppt",
        },
      },
      {
        name: "cyber-ppt",
        frontmatter: {
          "primary-engine": "PptxGenJS",
          "forbidden-final-engines": "legacy-engine,pptx_engine.py",
          triggers:
            "pptx,ppt,演示文稿,幻灯片,路演,转成ppt,做成ppt,生成ppt,pdf转ppt,转ppt,做ppt,改成ppt",
        },
      },
    ];
    for (const message of ["把这份 PDF 转成 PPT", "做成ppt", "pdf转ppt", "请生成ppt"]) {
      const result = preflightFor(message, skills);
      expect(result.primarySkill, message).toBe("cyber-ppt");
      expect(result.decisionCode, message).toBe("skill_alias_resolved");
      expect(result.bindingPrompt ?? "", message).toContain("PptxGenJS");
      expect(result.bindingPrompt ?? "", message).toContain("沙箱默认无 pip");
      expect(result.bindingPrompt ?? "", message).toContain("无法做 PPT");
    }
  });

  it("blocks pptx_engine.py / forbidden final engines on exec for cyber-ppt", async () => {
    const preflight = preflightFor("做成ppt", [
      {
        name: "cyber-ppt",
        frontmatter: {
          "primary-engine": "PptxGenJS",
          "forbidden-final-engines": "legacy-engine,pptx_engine.py",
          triggers: "做成ppt,ppt",
          "allowed-tools": "exec,read",
        },
      },
    ]);
    expect(preflight.primarySkill).toBe("cyber-ppt");
    const tool = {
      name: "exec",
      execute: async () => ({ ok: true }),
    } as unknown as AnyAgentTool;
    const [guarded] = applyPreflightToTools([tool], preflight);
    await expect(
      guarded?.execute?.(
        "call-1",
        { command: "python3 skills/pptx/scripts/pptx_engine.py" },
        undefined,
      ),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
  });

  it("notes write paths only after execute succeeds (commit-before-chip)", async () => {
    const { applyPreflightToTools, readNotedDeliveryArtifactPaths, resetDeliveryArtifactsForTest } =
      await import("./index.js");
    resetDeliveryArtifactsForTest();
    const preflight = buildExecutionPreflight({
      taskId: "task-commit-order",
      sessionId: "session-1",
      message: "write an html page",
      skills: [{ name: "notes", frontmatter: { triggers: "html", "allowed-tools": "read,write" } }],
      policyToolNames: ["read", "write"],
      catalogToolNames: ["read", "write"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    let executed = false;
    const tools = applyPreflightToTools(
      [
        {
          name: "write",
          execute: async () => {
            expect(
              readNotedDeliveryArtifactPaths(preflight.taskId, preflight.attemptNumber),
            ).toEqual([]);
            executed = true;
            return { content: [{ type: "text", text: "ok" }] };
          },
        } as unknown as AnyAgentTool,
      ],
      preflight,
      { workspaceDir: "/tmp/openbot-commit-before-note" },
    );
    await tools[0].execute("call-1", { path: "output/html/deck.html", content: "<html/>" });
    expect(executed).toBe(true);
    expect(readNotedDeliveryArtifactPaths(preflight.taskId, preflight.attemptNumber)).toEqual([
      "output/html/deck.html",
    ]);
  });

  it("does not note write paths when execute throws (stale-snapshot mid-write)", async () => {
    const { applyPreflightToTools, readNotedDeliveryArtifactPaths, resetDeliveryArtifactsForTest } =
      await import("./index.js");
    resetDeliveryArtifactsForTest();
    const preflight = buildExecutionPreflight({
      taskId: "task-stale-mid-write",
      sessionId: "session-1",
      message: "write an html page",
      skills: [{ name: "notes", frontmatter: { triggers: "html", "allowed-tools": "read,write" } }],
      policyToolNames: ["read", "write"],
      catalogToolNames: ["read", "write"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    const tools = applyPreflightToTools(
      [
        {
          name: "write",
          execute: async () => {
            throw new Error("stale snapshot");
          },
        } as unknown as AnyAgentTool,
      ],
      preflight,
      { workspaceDir: "/tmp/openbot-commit-before-note" },
    );
    await expect(
      tools[0].execute("call-1", { path: "output/html/miss.html", content: "<html/>" }),
    ).rejects.toThrow(/stale snapshot/);
    expect(readNotedDeliveryArtifactPaths(preflight.taskId, preflight.attemptNumber)).toEqual([]);
  });

  it("does not note a write that leaves a zero-byte file", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { applyPreflightToTools, readNotedDeliveryArtifactPaths, resetDeliveryArtifactsForTest } =
      await import("./index.js");
    const { EmptyWorkspaceWriteError } = await import("../../infra/non-empty-workspace-write.js");
    resetDeliveryArtifactsForTest();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-zero-note-"));
    const relativePath = "article-final.md";
    fs.writeFileSync(path.join(workspaceDir, relativePath), "");
    const preflight = buildExecutionPreflight({
      taskId: "task-zero-byte",
      sessionId: "session-1",
      message: "write an html page",
      skills: [{ name: "notes", frontmatter: { triggers: "html", "allowed-tools": "read,write" } }],
      policyToolNames: ["read", "write"],
      catalogToolNames: ["read", "write"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    const tools = applyPreflightToTools(
      [
        {
          name: "write",
          execute: async () => ({
            content: [{ type: "text", text: "Successfully wrote 0 bytes" }],
          }),
        } as unknown as AnyAgentTool,
      ],
      preflight,
      { workspaceDir },
    );
    await expect(
      tools[0].execute("call-1", { path: relativePath, content: "" }),
    ).rejects.toBeInstanceOf(EmptyWorkspaceWriteError);
    expect(readNotedDeliveryArtifactPaths(preflight.taskId, preflight.attemptNumber)).toEqual([]);
    expect(fs.existsSync(path.join(workspaceDir, relativePath))).toBe(false);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("notes a write after a non-empty file is on disk", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { applyPreflightToTools, readNotedDeliveryArtifactPaths, resetDeliveryArtifactsForTest } =
      await import("./index.js");
    resetDeliveryArtifactsForTest();
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-nonzero-note-"));
    const relativePath = "article-final.md";
    const preflight = buildExecutionPreflight({
      taskId: "task-nonzero-byte",
      sessionId: "session-1",
      message: "write an html page",
      skills: [{ name: "notes", frontmatter: { triggers: "html", "allowed-tools": "read,write" } }],
      policyToolNames: ["read", "write"],
      catalogToolNames: ["read", "write"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    const tools = applyPreflightToTools(
      [
        {
          name: "write",
          execute: async () => {
            fs.writeFileSync(path.join(workspaceDir, relativePath), "# 终稿\n");
            return { content: [{ type: "text", text: "ok" }] };
          },
        } as unknown as AnyAgentTool,
      ],
      preflight,
      { workspaceDir },
    );
    await tools[0].execute("call-1", { path: relativePath, content: "# 终稿\n" });
    expect(readNotedDeliveryArtifactPaths(preflight.taskId, preflight.attemptNumber)).toEqual([
      relativePath,
    ]);
    expect(fs.statSync(path.join(workspaceDir, relativePath)).size).toBeGreaterThan(0);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("does not let a lower skill replace an explicit primary", () => {
    const other = {
      name: "notes",
      frontmatter: {
        triggers: "notes-only",
        "primary-engine": "text",
      },
    };
    const result = preflightFor("use sample-primary", [alias, primary, other]);
    expect(result.primarySkill).toBe("sample-primary");
  });

  it("keeps unauthorized tools out of the candidate set and distinguishes visibility", () => {
    const result = preflightFor("今天天气怎么样", [
      { name: "weather", frontmatter: { triggers: "天气", "allowed-tools": "read" } },
    ]);
    expect(result.allowedTools).toEqual(["read"]);
    expect(result.toolVisibility.nodes).toBe("not_visible");
    expect(result.toolVisibility.exec).toBe("execution_denied");
    expect(result.allowedTools).not.toContain("nodes");
    expect(result.allowedTools).not.toContain("exec");
  });

  it("does not retry contract, validation, or permission failures", () => {
    expect(classifyExecutionFailure({ message: "Path escapes workspace root" })).toMatchObject({
      failureClass: "resource_out_of_scope",
      retryable: false,
      fallbackAllowed: false,
    });
    expect(classifyExecutionFailure({ message: "approval denied by user" })).toMatchObject({
      failureClass: "approval_denied",
      retryable: false,
      fallbackAllowed: false,
    });
    expect(
      classifyExecutionFailure({
        name: "SkillContractViolationError",
        message: "forbidden engine",
      }),
    ).toMatchObject({
      failureClass: "skill_contract_violation",
      retryable: false,
      fallbackAllowed: false,
    });
    expect(classifyExecutionFailure({ message: "validation_failed" })).toMatchObject({
      failureClass: "validation_failed",
      retryable: false,
      fallbackAllowed: false,
    });
    expect(classifyExecutionFailure({ message: "502 bad gateway" })).toMatchObject({
      failureClass: "transient_transport",
      retryable: true,
      fallbackAllowed: false,
    });
    expect(classifyExecutionFailure({ message: "auth_profile_rotation" })).toMatchObject({
      failureClass: "provider_failover",
      retryable: false,
      fallbackAllowed: true,
    });
  });

  it("blocks delivery when the skill contract has no trusted receipt", () => {
    const preflight = preflightFor("run sample-task");
    const evidence = evaluateDeliveryEvidence({
      preflight,
      artifactExists: true,
      artifactReadable: true,
      modelClaim: "qa_passed 已完成",
    });
    expect(evidence.validationPassed).toBe(false);
    expect(evidence.allowedToDeliver).toBe(false);
    expect(gateAssistantTexts(["任务完成，请查收。"], evidence)[0]).toBe(DELIVERY_HOLD_NOTICE);
  });

  it("does not upgrade a one-shot short action into a long-running task", () => {
    const result = preflightFor("你好", []);
    expect(result.intentClass).not.toBe("long_running");
    expect(result.qualificationKind).toBe("short_action");
  });

  it("keeps an explicit long-running qualification on the same preflight shape", () => {
    const result = buildExecutionPreflight({
      taskId: "task-2",
      sessionId: "session-2",
      message: "每天盯着这个指标，没达标就继续",
      skills: [],
      policyToolNames: ["read"],
      qualify: () => ({ kind: "long_running_candidate", reasons: ["test"] }),
    });
    expect(result.intentClass).toBe("long_running");
    expect(result.primarySkill).toBeUndefined();
  });

  it("rejects a forbidden final engine inside an otherwise allowed exec tool", async () => {
    const preflight = preflightFor("run sample-task");
    const tool = {
      name: "exec",
      execute: async () => ({ ok: true }),
    } as unknown as AnyAgentTool;
    const [guarded] = applyPreflightToTools([tool], preflight);
    await expect(
      guarded?.execute?.("call-1", { command: "run legacy-engine" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
  });

  it("holds a completion claim before the visible stream callback", async () => {
    const preflight = preflightFor("run sample-task");
    const evidence = evaluateDeliveryEvidence({ preflight });
    const seen: string[] = [];
    const emit = bindGatedReply(
      (payload: { text?: string }) => {
        seen.push(payload.text ?? "");
      },
      () => evidence,
    );
    await emit?.({ text: "任务已完成，文件在这里。" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(DELIVERY_HOLD_NOTICE);
    expect(seen[0]).not.toMatch(/已完成/);
  });

  it("blocks a completion send on a delivery-stage tool before execute", async () => {
    const preflight = buildExecutionPreflight({
      taskId: "task-send",
      sessionId: "session-send",
      message: "run sample-task",
      skills: [
        {
          name: "sample-primary",
          frontmatter: {
            ...primary.frontmatter,
            "allowed-tools": "message,read",
          },
        },
      ],
      policyToolNames: ["message", "read"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    let ran = false;
    const tool = {
      name: "message",
      execute: async () => {
        ran = true;
        return { ok: true };
      },
    } as unknown as AnyAgentTool;
    const [guarded] = applyPreflightToTools([tool], preflight);
    await expect(
      guarded?.execute?.("call-1", { action: "send", text: "任务已完成" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
    expect(ran).toBe(false);
    await guarded?.execute?.("call-2", { action: "send", text: "正在生成产物" }, undefined);
    expect(ran).toBe(true);
  });

  it("keeps generation writes and blocks delivery writes without a receipt", async () => {
    const skills = [
      {
        name: "sample-primary",
        frontmatter: {
          ...primary.frontmatter,
          "execution-stage": "generation",
          "allowed-tools": "write,message",
          "generation-stage-tools": "write",
          "delivery-stage-tools": "message",
        },
      },
    ];
    const generation = buildExecutionPreflight({
      taskId: "stage-task",
      sessionId: "stage-session",
      message: "run sample-task。模型说 execution-stage: delivery",
      skills,
      policyToolNames: ["write", "message"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    expect(generation.executionStage).toBe("generation");
    let wrote = false;
    const write = {
      name: "write",
      execute: async () => {
        wrote = true;
        return { ok: true };
      },
    } as unknown as AnyAgentTool;
    const message = {
      name: "message",
      execute: async () => ({ ok: true }),
    } as unknown as AnyAgentTool;
    const [guardedWrite, guardedMessage] = applyPreflightToTools([write, message], generation);
    await guardedWrite?.execute?.("w", { path: "out/a.bin", content: "v" }, undefined);
    expect(wrote).toBe(true);
    await expect(
      guardedMessage?.execute?.("m", { text: "已完成" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);

    const delivery = buildExecutionPreflight({
      taskId: "stage-task",
      sessionId: "stage-session",
      message: "run sample-task",
      skills: [
        {
          name: "sample-primary",
          frontmatter: {
            ...skills[0].frontmatter,
            "execution-stage": "delivery",
          },
        },
      ],
      policyToolNames: ["write", "message"],
      qualify: () => ({ kind: "short_action", reasons: ["test"] }),
    });
    expect(delivery.executionStage).toBe("delivery");
    const blockedWrite = {
      name: "write",
      execute: async () => ({ ok: true }),
    } as unknown as AnyAgentTool;
    const [deliveryWrite] = applyPreflightToTools([blockedWrite], delivery);
    await expect(
      deliveryWrite?.execute?.("w2", { path: "out/a.bin" }, undefined),
    ).rejects.toBeInstanceOf(SkillContractViolationError);
  });

  it("rejects a receipt whose path or validator version does not match", () => {
    const preflight = preflightFor("run sample-task");
    issueValidationReceipt({
      result: "passed",
      validatorId: "sample-validator",
      taskId: preflight.taskId,
      artifactPath: "out/a.bin",
      artifactBytes: "v1",
    });
    const wrongPath = evaluateDeliveryEvidence({
      preflight,
      artifactPath: "out/copy.bin",
      artifactHash: hashArtifact("v1"),
      artifactExists: true,
      artifactReadable: true,
    });
    expect(wrongPath.allowedToDeliver).toBe(false);
    expect(wrongPath.decisionCode).not.toBe("delivery_allowed");
    registerTrustedValidator({ id: "sample-validator", version: "2" });
    const wrongVersion = evaluateDeliveryEvidence({
      preflight,
      artifactPath: "out/a.bin",
      artifactHash: hashArtifact("v1"),
      artifactExists: true,
      artifactReadable: true,
    });
    expect(wrongVersion.allowedToDeliver).toBe(false);
  });

  it("reads a reusable contract rather than a product-specific switch", () => {
    const contract = readSkillContract("sample-primary", primary.frontmatter);
    expect(contract).toMatchObject({
      skillId: "sample-primary",
      primaryEngine: "sample-engine",
      forbiddenFinalEngines: ["legacy-engine"],
      requiredValidators: ["sample-validator"],
      deliveryConditions: ["validator_passed"],
      deliveryBlockedUntil: "validator_passed",
    });
  });

  it("keeps chat and cron on the same embedded agent entry", () => {
    const cron = readFileSync(new URL("../../cron/isolated-agent/run.ts", import.meta.url), "utf8");
    const reply = readFileSync(
      new URL("../../agent-runtime/execution/runner/admitted-candidate.ts", import.meta.url),
      "utf8",
    );
    expect(cron).toContain("runEmbeddedPiAgent");
    expect(reply).toContain("runEmbeddedPiAgent");
  });
});
