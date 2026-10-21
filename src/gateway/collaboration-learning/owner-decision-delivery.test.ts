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
import {
  normalizeOwnerDecisionDelivery,
  ownerDecisionFenceProvesIssuance,
  readOwnerDecisionDeliveries,
  recordOwnerDecisionDelivery,
  stripConfirmationTokens,
  type OwnerDecisionCardDelivery,
} from "./owner-decision-delivery.js";

const tempDirs: string[] = [];

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.OPENBOT_STATE_DIR;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    collaboration: { defaults: { workspace: path.join(root, "collaboration") } },
  } as OpenBotConfig;
}

async function useConfig(): Promise<OpenBotConfig> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-od-delivery-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return cfg;
}

function sampleDelivery(patch: Partial<OwnerDecisionCardDelivery> = {}): OwnerDecisionCardDelivery {
  return {
    ok: true,
    stage: "card_persisted",
    historyReloadable: true,
    deliveryTracked: false,
    clientPresented: false,
    retryable: false,
    userFacing: "waiting_confirmation",
    groupId: "grp-delivery",
    taskId: "task-delivery",
    boardItemId: "board-delivery",
    todolistId: "td-delivery",
    version: 1,
    ...patch,
  };
}

describe("owner-decision delivery log", () => {
  test("a matching fence is not issuance authority", () => {
    expect(ownerDecisionFenceProvesIssuance()).toBe(false);
  });

  test("strips confirmation tokens and never claims the client saw the card", () => {
    const secret = "11111111-2222-3333-4444-555555555555";
    const normalized = normalizeOwnerDecisionDelivery(
      sampleDelivery({
        card: {
          kind: "todolist_confirm",
          decisionId: "dec-1",
          groupId: "grp-delivery",
          taskId: "task-delivery",
          boardItemId: "board-delivery",
          todolistId: "td-delivery",
          title: "请确认执行计划",
          summary: ["1. 起草；"],
          options: [],
          mentionMemberIds: ["owner"],
          confirmationToken: secret,
        } as OwnerDecisionCardDelivery["card"],
        clientPresented: true as unknown as false,
      }),
    );
    expect(normalized.clientPresented).toBe(false);
    expect(JSON.stringify(normalized)).not.toContain(secret);
    expect(JSON.stringify(normalized)).not.toContain("confirmationToken");
    expect(stripConfirmationTokens({ confirmationToken: secret, keep: "ok" })).toEqual({
      keep: "ok",
    });
  });

  test("refuses a durable row whose text still names a confirmation token", async () => {
    const cfg = await useConfig();
    await expect(
      recordOwnerDecisionDelivery({
        groupId: "grp-delivery",
        cfg,
        delivery: sampleDelivery({ message: "leaked confirmationToken=secret" }),
      }),
    ).rejects.toThrow(/confirmationToken/);
    expect(await readOwnerDecisionDeliveries({ groupId: "grp-delivery", cfg })).toEqual([]);
  });

  test("persists a reloadable row without a token", async () => {
    const cfg = await useConfig();
    const secret = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const saved = await recordOwnerDecisionDelivery({
      groupId: "grp-delivery",
      cfg,
      delivery: sampleDelivery({
        card: {
          kind: "todolist_confirm",
          decisionId: "dec-1",
          groupId: "grp-delivery",
          taskId: "task-delivery",
          boardItemId: "board-delivery",
          todolistId: "td-delivery",
          title: "请确认",
          summary: ["1. 起草；"],
          options: [],
          mentionMemberIds: ["owner"],
          confirmationToken: secret,
        } as OwnerDecisionCardDelivery["card"],
      }),
    });
    expect(saved.deliveryTracked).toBe(true);
    expect(saved.clientPresented).toBe(false);
    expect(saved.userFacing).toBe("waiting_confirmation");
    const rows = await readOwnerDecisionDeliveries({ groupId: "grp-delivery", cfg });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(JSON.stringify(rows)).not.toContain("confirmationToken");
  });
});
