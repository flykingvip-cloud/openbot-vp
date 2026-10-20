/**
 * Governance Detector — 「能力使用管理」（enterprise-capability-usage-management）模块的
 * 治理问题检测器（业务语言版）。
 *
 * 模块定位：
 * 本模块是 Runtime_Projection_Layer 的纯函数检测器，对外暴露 {@link detectGovernanceIssues}
 * 一个入口；其输出 {@link GovernanceIssue}[] 直接喂给「使用治理」子页（低效能力 / 未使用能力 /
 * 冲突能力 三类 Tab）。本模块**仅**做企业端业务可解释表达，与平台端
 * `runtime-canonical/governance-detector.ts`（处理 zombie binding / orphaned agent /
 * version drift / fallback chain broken / resource overcommit / capability conflict
 * 等运行时层治理）职责完全独立、对象不重叠。
 *
 * 三类问题（落实 Requirements 7.3 / 7.4 / 7.5 / 7.6 + Property 6）：
 *
 *   1. **低效能力**（low-efficiency）：在最近 30 天内 `executions30d > minExecutions` **且**
 *      `successRate < maxSuccessRate` 的安装关系；两个比较都是**严格**不等号——边界值
 *      （恰好 50 调用 + 70% 成功率）**不**上榜。
 *   2. **未使用能力**（zombie）：`executions30d === 0` **且** `installDays > minInstallDays`
 *      的安装关系；同样**严格**不等号——恰好安装 30 天 + 0 调用**不**上榜。
 *   3. **冲突能力**（conflict）：同一 `robotId` 下存在 ≥ 2 个能力，其
 *      `domain` 相同且能力描述余弦相似度 `>= minSimilarity`（含等号）。
 *
 * 设计准则：
 * - **纯函数**：不持有状态、不发起网络调用、不写日志（除黑名单降级时由
 *   {@link assertNoBlacklistedTerm} 自身记 warn，属于已声明的副作用）。
 * - **确定性**：相同输入 → 相同输出（含 `issueId` 稳定）。`issueId` 由
 *   `${type}|${capabilityId}|${robotId}` 派生，同一问题在不同检测周期保持稳定，
 *   便于会话内 acknowledge 去重（Requirement 7.8）。
 * - **稳定排序**：输出按 `(type, capabilityId, robotId)` 升序排列，使本函数
 *   引用透明（Property 6 幂等性的关键前提之一）。
 * - **业务语言降级**：每条问题的 `description` 文本在产出前都经过
 *   {@link assertNoBlacklistedTerm}（`downgrade` 模式）扫描；命中黑名单时降级为
 *   `"暂无数据"`，并通过黑名单守卫自身记 warn 日志（落实 Requirement 8.6 +
 *   Property 1 文本子集）。
 *
 * 建议操作（落实 design.md §8 与 Requirements 7.3–7.5；UI 可在对话框中提供
 * 备选项，但默认 suggestion 字段一对一映射如下）：
 *   - 低效能力 → `"重新整理能力"`
 *   - 未使用能力 → `"卸载"`
 *   - 冲突能力 → `"重新整理能力"`
 *
 * 关联文档：
 * - `.kiro/specs/enterprise-capability-usage-management/requirements.md`
 *   （Requirements 7.3 / 7.4 / 7.5 / 7.6 / 7.8 + Property 6）
 * - `.kiro/specs/enterprise-capability-usage-management/design.md` §8 使用治理
 */

import { assertNoBlacklistedTerm } from "./term-blacklist.ts";
import type {
  GovernanceConfig,
  GovernanceIssue,
  GovernanceIssueEvidence,
  GovernanceIssueType,
  GovernanceSuggestion,
  InstallRelationEnhanced,
} from "./types.ts";
import { DEFAULT_GOVERNANCE_CONFIG, GOVERNANCE_ISSUE_TYPES } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/** 能力元数据（治理检测所需的最小投影）。 */
export type CapabilityMetadataForGovernance = {
  capabilityId: string;
  /** 业务领域；冲突判定要求同一 robotId 下两条能力的 domain 完全相等。 */
  domain: string;
  /** 能力描述；冲突判定基于其余弦相似度。 */
  description: string;
};

/**
 * 治理问题检测器（纯函数）。
 *
 * 入参：
 * - `relations`：当前企业内全部安装关系（已经过 Runtime_Projection_Layer 投影）
 * - `capabilities`：相关能力的元数据（仅冲突检测使用 `domain` / `description`，
 *   缺失元数据的能力将不参与冲突检测，但仍可参与低效 / 僵尸检测）
 * - `config`：阈值配置；缺省时使用 {@link DEFAULT_GOVERNANCE_CONFIG}
 *   （低效 minExecutions=50, maxSuccessRate=0.7；僵尸 minInstallDays=30；冲突 minSimilarity=0.8）
 * - `now`：当前时间（毫秒时间戳）；用于计算 `installDays`，便于测试注入虚拟时钟
 *
 * 输出：按 `(type, capabilityId, robotId)` 升序排列的 {@link GovernanceIssue} 数组。
 *
 * 边界规则（落实 Property 6）：
 * - 低效：`executions30d > minExecutions && successRate < maxSuccessRate`（**严格**）
 * - 僵尸：`executions30d === 0 && installDays > minInstallDays`（**严格**）
 * - 冲突：`domain 相同 && cosineSim(descA, descB) >= minSimilarity`（含等号）
 *
 * 注意：相同 (type, capabilityId, robotId) 在重复 `relations` 中只产生一条 issue
 * （`issueId` 派生自 `(type, capabilityId, robotId)`，去重逻辑由排序后扫描实现）。
 */
export function detectGovernanceIssues(
  relations: readonly InstallRelationEnhanced[],
  capabilities: ReadonlyArray<CapabilityMetadataForGovernance>,
  config: GovernanceConfig = DEFAULT_GOVERNANCE_CONFIG,
  now: number,
): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];

  // 低效 + 僵尸：逐条扫描安装关系
  for (const relation of relations) {
    const lowEff = detectLowEfficiencyForRelation(relation, config);
    if (lowEff !== null) {
      issues.push(lowEff);
    }
    const zombie = detectZombieForRelation(relation, config, now);
    if (zombie !== null) {
      issues.push(zombie);
    }
  }

  // 冲突：按 robotId 分组后两两配对
  const conflictIssues = detectConflictIssues(relations, capabilities, config, now);
  issues.push(...conflictIssues);

  return sortAndDedupe(issues);
}

// ─────────────────────────────────────────────────────────────────────────
// Low-efficiency detector
// ─────────────────────────────────────────────────────────────────────────

function detectLowEfficiencyForRelation(
  relation: InstallRelationEnhanced,
  config: GovernanceConfig,
): GovernanceIssue | null {
  const { executions30d, successRate } = relation.usageStats;
  const { minExecutions, maxSuccessRate } = config.lowEfficiency;

  // STRICT 比较：恰好 50 + 0.70 不上榜（Property 6 边界）。
  // NaN 比较恒为 false，自动不上榜（无需特判）。
  if (!(executions30d > minExecutions)) {
    return null;
  }
  if (!(successRate < maxSuccessRate)) {
    return null;
  }

  const description = formatLowEfficiencyDescription(executions30d, successRate);
  return makeIssue({
    type: "低效能力",
    relation,
    description,
    suggestion: "重新整理能力",
    evidence: {
      executions30d,
      successRate,
    },
    detectedAt: relation.installedAt, // 见下方 detectedAt 选择说明
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Zombie detector
// ─────────────────────────────────────────────────────────────────────────

function detectZombieForRelation(
  relation: InstallRelationEnhanced,
  config: GovernanceConfig,
  now: number,
): GovernanceIssue | null {
  const { executions30d } = relation.usageStats;
  if (executions30d !== 0) {
    return null;
  }

  const installDays = computeInstallDays(relation.installedAt, now);
  if (!(installDays > config.zombie.minInstallDays)) {
    return null;
  }

  const description = formatZombieDescription(installDays);
  return makeIssue({
    type: "未使用能力",
    relation,
    description,
    suggestion: "卸载",
    evidence: {
      executions30d,
      installDays,
    },
    detectedAt: relation.installedAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Conflict detector
// ─────────────────────────────────────────────────────────────────────────

function detectConflictIssues(
  relations: readonly InstallRelationEnhanced[],
  capabilities: ReadonlyArray<CapabilityMetadataForGovernance>,
  config: GovernanceConfig,
  _now: number,
): GovernanceIssue[] {
  const meta = new Map<string, CapabilityMetadataForGovernance>();
  for (const cap of capabilities) {
    meta.set(cap.capabilityId, cap);
  }

  // 按 robotId 分组：每个 robot 下保留唯一 capabilityId（重复关系不重复参与配对）
  const byRobot = new Map<string, Map<string, InstallRelationEnhanced>>();
  for (const relation of relations) {
    let bucket = byRobot.get(relation.robotId);
    if (!bucket) {
      bucket = new Map<string, InstallRelationEnhanced>();
      byRobot.set(relation.robotId, bucket);
    }
    if (!bucket.has(relation.capabilityId)) {
      bucket.set(relation.capabilityId, relation);
    }
  }

  const result: GovernanceIssue[] = [];
  // conflictMap: robotId -> capabilityId -> Set<otherCapabilityId>
  const conflictMap = new Map<string, Map<string, Set<string>>>();

  for (const [robotId, bucket] of byRobot) {
    // 把同一 robot 下的能力按 capabilityId 升序固定，便于双层循环成对扫描
    const ordered = [...bucket.values()].toSorted((a, b) =>
      compareStrings(a.capabilityId, b.capabilityId),
    );

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        if (!a || !b) {
          continue;
        }
        const metaA = meta.get(a.capabilityId);
        const metaB = meta.get(b.capabilityId);
        if (!metaA || !metaB) {
          // 缺失元数据：不参与冲突判定（保守降级，不引入误报）。
          continue;
        }
        if (metaA.domain !== metaB.domain) {
          continue;
        }
        const sim = cosineSimilarity(metaA.description, metaB.description);
        if (!(sim >= config.conflict.minSimilarity)) {
          continue;
        }
        recordConflict(conflictMap, robotId, a.capabilityId, b.capabilityId, sim);
      }
    }

    const robotConflicts = conflictMap.get(robotId);
    if (!robotConflicts) {
      continue;
    }
    // 每条参与冲突的 capability 单独 emit 一条 issue（per design.md §8）
    for (const [capabilityId, others] of robotConflicts) {
      const relation = bucket.get(capabilityId);
      if (!relation) {
        continue;
      }
      const orderedOthers = [...others].toSorted(compareStrings);
      const maxSim = computeMaxSimilarity(meta, capabilityId, orderedOthers);
      const description = formatConflictDescription(orderedOthers.length);
      result.push(
        makeIssue({
          type: "冲突能力",
          relation,
          description,
          suggestion: "重新整理能力",
          evidence: {
            similarity: maxSim,
            conflictWith: orderedOthers,
          },
          detectedAt: relation.installedAt,
        }),
      );
    }
  }
  return result;
}

function recordConflict(
  conflictMap: Map<string, Map<string, Set<string>>>,
  robotId: string,
  a: string,
  b: string,
  _sim: number,
): void {
  let robotConflicts = conflictMap.get(robotId);
  if (!robotConflicts) {
    robotConflicts = new Map<string, Set<string>>();
    conflictMap.set(robotId, robotConflicts);
  }
  for (const [capId, otherCapId] of [
    [a, b],
    [b, a],
  ]) {
    if (!capId || !otherCapId) {
      continue;
    }
    let set = robotConflicts.get(capId);
    if (!set) {
      set = new Set<string>();
      robotConflicts.set(capId, set);
    }
    set.add(otherCapId);
  }
}

function computeMaxSimilarity(
  meta: ReadonlyMap<string, CapabilityMetadataForGovernance>,
  capabilityId: string,
  others: readonly string[],
): number {
  const me = meta.get(capabilityId);
  if (!me) {
    return 0;
  }
  let max = 0;
  for (const otherId of others) {
    const other = meta.get(otherId);
    if (!other) {
      continue;
    }
    const sim = cosineSimilarity(me.description, other.description);
    if (sim > max) {
      max = sim;
    }
  }
  return max;
}

// ─────────────────────────────────────────────────────────────────────────
// Cosine similarity (internal, pure)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 简单词袋（bag-of-words）余弦相似度。
 *
 * 算法：
 * 1. 对每个输入字符串小写化（`String.prototype.toLowerCase`）。
 * 2. 按一个或多个 ASCII 空白字符（`\s+`）切分成 token 序列；空 token 过滤掉。
 * 3. 统计每个 token 的出现次数，得到稀疏向量 `a` / `b`。
 * 4. 余弦相似度 = `dot(a, b) / (||a|| * ||b||)`；任一向量为零向量时返回 0。
 *
 * 已知局限（明确写在 JSDoc 中以避免误用）：
 * - **无中文分词**：对中文文本，`\s+` 切分后整段视作一个 token。两段完全相同的
 *   中文返回 1.0；两段不同的中文（无共同 ASCII 片段）返回 0.0。这在企业能力
 *   描述以中文为主的场景下，等效于"近似相等"判定，仍能命中冲突能力的核心
 *   场景（描述高度雷同）。
 * - **无词干提取（stemming）**：`"capability"` 与 `"capabilities"` 视为不同 token。
 * - **无停用词过滤**：`"the"`、`"a"` 等常见高频词照常计入。
 * - **ASCII 空白边界**：`\s` 主要覆盖 ASCII 空白（含 Unicode 空白由 `\s` JS 标准
 *   覆盖至全角空格 U+3000，但不覆盖中日韩字符之间的"零空格边界"）。
 * - 不引入新依赖（不使用 jieba / 词向量 / Sentence-BERT 等）；如未来需要更精确
 *   的相似度，应在投影层独立替换该函数实现，本模块的调用契约保持稳定。
 */
function cosineSimilarity(textA: string, textB: string): number {
  const vecA = bagOfWords(textA);
  const vecB = bagOfWords(textB);
  if (vecA.size === 0 || vecB.size === 0) {
    return 0;
  }

  let dot = 0;
  let normASq = 0;
  let normBSq = 0;
  for (const [, count] of vecA) {
    normASq += count * count;
  }
  for (const [token, countB] of vecB) {
    normBSq += countB * countB;
    const countA = vecA.get(token);
    if (countA !== undefined) {
      dot += countA * countB;
    }
  }
  if (normASq === 0 || normBSq === 0) {
    return 0;
  }
  return dot / Math.sqrt(normASq * normBSq);
}

function bagOfWords(text: string): Map<string, number> {
  const result = new Map<string, number>();
  if (!text) {
    return result;
  }
  const tokens = text.toLowerCase().split(/\s+/u);
  for (const token of tokens) {
    if (!token) {
      continue;
    }
    result.set(token, (result.get(token) ?? 0) + 1);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function computeInstallDays(installedAt: number, now: number): number {
  // 与 task spec 一致：`Math.floor((now - installedAt) / 86_400_000)`。
  // 对 installedAt 大于 now（异常时钟）的输入，返回负值；后续 `> minInstallDays` 判定
  // 自然为 false，不上榜。
  return Math.floor((now - installedAt) / ONE_DAY_MS);
}

function formatLowEfficiencyDescription(executions30d: number, successRate: number): string {
  // 业务语言文案：避开黑名单 token（runtime / agent / cpu / ...）。
  // 百分比保留 1 位小数，与展示层 formatSuccessRate 的契约一致。
  const ratePct = (successRate * 100).toFixed(1);
  return `该能力本月调用 ${executions30d} 次，成功率仅 ${ratePct}%，效果不理想。`;
}

function formatZombieDescription(installDays: number): string {
  return `该能力已安装 ${installDays} 天，最近 30 天未被调用。`;
}

function formatConflictDescription(otherCount: number): string {
  return `该能力与同一机器人上 ${otherCount} 个其他能力业务领域相同且描述高度相似。`;
}

// ─────────────────────────────────────────────────────────────────────────
// Issue construction
// ─────────────────────────────────────────────────────────────────────────

type MakeIssueInput = {
  type: GovernanceIssueType;
  relation: InstallRelationEnhanced;
  description: string;
  suggestion: GovernanceSuggestion;
  evidence: GovernanceIssueEvidence;
  detectedAt: number;
};

function makeIssue(input: MakeIssueInput): GovernanceIssue {
  // description 在产出前必经术语黑名单扫描（downgrade 模式）。
  // 命中即降级为 "暂无数据"，并由黑名单守卫自身记 warn 日志（Requirement 8.6）。
  const safeDescription = assertNoBlacklistedTerm(input.description, { mode: "downgrade" });
  return {
    issueId: buildIssueId(input.type, input.relation.capabilityId, input.relation.robotId),
    type: input.type,
    capabilityId: input.relation.capabilityId,
    robotId: input.relation.robotId,
    description: safeDescription,
    suggestion: input.suggestion,
    evidence: input.evidence,
    detectedAt: input.detectedAt,
  };
}

/**
 * 由 `(type, capabilityId, robotId)` 派生的稳定问题 ID。
 *
 * 选择 `|` 作为分隔符是因为它在企业 ID 的常见字符集（字母 / 数字 / `-` / `_`）中
 * 不会出现，避免歧义。同一问题在不同检测周期保持稳定，便于会话内 acknowledge
 * 去重（Requirement 7.8 + Property 6）。
 */
function buildIssueId(type: GovernanceIssueType, capabilityId: string, robotId: string): string {
  return `${type}|${capabilityId}|${robotId}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Sort & dedupe
// ─────────────────────────────────────────────────────────────────────────

const TYPE_ORDER: ReadonlyMap<GovernanceIssueType, number> = new Map(
  GOVERNANCE_ISSUE_TYPES.map((t, i) => [t, i] as const),
);

/**
 * 按 `(type, capabilityId, robotId)` 升序稳定排序，并对相同 `issueId` 的多条
 * 重复 issue 仅保留首条（确保 issueId 唯一，落实 Property 6 幂等性）。
 *
 * 排序规则：
 * - `type` 按 {@link GOVERNANCE_ISSUE_TYPES} 中的位置升序（`低效 < 未使用 < 冲突`），
 *   避免依赖 `String.prototype.localeCompare` 的运行时 locale 漂移。
 * - `capabilityId` / `robotId` 使用纯 UTF-16 码元序（`<` / `>`），引用透明。
 */
function sortAndDedupe(issues: readonly GovernanceIssue[]): GovernanceIssue[] {
  const sorted = [...issues].toSorted((a, b) => {
    const typeDiff = (TYPE_ORDER.get(a.type) ?? 0) - (TYPE_ORDER.get(b.type) ?? 0);
    if (typeDiff !== 0) {
      return typeDiff;
    }
    const capDiff = compareStrings(a.capabilityId, b.capabilityId);
    if (capDiff !== 0) {
      return capDiff;
    }
    return compareStrings(a.robotId, b.robotId);
  });
  const seen = new Set<string>();
  const result: GovernanceIssue[] = [];
  for (const issue of sorted) {
    if (seen.has(issue.issueId)) {
      continue;
    }
    seen.add(issue.issueId);
    result.push(issue);
  }
  return result;
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}
