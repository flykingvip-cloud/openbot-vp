/**
 * Tier Failover / Circuit-breaker rule store.
 * Path: `CONFIG_DIR/openbot-resource-tier-failover.json`.
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { ResourceTierId, TierFailoverMode, TierFailoverRule } from "./types.js";

const STORE_VERSION = 1;

export const DEFAULT_TIER_FAILOVER_RULE: Omit<TierFailoverRule, "tier" | "updatedAt"> = {
  enabled: false,
  failureRateThreshold: 0.1,
  minSampleSize: 20,
  maxConsecutiveFailures: 3,
  latencyThresholdMs: 0,
  cooldownSeconds: 60,
  mode: "next_in_pool",
  fallbackTierId: null,
  fallbackModelId: null,
};

type Store = {
  version: number;
  rules: Record<ResourceTierId, TierFailoverRule>;
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, rules: {} };
}

export function resolveDefaultTierFailoverStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-resource-tier-failover.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTierFailoverStorePath());
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.rules !== "object" || parsed.rules === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, rules: parsed.rules };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(storePath?.trim() || resolveDefaultTierFailoverStorePath());
  await writeJsonAtomic(resolvedPath, store);
}

function normalizeMode(value: unknown): TierFailoverMode {
  if (value === "next_in_pool" || value === "fallback_tier" || value === "disabled") {
    return value;
  }
  return "disabled";
}

function normalizeNullableRate(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    return null;
  }
  return num;
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return Math.floor(num);
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildTierFailoverRule(
  tier: ResourceTierId,
  input: Partial<TierFailoverRule> = {},
  updatedAt?: string,
): TierFailoverRule {
  const now = updatedAt ?? new Date().toISOString();
  const enabled =
    typeof input.enabled === "boolean" ? input.enabled : DEFAULT_TIER_FAILOVER_RULE.enabled;
  const mode = enabled ? normalizeMode(input.mode) : "disabled";
  return {
    tier,
    enabled,
    failureRateThreshold:
      input.failureRateThreshold !== undefined
        ? normalizeNullableRate(input.failureRateThreshold)
        : DEFAULT_TIER_FAILOVER_RULE.failureRateThreshold,
    minSampleSize: normalizeNonNegativeInt(
      input.minSampleSize,
      DEFAULT_TIER_FAILOVER_RULE.minSampleSize,
    ),
    maxConsecutiveFailures: normalizeNonNegativeInt(
      input.maxConsecutiveFailures,
      DEFAULT_TIER_FAILOVER_RULE.maxConsecutiveFailures,
    ),
    latencyThresholdMs: normalizeNonNegativeInt(
      input.latencyThresholdMs,
      DEFAULT_TIER_FAILOVER_RULE.latencyThresholdMs,
    ),
    cooldownSeconds: normalizeNonNegativeInt(
      input.cooldownSeconds,
      DEFAULT_TIER_FAILOVER_RULE.cooldownSeconds,
    ),
    mode,
    fallbackTierId: normalizeOptionalId(input.fallbackTierId),
    fallbackModelId: normalizeOptionalId(input.fallbackModelId),
    updatedAt: now,
  };
}

export async function listTierFailoverRules(storePath?: string): Promise<TierFailoverRule[]> {
  const store = await loadStore(storePath);
  return Object.values(store.rules).toSorted((a, b) => a.tier.localeCompare(b.tier));
}

export async function getTierFailoverRule(
  tier: ResourceTierId,
  storePath?: string,
): Promise<TierFailoverRule | null> {
  const store = await loadStore(storePath);
  return store.rules[tier.trim()] ?? null;
}

export async function upsertTierFailoverRule(
  input: Partial<TierFailoverRule> & { tier: ResourceTierId },
  storePath?: string,
): Promise<TierFailoverRule> {
  const tier = input.tier.trim();
  if (!tier) {
    throw new Error("invalid tier");
  }
  if (
    input.mode === "fallback_tier" &&
    input.enabled !== false &&
    !normalizeOptionalId(input.fallbackTierId)
  ) {
    throw new Error("fallbackTierId is required when mode is fallback_tier");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const existing = store.rules[tier];
    const record = buildTierFailoverRule(tier, { ...existing, ...input });
    store.rules[tier] = record;
    await saveStore(store, storePath);
    return record;
  });
}
