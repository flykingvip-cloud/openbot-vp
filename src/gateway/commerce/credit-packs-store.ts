/**
 * 平台定义的容量包（CreditPack）store — 内部 credits 计量，对外展示「任务包/额外容量」。
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { CreditPack } from "./types.js";

const STORE_VERSION = 1;

type CreditPacksStore = {
  version: number;
  packs: Record<string, CreditPack>;
};

function createEmptyStore(): CreditPacksStore {
  return { version: STORE_VERSION, packs: {} };
}

export function resolveDefaultCreditPacksStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-credit-packs.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<CreditPacksStore> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditPacksStorePath());
  const parsed = await readJsonFile<Partial<CreditPacksStore>>(resolvedPath);
  if (!parsed) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, packs: parsed.packs ?? {} };
}

async function saveStore(store: CreditPacksStore, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultCreditPacksStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

export async function getCreditPack(
  packId: string,
  storePath?: string,
): Promise<CreditPack | null> {
  const store = await loadStore(storePath);
  return store.packs[packId] ?? null;
}

export async function listCreditPacks(
  filter: { status?: CreditPack["status"] } = {},
  storePath?: string,
): Promise<CreditPack[]> {
  const store = await loadStore(storePath);
  return Object.values(store.packs)
    .filter((pack) => (filter.status ? pack.status === filter.status : true))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function listActiveCreditPacks(storePath?: string): Promise<CreditPack[]> {
  return listCreditPacks({ status: "active" }, storePath);
}

export type UpsertCreditPackInput = {
  id?: string;
  name: string;
  credits: number;
  priceCents: number;
  status?: CreditPack["status"];
};

export async function upsertCreditPack(
  input: UpsertCreditPackInput,
  storePath?: string,
): Promise<CreditPack> {
  const name = input.name.trim();
  if (!name) {
    throw new Error("容量包名称不能为空");
  }
  const credits = Math.max(0, Math.floor(input.credits));
  const priceCents = Math.max(0, Math.round(input.priceCents));
  if (credits <= 0) {
    throw new Error("credits 必须大于 0");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const id = input.id?.trim() || `cpk-${randomUUID()}`;
    const pack: CreditPack = {
      id,
      name,
      credits,
      priceCents,
      status: input.status ?? store.packs[id]?.status ?? "active",
      updatedAt: now,
    };
    store.packs[id] = pack;
    await saveStore(store, storePath);
    return pack;
  });
}

export async function __resetCreditPacksForTest(storePath?: string): Promise<void> {
  await withLock(async () => {
    await saveStore(createEmptyStore(), storePath);
  });
}
