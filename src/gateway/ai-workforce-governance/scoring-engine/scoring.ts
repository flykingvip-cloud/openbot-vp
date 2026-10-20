/**
 * AI Scoring Engine
 * Calculates performance scores for AI assets (bots, groups, positions).
 *
 * Scoring Model:
 * - Bot Score = 0.4 × efficiency + 0.3 × cost + 0.3 × stability
 * - Position Score = average of its assets' scores
 */

import type { AiMetricsDaily, AiScore, ScoreType } from "../shared/types.js";
import { generateScoreId, getTodayDate } from "../shared/utils.js";

// ============================================================================
// Scoring Weights
// ============================================================================

const BOT_SCORE_WEIGHTS = {
  efficiency: 0.4,
  cost: 0.3,
  stability: 0.3,
};

const EFFICIENCY_SUB_WEIGHTS = {
  taskCount: 0.6,
  successRate: 0.4,
};

// ============================================================================
// In-Memory Store
// ============================================================================

const scoresStore = new Map<string, AiScore>();

// ============================================================================
// Normalize Function
// ============================================================================

export function normalize(value: number, min: number, max: number): number {
  if (max === min) {
    return 0.5; // Return middle value if no variance
  }
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

// ============================================================================
// Component Scoring
// ============================================================================

export interface ScoreContext {
  minTaskCount: number;
  maxTaskCount: number;
  minCostPerTask: number;
  maxCostPerTask: number;
  minFailRate: number;
  maxFailRate: number;
}

export function calculateEfficiencyScore(metrics: AiMetricsDaily, context: ScoreContext): number {
  const taskScore = normalize(metrics.taskCount, context.minTaskCount, context.maxTaskCount);
  const successScore = metrics.successRate; // Already 0-1

  return (
    taskScore * EFFICIENCY_SUB_WEIGHTS.taskCount + successScore * EFFICIENCY_SUB_WEIGHTS.successRate
  );
}

export function calculateCostScore(metrics: AiMetricsDaily, context: ScoreContext): number {
  // Lower cost is better, so we invert
  const costPerTask = metrics.avgCostPerTask || 0;
  const normalizedCost = normalize(costPerTask, context.minCostPerTask, context.maxCostPerTask);
  return 1 - normalizedCost; // Invert so higher score = lower cost
}

export function calculateStabilityScore(metrics: AiMetricsDaily, context: ScoreContext): number {
  const failRate = metrics.taskCount > 0 ? metrics.failCount / metrics.taskCount : 0;
  const normalizedFailRate = normalize(failRate, context.minFailRate, context.maxFailRate);
  return 1 - normalizedFailRate; // Invert so higher score = lower failure rate
}

// ============================================================================
// Bot Score Calculation
// ============================================================================

export interface BotScoreResult {
  assetId: string;
  score: number;
  efficiencyScore: number;
  costScore: number;
  stabilityScore: number;
  metrics: {
    taskCount: number;
    successRate: number;
    costPerTask: number;
    failRate: number;
  };
}

export function calculateBotScore(
  assetId: string,
  metrics: AiMetricsDaily,
  context: ScoreContext,
): BotScoreResult {
  const efficiencyScore = calculateEfficiencyScore(metrics, context);
  const costScore = calculateCostScore(metrics, context);
  const stabilityScore = calculateStabilityScore(metrics, context);

  const score =
    efficiencyScore * BOT_SCORE_WEIGHTS.efficiency +
    costScore * BOT_SCORE_WEIGHTS.cost +
    stabilityScore * BOT_SCORE_WEIGHTS.stability;

  const failRate = metrics.taskCount > 0 ? metrics.failCount / metrics.taskCount : 0;

  return {
    assetId,
    score: Math.round(score * 100), // Convert to 0-100
    efficiencyScore: Math.round(efficiencyScore * 100),
    costScore: Math.round(costScore * 100),
    stabilityScore: Math.round(stabilityScore * 100),
    metrics: {
      taskCount: metrics.taskCount,
      successRate: metrics.successRate,
      costPerTask: metrics.avgCostPerTask,
      failRate,
    },
  };
}

// ============================================================================
// Batch Score Calculation
// ============================================================================

export function calculateScoreContext(allMetrics: AiMetricsDaily[]): ScoreContext {
  const taskCounts = allMetrics.map((m) => m.taskCount);
  const costsPerTask = allMetrics.map((m) => m.avgCostPerTask || 0);
  const failRates = allMetrics.map((m) => (m.taskCount > 0 ? m.failCount / m.taskCount : 0));

  return {
    minTaskCount: Math.min(...taskCounts, 0),
    maxTaskCount: Math.max(...taskCounts, 1),
    minCostPerTask: Math.min(...costsPerTask, 0),
    maxCostPerTask: Math.max(...costsPerTask, 0.01),
    minFailRate: Math.min(...failRates, 0),
    maxFailRate: Math.max(...failRates, 0.01),
  };
}

export async function calculateAllBotScores(
  metricsByAsset: Map<string, AiMetricsDaily>,
): Promise<BotScoreResult[]> {
  const allMetrics = Array.from(metricsByAsset.values());
  const context = calculateScoreContext(allMetrics);

  const results: BotScoreResult[] = [];

  for (const [assetId, metrics] of metricsByAsset) {
    const result = calculateBotScore(assetId, metrics, context);
    results.push(result);
  }

  // Sort by score descending
  return results.toSorted((a, b) => b.score - a.score);
}

// ============================================================================
// Position Score Calculation
// ============================================================================

export interface PositionScoreResult {
  positionId: string;
  score: number;
  assetCount: number;
  avgEfficiency: number;
  avgCost: number;
  avgStability: number;
}

export function calculatePositionScore(
  positionId: string,
  assetScores: BotScoreResult[],
): PositionScoreResult {
  if (assetScores.length === 0) {
    return {
      positionId,
      score: 0,
      assetCount: 0,
      avgEfficiency: 0,
      avgCost: 0,
      avgStability: 0,
    };
  }

  const avgEfficiency =
    assetScores.reduce((sum, s) => sum + s.efficiencyScore, 0) / assetScores.length;
  const avgCost = assetScores.reduce((sum, s) => sum + s.costScore, 0) / assetScores.length;
  const avgStability =
    assetScores.reduce((sum, s) => sum + s.stabilityScore, 0) / assetScores.length;

  // Use same weights as bot score
  const score =
    avgEfficiency * BOT_SCORE_WEIGHTS.efficiency +
    avgCost * BOT_SCORE_WEIGHTS.cost +
    avgStability * BOT_SCORE_WEIGHTS.stability;

  return {
    positionId,
    score: Math.round(score),
    assetCount: assetScores.length,
    avgEfficiency: Math.round(avgEfficiency),
    avgCost: Math.round(avgCost),
    avgStability: Math.round(avgStability),
  };
}

// ============================================================================
// Score Storage
// ============================================================================

export async function saveScore(
  assetId: string,
  type: ScoreType,
  result: BotScoreResult | PositionScoreResult,
  date: string = getTodayDate(),
  rank?: number,
): Promise<AiScore> {
  const id = generateScoreId();
  const now = new Date().toISOString();

  const score: AiScore = {
    id,
    assetId,
    type,
    score: result.score,
    efficiencyScore: "efficiencyScore" in result ? result.efficiencyScore : result.avgEfficiency,
    costScore: "costScore" in result ? result.costScore : result.avgCost,
    stabilityScore: "stabilityScore" in result ? result.stabilityScore : result.avgStability,
    taskCount: "metrics" in result ? result.metrics.taskCount : 0,
    successRate: "metrics" in result ? result.metrics.successRate : 0,
    costPerTask: "metrics" in result ? result.metrics.costPerTask : 0,
    failRate: "metrics" in result ? result.metrics.failRate : 0,
    rank,
    date,
    createdAt: now,
    updatedAt: now,
  };

  const key = `${assetId}:${date}`;
  scoresStore.set(key, score);

  return score;
}

export async function getScore(
  assetId: string,
  date: string = getTodayDate(),
): Promise<AiScore | null> {
  const key = `${assetId}:${date}`;
  return scoresStore.get(key) ?? null;
}

export async function getScoresByDate(date: string, type?: ScoreType): Promise<AiScore[]> {
  let scores = Array.from(scoresStore.values()).filter((s) => s.date === date);

  if (type) {
    scores = scores.filter((s) => s.type === type);
  }

  return scores.toSorted((a, b) => b.score - a.score);
}

// ============================================================================
// Store Management
// ============================================================================

export function clearScoresStore(): void {
  scoresStore.clear();
}

export function seedScoresForTesting(scores: AiScore[]): void {
  for (const score of scores) {
    const key = `${score.assetId}:${score.date}`;
    scoresStore.set(key, score);
  }
}

export function getScoresStoreSize(): number {
  return scoresStore.size;
}
