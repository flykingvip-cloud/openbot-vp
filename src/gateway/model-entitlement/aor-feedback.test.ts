// @vitest-environment node
// Feature: model-entitlement-chain, P3 任务 14（AOR 反馈回写 bandit 状态）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBanditPersistedState } from "@openbot/aor-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordAorRoutingExplanation, recordAorRunFeedback } from "./aor-feedback.js";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aor-feedback-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("recordAorRunFeedback", () => {
  it("把一次成功运行写入持久化 bandit 状态文件", () => {
    const statePath = path.join(tempDir, "bandit.json");
    recordAorRunFeedback({
      banditStatePath: statePath,
      provider: "api-proxy-deepseek",
      model: "deepseek-chat",
      taskTypeId: "summarization",
    });
    const state = readBanditPersistedState(statePath);
    expect(state).toBeDefined();
    const armKeys = Object.keys(state!.arms);
    expect(armKeys.some((k) => k.includes("api-proxy-deepseek/deepseek-chat"))).toBe(true);
    // 成功反馈累计一次 trial。
    const arm = state!.arms[armKeys[0]];
    expect(arm.trials).toBeGreaterThanOrEqual(1);
  });

  it("缺少必填字段时安全跳过（不创建文件）", () => {
    const statePath = path.join(tempDir, "noop.json");
    recordAorRunFeedback({
      banditStatePath: statePath,
      provider: "",
      model: "deepseek-chat",
      taskTypeId: "summarization",
    });
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it("多次回写在同一文件上累积", () => {
    const statePath = path.join(tempDir, "accum.json");
    recordAorRunFeedback({
      banditStatePath: statePath,
      provider: "p",
      model: "m",
      taskTypeId: "summarization",
    });
    recordAorRunFeedback({
      banditStatePath: statePath,
      provider: "p",
      model: "m",
      taskTypeId: "summarization",
    });
    const state = readBanditPersistedState(statePath);
    const arm = Object.values(state!.arms).find((a) => a.trials >= 2);
    expect(arm).toBeDefined();
  });
});

describe("recordAorRoutingExplanation (P3 收口：路由解释写入)", () => {
  // 投影 loadAuditExplanations 的读取字段：runId / taskType / strategy / selection{model,reason,score} / evaluationScore。
  type AuditLine = {
    runId?: string;
    taskType?: string;
    strategy?: string;
    selection?: { model?: string; reason?: string; score?: number };
    evaluationScore?: number;
    occurredAt?: string;
  };

  function readLines(p: string): AuditLine[] {
    return fs
      .readFileSync(p, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditLine);
  }

  it("写入一行投影可读的 JSONL 路由解释记录", () => {
    const auditLogPath = path.join(tempDir, "routing.jsonl");
    recordAorRoutingExplanation({
      auditLogPath,
      runId: "run-1",
      taskTypeId: "summarization",
      strategy: "cheapest",
      provider: "api-proxy-deepseek",
      model: "deepseek-chat",
      reason: "lowest estimated cost",
      score: 0.92,
      evaluationScore: 1,
    });
    const lines = readLines(auditLogPath);
    expect(lines).toHaveLength(1);
    const rec = lines[0];
    // 与 platform-models-aor-projection.loadAuditExplanations 读取字段对齐。
    expect(rec.runId).toBe("run-1");
    expect(rec.taskType).toBe("summarization");
    expect(rec.strategy).toBe("cheapest");
    expect(rec.selection?.model).toBe("api-proxy-deepseek/deepseek-chat");
    expect(rec.selection?.reason).toBe("lowest estimated cost");
    expect(rec.selection?.score).toBe(0.92);
    expect(rec.evaluationScore).toBe(1);
    expect(typeof rec.occurredAt).toBe("string");
  });

  it("缺必填字段安全跳过（不创建文件）", () => {
    const auditLogPath = path.join(tempDir, "noop-routing.jsonl");
    recordAorRoutingExplanation({
      auditLogPath,
      runId: "",
      taskTypeId: "summarization",
      strategy: "balanced",
      provider: "p",
      model: "m",
    });
    expect(fs.existsSync(auditLogPath)).toBe(false);
  });

  it("多次写入追加为多行（append-only）", () => {
    const auditLogPath = path.join(tempDir, "accum-routing.jsonl");
    for (const runId of ["r1", "r2", "r3"]) {
      recordAorRoutingExplanation({
        auditLogPath,
        runId,
        taskTypeId: "summarization",
        strategy: "balanced",
        provider: "p",
        model: "m",
      });
    }
    expect(readLines(auditLogPath)).toHaveLength(3);
  });
});

describe("routing explanation round-trips through platform projection (P3 收口)", () => {
  it("projection surfaces the written routing explanation", async () => {
    const { buildPlatformModelsAorProjection } =
      await import("../models/platform-models-aor-projection.js");
    const auditLogPath = path.join(tempDir, "proj-routing.jsonl");
    recordAorRoutingExplanation({
      auditLogPath,
      runId: "run-proj-1",
      taskTypeId: "summarization",
      strategy: "best_quality",
      provider: "api-proxy-gpt",
      model: "gpt-5.2",
      reason: "highest task-type quality",
      score: 0.81,
    });

    const projection = await buildPlatformModelsAorProjection({
      config: {
        mode: "aor_enhanced",
        aor: {
          gatewayUrl: "http://127.0.0.1:18789",
          toolsBaseUrl: "http://127.0.0.1:18789",
          auditLogPath,
          enableBandit: false,
          enableRoutingExplanations: true,
          enableOptimizationMetrics: false,
        },
      } as never,
      plans: [],
    });

    expect(projection?.routingExplanations).toHaveLength(1);
    const exp = projection!.routingExplanations[0];
    expect(exp.requestId).toBe("run-proj-1");
    expect(exp.selectedModelId).toBe("api-proxy-gpt/gpt-5.2");
    expect(exp.taskProfileId).toBe("summarization");
    expect(exp.matchedRules).toContain("best_quality");
  });
});
