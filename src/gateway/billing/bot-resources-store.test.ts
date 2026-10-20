// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetBotResourcesForTest,
  createBot,
  findActiveBotById,
  updateBotGovernance,
} from "./bot-resources-store.js";

async function tempStore(): Promise<{ path: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-bot-res-"));
  return { dir, path: path.join(dir, "bots.json") };
}

describe("bot-resources-store ownerSeatId", () => {
  let storePath: string;
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("persists ownerSeatId and visibility on create", async () => {
    ({ path: storePath, dir } = await tempStore());
    await __resetBotResourcesForTest(storePath);
    const bot = await createBot("ent-bot", "user-a", {
      ownerSeatId: "seat-alpha",
      visibility: "team",
      storePath,
    });
    expect(bot.ownerSeatId).toBe("seat-alpha");
    expect(bot.visibility).toBe("team");

    const loaded = await findActiveBotById("ent-bot", bot.id, storePath);
    expect(loaded?.ownerSeatId).toBe("seat-alpha");
  });

  it("transfers ownerSeatId via updateBotGovernance", async () => {
    ({ path: storePath, dir } = await tempStore());
    await __resetBotResourcesForTest(storePath);
    const bot = await createBot("ent-bot", "user-a", {
      ownerSeatId: "seat-alpha",
      storePath,
    });
    const updated = await updateBotGovernance(
      "ent-bot",
      bot.id,
      { ownerSeatId: "seat-beta", visibility: "enterprise" },
      storePath,
    );
    expect(updated?.ownerSeatId).toBe("seat-beta");
    expect(updated?.visibility).toBe("enterprise");

    const cleared = await updateBotGovernance("ent-bot", bot.id, { ownerSeatId: null }, storePath);
    expect(cleared?.ownerSeatId).toBeUndefined();
  });
});

describe("bot-resources-store sourceAgentId idempotency", () => {
  let storePath: string;
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses the same active bot for the same sourceAgentId", async () => {
    const { createBotWithStatus, findActiveBotBySourceAgentId, countActiveBots } =
      await import("./bot-resources-store.js");
    ({ path: storePath, dir } = await tempStore());
    await __resetBotResourcesForTest(storePath);

    const first = await createBotWithStatus("ent-bot", "user-a", {
      sourceAgentId: "agent-marketing",
      ownerSeatId: "seat-a",
      storePath,
    });
    expect(first.created).toBe(true);
    expect(first.bot.sourceAgentId).toBe("agent-marketing");

    const second = await createBotWithStatus("ent-bot", "user-a", {
      sourceAgentId: "agent-marketing",
      storePath,
    });
    expect(second.created).toBe(false);
    expect(second.bot.id).toBe(first.bot.id);
    expect(await countActiveBots("ent-bot", storePath)).toBe(1);

    const found = await findActiveBotBySourceAgentId("ent-bot", "agent-marketing", storePath);
    expect(found?.id).toBe(first.bot.id);
  });

  it("allows a new bot after soft-delete of the same sourceAgentId", async () => {
    const { createBotWithStatus, deleteBot, countActiveBots } =
      await import("./bot-resources-store.js");
    ({ path: storePath, dir } = await tempStore());
    await __resetBotResourcesForTest(storePath);

    const first = await createBotWithStatus("ent-bot", "user-a", {
      sourceAgentId: "agent-ops",
      storePath,
    });
    await deleteBot("ent-bot", first.bot.id, storePath);
    expect(await countActiveBots("ent-bot", storePath)).toBe(0);

    const second = await createBotWithStatus("ent-bot", "user-a", {
      sourceAgentId: "agent-ops",
      storePath,
    });
    expect(second.created).toBe(true);
    expect(second.bot.id).not.toBe(first.bot.id);
    expect(await countActiveBots("ent-bot", storePath)).toBe(1);
  });
});
