import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMessageCharEstimateCache,
  estimateContextChars,
} from "../pi-embedded-runner/tool-result-char-estimator.js";
import { seedActiveTaskFromMessages } from "./active-task-seed.js";
import { assertToolTransactionIntegrity, groupContextUnits } from "./atomic-units.js";
import { compileModelContext, COMPILED_CONTEXT_CAPSULE_MARKER } from "./compile.js";
import { extractHighConfidencePreferenceMutation } from "./preference-mutation.js";
import type { ContextCandidates } from "./types.js";

const { infoLog } = vi.hoisted(() => ({
  infoLog: vi.fn(),
}));

vi.mock("../../logging/subsystem.js", () => {
  const makeLogger = () => ({
    subsystem: "context-compiler",
    isEnabled: () => true,
    trace: vi.fn(),
    debug: vi.fn(),
    info: infoLog,
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    raw: vi.fn(),
    child: () => makeLogger(),
  });
  return { createSubsystemLogger: () => makeLogger() };
});

function user(text: string, id?: string): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
    ...(id ? { id } : {}),
  } as AgentMessage;
}

function assistant(text: string): AgentMessage {
  return { role: "assistant", content: text, timestamp: Date.now() } as unknown as AgentMessage;
}

function assistantToolCall(id: string, name: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: {} }],
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

function toolResult(id: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "lookup",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function messageRole(message: AgentMessage): string {
  const role = (message as { role?: unknown }).role;
  return typeof role === "string" ? role : "";
}

function blob(messages: AgentMessage[]): string {
  return messages.map((message) => messageText(message)).join("\n");
}

function hasTextBlock(messages: AgentMessage[], text: string): boolean {
  return messages.some((message) => {
    const content = (message as { content?: unknown }).content;
    return (
      Array.isArray(content) &&
      content.some((block) => {
        if (!block || typeof block !== "object") {
          return false;
        }
        const typed = block as { type?: unknown; text?: unknown };
        return typed.type === "text" && typed.text === text;
      })
    );
  });
}

function emptyCandidates(): {
  userProfile: [];
  task: string;
  memory: string;
  evidence: string;
} {
  return { userProfile: [], task: "", memory: "", evidence: "" };
}

function longHistory(count: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i += 1) {
    messages.push(user(`old user ${i}`, `old-${i}`));
    messages.push(assistant(`old assistant ${i}`));
  }
  return messages;
}

describe("groupContextUnits", () => {
  it("treats a missing transcript as no units", () => {
    expect(groupContextUnits(undefined as unknown as AgentMessage[])).toEqual([]);
  });

  it("keeps a tool execution as one atomic unit", () => {
    const messages = [
      user("查订单"),
      assistantToolCall("c1", "getOrder"),
      toolResult("c1", "order-1"),
      assistant("订单已查到"),
      user("谢谢"),
    ];
    const units = groupContextUnits(messages);
    expect(units).toHaveLength(2);
    expect(units[0]?.kind).toBe("tool_execution_turn");
    expect(units[0]?.messages).toHaveLength(4);
    expect(units[1]?.kind).toBe("current_execution_turn");
  });
});

describe("compileModelContext", () => {
  beforeEach(() => {
    infoLog.mockClear();
  });

  it("is history-to-context compilation, not truncation-only: keeps current + profile recall", () => {
    const history = longHistory(300);
    const current = user("以后叫我老大", "current");
    const source = [...history, current];
    const result = compileModelContext({
      messages: source,
      lane: "chat",
      candidates: {
        userProfile: [
          {
            key: "preferred_address",
            value: "老大",
            scope: "user",
            source: "conversation",
            sourceMessageId: "current",
            updatedAt: "2026-08-20T00:00:00.000Z",
            version: 1,
          },
        ],
        task: "",
        memory: "",
        evidence: "",
      },
    });

    expect(result.telemetry.preCompileMessageCount).toBe(source.length);
    expect(result.telemetry.postCompileMessageCount).toBeLessThan(source.length);
    expect(result.telemetry.postCompileEstimatedTokens).toBeLessThan(
      result.telemetry.preCompileEstimatedTokens,
    );
    expect(result.messages.some((message) => message === current)).toBe(true);
    expect(result.messages.some((message) => message === history[0])).toBe(true);
    const capsule = result.messages.find(
      (message) =>
        typeof (message as { content?: unknown }).content === "string" &&
        String((message as { content?: string }).content).includes(COMPILED_CONTEXT_CAPSULE_MARKER),
    );
    expect(String((capsule as { content?: string } | undefined)?.content ?? "")).toContain(
      "preferred_address=老大",
    );
    expect(result.telemetry.recallSafety.currentTurnPreserved).toBe(true);
    expect(result.telemetry.recallSafety.requiredMemoryPreserved).toBe(true);
    expect(result.telemetry.contextDropReasons.length).toBeGreaterThan(0);
    expect(source).toHaveLength(601);
  });

  it("never splits a tool execution unit", () => {
    const prefix = longHistory(40);
    const toolTurn = [
      user("查订单"),
      assistantToolCall("c1", "getOrder"),
      toolResult("c1", "order-1"),
      assistant("查到了"),
    ];
    const current = user("继续");
    const result = compileModelContext({
      messages: [...prefix, ...toolTurn, current],
      lane: "act",
      maxRecentTurns: 2,
    });
    const contents = result.messages.map((message) =>
      typeof (message as { content?: unknown }).content === "string"
        ? (message as { content: string }).content
        : JSON.stringify((message as { content?: unknown }).content),
    );
    expect(contents.some((text) => text.includes("查订单"))).toBe(true);
    expect(contents.some((text) => text.includes("c1"))).toBe(true);
    expect(result.telemetry.recallSafety.toolTransactionIntegrity).toBe(true);
    expect(result.telemetry.recallSafety.currentTurnPreserved).toBe(true);
  });

  it("uses a larger admission budget for act than chat", () => {
    const chat = compileModelContext({ messages: longHistory(5), lane: "chat" });
    const act = compileModelContext({ messages: longHistory(5), lane: "act" });
    expect(act.telemetry.admissionBudgetTokens).toBeGreaterThan(
      chat.telemetry.admissionBudgetTokens,
    );
    expect(act.telemetry.targetBudgetTokens).toBeGreaterThan(chat.telemetry.targetBudgetTokens);
  });

  it("scales the admission budget from the model context window and keeps the floor", () => {
    const floor = compileModelContext({
      messages: [user("hi")],
      lane: "act",
      contextWindowTokens: 8_000,
    });
    const scaled = compileModelContext({
      messages: [user("hi")],
      lane: "act",
      contextWindowTokens: 128_000,
    });
    const capped = compileModelContext({
      messages: [user("hi")],
      lane: "act",
      contextWindowTokens: 400_000,
    });
    expect(floor.telemetry.targetBudgetTokens).toBe(16_000);
    expect(floor.telemetry.admissionBudgetTokens).toBe(12_800);
    expect(scaled.telemetry.targetBudgetTokens).toBe(32_000);
    expect(scaled.telemetry.admissionBudgetTokens).toBe(25_600);
    expect(capped.telemetry.targetBudgetTokens).toBe(48_000);
    expect(capped.telemetry.admissionBudgetTokens).toBe(38_400);
  });

  it("keeps the JD shopping goal when a browser turn exceeds the lane budget", () => {
    const snapshotTail = "SNAPSHOT_TAIL_MARKER";
    const orphan = "ORPHAN_TOOL_RESULT_MARKER";
    const snapshot = `RESULT_HEAD sku=10213529116458${"S".repeat(50_000)}${snapshotTail}`;
    const shopping = user("帮我挑选一双价格最低的飞燃4，39码，粉色，并下单。");
    const finalReply = assistant("已将飞燃4 粉色 39码放入购物车，可以下单。");
    const pay = user("帮我进行支付");
    const result = compileModelContext({
      messages: [
        user("打开京东网站"),
        assistant("已打开京东"),
        user("继续"),
        assistant("继续浏览"),
        shopping,
        {
          role: "assistant",
          content: [
            { type: "text", text: "先看页面" },
            {
              type: "toolCall",
              id: "b1",
              name: "browser",
              arguments: { action: "snapshot", target: "sandbox", url: "https://www.jd.com" },
            },
            {
              type: "toolCall",
              id: "b2",
              name: "browser",
              arguments: { action: "click", target: "sandbox", ref: "e126" },
            },
          ],
          timestamp: 1,
        } as unknown as AgentMessage,
        toolResult("b1", snapshot),
        toolResult("b2", "clicked 加入购物车"),
        toolResult("missing", orphan),
        finalReply,
        pay,
      ],
      lane: "act",
      candidates: emptyCandidates(),
    });

    const text = blob(result.messages);
    expect(text).toContain("飞燃4");
    expect(text).toContain("39");
    expect(text).toContain("粉色");
    expect(text).toContain("下单");
    expect(text).toContain("active_task:");
    expect(text).toContain("帮我挑选一双价格最低的飞燃4，39码，粉色，并下单。");
    expect(result.messages.some((message) => message === shopping)).toBe(true);
    expect(hasTextBlock(result.messages, "已将飞燃4 粉色 39码放入购物车，可以下单。")).toBe(true);
    expect(result.messages.some((message) => message === pay)).toBe(true);
    expect(text).toContain("[tool-digest] browser");
    expect(text).toContain("action=snapshot");
    expect(text).toContain("action=click");
    expect(text).toContain("ref=e126");
    expect(text).toContain("result omitted: exceeds digest budget");
    expect(text).not.toContain("RESULT_HEAD");
    expect(text).toContain("clicked 加入购物车");
    expect(text).not.toContain(snapshotTail);
    expect(text).not.toContain(orphan);
    expect(text).not.toContain("先看页面");
    expect(text).not.toContain('"type":"toolCall"');
    expect(result.messages.some((message) => messageRole(message) === "toolResult")).toBe(false);
    expect(result.telemetry.unitCountAfter).toBeGreaterThan(1);
    expect(result.telemetry.recallSafety.currentTurnPreserved).toBe(true);
    expect(result.telemetry.recallSafety.toolTransactionIntegrity).toBe(true);
    expect(assertToolTransactionIntegrity(result.messages)).toBe(true);
    expect(infoLog).toHaveBeenCalledWith(
      expect.stringContaining("shrunk"),
      expect.objectContaining({
        reason: "budget",
        phase: "digest",
        userText: expect.stringContaining("飞燃4"),
      }),
    );
  });

  it("refuses compilation rather than dropping original user requirements to meet the budget", () => {
    const recent = user(`KEEP_RECENT_GOAL ${"Z".repeat(60_000)}`);
    expect(() =>
      compileModelContext({
        messages: [
          user("禁止发布，只有主人确认才允许"),
          assistant("收到"),
          recent,
          assistant("已记录"),
          user("继续"),
        ],
        lane: "act",
        candidates: emptyCandidates(),
      }),
    ).toThrow(/Required user history exceeds/);
  });

  it("does not throw reading length when history text or candidate lists are missing", () => {
    const hole = {
      role: "user",
      content: [{ type: "text" }],
      timestamp: 1,
    } as AgentMessage;
    const missingContent = { role: "assistant", timestamp: 2 } as AgentMessage;
    const toolHole = {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "lookup",
      content: [{ type: "text" }],
      timestamp: 3,
    } as AgentMessage;
    const current = user("你好");
    const result = compileModelContext({
      messages: [hole, missingContent, toolHole, current],
      lane: "chat",
      candidates: {
        userProfile: undefined,
        task: undefined,
        memory: undefined,
        evidence: undefined,
      } as unknown as ContextCandidates,
    });

    expect(result.telemetry.recallSafety.currentTurnPreserved).toBe(true);
    expect(result.messages.some((message) => message === current)).toBe(true);
    expect(blob(result.messages)).toContain("你好");
    expect(() =>
      estimateContextChars(result.messages, createMessageCharEstimateCache()),
    ).not.toThrow();
    for (const message of result.messages) {
      const content = (message as { content?: unknown }).content;
      expect(typeof content === "string" || Array.isArray(content)).toBe(true);
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const typed = block as { type?: unknown; text?: unknown; thinking?: unknown };
        if (typed.type === "text") {
          expect(typeof typed.text).toBe("string");
        }
        if (typed.type === "thinking") {
          expect(typeof typed.thinking).toBe("string");
        }
      }
    }
  });

  it("treats a missing transcript as an empty compile", () => {
    const result = compileModelContext({
      messages: undefined as unknown as AgentMessage[],
      lane: "chat",
    });
    expect(result.messages).toEqual([]);
    expect(result.telemetry.preCompileMessageCount).toBe(0);
    expect(result.telemetry.recallSafety.currentTurnPreserved).toBe(true);
  });

  it("does not replace an existing task context with a seeded goal", () => {
    const result = compileModelContext({
      messages: [
        user("帮我挑选一双价格最低的飞燃4，39码，粉色，并下单。"),
        assistant("好"),
        user("帮我进行支付"),
      ],
      lane: "act",
      candidates: {
        userProfile: [],
        task: "已绑定的采购任务 KEEP_BOUND_TASK",
        memory: "",
        evidence: "",
      },
    });
    const capsuleMessage = result.messages[0];
    if (!capsuleMessage) {
      throw new Error("expected operating context capsule");
    }
    const capsule = messageText(capsuleMessage);
    expect(capsule).toContain("KEEP_BOUND_TASK");
    expect(capsule).not.toContain("飞燃4");
  });
});

describe("seedActiveTaskFromMessages", () => {
  it("uses the last explicit goal and skips short follow-ups", () => {
    const seeded = seedActiveTaskFromMessages([
      user("继续"),
      user("打开京东网站"),
      user("帮我挑选一双价格最低的飞燃4，39码，粉色，并下单。"),
      user("帮我进行支付"),
    ]);
    expect(seeded).toContain("飞燃4");
    expect(seeded).toContain("39");
    expect(seeded).toContain("粉色");
    expect(seeded).toContain("下单");
    expect(seeded).not.toContain("帮我进行支付");
  });
});

describe("extractHighConfidencePreferenceMutation", () => {
  it("accepts the imperative LIVE sample and rejects questions", () => {
    expect(extractHighConfidencePreferenceMutation("以后叫我老大")).toEqual({
      key: "preferred_address",
      value: "老大",
    });
    expect(extractHighConfidencePreferenceMutation("你以后能不能叫我老大？")).toBeNull();
    expect(extractHighConfidencePreferenceMutation("以后叫我老板吗")).toBeNull();
    expect(extractHighConfidencePreferenceMutation("以后别叫我老大了，叫我老板")).toEqual({
      key: "preferred_address",
      value: "老板",
    });
  });
});

describe("compileModelContext collab strategy (expert #3)", () => {
  it("flag-off keeps global act window of 12 units", () => {
    const messages = longHistory(20);
    const result = compileModelContext({ messages, lane: "act", candidates: emptyCandidates() });
    expect(result.telemetry.unitCountAfter).toBeLessThanOrEqual(12);
  });

  it("flag-on raises group window modestly and retains member disagreement on compress", () => {
    const messages: AgentMessage[] = [];
    for (let i = 0; i < 16; i += 1) {
      messages.push(user(`round ${i} please review`));
      messages.push(assistant(`lead ${i}: 主答结论可以推进`));
      messages.push(assistant(`challenge ${i}: 但是我认为风险偏高，建议先做小范围试点再铺开。`));
      messages.push(assistant(`wrap ${i}: 收束采纳试点路径`));
    }
    const off = compileModelContext({
      messages,
      lane: "act",
      candidates: emptyCandidates(),
    });
    const on = compileModelContext({
      messages,
      lane: "act",
      candidates: emptyCandidates(),
      collabCompileStrategy: { enabled: true, retainMemberConclusions: true },
    });
    expect(off.telemetry.unitCountAfter).toBeLessThanOrEqual(12);
    expect(on.telemetry.unitCountAfter).toBeGreaterThan(off.telemetry.unitCountAfter);
    expect(on.telemetry.unitCountAfter).toBeLessThanOrEqual(18);
    // Force strip projection on a single multi-bot unit under tiny budget.
    const oneRound = [
      user("请评审方案"),
      assistant("主答：方案可行，按 A 推进。"),
      assistant("但是我认为风险偏高，建议先做小范围试点再铺开。"),
      assistant("收束：采纳试点路径。"),
    ];
    const compressed = compileModelContext({
      messages: [...longHistory(30), ...oneRound],
      lane: "chat",
      candidates: emptyCandidates(),
      collabCompileStrategy: {
        enabled: true,
        retainMemberConclusions: true,
        maxRecentTurns: 2,
      },
      contextWindowTokens: 1_000,
    });
    const blob = compressed.messages
      .map((m) => {
        const content = (m as { content?: unknown }).content;
        return typeof content === "string" ? content : JSON.stringify(content ?? "");
      })
      .join("\n");
    expect(blob).toContain("风险偏高");
    expect(blob).toContain("采纳试点路径");
  });
});

it("preserves the complete multiline goal including restrictions beyond 2000 chars", () => {
  const goal =
    "请分析以下数据，原文如下：\n" + "数据\n".repeat(800) + "禁止发布。金额是100元，不是100美元。";
  expect(seedActiveTaskFromMessages([{ role: "user", content: goal } as never])).toBe(goal);
});

it("keeps earlier user restrictions when the recent-turn window evicts their unit", () => {
  const restriction = { role: "user", content: "禁止发布。金额是100元，不是美元。" } as never;
  const current = { role: "user", content: "请继续整理数据并生成分析报告。" } as never;
  const result = compileModelContext({
    messages: [restriction, { role: "assistant", content: "收到" } as never, current],
    lane: "act",
    maxRecentTurns: 1,
  });
  expect(result.messages).toContain(restriction);
});
