/**
 * Floor Runtime v2.1 §5.7 P1-C — shadow sink, flag default off, fail-closed.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { runFloorShadowReport } from "../../../scripts/collab-floor-shadow-report.ts";
import {
  clearRuntimeConfigSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import { FIELD_HELP } from "../../config/schema.help.js";
import { FIELD_LABELS } from "../../config/schema.labels.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateConfigObject } from "../../config/validation.js";
import { readCollaborationLedgerArchive } from "../collaboration-ledger/reader.js";
import { executeCollaborationRoundForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { beatIdForEpisode, buildCollaborationEventKey } from "./collaboration-event-key.js";
import {
  writeBeatDecisionRecords,
  type BeatDecisionWriteInput,
  type CollaborationEpisodeDecisionRecord,
  type CollaborationPolicyDecisionRecord,
} from "./episode-decision-record.js";
import {
  FLOOR_SHADOW_FILE_NAME,
  isCollabFloorShadowEnabled,
  recordFloorShadow,
  resolveFloorShadowFile,
  setFloorShadowAppendForTest,
  type FloorShadowSignals,
} from "./floor-shadow.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "./types.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixturePath = fileURLToPath(
  new URL("./__fixtures__/floor-shadow-report.jsonl", import.meta.url),
);

afterEach(async () => {
  setFloorShadowAppendForTest(null);
  clearRuntimeConfigSnapshot();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
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

function withFloor(
  protocol: "legacy" | "shadow" | "floor" | undefined,
  extra?: { decisionRecords?: boolean; runtimeNamespace?: boolean; root?: string },
): OpenBotConfig {
  clearRuntimeConfigSnapshot();
  let base: OpenBotConfig = {};
  try {
    base = loadConfig();
  } catch {
    base = {};
  }
  const floor = protocol ? { protocol } : undefined;
  const cfg = {
    ...base,
    ...(extra?.root
      ? {
          agents: { defaults: { workspace: path.join(extra.root, "agent-ws") } },
          gateway: { security: { profile: "personal_local" } },
        }
      : {}),
    collaboration: {
      ...base.collaboration,
      ...(extra?.root ? { defaults: { workspace: path.join(extra.root, "collaboration") } } : {}),
      ...(extra?.runtimeNamespace !== undefined
        ? { runtimeNamespace: extra.runtimeNamespace }
        : {}),
      ...(extra?.decisionRecords !== undefined
        ? { ledger: { decisionRecords: extra.decisionRecords } }
        : {}),
      floor,
    },
  } as OpenBotConfig;
  setRuntimeConfigSnapshot(cfg, cfg);
  return cfg;
}

async function tempRoot(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function signals(roundId = "round-1"): FloorShadowSignals {
  return {
    roundId,
    intentInput: { message: "预算怎么拆", mentionMode: "none" },
    posts: [{ agentId: "bot-a", text: "预算应分两期压缩并在下周复盘结论", atMs: 20 }],
    admittedAgentIds: ["bot-a"],
    calls: [{ agentId: "bot-a", outcome: "visible" }],
    humanMessageAtMs: 10,
  };
}

const botA = {
  agentId: "bot-a",
  name: "Bot A",
  sessionKey: "agent:bot-a:main:space:alpha",
  updatedAt: 1,
};

function policyWithoutWrap() {
  return {
    ...DEFAULT_COLLABORATION_POLICY,
    supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
    coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
  };
}

function createDecision(): ParticipationDecision {
  return {
    roundId: "round-shadow",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA],
    tier2: [],
    executionBots: [botA],
    roundPlan: {
      roundId: "round-shadow",
      sessionKey: "space:alpha",
      responseMode: "lead_plus_supplement",
      summaryText: "test",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "duty",
          contributionRole: "lead",
          reasonText: "lead",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
  };
}

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    bots: [botA],
  };
}

async function runRound(roundsDir: string) {
  return await executeCollaborationRoundForTest({
    decision: createDecision(),
    policy: policyWithoutWrap(),
    scope: createScope(),
    message: "分析一下",
    sessionKey: "space:alpha",
    roundsDir,
    isAborted: () => false,
    runBot: async () => ({ text: "这是一条完整结论，足够通过完成合同。" }),
  });
}

describe("collaboration.floor.protocol", () => {
  test("defaults off; only shadow enables the sink", () => {
    expect(isCollabFloorShadowEnabled({})).toBe(false);
    expect(isCollabFloorShadowEnabled({ collaboration: {} })).toBe(false);
    expect(isCollabFloorShadowEnabled({ collaboration: { floor: { protocol: "legacy" } } })).toBe(
      false,
    );
    expect(isCollabFloorShadowEnabled({ collaboration: { floor: { protocol: "floor" } } })).toBe(
      false,
    );
    expect(isCollabFloorShadowEnabled({ collaboration: { floor: { protocol: "shadow" } } })).toBe(
      true,
    );
    expect(FIELD_HELP["collaboration.floor.protocol"]).toMatch(/default unset = legacy/);
    expect(FIELD_LABELS["collaboration.floor.protocol"]).toBeTruthy();
    expect(validateConfigObject({ collaboration: { floor: { protocol: "legacy" } } }).ok).toBe(
      true,
    );
    expect(validateConfigObject({ collaboration: { floor: { protocol: "shadow" } } }).ok).toBe(
      true,
    );
    expect(validateConfigObject({ collaboration: { floor: { protocol: "floor" } } }).ok).toBe(true);
    expect(validateConfigObject({ collaboration: { floor: { protocol: "yes" } } }).ok).toBe(false);
  });

  test("shadow file is the rounds sibling and append is idempotent", async () => {
    const root = await tempRoot("openbot-floor-shadow-");
    const roundsDir = path.join(root, "runtime", "rounds");
    const cfg = withFloor("shadow");
    const filePath = resolveFloorShadowFile({ groupId: "g", roundsDir, cfg });
    expect(filePath).toBe(path.join(root, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "not-json\n", "utf8");
    const first = await recordFloorShadow({
      signals: signals(),
      groupId: "g",
      episodeId: "ep",
      beatId: "ep:b0",
      roundsDir,
      cfg,
      at: 30,
    });
    const second = await recordFloorShadow({
      signals: signals(),
      groupId: "g",
      episodeId: "ep",
      beatId: "ep:b0",
      roundsDir,
      cfg,
      at: 30,
    });
    expect(first).toMatchObject({ enabled: true, wrote: true, filePath });
    expect(second).toMatchObject({ enabled: true, wrote: false, filePath });
    const lines = (await fs.readFile(filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("not-json");
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
      kind: "floor_shadow",
      qualityClassifierVersion: "useful-v1",
      protocol: "shadow",
      recordId: "ep:ep:b0:round-1",
    });
    const off = await recordFloorShadow({
      signals: signals("other"),
      groupId: "g",
      episodeId: "ep",
      beatId: "ep:b0",
      roundsDir,
      cfg: withFloor("floor"),
      at: 40,
    });
    expect(off).toEqual({ enabled: false, wrote: false, filePath: null });
    expect((await fs.readFile(filePath, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  test("flag-off round does not call the sink or change the queue", async () => {
    const root = await tempRoot("openbot-floor-round-off-");
    const roundsDir = path.join(root, "runtime", "rounds");
    withFloor("legacy");
    let calls = 0;
    setFloorShadowAppendForTest(async () => {
      calls += 1;
      throw new Error("shadow must stay unwired");
    });
    const round = await runRound(roundsDir);
    expect(round.state).toBeTruthy();
    expect(round.primaryQueue).toEqual(["bot-a"]);
    expect("floorShadow" in round).toBe(false);
    expect(calls).toBe(0);
    await expect(
      fs.access(path.join(root, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME)),
    ).rejects.toThrow();
  });

  test("shadow records the beat and still leaves the round decision unchanged", async () => {
    const root = await tempRoot("openbot-floor-round-on-");
    const roundsDir = path.join(root, "runtime", "rounds");
    withFloor("shadow");
    const round = await runRound(roundsDir);
    expect(round.primaryQueue).toEqual(["bot-a"]);
    expect("floorShadow" in round).toBe(false);
    const filePath = path.join(root, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME);
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw.trim().split("\n")[0] ?? "{}") as {
      qualityClassifierVersion?: string;
      protocol?: string;
    };
    expect(parsed.qualityClassifierVersion).toBe("useful-v1");
    expect(parsed.protocol).toBe("shadow");
  });

  test("a throwing shadow append does not abort the round", async () => {
    const root = await tempRoot("openbot-floor-fault-");
    const roundsDir = path.join(root, "runtime", "rounds");
    withFloor("shadow");
    setFloorShadowAppendForTest(async () => {
      throw new Error("injected shadow failure");
    });
    const round = await runRound(roundsDir);
    expect(round.state).toBeTruthy();
    expect(round.primaryQueue).toEqual(["bot-a"]);
    await expect(
      fs.access(path.join(root, "runtime", "shadow", FLOOR_SHADOW_FILE_NAME)),
    ).rejects.toThrow();
  });
});

describe("shadowSignals on the decision writer", () => {
  function flagConfig(root: string, protocol: "legacy" | "shadow" | "floor"): OpenBotConfig {
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    delete process.env.OPENBOT_SECURITY_PROFILE;
    delete process.env.OPENCLAW_SECURITY_PROFILE;
    return withFloor(protocol, {
      root,
      decisionRecords: true,
      runtimeNamespace: true,
    });
  }

  function beatInput(cfg: OpenBotConfig, groupId: string): BeatDecisionWriteInput {
    const snap = createRoundPolicySnapshot({}, { now: 1, idGen: () => "pss_shadow" });
    const episodeId = "ep_shadow";
    const key = buildCollaborationEventKey({
      tenantId: null,
      groupId,
      episodeId,
      beatId: beatIdForEpisode(episodeId, 0),
      snapshot: snap,
    });
    return {
      key,
      at: 100,
      protocol: "legacy",
      intent: "discussion",
      provenanceHash: snap.provenanceHash,
      decideBranch: "open_discussion",
      legacy: { admitted: ["bot-a"], primaryQueue: ["bot-a"], dropped: [] },
      need: { agentIds: ["bot-a"], source: "mention" },
      facilitator: [],
      outcome: {
        roundId: "run-shadow",
        respondedAgentIds: ["bot-a"],
        usefulAgentIds: [],
        noReply: [],
        duplicates: [],
        timeouts: [],
        qualityClassifierVersion: "useful-v1",
      },
      roundId: "run-shadow",
      mode: snap.effective.strategy.id,
      policyConstraints: snap.effective.clamps,
      participants: [{ agentId: "bot-a", tier: "primary", reason: "lead" }],
      provenance: snap.effective.provenance,
      cfg,
      shadowSignals: {
        roundId: "run-shadow",
        intentInput: { responseMode: "single_owner", message: "做任务" },
        need: { taskOwnerAgentId: "bot-owner", handoffReceiverAgentIds: ["bot-recv"] },
        posts: [
          { agentId: "bot-owner", text: "已完成 task-42 的交付物说明并附回滚步骤", atMs: 50 },
        ],
        taskRefs: ["task-42"],
        calls: [{ agentId: "bot-owner", outcome: "visible" }],
      },
    };
  }

  test("shadow fills need and still keeps the policy decision branch", async () => {
    const root = await tempRoot("openbot-floor-edr-");
    const cfg = flagConfig(root, "shadow");
    const groupId = "grp-shadow";
    const input = beatInput(cfg, groupId);
    const result = await writeBeatDecisionRecords(input);
    expect(result.enabled).toBe(true);
    expect(result.wroteEpisodeDecision).toBe(true);
    const archive = await readCollaborationLedgerArchive({ groupId });
    const edr = archive.records.find(
      (record): record is CollaborationEpisodeDecisionRecord => record.kind === "episode_decision",
    );
    const pdr = archive.records.find(
      (record): record is CollaborationPolicyDecisionRecord => record.kind === "policy_decision",
    );
    expect(edr?.need).toEqual({ agentIds: ["bot-owner", "bot-recv"], source: "task" });
    expect(edr?.intent).toBe("task");
    expect(edr?.outcome?.qualityClassifierVersion).toBe("useful-v1");
    expect(edr?.outcome?.usefulAgentIds).toEqual(["bot-owner"]);
    expect(pdr?.decideBranch).toBe("open_discussion");
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    const shadowFile = path.join(facts.namespace!.shadowDir, FLOOR_SHADOW_FILE_NAME);
    const shadow = JSON.parse((await fs.readFile(shadowFile, "utf8")).trim()) as {
      qualityClassifierVersion?: string;
    };
    expect(shadow.qualityClassifierVersion).toBe("useful-v1");
  });

  test("legacy ignores shadowSignals and a sink throw still commits the ledger", async () => {
    const root = await tempRoot("openbot-floor-edr-off-");
    const cfg = flagConfig(root, "legacy");
    const groupId = "grp-shadow-off";
    const result = await writeBeatDecisionRecords(beatInput(cfg, groupId));
    expect(result.enabled).toBe(true);
    const archive = await readCollaborationLedgerArchive({ groupId });
    const edr = archive.records.find(
      (record): record is CollaborationEpisodeDecisionRecord => record.kind === "episode_decision",
    );
    expect(edr?.need).toEqual({ agentIds: ["bot-a"], source: "mention" });
    expect(edr?.intent).toBe("discussion");
    const facts = resolveCollaborationRuntimeFactPaths({ groupId, tenantId: null, cfg });
    await expect(
      fs.access(path.join(facts.namespace!.shadowDir, FLOOR_SHADOW_FILE_NAME)),
    ).rejects.toThrow();

    const rootOn = await tempRoot("openbot-floor-edr-throw-");
    const cfgOn = flagConfig(rootOn, "shadow");
    setFloorShadowAppendForTest(async () => {
      throw new Error("sink exploded");
    });
    const thrown = await writeBeatDecisionRecords(beatInput(cfgOn, "grp-shadow-throw"));
    expect(thrown.enabled).toBe(true);
    expect(thrown.wroteEpisodeDecision).toBe(true);
    const kept = await readCollaborationLedgerArchive({ groupId: "grp-shadow-throw" });
    expect(kept.records.some((record) => record.kind === "episode_decision")).toBe(true);
  });
});

describe("collab-floor-shadow-report", () => {
  test("dry-run groups the fixture by classifier version", async () => {
    const before = await fs.readFile(fixturePath);
    const report = await runFloorShadowReport({
      input: fixturePath,
      date: "2026-10-07",
      dryRun: true,
    });
    expect(report.dryRun).toBe(true);
    expect(report.date).toBe("2026-10-07");
    expect(report.skippedLines).toBe(2);
    expect(report.excludedByRoundId).toBe(0);
    expect(report.excludeRoundIdsPath).toBeNull();
    expect(report.groups).toEqual([
      {
        qualityClassifierVersion: "useful-v1",
        episodes: 2,
        coverageEpisodes: 1,
        eligibilityCoverage: 0.5,
        responseCoverage: 0.5,
        usefulCoverage: 0.5,
        waste: 2 / 3,
        ttfu: { p50: 1000, p95: 1000, samples: 1 },
        humanInterruptRate: 0.5,
      },
      {
        qualityClassifierVersion: "useful-v2",
        episodes: 1,
        coverageEpisodes: 1,
        eligibilityCoverage: 1,
        responseCoverage: 1,
        usefulCoverage: 0,
        waste: 0,
        ttfu: { p50: null, p95: null, samples: 0 },
        humanInterruptRate: 0,
      },
    ]);
    expect(await fs.readFile(fixturePath)).toEqual(before);

    const env = { ...process.env };
    delete env.VITEST;
    const bun = spawnSync(
      "bun",
      [
        "scripts/collab-floor-shadow-report.ts",
        "--input",
        fixturePath,
        "--dry-run",
        "--date",
        "2026-10-07",
      ],
      { cwd: repoRoot, encoding: "utf8", env },
    );
    expect(bun.status, bun.stderr).toBe(0);
    const printed = JSON.parse(bun.stdout) as {
      groups: unknown;
      skippedLines: number;
      excludedByRoundId: number;
    };
    expect(printed.skippedLines).toBe(2);
    expect(printed.excludedByRoundId).toBe(0);
    expect(printed.groups).toEqual(report.groups);
    expect(await fs.readFile(fixturePath)).toEqual(before);
  });

  test("exclude-round-ids drops matching roundId rows from coverage denominators", async () => {
    const excludeFile = fileURLToPath(
      new URL("./__fixtures__/floor-p3-probe-roundids-exclude-test.csv", import.meta.url),
    );
    await fs.writeFile(excludeFile, "roundId,source\nr1,test\nr4,test\n", "utf8");
    try {
      const report = await runFloorShadowReport({
        input: fixturePath,
        date: "2026-10-07",
        dryRun: true,
        excludeRoundIds: excludeFile,
      });
      // Fixture on 2026-10-07: r1 (v1), r2 (v1 empty need), r4 (v2). Excluding r1+r4 leaves r2 only.
      expect(report.excludedByRoundId).toBe(2);
      expect(report.excludeRoundIdsPath).toBe(excludeFile);
      expect(report.groups).toEqual([
        {
          qualityClassifierVersion: "useful-v1",
          episodes: 1,
          coverageEpisodes: 0,
          eligibilityCoverage: null,
          responseCoverage: null,
          usefulCoverage: null,
          waste: 1,
          ttfu: { p50: null, p95: null, samples: 0 },
          humanInterruptRate: 1,
        },
      ]);

      const env = { ...process.env };
      delete env.VITEST;
      const bun = spawnSync(
        "bun",
        [
          "scripts/collab-floor-shadow-report.ts",
          "--input",
          fixturePath,
          "--dry-run",
          "--date",
          "2026-10-07",
          "--exclude-round-ids",
          excludeFile,
        ],
        { cwd: repoRoot, encoding: "utf8", env },
      );
      expect(bun.status, bun.stderr).toBe(0);
      const printed = JSON.parse(bun.stdout) as {
        excludedByRoundId: number;
        groups: unknown;
      };
      expect(printed.excludedByRoundId).toBe(2);
      expect(printed.groups).toEqual(report.groups);
    } finally {
      await fs.rm(excludeFile, { force: true });
    }
  });

  test("exclude-round-ids default loads bundled Floor P3 probe list", async () => {
    const report = await runFloorShadowReport({
      input: fixturePath,
      date: "2026-10-07",
      dryRun: true,
      excludeRoundIds: "default",
    });
    // Bundled list does not contain fixture r1/r2/r4 — no exclusions.
    expect(report.excludedByRoundId).toBe(0);
    expect(report.excludeRoundIdsPath).toBe("default");
    expect(report.groups.length).toBe(2);
  });
});
