/**
 * 套餐人均定价 → Credits/席校准与毛利测算（只读）。
 *
 * 用真实 Usage Ledger 推导「每 Credit 真实成本」，再对三档人均价
 * （基础/专业/商业）反算：在目标毛利下每席可附带多少 Credits，以及
 * 选定配额后的毛利率、保本点、成本上浮敏感性。
 *
 * 复用生产同款纯函数（成本/基准/观测 mix），不重写口径：
 *   - src/gateway/cost-version/provider-cost.ts   provider 成本
 *   - src/gateway/economics/ledger-benchmark.ts   基准/观测 tier mix
 *   - src/gateway/billing/credit-meter.ts         v2 token 加权（0.25–4x clamp）
 *   - src/gateway/billing/usage-ledger-store.ts    真实 ledger 读取
 *
 * 货币口径：脚本按「人民币分」处理（¥1 = 100 分），与套餐 ¥ 价对齐。
 * 若 ledger 的 providerCostCents 实际记为美元分，用 --cost-scale 7.2 换算。
 *
 * 用法：
 *   bun scripts/pricing/calibrate-tier-credits.ts
 *   bun scripts/pricing/calibrate-tier-credits.ts --basic 199 --pro 599 --biz 899
 *   bun scripts/pricing/calibrate-tier-credits.ts --target-margin 0.7 --guard-margin 0.6
 *   bun scripts/pricing/calibrate-tier-credits.ts --ledger ~/.openbot/openbot-usage-ledger.json --json
 *   bun scripts/pricing/calibrate-tier-credits.ts --cost-scale 7.2   # ledger 记美元分时换算为人民币分
 *
 * 退出码：0 正常；2 参数错误。
 */

import { resolveTokenWeightedCreditCost } from "../../src/gateway/billing/credit-meter.ts";
import {
  listAllUsageLedgerEntries,
  resolveDefaultUsageLedgerStorePath,
} from "../../src/gateway/billing/usage-ledger-store.ts";
import { computeProviderCostCentsFloat } from "../../src/gateway/cost-version/provider-cost.ts";
import type { TokenUsageInput } from "../../src/gateway/cost-version/provider-cost.ts";
import {
  DEFAULT_BENCHMARK_USAGE,
  deriveBenchmarkUsageFromLedger,
  deriveObservedTierMixFromLedger,
} from "../../src/gateway/economics/ledger-benchmark.ts";
import type { UsageLedgerEntry } from "../../src/gateway/package-entitlement/types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 可配置假设（真实 ledger 优先；以下仅在某 tier 无真实成本时兜底）
// ─────────────────────────────────────────────────────────────────────────

/**
 * Tier 元数据。
 * - creditWeight：每次任务扣点（master plan §2.3：A=1 / B=5 / C=20）。
 * - synth*1MCents：合成成本兜底，人民币分 / 100 万 token（按 2026 市场价 × 7.2 取整）。
 *   A≈DeepSeek/Gemini Flash 档；B≈GPT-5/Sonnet 档；C≈Opus 档。
 */
const TIER_META: Record<
  string,
  { label: string; creditWeight: number; synthInput1MCents: number; synthOutput1MCents: number }
> = {
  tier_a: { label: "经济 A", creditWeight: 1, synthInput1MCents: 200, synthOutput1MCents: 800 },
  tier_b: { label: "标准 B", creditWeight: 5, synthInput1MCents: 1500, synthOutput1MCents: 9000 },
  tier_c: { label: "旗舰 C", creditWeight: 20, synthInput1MCents: 3600, synthOutput1MCents: 18000 },
};

type PackageDef = {
  id: string;
  label: string;
  defaultPriceYuan: number;
  refSeats: number;
  allowedTiers: string[];
};

/** 三档套餐（allowedTiers / 参考席位来自 master plan 2026-06-21 §2.1）。 */
const PACKAGES: PackageDef[] = [
  {
    id: "basic",
    label: "基础版",
    defaultPriceYuan: 199,
    refSeats: 10,
    allowedTiers: ["tier_a", "tier_b"],
  },
  {
    id: "pro",
    label: "专业版",
    defaultPriceYuan: 599,
    refSeats: 30,
    allowedTiers: ["tier_a", "tier_b"],
  },
  {
    id: "biz",
    label: "商业版",
    defaultPriceYuan: 899,
    refSeats: 100,
    allowedTiers: ["tier_a", "tier_b", "tier_c"],
  },
];

/** 成本上浮敏感性档位（真实 agentic 任务 token 可远超基准；v2 加权封顶 4x）。 */
const STRESS_MULTIPLES = [1, 2, 4] as const;

// ─────────────────────────────────────────────────────────────────────────
// 参数解析
// ─────────────────────────────────────────────────────────────────────────

type MixMode = "observed" | "equal" | "blend";

type CliOptions = {
  ledgerPath?: string;
  targetMargin: number;
  guardMargin: number;
  costScale: number;
  roundStep: number;
  mixMode: MixMode;
  priceYuanById: Record<string, number>;
  json: boolean;
};

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

function parseNumber(flag: string, raw: string | undefined): number {
  if (raw === undefined) {
    fail(`${flag} 需要一个数值`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    fail(`${flag} 不是合法数值: ${raw}`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    targetMargin: 0.7,
    guardMargin: 0.6,
    costScale: 1,
    roundStep: 100,
    mixMode: "blend",
    priceYuanById: Object.fromEntries(PACKAGES.map((p) => [p.id, p.defaultPriceYuan])),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string | undefined => argv[(i += 1)];
    switch (arg) {
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--ledger":
        opts.ledgerPath = next();
        break;
      case "--target-margin":
        opts.targetMargin = parseNumber(arg, next());
        break;
      case "--guard-margin":
        opts.guardMargin = parseNumber(arg, next());
        break;
      case "--cost-scale":
        opts.costScale = parseNumber(arg, next());
        break;
      case "--round":
        opts.roundStep = Math.max(1, Math.floor(parseNumber(arg, next())));
        break;
      case "--mix": {
        const raw = next();
        if (raw !== "observed" && raw !== "equal" && raw !== "blend") {
          fail(`--mix 仅支持 observed|equal|blend，收到: ${raw ?? ""}`);
        }
        opts.mixMode = raw;
        break;
      }
      case "--basic":
        opts.priceYuanById.basic = parseNumber(arg, next());
        break;
      case "--pro":
        opts.priceYuanById.pro = parseNumber(arg, next());
        break;
      case "--biz":
        opts.priceYuanById.biz = parseNumber(arg, next());
        break;
      default:
        fail(`未知参数: ${arg}（用 --help 查看用法）`);
    }
  }
  if (opts.targetMargin <= 0 || opts.targetMargin >= 1) {
    fail("--target-margin 必须在 (0,1) 之间");
  }
  if (opts.guardMargin <= 0 || opts.guardMargin >= 1) {
    fail("--guard-margin 必须在 (0,1) 之间");
  }
  if (opts.guardMargin > opts.targetMargin) {
    fail("--guard-margin 不应高于 --target-margin");
  }
  if (opts.costScale <= 0) {
    fail("--cost-scale 必须为正数");
  }
  return opts;
}

function printHelp(): void {
  process.stdout.write(
    [
      "套餐人均定价 → Credits/席校准与毛利测算（只读）",
      "",
      "选项：",
      "  --basic <元>          基础版人均价（默认 199）",
      "  --pro <元>            专业版人均价（默认 599）",
      "  --biz <元>            商业版人均价（默认 899）",
      "  --target-margin <r>   目标毛利率，0..1（默认 0.70）",
      "  --guard-margin <r>    红线毛利率，0..1（默认 0.60）",
      "  --cost-scale <n>      每 Credit 成本统一缩放（默认 1；ledger 记美元分时用 7.2）",
      "  --round <n>           推荐 Credits/席向下取整步长（默认 100）",
      "  --mix <模式>          tier 成本混合：observed|equal|blend（默认 blend，校准更稳妥）",
      "  --ledger <path>       指定 ledger 文件（默认 CONFIG_DIR/openbot-usage-ledger.json）",
      "  --json                输出机器可读 JSON",
      "  -h, --help            显示帮助",
      "",
    ].join("\n"),
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 成本推导
// ─────────────────────────────────────────────────────────────────────────

type TierCost = {
  tier: string;
  label: string;
  creditWeight: number;
  /** 最终采用的每 Credit 成本（人民币分，已乘 costScale）。 */
  costPerCreditCents: number;
  source: "ledger" | "synthetic";
  /** 真实样本数（该 tier 在 ledger 中 creditsCharged>0 的条数）。 */
  sampleCount: number;
};

/** 合成兜底：用基准 token 用量 × tier 合成单价，÷ 扣点权重 = 每 Credit 成本。 */
function syntheticCostPerCredit(tier: string, benchmark: TokenUsageInput): number {
  const meta = TIER_META[tier];
  const taskCostCents = computeProviderCostCentsFloat({
    usage: benchmark,
    inputCostPer1MCents: meta.synthInput1MCents,
    outputCostPer1MCents: meta.synthOutput1MCents,
  });
  return taskCostCents / Math.max(1, meta.creditWeight);
}

/** 真实优先：Σ providerCostCents / Σ creditsCharged（按 tier 聚合）；无真实成本则合成兜底。 */
function resolveCostPerCreditByTier(
  entries: readonly UsageLedgerEntry[],
  benchmark: TokenUsageInput,
  costScale: number,
): Map<string, TierCost> {
  const sumCost = new Map<string, number>();
  const sumCredits = new Map<string, number>();
  const samples = new Map<string, number>();
  for (const e of entries) {
    const tier = e.tier.trim();
    if (!tier || e.creditsCharged <= 0) {
      continue;
    }
    sumCredits.set(tier, (sumCredits.get(tier) ?? 0) + e.creditsCharged);
    sumCost.set(tier, (sumCost.get(tier) ?? 0) + Math.max(0, e.providerCostCents));
    samples.set(tier, (samples.get(tier) ?? 0) + 1);
  }
  const out = new Map<string, TierCost>();
  for (const tier of Object.keys(TIER_META)) {
    const meta = TIER_META[tier];
    const credits = sumCredits.get(tier) ?? 0;
    const cost = sumCost.get(tier) ?? 0;
    const hasReal = credits > 0 && cost > 0;
    const base = hasReal ? cost / credits : syntheticCostPerCredit(tier, benchmark);
    out.set(tier, {
      tier,
      label: meta.label,
      creditWeight: meta.creditWeight,
      costPerCreditCents: base * costScale,
      source: hasReal ? "ledger" : "synthetic",
      sampleCount: samples.get(tier) ?? 0,
    });
  }
  return out;
}

/**
 * 套餐的混合每 Credit 成本：按 mixMode 在 allowedTiers 上加权。
 * - observed：纯真实观测 mix（该套餐 allowedTiers 无观测则退化为等权）。
 * - equal：allowedTiers 等权（保守，假设高价 tier 也会被用满 → 校准更安全）。
 * - blend：0.5×observed + 0.5×equal（默认；兼顾现状用量与未来上探到高价 tier）。
 *
 * 说明：纯 observed 会让「允许高价 tier 但当前只用 tier_a」的套餐被低估成本，
 * 进而高估可附带额度。blend/equal 用于校准时更稳妥。
 */
function blendedCostPerCredit(
  pkg: PackageDef,
  costByTier: Map<string, TierCost>,
  observedMix: Record<string, number>,
  mixMode: MixMode,
): { costPerCreditCents: number; mix: Record<string, number> } {
  const allowed = pkg.allowedTiers.filter((t) => costByTier.has(t));
  if (allowed.length === 0) {
    return { costPerCreditCents: 0, mix: {} };
  }
  // 等权基准。
  const equal: Record<string, number> = {};
  for (const t of allowed) {
    equal[t] = 1 / allowed.length;
  }
  // 限定到 allowedTiers 的观测 mix，归一化（无观测退化为等权）。
  let obsSum = 0;
  const obsRestricted: Record<string, number> = {};
  for (const t of allowed) {
    const w = observedMix[t] ?? 0;
    if (w > 0) {
      obsRestricted[t] = w;
      obsSum += w;
    }
  }
  const observed: Record<string, number> = {};
  for (const t of allowed) {
    observed[t] = obsSum > 0 ? (obsRestricted[t] ?? 0) / obsSum : equal[t];
  }
  // 按模式合成最终 mix。
  const mix: Record<string, number> = {};
  for (const t of allowed) {
    if (mixMode === "equal") {
      mix[t] = equal[t];
    } else if (mixMode === "observed") {
      mix[t] = observed[t];
    } else {
      mix[t] = 0.5 * observed[t] + 0.5 * equal[t];
    }
  }
  let blended = 0;
  for (const t of allowed) {
    blended += mix[t] * (costByTier.get(t)?.costPerCreditCents ?? 0);
  }
  return { costPerCreditCents: blended, mix };
}

// ─────────────────────────────────────────────────────────────────────────
// 校准
// ─────────────────────────────────────────────────────────────────────────

type PackageCalibration = {
  id: string;
  label: string;
  priceYuan: number;
  refSeats: number;
  monthlyTotalYuan: number;
  allowedTiers: string[];
  tierMix: Record<string, number>;
  costPerCreditCents: number;
  breakEvenCreditsPerSeat: number | null;
  guardCeilingCreditsPerSeat: number | null;
  recommendedCreditsPerSeat: number | null;
  marginAtRecommended: number | null;
  costPerSeatYuanAtRecommended: number | null;
  sensitivity: Array<{ multiple: number; marginAtRecommended: number | null }>;
};

function floorToStep(value: number, step: number): number {
  return Math.max(0, Math.floor(value / step) * step);
}

function calibratePackage(
  pkg: PackageDef,
  priceYuan: number,
  costPerCreditCents: number,
  tierMix: Record<string, number>,
  opts: CliOptions,
): PackageCalibration {
  const priceCents = priceYuan * 100;
  const c = costPerCreditCents;
  const hasCost = c > 0;

  const breakEven = hasCost ? Math.floor(priceCents / c) : null;
  const guardCeil = hasCost ? Math.floor((priceCents * (1 - opts.guardMargin)) / c) : null;
  const recRaw = hasCost ? (priceCents * (1 - opts.targetMargin)) / c : null;
  const recommended = recRaw === null ? null : floorToStep(recRaw, opts.roundStep);

  let marginAtRec: number | null = null;
  let costPerSeatYuan: number | null = null;
  const sensitivity: PackageCalibration["sensitivity"] = [];
  if (recommended !== null && priceCents > 0) {
    const costAtRec = recommended * c;
    marginAtRec = 1 - costAtRec / priceCents;
    costPerSeatYuan = costAtRec / 100;
    for (const m of STRESS_MULTIPLES) {
      const costM = recommended * c * m;
      sensitivity.push({ multiple: m, marginAtRecommended: 1 - costM / priceCents });
    }
  }

  return {
    id: pkg.id,
    label: pkg.label,
    priceYuan,
    refSeats: pkg.refSeats,
    monthlyTotalYuan: priceYuan * pkg.refSeats,
    allowedTiers: pkg.allowedTiers,
    tierMix,
    costPerCreditCents: c,
    breakEvenCreditsPerSeat: breakEven,
    guardCeilingCreditsPerSeat: guardCeil,
    recommendedCreditsPerSeat: recommended,
    marginAtRecommended: marginAtRec,
    costPerSeatYuanAtRecommended: costPerSeatYuan,
    sensitivity,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────────────────────────────────

function fmtPct(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) {
    return "—";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

function fmtYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(4)}`;
}

function fmtInt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toLocaleString("en-US");
}

function totalTokens(usage: TokenUsageInput): number {
  return (
    Math.max(0, Math.floor(usage.inputTokens ?? 0)) +
    Math.max(0, Math.floor(usage.outputTokens ?? 0))
  );
}

type Report = {
  config: {
    ledgerPath: string;
    targetMargin: number;
    guardMargin: number;
    costScale: number;
    roundStep: number;
    mixMode: MixMode;
    currency: string;
    prices: Record<string, number>;
  };
  ledger: {
    entryCount: number;
    withTokenCount: number;
    benchmarkSource: "ledger" | "default";
    benchmark: TokenUsageInput;
    defaultBenchmark: TokenUsageInput;
    tokenMultipleVsDefault: number;
    v2WeightClamp: number;
    globalCostPerCreditCents: number | null;
    observedTierMix: Record<string, number>;
  };
  tiers: TierCost[];
  packages: PackageCalibration[];
};

function buildTextReport(report: Report): string {
  const lines: string[] = [];
  const L = report.ledger;
  lines.push("════════════════════════════════════════════════════════════════");
  lines.push("  套餐人均定价 → Credits/席校准与毛利测算");
  lines.push("════════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push("【输入】");
  lines.push(`  ledger 文件      : ${report.config.ledgerPath}`);
  lines.push(
    `  目标毛利 / 红线  : ${fmtPct(report.config.targetMargin)} / ${fmtPct(report.config.guardMargin)}`,
  );
  lines.push(
    `  成本缩放 cost-scale: ×${report.config.costScale}（货币单位：${report.config.currency}）`,
  );
  const mixLabel =
    report.config.mixMode === "observed"
      ? "observed（按真实观测用量）"
      : report.config.mixMode === "equal"
        ? "equal（allowedTiers 等权，最保守）"
        : "blend（0.5×观测 + 0.5×等权）";
  lines.push(`  tier 成本混合    : ${mixLabel}`);
  lines.push("");
  lines.push("【Ledger 概况】");
  lines.push(
    `  条目数           : ${fmtInt(L.entryCount)}（含 token 字段 ${fmtInt(L.withTokenCount)} 条）`,
  );
  lines.push(
    `  基准 token 来源  : ${L.benchmarkSource === "ledger" ? "真实 ledger 中位数" : "默认 1500/500"}`,
  );
  lines.push(
    `  基准 token       : 输入 ${fmtInt(L.benchmark.inputTokens ?? 0)} / 输出 ${fmtInt(L.benchmark.outputTokens ?? 0)}（合计 ${fmtInt(totalTokens(L.benchmark))}）`,
  );
  lines.push(
    `  真实任务倍数     : ×${L.tokenMultipleVsDefault.toFixed(2)} vs 默认基准 2000 token → v2 加权系数 ×${L.v2WeightClamp.toFixed(2)}（封顶 4x）`,
  );
  lines.push(
    `  全局每Credit成本 : ${L.globalCostPerCreditCents === null ? "—（无真实成本，用合成兜底）" : fmtYuan(L.globalCostPerCreditCents)}`,
  );
  lines.push("");
  lines.push("【各 Tier 每 Credit 成本】");
  for (const t of report.tiers) {
    lines.push(
      `  ${t.tier} ${t.label}（扣点 ${t.creditWeight}/次）: ${fmtYuan(t.costPerCreditCents)}/credit ` +
        `[${t.source === "ledger" ? `真实 ${t.sampleCount} 样本` : "合成兜底"}]`,
    );
  }
  lines.push("");
  lines.push("【各档校准结果】");
  for (const p of report.packages) {
    lines.push("────────────────────────────────────────────────────────────");
    lines.push(
      `  ${p.label}  人均 ¥${p.priceYuan}/月   参考 ${p.refSeats} 席 → 月度总价 ¥${p.monthlyTotalYuan.toLocaleString("en-US")}`,
    );
    const mixStr = Object.entries(p.tierMix)
      .map(([t, w]) => `${t} ${(w * 100).toFixed(0)}%`)
      .join(" + ");
    lines.push(`  可用 Tier        : ${p.allowedTiers.join(", ")}（混合 ${mixStr || "—"}）`);
    lines.push(`  混合每Credit成本 : ${fmtYuan(p.costPerCreditCents)}/credit`);
    lines.push(`  保本 Credits/席  : ${fmtInt(p.breakEvenCreditsPerSeat)}（毛利=0 临界）`);
    lines.push(
      `  红线上限 Credits/席: ${fmtInt(p.guardCeilingCreditsPerSeat)}（毛利=${fmtPct(report.config.guardMargin)} 时的最大配额）`,
    );
    lines.push(
      `  ★ 推荐 Credits/席 : ${fmtInt(p.recommendedCreditsPerSeat)}  →  毛利 ${fmtPct(p.marginAtRecommended)}` +
        `（每席成本 ¥${(p.costPerSeatYuanAtRecommended ?? 0).toFixed(2)}）`,
    );
    if (p.sensitivity.length > 0) {
      const sens = p.sensitivity
        .map((s) => `×${s.multiple}=${fmtPct(s.marginAtRecommended)}`)
        .join("  ");
      lines.push(`  成本上浮敏感性   : ${sens}`);
    }
  }
  lines.push("────────────────────────────────────────────────────────────");
  lines.push("");
  lines.push("【说明】");
  lines.push("  · 推荐 Credits/席 = 在目标毛利下每席可附带的额度；超出走超额按量计费。");
  lines.push(
    "  · ledger 有真实 providerCostCents 时即采用真实口径；否则用合成单价兜底（已在 Tier 行标注）。",
  );
  lines.push("  · 敏感性 ×N 模拟真实任务成本高于实测 N 倍时的毛利（v2 token 加权封顶 4x）。");
  if (
    report.ledger.benchmarkSource === "default" ||
    report.tiers.every((t) => t.source === "synthetic")
  ) {
    lines.push("");
    lines.push("  ⚠ 当前 ledger 无真实成本数据，结果基于合成假设（市场价 × 7.2）。");
    lines.push("    上线后用真实 ledger 重跑，数字才可锁定。");
  }
  lines.push("");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const ledgerPath = opts.ledgerPath?.trim() || resolveDefaultUsageLedgerStorePath();

  let entries: UsageLedgerEntry[] = [];
  try {
    entries = await listAllUsageLedgerEntries(undefined, ledgerPath);
  } catch (err) {
    process.stderr.write(`warn: 读取 ledger 失败，按空账本处理: ${(err as Error).message}\n`);
  }

  const benchmarkResult = deriveBenchmarkUsageFromLedger(entries);
  const observedMix = deriveObservedTierMixFromLedger(entries);
  const costByTier = resolveCostPerCreditByTier(entries, benchmarkResult.benchmark, opts.costScale);

  // 全局每 Credit 成本（真实口径，跨 tier）。
  let gCost = 0;
  let gCredits = 0;
  let withTokenCount = 0;
  for (const e of entries) {
    if (e.creditsCharged > 0 && e.providerCostCents > 0) {
      gCost += e.providerCostCents;
      gCredits += e.creditsCharged;
    }
    if (e.inputTokens !== undefined || e.outputTokens !== undefined) {
      withTokenCount += 1;
    }
  }
  const globalCostPerCreditCents =
    gCredits > 0 && gCost > 0 ? (gCost / gCredits) * opts.costScale : null;

  const benchTotal = Math.max(1, totalTokens(benchmarkResult.benchmark));
  const defaultTotal = Math.max(1, totalTokens(DEFAULT_BENCHMARK_USAGE));
  const tokenMultiple = benchTotal / defaultTotal;
  // 复用生产 clamp：base=100 求出加权后值再 /100，得到 0.25–4x 的实际系数。
  const v2WeightClamp =
    resolveTokenWeightedCreditCost({
      tierBaseCost: 100,
      tokenUsage: benchmarkResult.benchmark,
      benchmark: DEFAULT_BENCHMARK_USAGE,
    }) / 100;

  const packages = PACKAGES.map((pkg) => {
    const priceYuan = opts.priceYuanById[pkg.id] ?? pkg.defaultPriceYuan;
    const blended = blendedCostPerCredit(pkg, costByTier, observedMix, opts.mixMode);
    return calibratePackage(pkg, priceYuan, blended.costPerCreditCents, blended.mix, opts);
  });

  const report: Report = {
    config: {
      ledgerPath,
      targetMargin: opts.targetMargin,
      guardMargin: opts.guardMargin,
      costScale: opts.costScale,
      roundStep: opts.roundStep,
      mixMode: opts.mixMode,
      currency: "人民币分",
      prices: opts.priceYuanById,
    },
    ledger: {
      entryCount: entries.length,
      withTokenCount,
      benchmarkSource: benchmarkResult.source,
      benchmark: benchmarkResult.benchmark,
      defaultBenchmark: DEFAULT_BENCHMARK_USAGE,
      tokenMultipleVsDefault: tokenMultiple,
      v2WeightClamp,
      globalCostPerCreditCents,
      observedTierMix: observedMix,
    },
    tiers: [...costByTier.values()],
    packages,
  };

  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(buildTextReport(report));
}

void run();
