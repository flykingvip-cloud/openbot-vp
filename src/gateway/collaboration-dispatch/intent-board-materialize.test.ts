/**
 * P1/S1 — intent → board draft / publish materialize tests (FINAL v3 §C).
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
import { oralDispatchCreatesBoardFact } from "./claim-contract.js";
import {
  assessBoardContractQuality,
  buildBoardPublishDraftFromIntent,
  detectBoardMaterializeCandidate,
  materializeIntentToBoardItem,
} from "./intent-board-materialize.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority } from "./runtime-authority.js";

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

function flagConfig(
  root: string,
  allowlist: string[],
  opts?: { challengeWindow?: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: false,
        claimContractGroupAllowlist: allowlist,
        challengeWindow: opts?.challengeWindow === true,
      },
    },
  } as OpenBotConfig;
}

async function useAllowlist(allowlist: string[], opts?: { challengeWindow?: boolean }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p1-intent-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, allowlist, opts);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId: string) {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_intent_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_intent",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

/** Complete contract fields that pass FINAL v3 §C quality. */
const QUALITY_FIELDS = {
  goal: "交付 AI×能源 overnight 调研报告（含来源）",
  acceptanceCriteria: ["报告含可核对来源链接", "覆盖发电侧与用电侧各不少于 3 条要点"] as string[],
  constraints: ["必须带来源/引用", "范围限于公开资料", "禁止外发未脱敏数据"] as string[],
  dueAtMs: Date.parse("2026-10-15T23:59:00+08:00"),
};

describe("P1/S1 intent board materialize (FINAL v3 §C)", () => {
  test("oralDispatchCreatesBoardFact stays false", () => {
    expect(oralDispatchCreatesBoardFact()).toBe(false);
  });

  test("detects deliverable+deadline and long goals; skips chitchat", () => {
    expect(
      detectBoardMaterializeCandidate("请今晚前交付一份 AI×能源 overnight 报告，必须带来源"),
    ).toBe(true);
    expect(detectBoardMaterializeCandidate("你好")).toBe(false);
    expect(detectBoardMaterializeCandidate("哈哈")).toBe(false);
  });

  test("draft without explicit Acceptance keeps empty contract + hints; fuzzy due pending", () => {
    const draft = buildBoardPublishDraftFromIntent({
      message: "请分析助手认领：今晚前交付 AI×能源 overnight 报告，必须带来源",
      groupId: "grp-daniel-hhd-gmail-com-upbeyond",
      taskId: "task-energy-1",
      publishedBy: "bot-secretary",
      suggestedClaimantIds: ["bot-analyst"],
      suggestedRole: "analyst",
      nowMs: Date.parse("2026-10-15T08:00:00+08:00"),
    });
    expect(draft).not.toBeNull();
    if (!draft) {
      return;
    }
    expect(draft.goal.length).toBeGreaterThan(10);
    // §C: do not fake complete Acceptance with generic defaults
    expect(draft.acceptanceCriteria).toEqual([]);
    expect(draft.suggestedAcceptanceHints?.length).toBeGreaterThan(0);
    expect(draft.dueAtMs).toBeUndefined();
    expect(draft.duePendingConfirm).toBe(true);
    expect(draft.dueSuggestedMs).toBeTypeOf("number");
    expect(draft.quality.ok).toBe(false);
    expect(draft.quality.issues).toContain("acceptance_missing");
    expect(draft.quality.issues).toContain("due_unreliable");
    expect(draft.intendedClaimantIds).toEqual(["bot-analyst"]);
    expect(draft.requiresHumanConfirm).toBe(true);
  });

  test("assessBoardContractQuality rejects generic Acceptance masquerade", () => {
    const q = assessBoardContractQuality({
      goal: "随便聊聊",
      message: "随便聊聊",
      acceptanceCriteria: ["产出满足目标：随便聊聊", "主答可按 Acceptance 判定完成（非草稿闲聊）"],
      constraints: ["不得用口头派工代替看板事实", "外发/终裁仍须人确认"],
      duePendingConfirm: true,
      goalFromRawChat: true,
    });
    expect(q.ok).toBe(false);
    expect(q.issues).toContain("goal_not_delivery");
    expect(q.issues).toContain("acceptance_non_verifiable");
    expect(q.issues).toContain("constraints_thin");
    expect(q.issues).toContain("due_unreliable");
  });

  test("incomplete draft → needs_confirm even if humanConfirmed; complete fields publish", async () => {
    const gray = "grp-daniel-hhd-gmail-com-upbeyond";
    const { cfg } = await useAllowlist([gray]);
    const auth = authority(cfg, gray);
    const base = {
      message: "请今晚前交付一份 overnight 报告，需要执行落地并带来源",
      groupId: gray,
      taskId: "task-energy-2",
      publishedBy: "bot-secretary",
      suggestedClaimantIds: ["bot-analyst"] as string[],
      suggestedRole: "analyst",
    };

    const pending = await materializeIntentToBoardItem({
      authority: auth,
      input: { ...base, requireHumanConfirm: true, humanConfirmed: false },
      cfg,
    });
    expect(pending.status).toBe("needs_confirm");
    if (pending.status === "needs_confirm") {
      expect(pending.qualityIssues.length).toBeGreaterThan(0);
      expect(pending.draft.acceptanceCriteria).toEqual([]);
    }

    // Confirmed but still missing Acceptance / exact Due → still needs_confirm (§C)
    const stillPending = await materializeIntentToBoardItem({
      authority: auth,
      input: { ...base, requireHumanConfirm: true, humanConfirmed: true },
      cfg,
    });
    expect(stillPending.status).toBe("needs_confirm");

    const published = await materializeIntentToBoardItem({
      authority: auth,
      input: {
        ...base,
        ...QUALITY_FIELDS,
        requireHumanConfirm: true,
        humanConfirmed: true,
      },
      cfg,
    });
    expect(published.status).toBe("published");
    if (published.status === "published") {
      expect(published.item.status).toBe("published");
      expect(published.item.goal).toBe(QUALITY_FIELDS.goal);
      expect(published.item.acceptanceCriteria).toEqual(QUALITY_FIELDS.acceptanceCriteria);
      expect(published.item.intendedClaimantIds).toContain("bot-analyst");
      expect(published.draft.quality.ok).toBe(true);
    }
  });

  test("non-allowlisted group stays flag_off after quality+confirm", async () => {
    const { cfg } = await useAllowlist(["grp-daniel-hhd-gmail-com-upbeyond"]);
    const auth = authority(cfg, "grp-other");
    const result = await materializeIntentToBoardItem({
      authority: auth,
      input: {
        message: "请今晚前交付 overnight 报告并执行落地",
        groupId: "grp-other",
        taskId: "task-x",
        publishedBy: "bot-secretary",
        humanConfirmed: true,
        ...QUALITY_FIELDS,
      },
      cfg,
    });
    expect(result.status).toBe("flag_off");
  });

  test("challengeWindow ON without window → needs_challenge; skip publishes", async () => {
    const gray = "grp-daniel-hhd-gmail-com-upbeyond";
    const { cfg } = await useAllowlist([gray], { challengeWindow: true });
    const auth = authority(cfg, gray);
    const base = {
      message: "请今晚前交付一份 overnight 报告，需要执行落地并带来源",
      groupId: gray,
      taskId: "task-challenge-intent",
      publishedBy: "bot-secretary",
      humanConfirmed: true,
      ...QUALITY_FIELDS,
    };
    const needs = await materializeIntentToBoardItem({
      authority: auth,
      input: { ...base },
      cfg,
    });
    expect(needs.status).toBe("needs_challenge");

    const published = await materializeIntentToBoardItem({
      authority: auth,
      input: { ...base, skipChallengeWindow: true },
      cfg,
    });
    expect(published.status).toBe("published");
  });
});
