import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createInitialGrowthStatus } from "./factory.js";
import { applyRobotGrowthEvent, readRobotGrowthStatus, updateRobotGrowthStatus } from "./store.js";
it("keeps one aggregate and preserves receipts across legacy updates", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-events-"));
  const update = vi.fn(() => createInitialGrowthStatus({ kind: "robot", atMs: 1 }));
  const input = {
    cfg: {},
    agentId: "agent",
    opts: { agentDir: dir },
    eventId: "event",
    payload: { kind: "created" },
    update,
  };
  try {
    await applyRobotGrowthEvent(input);
    await applyRobotGrowthEvent(input);
    expect(update).toHaveBeenCalledTimes(1);
    await updateRobotGrowthStatus(
      {},
      "agent",
      (current) => ({ ...current!, preludeDismissedAtMs: 5 }),
      { agentDir: dir },
    );
    await applyRobotGrowthEvent(input);
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      (await readRobotGrowthStatus({}, "agent", { agentDir: dir }))?.preludeDismissedAtMs,
    ).toBe(5);
    await expect(
      applyRobotGrowthEvent({ ...input, payload: { kind: "different" } }),
    ).rejects.toThrow("conflict");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("does not overwrite corrupt aggregate state during event application", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-corrupt-"));
  try {
    const file = path.join(dir, "growth-status.json");
    await fs.writeFile(file, "{");
    const update = vi.fn(() => createInitialGrowthStatus({ kind: "robot", atMs: 1 }));
    await expect(
      applyRobotGrowthEvent({
        cfg: {},
        agentId: "agent",
        opts: { agentDir: dir },
        eventId: "event",
        payload: {},
        update,
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(await fs.readFile(file, "utf8")).toBe("{");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

it("legacy update refuses corrupt state before invoking the updater", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "growth-corrupt-legacy-"));
  try {
    const file = path.join(dir, "growth-status.json");
    await fs.writeFile(file, "{");
    const update = vi.fn(() => createInitialGrowthStatus({ kind: "robot", atMs: 1 }));
    await expect(updateRobotGrowthStatus({}, "agent", update, { agentDir: dir })).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(await fs.readFile(file, "utf8")).toBe("{");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
