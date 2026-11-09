import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSubagentToolPolicy } from "../agents/pi-tools.policy.js";
import { decideHonestEmptyReply } from "../auto-reply/reply/honest-empty-reply.js";
import { DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH } from "../config/agent-limits.js";
import type { OpenBotConfig } from "../config/config.js";
import { captureTaskCompletionBinding } from "../conversation-task/session-task-board.js";
import {
  applyIncomingUserMessage,
  emptySessionTaskBoard,
  readSessionTaskBoard,
  seedSessionTaskBoard,
} from "../conversation-task/session-task-board.js";
import { assessTaskOutputAlignment } from "../cron/task-focus.js";
import {
  createCollabEdgeTargetResolver,
  hasCollabEdgeDirective,
  MAX_COLLAB_EDGES_PER_ROUND,
  parseCollabEdgesFromText,
} from "../gateway/collaboration-dispatch/collab-edge.js";
import { applyComplexTaskLoop, shapeAdmittedComplexTaskReply } from "./complex-task-loop.js";
import { considerDispatchFromEnv } from "./dispatch.js";
import { readOrchestrationFlags } from "./feature.js";
import { classifyUtteranceIntent, resolveOrchestrationObserve } from "./observe-gate.js";
import { orchestrationToolNames } from "./spawn-table.js";
import { ORCHESTRATION_LIVE_INVOKE, PERSONAL_SUBAGENT_MAX_DEPTH } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const MEMBERS = [
  { agentId: "bot-self", name: "大白管家" },
  { agentId: "bot-market", name: "市场助手" },
  { agentId: "bot-skill", name: "Skill孵化" },
  { agentId: "bot-dense", name: "高密度分析" },
] as const;

function admitEnv(): NodeJS.ProcessEnv {
  return {
    OPENBOT_CONVERSATION_TASK_ORCH_DISPATCH: "1",
    OPENBOT_CONVERSATION_TASK_ORCH_TENANT_ALLOWLIST: "t-1",
  };
}

function joined(payloads: ReadonlyArray<{ text?: string }>): string {
  return payloads.map((payload) => payload.text ?? "").join("\n");
}

describe("P3 complex task loop", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps chat payloads unchanged when orchestration flags are off", () => {
    const payloads = [{ text: "原回复" }];
    const closed = applyComplexTaskLoop({
      userText: "@市场助手 请分步骤做竞品分析",
      tenantId: "t-1",
      surface: "group",
      members: MEMBERS,
      payloads,
      env: {},
    });
    expect(readOrchestrationFlags({})).toEqual({
      shadowEnabled: false,
      dispatchEnabled: false,
      nodeEnabled: false,
      browserEnabled: false,
    });
    expect(closed.admitted).toBe(false);
    expect(closed.payloads).toBe(payloads);
    expect(closed.wroteEvolutionProposal).toBe(false);
    expect(
      shapeAdmittedComplexTaskReply({
        payloads,
        userText: payloads[0]?.text ?? "",
        surface: "direct",
        env: {},
      }),
    ).toBe(payloads);
  });

  it("does not admit enqueue without both a tenant allowlist and an explicit kind", () => {
    const env = admitEnv();
    expect(classifyUtteranceIntent("").intent).toBe("recall_memory");
    expect(classifyUtteranceIntent(undefined).taskKind).toBeNull();
    expect(resolveOrchestrationObserve({ tenantId: "t-1", text: "你好" }, env).admitted).toBe(
      false,
    );
    expect(
      resolveOrchestrationObserve({ tenantId: "other", text: "@市场助手 请分步骤做竞品分析" }, env)
        .allowlistEmpty,
    ).toBe(true);

    const observed = resolveOrchestrationObserve(
      { tenantId: "t-1", text: "@市场助手 请分步骤做竞品分析" },
      env,
    );
    expect(observed.admitted).toBe(true);
    expect(observed.allowlistEmpty).toBe(false);
    expect(observed.taskKind).toBe("stepped");
    expect(observed.intent).not.toBe("recall_memory");

    const dispatched = considerDispatchFromEnv(
      {
        intent: observed.intent,
        flags: readOrchestrationFlags(env),
        allowlistEmpty: observed.allowlistEmpty,
        tenantId: "t-1",
        messageId: "m-p3",
      },
      env,
    );
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(dispatched.decision.enqueue).toBe(false);
    expect(dispatched.invokedTool).toBe(false);
    expect(dispatched.job).toBeNull();
    expect(dispatched.wroteLedger).toBe(false);
  });

  it("emits at most two depth-1 collab edges and one acceptance sentence", () => {
    const directSend = vi.fn();
    const result = applyComplexTaskLoop({
      userText: "@市场助手 @Skill孵化 @高密度分析 请分步骤做竞品分析",
      tenantId: "t-1",
      surface: "group",
      fromAgentId: "bot-self",
      members: MEMBERS,
      payloads: [{ text: "先看市场。" }],
      env: admitEnv(),
      directSend,
    });
    const text = joined(result.payloads);
    const parsed = parseCollabEdgesFromText({
      text,
      fromAgentId: "bot-self",
      resolveTargetAgentId: createCollabEdgeTargetResolver(MEMBERS),
    });
    expect(result.admitted).toBe(true);
    expect(parsed.edges.length).toBeLessThanOrEqual(MAX_COLLAB_EDGES_PER_ROUND);
    expect(parsed.edges).toHaveLength(2);
    expect(parsed.edges.every((edge) => edge.depth === 1)).toBe(true);
    expect(text).toContain("验收对照");
    expect(text).toContain("理解：");
    expect(text).toContain("计划：");
    expect(directSend).not.toHaveBeenCalled();
  });

  it("does not call direct send when the reply has no collab edge marker", () => {
    const directSend = vi.fn();
    const result = applyComplexTaskLoop({
      userText: "请分步骤整理本周纪要",
      tenantId: "t-1",
      surface: "group",
      fromAgentId: "bot-self",
      members: MEMBERS,
      payloads: [{ text: "我来整理。" }],
      env: admitEnv(),
      directSend,
    });
    const text = joined(result.payloads);
    expect(hasCollabEdgeDirective(text)).toBe(false);
    expect(text).toContain("验收对照");
    expect(directSend).not.toHaveBeenCalled();
  });

  it("says delegation is unavailable in a direct chat whose tool table lacks sessions_spawn", () => {
    const directSend = vi.fn();
    const result = applyComplexTaskLoop({
      userText: "请分步骤把调研交给另一个助手",
      tenantId: "t-1",
      surface: "direct",
      toolNames: ["read", "write"],
      payloads: [{ text: "好，我来写。" }],
      env: admitEnv(),
      directSend,
    });
    const text = joined(result.payloads);
    expect(text).toContain("做不到委派");
    expect(text).not.toMatch(/已分派|已委派|已经分派|已经委派/);
    expect(hasCollabEdgeDirective(text)).toBe(false);
    expect(directSend).not.toHaveBeenCalled();
  });

  it("does not pretend a child was dispatched when sessions_spawn is listed", () => {
    const result = applyComplexTaskLoop({
      userText: "请分步骤写竞品小节",
      tenantId: "t-1",
      surface: "direct",
      toolNames: ["read", "sessions_spawn"],
      payloads: [{ text: "开始写。" }],
      env: admitEnv(),
    });
    const text = joined(result.payloads);
    expect(text).toContain("尚未发起子代理");
    expect(text).not.toContain("做不到委派");
    expect(text).not.toMatch(/已分派|已委派|已经分派|已经委派/);
  });

  it("replaces a mismatched draft and leaves the session task unfinished", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-orch-"));
    tempDirs.push(dir);
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const started = applyIncomingUserMessage({
      board: emptySessionTaskBoard(),
      incomingText: "请分步骤做竞品分析",
      nowMs: 1,
    });
    seedSessionTaskBoard(sessionFile, started.board);

    const drift = "这是一份中医诊断学教材笔记，按章节整理望闻问切知识库课程论文摘要。".repeat(3);
    const missed = applyComplexTaskLoop({
      userText: "请分步骤做竞品分析",
      tenantId: "t-1",
      surface: "direct",
      toolNames: ["read"],
      payloads: [{ text: drift }],
      sessionFile,
      completionBinding: captureTaskCompletionBinding(sessionFile),
      currentGoal: started.board.current?.goalText,
      env: admitEnv(),
    });
    const text = joined(missed.payloads);
    expect(missed.failedStep).toBe("accept");
    expect(missed.deliverableChecked).toBe(false);
    expect(missed.wroteEvolutionProposal).toBe(false);
    expect(text).toContain("验收对照");
    expect(text).toContain("失败步骤：验收");
    expect(text).toContain("不交付成稿");
    expect(text).not.toContain("望闻问切");
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);

    const aside = applyIncomingUserMessage({
      board: readSessionTaskBoard(sessionFile),
      incomingText: "请用中文回复",
      nowMs: 2,
    });
    expect(aside.action).toBe("continue");
    expect(aside.cutContext).toBe(false);
    expect(aside.board.current?.unfinished).toBe(true);
  });

  it("records the existing completion only after the acceptance check passes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-orch-"));
    tempDirs.push(dir);
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(sessionFile, "");
    const started = applyIncomingUserMessage({
      board: emptySessionTaskBoard(),
      incomingText: "请分步骤做竞品分析",
      nowMs: 1,
    });
    seedSessionTaskBoard(sessionFile, started.board);
    const draft = `${"每一步都有可见结果。".repeat(12)}竞品分析已按步骤写完。`;
    expect(
      assessTaskOutputAlignment({
        anchorText: "每一步都有可见结果",
        outputText: draft,
        minOutputLength: 40,
      }).aligned,
    ).toBe(true);

    const checked = applyComplexTaskLoop({
      userText: "请分步骤做竞品分析",
      tenantId: "t-1",
      surface: "direct",
      toolNames: ["read"],
      payloads: [{ text: draft }],
      sessionFile,
      completionBinding: captureTaskCompletionBinding(sessionFile),
      env: admitEnv(),
    });
    expect(checked.deliverableChecked).toBe(false);
    expect(checked.failedStep).toBeUndefined();
    expect(readSessionTaskBoard(sessionFile).current?.unfinished).toBe(true);
    expect(readSessionTaskBoard(sessionFile).current?.deliverableChecked).not.toBe(true);
    expect(fs.readFileSync(sessionFile, "utf8")).not.toContain("交付已核对");
  });

  it("keeps collab depth and leaf spawn denial, and does not write evolution proposals", () => {
    expect(DEFAULT_SUBAGENT_MAX_SPAWN_DEPTH).toBe(1);
    expect(PERSONAL_SUBAGENT_MAX_DEPTH).toBe(1);
    expect(MAX_COLLAB_EDGES_PER_ROUND).toBe(2);
    expect(resolveSubagentToolPolicy(undefined, 1).deny).toContain("sessions_spawn");
    expect(
      orchestrationToolNames({
        cfg: {} as OpenBotConfig,
        sessionKey: "agent:bot:subagent:child",
      }),
    ).not.toContain("sessions_spawn");

    const source = fs.readFileSync(path.join(here, "complex-task-loop.ts"), "utf8");
    expect(source).not.toMatch(/sessions_send\s*\(/);
    expect(source).not.toMatch(/capability-gap/);
    expect(source).not.toMatch(/evolution-control/);

    expect(
      decideHonestEmptyReply({
        isHeartbeat: false,
        sessionCtx: {
          ChatType: "group",
          CollaborationGroupId: "space-1",
          CollaborationRoundInvoked: true,
          CollaborationBotAgentId: "bot-market",
        },
        rawPayloads: [{ text: "NO_REPLY" }],
        blockStreamDelivered: false,
        directlySentBlockCount: 0,
        toolResultDelivered: false,
      }),
    ).toEqual({ emit: false, reason: "collaboration" });
  });
});
