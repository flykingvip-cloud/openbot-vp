/**
 * 一次性迁移：版本生命周期兼容（R27.1 / R27.2）。
 *
 * - 归一化既有 PlanVersion 的 `status`（currentVersionId→active，余→deprecated）。
 * - 为缺 `planVersionId` 的 Subscription 补绑创建时点版本（无法判定→active + migratedBinding）。
 *
 * 用法：
 *   bun scripts/migrate-billing-version-lifecycle.ts [--dry-run]
 *
 * 默认读写 `CONFIG_DIR` 下的 billing store 文件。`--dry-run` 仅打印报告不落盘。
 */

import fs from "node:fs";
import path from "node:path";
import { migrateVersionLifecycle } from "../src/gateway/billing/version-migration.ts";
import { CONFIG_DIR } from "../src/utils.ts";

type Json = Record<string, unknown>;

function readJson(filePath: string): Json | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Json;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(): void {
  const dryRun = process.argv.includes("--dry-run");
  const plansPath = path.join(CONFIG_DIR, "openbot-billing-plans.json");
  const subsPath = path.join(CONFIG_DIR, "openbot-billing-subscriptions.json");

  const plansStore = readJson(plansPath);
  const subsStore = readJson(subsPath);

  if (!plansStore) {
    process.stdout.write(JSON.stringify({ skipped: "no plans store", plansPath }, null, 2));
    return;
  }

  // 适配 store 形状（plans/planVersions、subscriptions）。
  const plansShape = {
    plans: (plansStore.plans as Json) ?? {},
    planVersions: Array.isArray(plansStore.planVersions) ? plansStore.planVersions : [],
  } as never;
  const subsShape = {
    subscriptions: (subsStore?.subscriptions as Json) ?? {},
  } as never;

  const report = migrateVersionLifecycle(plansShape, subsShape);

  if (!dryRun) {
    // 归一化可能改了 planVersions（in-place），写回 plans store。
    writeJson(plansPath, { ...plansStore, planVersions: (plansShape as Json).planVersions });
    if (subsStore) {
      writeJson(subsPath, { ...subsStore, subscriptions: (subsShape as Json).subscriptions });
    }
  }

  process.stdout.write(JSON.stringify({ dryRun, report, plansPath, subsPath }, null, 2));
}

run();
