/**
 * C4 follow-up — chat.send OGUI projection wiring + propose enrichment (unit).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { proposeHandoff } from "./handoff-contract.js";
import { recordChatSendOguiProjectionBestEffort } from "./ogui-handoff-projection-chat-hook.js";
import { listOguiAnswerProjections, oguiProjectionsDir } from "./ogui-handoff-projection.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";

const SUBMISSION_ID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function answerFence(): string {
  const payload = {
    schema_version: "ogui/v1",
    component_id: "biz-model-form-1",
    submission_id: SUBMISSION_ID,
    answers: { channel: "hybrid", billing: "device" },
    submitted_at: "2026-10-13T01:00:00+08:00",
  };
  return [
    "请基于以下表单选择继续完成任务：",
    "",
    "```ogui-answer",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

function flagConfig(
  root: string,
  opts: { oguiHandoffProjection?: boolean; handoffContract?: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        ...(opts.oguiHandoffProjection !== undefined
          ? { oguiHandoffProjection: opts.oguiHandoffProjection }
          : {}),
        ...(opts.handoffContract !== undefined ? { handoffContract: opts.handoffContract } : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: { oguiHandoffProjection?: boolean; handoffContract?: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c4-ogui-hook-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, opts);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const authority = createRuntimeAuthority({
    snapshot: createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now: 1, idGen: () => "pss_c4_ogui_hook_test" },
    ),
    episodeId: "ep_c4_ogui_hook_test",
    tenant: { tenantId: null, trust: "none" },
    groupId: "grp_c4_ogui",
    profile: "personal_local",
    cfg,
  });
  return { root, cfg, authority };
}

describe("C4 OGUI chat.send projection hook + proposeHandoff wire", () => {
  test("flag-off: chat hook does not write projections", async () => {
    const { cfg, authority } = await useConfig({ oguiHandoffProjection: false });
    const result = await recordChatSendOguiProjectionBestEffort({
      authority,
      cfg,
      groupId: "grp_c4_ogui",
      message: answerFence(),
      fromAgentId: "human",
      relatedId: "run_1",
      taskId: "task_1",
    });
    expect(result.recorded).toBe(false);
    expect(result.record).toBeNull();
    const listed = await listOguiAnswerProjections(authority, { groupId: "grp_c4_ogui" });
    expect(listed).toEqual([]);
    await expect(fs.access(oguiProjectionsDir(authority))).rejects.toBeTruthy();
  });

  test("flag-on + legal ogui-answer: persists brief; illegal degrades", async () => {
    const { cfg, authority } = await useConfig({ oguiHandoffProjection: true });
    const bad = await recordChatSendOguiProjectionBestEffort({
      authority,
      cfg,
      groupId: "grp_c4_ogui",
      message: "```ogui-answer\n{not json}\n```",
      fromAgentId: "human",
    });
    expect(bad.recorded).toBe(false);

    const ok = await recordChatSendOguiProjectionBestEffort({
      authority,
      cfg,
      groupId: "grp_c4_ogui",
      message: answerFence(),
      fromAgentId: "human",
      relatedId: "run_2",
      taskId: "task_biz",
    });
    expect(ok.recorded).toBe(true);
    expect(ok.record?.submissionId).toBe(SUBMISSION_ID);
    expect(ok.record?.handoffBrief).toContain("channel: hybrid");

    const listed = await listOguiAnswerProjections(authority, {
      groupId: "grp_c4_ogui",
      taskId: "task_biz",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.handoffBrief).toContain("非控制指令");
  });

  test("proposeHandoff appends stored brief when flag ON; skips when OFF", async () => {
    const on = await useConfig({ oguiHandoffProjection: true, handoffContract: true });
    await recordChatSendOguiProjectionBestEffort({
      authority: on.authority,
      cfg: on.cfg,
      groupId: "grp_c4_ogui",
      message: answerFence(),
      fromAgentId: "human",
      taskId: "task_biz",
    });

    const proposed = await proposeHandoff(
      on.authority,
      {
        taskId: "task_biz",
        kind: "continue",
        from: { agentId: "bot_a", responsibilityRole: "executor" },
        to: { agentId: "bot_b", responsibilityRole: "executor" },
        remainingWork: "继续写商业方案",
        acceptanceCriteria: ["方案可读"],
        assumptions: ["base-assumption"],
        proposedBy: "bot_a",
      },
      { cfg: on.cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    expect(proposed.value.assumptions).toContain("base-assumption");
    expect(proposed.value.assumptions.some((a) => a.includes(SUBMISSION_ID))).toBe(true);
    expect(proposed.value.assumptions.some((a) => a.includes("channel: hybrid"))).toBe(true);

    const off = await useConfig({ oguiHandoffProjection: false, handoffContract: true });
    const proposedOff = await proposeHandoff(
      off.authority,
      {
        taskId: "task_biz",
        kind: "continue",
        from: { agentId: "bot_a", responsibilityRole: "executor" },
        to: { agentId: "bot_b", responsibilityRole: "executor" },
        remainingWork: "继续写商业方案",
        acceptanceCriteria: ["方案可读"],
        assumptions: ["base-assumption"],
        proposedBy: "bot_a",
        sourceChatText: answerFence(),
      },
      { cfg: off.cfg },
    );
    expect(proposedOff.ok).toBe(true);
    if (!proposedOff.ok) {
      return;
    }
    expect(proposedOff.value.assumptions).toEqual(["base-assumption"]);
  });
});
