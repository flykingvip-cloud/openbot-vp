import type { StatisticalAssessment } from "./types.js";

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

export function wilsonScoreInterval(
  successes: number,
  trials: number,
  z = 1.96,
): { lower: number; upper: number } | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) {
    return null;
  }
  const n = trials;
  const p = clamp01(successes / n);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    lower: clamp01((center - margin) / denom),
    upper: clamp01((center + margin) / denom),
  };
}

export function assessTwoProportion(input: {
  baselineRate: number;
  baselineTrials: number;
  treatmentRate: number;
  treatmentTrials: number;
  minimumTrials: number;
}): StatisticalAssessment {
  const notes: string[] = [];
  const baselineTrials = Math.max(0, Math.floor(input.baselineTrials));
  const treatmentTrials = Math.max(0, Math.floor(input.treatmentTrials));
  if (baselineTrials <= 0 || treatmentTrials <= 0) {
    return {
      method: "insufficient-sample",
      baselineTrials,
      treatmentTrials,
      confidence: null,
      notes: ["zero_sample"],
    };
  }
  if (baselineTrials < input.minimumTrials || treatmentTrials < input.minimumTrials) {
    return {
      method: "insufficient-sample",
      baselineTrials,
      treatmentTrials,
      confidence: null,
      notes: ["sample_size_insufficient"],
    };
  }
  const p1 = clamp01(input.baselineRate);
  const p2 = clamp01(input.treatmentRate);
  const pooled = (p1 * baselineTrials + p2 * treatmentTrials) / (baselineTrials + treatmentTrials);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / baselineTrials + 1 / treatmentTrials));
  if (se === 0) {
    notes.push("zero_variance");
    return {
      method: "two-proportion-z",
      baselineTrials,
      treatmentTrials,
      confidence: p1 === p2 ? 0 : 1,
      notes,
    };
  }
  const z = (p2 - p1) / se;
  const confidence = clamp01(2 * normalCdf(Math.abs(z)) - 1);
  notes.push("two_proportion_z");
  const interval = wilsonScoreInterval(p2 * treatmentTrials, treatmentTrials);
  if (interval) {
    notes.push(`wilson:${interval.lower.toFixed(4)}-${interval.upper.toFixed(4)}`);
  }
  return {
    method: "two-proportion-z",
    baselineTrials,
    treatmentTrials,
    confidence,
    notes,
  };
}
