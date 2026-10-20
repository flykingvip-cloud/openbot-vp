// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBot, __resetBotResourcesForTest } from "./bot-resources-store.js";
import { resolveBillingSeatForCommercialRun } from "./resolve-billing-seat-for-commercial-run.js";
import { assignSeat, __resetSeatsForTest } from "./seats-store.js";

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "openbot-billing-seat-"));
}

describe("resolveBillingSeatForCommercialRun", () => {
  let dir: string;
  let seatsPath: string;
  let botsPath: string;

  afterEach(async () => {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("prefers bot.ownerSeatId over ownerUserId seat lookup", async () => {
    dir = await tempDir();
    seatsPath = path.join(dir, "seats.json");
    botsPath = path.join(dir, "bots.json");
    await __resetSeatsForTest(seatsPath);
    await __resetBotResourcesForTest(botsPath);

    const seatA = await assignSeat(
      { enterpriseId: "ent-seat", userId: "user-a", role: "viewer", botQuota: 1 },
      seatsPath,
    );
    const seatB = await assignSeat(
      { enterpriseId: "ent-seat", userId: "user-b", role: "viewer", botQuota: 1 },
      seatsPath,
    );
    const bot = await createBot("ent-seat", "user-a", {
      ownerSeatId: seatB.id,
      storePath: botsPath,
    });

    const resolved = await resolveBillingSeatForCommercialRun({
      enterpriseId: "ent-seat",
      botId: bot.id,
      storePaths: { seats: seatsPath, botResources: botsPath },
    });
    expect(resolved?.id).toBe(seatB.id);
    expect(resolved?.id).not.toBe(seatA.id);
  });

  it("falls back to ownerUserId when ownerSeatId is absent", async () => {
    dir = await tempDir();
    seatsPath = path.join(dir, "seats.json");
    botsPath = path.join(dir, "bots.json");
    await __resetSeatsForTest(seatsPath);
    await __resetBotResourcesForTest(botsPath);

    const seat = await assignSeat(
      { enterpriseId: "ent-seat", userId: "user-a", role: "viewer", botQuota: 1 },
      seatsPath,
    );
    const bot = await createBot("ent-seat", "user-a", { storePath: botsPath });

    const resolved = await resolveBillingSeatForCommercialRun({
      enterpriseId: "ent-seat",
      botId: bot.id,
      storePaths: { seats: seatsPath, botResources: botsPath },
    });
    expect(resolved?.id).toBe(seat.id);
  });
});
