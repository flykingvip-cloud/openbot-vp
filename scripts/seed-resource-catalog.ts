#!/usr/bin/env bun
/**
 * 从网关 models.providers 配置种子化 Resource Catalog（Tier + Model + CreditWeight）。
 *
 * Usage: bun scripts/seed-resource-catalog.ts [--dry-run]
 */

import { loadConfig } from "../src/config/config.js";
import {
  bootstrapResourceCatalogFromConfig,
  buildSeedEntriesFromConfig,
} from "../src/gateway/resource-catalog/seed-from-config.js";

const dryRun = process.argv.includes("--dry-run");

const cfg = loadConfig();
const entries = buildSeedEntriesFromConfig(cfg);

if (dryRun) {
  console.log(`[dry-run] would seed ${entries.length} model(s):`);
  for (const e of entries) {
    console.log(`  - ${e.modelId} → ${e.defaultTier ?? "tier_b"}`);
  }
  process.exit(0);
}

const result = await bootstrapResourceCatalogFromConfig(cfg);
console.log(
  `Resource catalog seeded: tiers=${result.tiers}, weights=${result.weights}, created=${result.seed.created}, skipped=${result.seed.skipped}`,
);
