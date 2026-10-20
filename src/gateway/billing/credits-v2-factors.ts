/**
 * Credits v2 乘子纯函数（P4）。
 *
 * 与 tokenCostFactor 一致：相对 benchmark 比值，钳制在 [0.25, 4]。
 */

export const DEFAULT_BENCHMARK_TOOL_CALLS = 2;
export const DEFAULT_BENCHMARK_DURATION_MS = 30_000;
export const DEFAULT_BENCHMARK_RETRIES = 0;

const V2_FACTOR_MIN = 0.25;
const V2_FACTOR_MAX = 4;

function clampV2Factor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(V2_FACTOR_MAX, Math.max(V2_FACTOR_MIN, value));
}

/** 重工具类名加权（exec/browser 等相对轻量 read 额外 +0.5 等效调用）。 */
export function resolveToolClassWeight(className: string): number {
  const key = className.trim().toLowerCase();
  if (!key) {
    return 0;
  }
  if (/browser|exec|bash|shell|computer|canvas|screenshot|web_fetch/.test(key)) {
    return 0.5;
  }
  return 0;
}

export type ResolveV2ToolFactorInput = {
  toolCallCount?: number;
  toolClasses?: readonly string[];
  benchmarkToolCalls?: number;
};

export function resolveV2ToolFactor(input: ResolveV2ToolFactorInput = {}): number {
  const count = Math.max(0, Math.floor(input.toolCallCount ?? 0));
  const classBonus = (input.toolClasses ?? []).reduce(
    (sum, name) => sum + resolveToolClassWeight(name),
    0,
  );
  const effective = count + classBonus;
  if (effective <= 0) {
    return 1;
  }
  const benchmark = Math.max(
    1,
    Math.floor(input.benchmarkToolCalls ?? DEFAULT_BENCHMARK_TOOL_CALLS),
  );
  const ratio = (1 + effective) / (1 + benchmark);
  return clampV2Factor(ratio);
}

export type ResolveV2RuntimeFactorInput = {
  durationMs?: number;
  retryCount?: number;
  benchmarkDurationMs?: number;
  benchmarkRetries?: number;
};

export function resolveV2RuntimeFactor(input: ResolveV2RuntimeFactorInput = {}): number {
  const durationMs = Math.max(0, Math.floor(input.durationMs ?? 0));
  const retryCount = Math.max(0, Math.floor(input.retryCount ?? 0));
  if (durationMs <= 0 && retryCount <= 0) {
    return 1;
  }
  const benchmarkMs = Math.max(
    1,
    Math.floor(input.benchmarkDurationMs ?? DEFAULT_BENCHMARK_DURATION_MS),
  );
  const benchmarkRetries = Math.max(
    0,
    Math.floor(input.benchmarkRetries ?? DEFAULT_BENCHMARK_RETRIES),
  );
  const durationRatio = durationMs > 0 ? durationMs / benchmarkMs : 1;
  const retryRatio = (1 + retryCount) / (1 + benchmarkRetries);
  return clampV2Factor(durationRatio * retryRatio);
}
