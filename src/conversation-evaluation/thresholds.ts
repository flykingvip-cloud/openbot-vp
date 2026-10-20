/**
 * A0 defaults from v3.1 §3.7.1.
 * Michael may revise these in writing; the acceptance record then replaces them.
 */

export const A0_WRITE_TIMEOUT_MS = 200;
export const A0_QUEUE_MAX_ITEMS = 10_000;
export const A0_QUEUE_MAX_BYTES = 256 * 1024 * 1024;
export const A0_LATENCY_MIN_SAMPLES = 1000;
export const A0_LATENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const A0_P95_RATIO = 0.05;
export const A0_P95_ABS_MS = 50;
export const A0_P99_RATIO = 0.1;
export const A0_P99_ABS_MS = 100;
export const A0_DROP_ALERT_RATE = 0.01;
export const A0_DROP_ALERT_WINDOW_MS = 5 * 60 * 1000;

/** In-flight evals still pending after this are the pending-timeout numerator. */
export const PENDING_SLO_MS = A0_DROP_ALERT_WINDOW_MS;

export type LatencyComparison = {
  status: "pass" | "fail" | "insufficient_sample";
  samplesOff: number;
  samplesOn: number;
  p95DeltaMs: number | null;
  p99DeltaMs: number | null;
  p95LimitMs: number | null;
  p99LimitMs: number | null;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? 0;
}

/**
 * on vs off for the same entrypoint.
 * Pass when the increment is within the wider of the ratio and absolute caps.
 */
export function compareLatencyRegression(input: {
  offMs: number[];
  onMs: number[];
  windowMs?: number;
}): LatencyComparison {
  const samplesOff = input.offMs.length;
  const samplesOn = input.onMs.length;
  const enoughSamples = samplesOff >= A0_LATENCY_MIN_SAMPLES && samplesOn >= A0_LATENCY_MIN_SAMPLES;
  const enoughWindow = (input.windowMs ?? 0) >= A0_LATENCY_WINDOW_MS;
  if (!enoughSamples && !enoughWindow) {
    return {
      status: "insufficient_sample",
      samplesOff,
      samplesOn,
      p95DeltaMs: null,
      p99DeltaMs: null,
      p95LimitMs: null,
      p99LimitMs: null,
    };
  }
  const off = input.offMs.toSorted((a, b) => a - b);
  const on = input.onMs.toSorted((a, b) => a - b);
  const p95Base = percentile(off, 95);
  const p99Base = percentile(off, 99);
  const p95DeltaMs = percentile(on, 95) - p95Base;
  const p99DeltaMs = percentile(on, 99) - p99Base;
  const p95LimitMs = Math.max(p95Base * A0_P95_RATIO, A0_P95_ABS_MS);
  const p99LimitMs = Math.max(p99Base * A0_P99_RATIO, A0_P99_ABS_MS);
  const pass = p95DeltaMs <= p95LimitMs && p99DeltaMs <= p99LimitMs;
  return {
    status: pass ? "pass" : "fail",
    samplesOff,
    samplesOn,
    p95DeltaMs,
    p99DeltaMs,
    p95LimitMs,
    p99LimitMs,
  };
}

export function isDropRateAlert(drops: number, observed: number): boolean {
  if (observed <= 0 || drops <= 0) {
    return false;
  }
  return drops / observed > A0_DROP_ALERT_RATE;
}
