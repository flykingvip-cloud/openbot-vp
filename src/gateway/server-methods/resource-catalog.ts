/**
 * 平台端 Resource Catalog handler（Package V2 Phase 1）。
 */

import { loadConfig } from "../../config/config.js";
import { resolveCycleWindow } from "../billing/runtime.js";
import { listAllUsageLedgerEntries } from "../billing/usage-ledger-store.js";
import {
  ensureDefaultCreditWeights,
  listCreditWeights,
  upsertCreditWeight,
} from "../resource-catalog/credit-weights-store.js";
import {
  listResourceModelCatalog,
  upsertResourceModelCatalogEntry,
} from "../resource-catalog/models-catalog-store.js";
import {
  compareTierProjectionWithModelIds,
  resolveModelsFromTiers,
} from "../resource-catalog/resolve.js";
import {
  bootstrapResourceCatalogFromConfig,
  buildSeedEntriesFromConfig,
} from "../resource-catalog/seed-from-config.js";
import {
  listTierFailoverRules,
  upsertTierFailoverRule,
} from "../resource-catalog/tier-failover-store.js";
import { buildTierUsageStats } from "../resource-catalog/tier-usage-stats.js";
import {
  ensureDefaultResourceTiers,
  listResourceTiers,
  upsertResourceTier,
} from "../resource-catalog/tiers-store.js";
import type { ResourceModelCatalogEntry } from "../resource-catalog/types.js";
import { numberValue, respondInvalid, respondUnavailable, stringValue } from "./billing-helpers.js";
import type { GatewayRequestHandlers } from "./types.js";

async function buildOverview() {
  await ensureDefaultResourceTiers();
  await ensureDefaultCreditWeights();
  const cfg = loadConfig();
  const { cycleStart, cycleEnd } = resolveCycleWindow();
  const [tiers, models, creditWeights, failoverRules, ledgerEntries] = await Promise.all([
    listResourceTiers(),
    listResourceModelCatalog(),
    listCreditWeights(),
    listTierFailoverRules(),
    listAllUsageLedgerEntries({ startTime: cycleStart, endTime: cycleEnd }),
  ]);
  const configModelIds = buildSeedEntriesFromConfig(cfg).map((e) => e.modelId);
  const catalogModelIds = new Set(models.map((m) => m.modelId));
  const missingFromCatalog = configModelIds.filter((id) => !catalogModelIds.has(id));
  const tierUsage = await buildTierUsageStats({
    cfg,
    tiers,
    models,
    ledgerEntries,
    window: { startTime: cycleStart, endTime: cycleEnd },
  });
  return {
    tiers,
    models,
    creditWeights,
    failoverRules,
    configModelCount: configModelIds.length,
    missingFromCatalog,
    tierUsageWindow: tierUsage.window,
    tierUsageStats: tierUsage.stats,
  };
}

export const resourceCatalogHandlers: GatewayRequestHandlers = {
  "platform-resource-catalog.overview": async ({ respond }) => {
    try {
      respond(true, await buildOverview());
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.tiers.list": async ({ respond }) => {
    try {
      await ensureDefaultResourceTiers();
      respond(true, { tiers: await listResourceTiers() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.tiers.upsert": async ({ params, respond }) => {
    try {
      const id = stringValue(params.id);
      const code = stringValue(params.code);
      const name = stringValue(params.name);
      if (!id || !code || !name) {
        respondInvalid(respond, "id / code / name 为必填项");
        return;
      }
      const sortOrder = numberValue(params.sortOrder);
      const status = stringValue(params.status);
      const tier = await upsertResourceTier({
        id,
        code,
        name,
        description: stringValue(params.description) ?? undefined,
        ...(sortOrder !== null ? { sortOrder: Math.floor(sortOrder) } : {}),
        ...(status === "active" || status === "archived" ? { status } : {}),
      });
      respond(true, { tier });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  "platform-resource-catalog.models.list": async ({ respond }) => {
    try {
      respond(true, { models: await listResourceModelCatalog() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.models.upsert": async ({ params, respond }) => {
    try {
      const modelId = stringValue(params.modelId);
      const tier = stringValue(params.tier);
      if (!modelId || !tier) {
        respondInvalid(respond, "modelId 与 tier 为必填项");
        return;
      }
      const inputCost = numberValue(params.inputCostPer1MCents);
      const outputCost = numberValue(params.outputCostPer1MCents);
      const contextWindow = numberValue(params.contextWindow);
      const avgTokensPerTask = numberValue(params.avgTokensPerTask);
      const enabledRaw = params.enabled;
      const capabilitiesRaw = Array.isArray(params.capabilities)
        ? params.capabilities
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0)
        : undefined;
      const model = await upsertResourceModelCatalogEntry({
        modelId,
        tier,
        provider: stringValue(params.provider) ?? undefined,
        displayName: stringValue(params.displayName) ?? undefined,
        ...(typeof enabledRaw === "boolean" ? { enabled: enabledRaw } : {}),
        ...(contextWindow !== null && contextWindow >= 0
          ? { contextWindow: Math.floor(contextWindow) }
          : {}),
        ...(avgTokensPerTask !== null && avgTokensPerTask > 0
          ? { avgTokensPerTask: Math.floor(avgTokensPerTask) }
          : {}),
        ...(capabilitiesRaw && capabilitiesRaw.length > 0
          ? { capabilities: capabilitiesRaw as ResourceModelCatalogEntry["capabilities"] }
          : {}),
        ...(inputCost !== null && inputCost >= 0
          ? { inputCostPer1MCents: Math.floor(inputCost) }
          : {}),
        ...(outputCost !== null && outputCost >= 0
          ? { outputCostPer1MCents: Math.floor(outputCost) }
          : {}),
      });
      respond(true, { model });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  "platform-resource-catalog.models.seed-from-config": async ({ respond }) => {
    try {
      const result = await bootstrapResourceCatalogFromConfig(loadConfig());
      respond(true, result);
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.credit-weights.list": async ({ respond }) => {
    try {
      await ensureDefaultCreditWeights();
      respond(true, { creditWeights: await listCreditWeights() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.credit-weights.upsert": async ({ params, respond }) => {
    try {
      const tier = stringValue(params.tier);
      const creditCost = numberValue(params.creditCost);
      if (!tier || creditCost === null || creditCost < 0) {
        respondInvalid(respond, "tier 与 creditCost（非负）为必填项");
        return;
      }
      const weight = await upsertCreditWeight({ tier, creditCost: Math.floor(creditCost) });
      respond(true, { creditWeight: weight });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  "platform-resource-catalog.failover-rules.list": async ({ respond }) => {
    try {
      respond(true, { failoverRules: await listTierFailoverRules() });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "platform-resource-catalog.failover-rules.upsert": async ({ params, respond }) => {
    try {
      const tier = stringValue(params.tier);
      if (!tier) {
        respondInvalid(respond, "tier 为必填项");
        return;
      }
      const enabledRaw = params.enabled;
      const failureRateRaw = params.failureRateThreshold;
      const modeRaw = stringValue(params.mode);
      const rule = await upsertTierFailoverRule({
        tier,
        ...(typeof enabledRaw === "boolean" ? { enabled: enabledRaw } : {}),
        ...(failureRateRaw === null
          ? { failureRateThreshold: null }
          : numberValue(failureRateRaw) !== null
            ? { failureRateThreshold: numberValue(failureRateRaw)! }
            : {}),
        ...(numberValue(params.minSampleSize) !== null
          ? { minSampleSize: Math.floor(numberValue(params.minSampleSize)!) }
          : {}),
        ...(numberValue(params.maxConsecutiveFailures) !== null
          ? { maxConsecutiveFailures: Math.floor(numberValue(params.maxConsecutiveFailures)!) }
          : {}),
        ...(numberValue(params.latencyThresholdMs) !== null
          ? { latencyThresholdMs: Math.floor(numberValue(params.latencyThresholdMs)!) }
          : {}),
        ...(numberValue(params.cooldownSeconds) !== null
          ? { cooldownSeconds: Math.floor(numberValue(params.cooldownSeconds)!) }
          : {}),
        ...(modeRaw === "disabled" || modeRaw === "next_in_pool" || modeRaw === "fallback_tier"
          ? { mode: modeRaw }
          : {}),
        ...(params.fallbackTierId === null
          ? { fallbackTierId: null }
          : stringValue(params.fallbackTierId)
            ? { fallbackTierId: stringValue(params.fallbackTierId)! }
            : {}),
        ...(params.fallbackModelId === null
          ? { fallbackModelId: null }
          : stringValue(params.fallbackModelId)
            ? { fallbackModelId: stringValue(params.fallbackModelId)! }
            : {}),
      });
      respond(true, { failoverRule: rule });
    } catch (err) {
      respondInvalid(respond, err instanceof Error ? err.message : String(err));
    }
  },

  "platform-resource-catalog.resolve-tiers": async ({ params, respond }) => {
    try {
      const tierIds = Array.isArray(params.tierIds)
        ? params.tierIds
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 0)
        : null;
      if (!tierIds) {
        respondInvalid(respond, "tierIds 必须是字符串数组");
        return;
      }
      const models = await listResourceModelCatalog();
      const pool = resolveModelsFromTiers({ allowedTierIds: tierIds, catalog: models });
      const allowedModelIds = Array.isArray(params.allowedModelIds)
        ? params.allowedModelIds
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter((v) => v.length > 0)
        : undefined;
      const comparison = allowedModelIds
        ? compareTierProjectionWithModelIds({
            allowedTierIds: tierIds,
            allowedModelIds,
            catalog: models,
          })
        : undefined;
      respond(true, { pool, comparison });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
