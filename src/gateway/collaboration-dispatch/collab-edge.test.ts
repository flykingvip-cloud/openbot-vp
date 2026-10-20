import { describe, expect, test } from "vitest";
import {
  budgetCollabEdges,
  createCollabEdgeTargetResolver,
  hasCollabEdgeDirective,
  MAX_COLLAB_EDGES_PER_ROUND,
  parseCollabEdgesFromText,
  stripCollabEdgeDirectives,
  type CollabEdge,
} from "./collab-edge.js";

describe("collab-edge", () => {
  test("parses peer_ask / challenge / request_review / handoff directives", () => {
    const text = [
      "结论：方案可行。",
      "[[collab_edge:challenge|to=bot-b|reason=风险未覆盖]]",
      "[[collab_edge:handoff|to=bot-c|reason=owner_transfer|remaining=补验收标准|acceptance=通过评审]]",
      "[[collab_edge:peer_ask|to=bot-d|reason=补数据口径]]",
    ].join("\n");
    const parsed = parseCollabEdgesFromText({ text, fromAgentId: "bot-a", taskId: "task-1" });
    expect(parsed.edges).toHaveLength(MAX_COLLAB_EDGES_PER_ROUND);
    expect(parsed.edges.map((e) => e.kind)).toEqual(["challenge", "handoff"]);
    expect(parsed.edges[1]?.handoff?.remainingWork).toBe("补验收标准");
    expect(parsed.visibleText).toContain("结论：方案可行");
    expect(parsed.visibleText).not.toContain("collab_edge");
  });

  test("budget keeps at most 2 depth-1 edges", () => {
    const edges: CollabEdge[] = [
      { kind: "peer_ask", fromAgentId: "a", toAgentId: "b", reason: "q1", depth: 1 },
      { kind: "challenge", fromAgentId: "a", toAgentId: "c", reason: "c1", depth: 1 },
      { kind: "request_review", fromAgentId: "a", toAgentId: "d", reason: "r1", depth: 1 },
    ];
    expect(budgetCollabEdges(edges)).toHaveLength(2);
  });

  test("strip removes directives from visible text", () => {
    expect(
      stripCollabEdgeDirectives("可见正文 [[collab_edge:peer_ask|to=bot-b|reason=问口径]] 尾巴"),
    ).toBe("可见正文  尾巴");
  });

  test("resolver maps display names / @names / agentIds to group bots and drops outsiders", () => {
    const resolve = createCollabEdgeTargetResolver([
      { agentId: "bot-2", name: "市场助手" },
      { agentId: "bot--agent", name: "高密度分析" },
      { agentId: "panda", name: "熊猫学习" },
    ]);
    const parsed = parseCollabEdgesFromText({
      text: [
        "分工如下。",
        "[[collab_edge:handoff|to=市场助手|reason=市场规模]]",
        "[[collab_edge:peer_ask|to=大白管家|reason=不在群里]]",
        "[[collab_edge:peer_ask|to=@高密度分析|reason=能力矩阵]]",
      ].join("\n"),
      fromAgentId: "panda",
      resolveTargetAgentId: resolve,
    });
    expect(parsed.edges.map((edge) => [edge.kind, edge.toAgentId])).toEqual([
      ["handoff", "bot-2"],
      ["peer_ask", "bot--agent"],
    ]);
    expect(resolve("BOT-2")).toBe("bot-2");
    expect(resolve("熊猫学习")).toBe("panda");
  });

  test("resolved self-targets are dropped", () => {
    const parsed = parseCollabEdgesFromText({
      text: "[[collab_edge:peer_ask|to=熊猫学习|reason=自问]]",
      fromAgentId: "panda",
      resolveTargetAgentId: createCollabEdgeTargetResolver([
        { agentId: "panda", name: "熊猫学习" },
      ]),
    });
    expect(parsed.edges).toEqual([]);
  });

  test("detects directives without consuming global regex state", () => {
    const text = "正文 [[collab_edge:peer_ask|to=bot-b|reason=问]]";
    expect(hasCollabEdgeDirective(text)).toBe(true);
    expect(hasCollabEdgeDirective(text)).toBe(true);
    expect(hasCollabEdgeDirective("普通回复")).toBe(false);
    expect(hasCollabEdgeDirective(undefined)).toBe(false);
  });
});
