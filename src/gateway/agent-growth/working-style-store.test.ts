/**
 * Working DNA 自调闭环的端到端行为（真实文件）。
 *
 * 这一层曾在 2026-07-12 实现过但从未合入，导致 main 只留下调用点没有实现。恢复后必须
 * 有测试锁住闭环语义：行为改变 → 二阶评估 → 回归则自动回滚 → 抑制同一 delta 复发。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "./genome.js";
import {
  applyOperationalSignalsToWorkingStyle,
  assessAndMarkWorkingStyleEffect,
  readRobotWorkingStyle,
  readWorkingStyleChange,
  readWorkingStyleEffectStats,
  resolveWorkingStyleInstructions,
} from "./working-style-store.js";

const AGENT_ID = "dna-bot";
let tmpDir = "";
let cfg: OpenBotConfig;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-working-dna-"));
  cfg = { agents: { list: [{ id: AGENT_ID, agentDir: tmpDir }] } } as unknown as OpenBotConfig;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Working DNA：行为改变写入", () => {
  it("未学习过的 agent 不注入任何提示词（向后兼容）", async () => {
    expect(await resolveWorkingStyleInstructions(cfg, AGENT_ID)).toBeUndefined();
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
  });

  it("高接管率 → 变保守并要求先确认，且渲染进提示词", async () => {
    const applied = await applyOperationalSignalsToWorkingStyle(
      cfg,
      AGENT_ID,
      { humanTakeoverRate: 0.8, taskSuccessRate: 0.4, tasksTotal: 8 },
      60,
    );
    expect(applied?.riskPreference).toBe("conservative");
    expect(applied?.decisionPreference).toBe("confirm_first");

    const instructions = await resolveWorkingStyleInstructions(cfg, AGENT_ID);
    expect(instructions).toBeTruthy();
    expect(instructions).not.toBe("");

    const change = await readWorkingStyleChange(cfg, AGENT_ID);
    expect(change?.baselineOperationalScore).toBe(60);
    expect(change?.assessedAtMs).toBeNull();
    expect(change?.previousValues).toMatchObject({
      riskPreference: DEFAULT_WORKING_STYLE.riskPreference,
    });
  });

  it("信号不触发规则时不写盘（无变更不留痕）", async () => {
    const applied = await applyOperationalSignalsToWorkingStyle(
      cfg,
      AGENT_ID,
      { humanTakeoverRate: 0.3, taskSuccessRate: 0.7, tasksTotal: 8 },
      50,
    );
    expect(applied).toBeNull();
    expect(await readWorkingStyleChange(cfg, AGENT_ID)).toBeNull();
  });
  it("样本不足时不写入 Working DNA（单次偶然结果不固化）", async () => {
    const applied = await applyOperationalSignalsToWorkingStyle(
      cfg,
      AGENT_ID,
      { humanTakeoverRate: 0, taskSuccessRate: 1, tasksTotal: 1 },
      90,
    );
    expect(applied).toBeNull();
    expect(await readRobotWorkingStyle(cfg, AGENT_ID)).toBeNull();
  });
});

describe("Working DNA：二阶评估与自动回滚", () => {
  async function seedConservativeChange(baseline: number) {
    await applyOperationalSignalsToWorkingStyle(
      cfg,
      AGENT_ID,
      { humanTakeoverRate: 0.8, taskSuccessRate: 0.4, tasksTotal: 8 },
      baseline,
    );
  }

  it("表现变差 → 自动回滚到变更前的值并记录 rolledBack", async () => {
    await seedConservativeChange(70);
    const effect = await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 40);

    expect(effect?.status).toBe("regressed");
    expect(effect?.rolledBack).toBe(true);
    expect(effect?.newlyAssessed).toBe(true);

    const style = await readRobotWorkingStyle(cfg, AGENT_ID);
    expect(style?.riskPreference).toBe(DEFAULT_WORKING_STYLE.riskPreference);
    expect(style?.decisionPreference).toBe(DEFAULT_WORKING_STYLE.decisionPreference);
  });

  it("回滚后抑制同一 delta 复发（防振荡）", async () => {
    await seedConservativeChange(70);
    await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 40);

    // 同样的信号 → 同样的 delta → 被抑制，不再写入。
    const retry = await applyOperationalSignalsToWorkingStyle(
      cfg,
      AGENT_ID,
      { humanTakeoverRate: 0.8, taskSuccessRate: 0.4, tasksTotal: 8 },
      40,
    );
    expect(retry).toBeNull();
  });

  it("表现变好 → 保留变更，不回滚", async () => {
    await seedConservativeChange(50);
    const effect = await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 80);

    expect(effect?.status).toBe("improved");
    expect(effect?.rolledBack).toBe(false);
    const style = await readRobotWorkingStyle(cfg, AGENT_ID);
    expect(style?.riskPreference).toBe("conservative");
  });

  it("变化幅度过小 → inconclusive，保留记录待后续评估", async () => {
    await seedConservativeChange(60);
    const effect = await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 62);

    expect(effect?.status).toBe("inconclusive");
    expect(effect?.newlyAssessed).toBe(false);
    expect((await readWorkingStyleChange(cfg, AGENT_ID))?.assessedAtMs).toBeNull();
  });

  it("没有待评估变更时返回 null（幂等）", async () => {
    expect(await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 90)).toBeNull();
    await seedConservativeChange(50);
    await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 90);
    expect(await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 95)).toBeNull();
  });

  it("累计有效性统计供三阶自调使用", async () => {
    await seedConservativeChange(50);
    await assessAndMarkWorkingStyleEffect(cfg, AGENT_ID, 80);
    const stats = await readWorkingStyleEffectStats(cfg, AGENT_ID);
    expect(stats?.assessedCount).toBe(1);
    expect(stats?.improvedCount).toBe(1);
    expect(stats?.regressedCount).toBe(0);
  });
});
