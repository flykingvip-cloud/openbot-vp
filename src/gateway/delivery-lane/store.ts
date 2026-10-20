/**
 * store.ts — runtime persistence for DeliveryLane (Tip A).
 *
 * One JSON file per lane at `CONFIG_DIR/delivery-lane/lanes/<laneId>.json`.
 * Parallel to supervisor/tasks; does not write `.loom/`.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import { rememberDeliveryLaneMode } from "./active-mode.js";
import type { DeliveryLane } from "./types.js";

export function resolveDeliveryLaneDir(storeDir?: string): string {
  return resolveUserPath(storeDir?.trim() || path.join(CONFIG_DIR, "delivery-lane", "lanes"));
}

function laneFilePath(laneId: string, storeDir?: string): string {
  return path.join(resolveDeliveryLaneDir(storeDir), `${laneId}.json`);
}

const writeQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(laneId: string, fn: () => Promise<T>): Promise<T> {
  const prior = writeQueues.get(laneId) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  writeQueues.set(
    laneId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export async function createLane(lane: DeliveryLane, storeDir?: string): Promise<DeliveryLane> {
  const laneId = lane.laneId.trim();
  if (!laneId) {
    throw new Error("laneId is required");
  }
  return enqueue(laneId, async () => {
    const filePath = laneFilePath(laneId, storeDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const existing = await readJsonFile<DeliveryLane>(filePath);
    if (existing) {
      throw new Error(`delivery lane "${laneId}" already exists`);
    }
    await writeJsonAtomic(filePath, lane);
    rememberDeliveryLaneMode(lane);
    return lane;
  });
}

export async function getLane(laneId: string, storeDir?: string): Promise<DeliveryLane | null> {
  return readJsonFile<DeliveryLane>(laneFilePath(laneId.trim(), storeDir));
}

export async function updateLane(
  laneId: string,
  mutator: (lane: DeliveryLane) => DeliveryLane,
  storeDir?: string,
): Promise<DeliveryLane> {
  const id = laneId.trim();
  return enqueue(id, async () => {
    const filePath = laneFilePath(id, storeDir);
    const current = await readJsonFile<DeliveryLane>(filePath);
    if (!current) {
      throw new Error(`delivery lane "${id}" not found`);
    }
    const next = { ...mutator(current), updatedAt: new Date().toISOString() };
    await writeJsonAtomic(filePath, next);
    rememberDeliveryLaneMode(next);
    return next;
  });
}

export async function listLanes(storeDir?: string): Promise<DeliveryLane[]> {
  const dir = resolveDeliveryLaneDir(storeDir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const lanes: DeliveryLane[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const lane = await readJsonFile<DeliveryLane>(path.join(dir, name));
    if (lane) {
      lanes.push(lane);
    }
  }
  return lanes;
}
