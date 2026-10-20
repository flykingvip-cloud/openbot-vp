#!/usr/bin/env bun
/**
 * 回填 Resource Model Catalog 的真实单价与 tier（修复 seed 出来的 0/0、tier_b）。
 *
 * 按 src/gateway/resource-catalog/model-cost-defaults.ts 的价表，对已存在的目录条目
 * 回填 inputCostPer1MCents / outputCostPer1MCents / tier。回填后，已接好的链路
 * （recordCreditUsage → resolveModelCostRates → ledger.providerCostCents → economics）
 * 会对**后续运行**写入真实成本（历史 ledger 条目不追溯改写）。
 *
 * Usage:
 *   bun scripts/seed-model-costs.ts --dry-run     # 只预览将回填哪些模型
 *   bun scripts/seed-model-costs.ts               # 仅回填未定价（0/0）的条目
 *   bun scripts/seed-model-costs.ts --overwrite    # 连已定价条目也按默认价覆盖
 *   bun scripts/seed-model-costs.ts --json         # 机器可读输出
 */

import { applyModelCostDefaultsToCatalog } from "../src/gateway/resource-catalog/apply-cost-defaults.ts";

async function run(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const overwriteExisting = process.argv.includes("--overwrite");
  const json = process.argv.includes("--json");

  const result = await applyModelCostDefaultsToCatalog({ dryRun, overwriteExisting });

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const verb = dryRun ? "将回填" : "已回填";
  const lines: string[] = [];
  lines.push(`目录模型总数：${result.total}`);
  lines.push(
    `${verb} ${result.updated.length} 个；未命中价表 ${result.skippedNoDefault.length} 个；已定价跳过 ${result.skippedAlreadyPriced.length} 个`,
  );
  if (result.updated.length > 0) {
    lines.push("");
    lines.push(`${verb}明细（人民币分 / 1M token）：`);
    for (const u of result.updated) {
      lines.push(
        `  ${u.modelId}  →  ${u.tier}  in ${u.inputCostPer1MCents} / out ${u.outputCostPer1MCents}  ` +
          `[${u.ruleId}]  (原 ${u.previousInputCostPer1MCents}/${u.previousOutputCostPer1MCents})`,
      );
    }
  }
  if (result.skippedNoDefault.length > 0) {
    lines.push("");
    lines.push(`未命中价表（需运营手动填价）：${result.skippedNoDefault.join(", ")}`);
  }
  if (dryRun) {
    lines.push("");
    lines.push("（--dry-run：未落盘。去掉该参数执行真正回填。）");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

void run();
