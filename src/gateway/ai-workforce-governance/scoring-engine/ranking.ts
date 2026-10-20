/**
 * Ranking Engine
 * Generates ranked lists of AI assets based on scores.
 */

import * as aiAssets from "../ai-assets/store.js";
import type { AiScore, RankedItem, RankingResult, ScoreType } from "../shared/types.js";
import { getScoresByDate } from "./scoring.js";

// ============================================================================
// Ranking Generation
// ============================================================================

export async function generateRanking(type: ScoreType, date: string): Promise<RankingResult> {
  // Get all scores for the date and type
  const scores = await getScoresByDate(date, type);

  // Assign ranks
  const rankedScores = scores.map((score, index) => ({
    ...score,
    rank: index + 1,
  }));

  // Convert to ranked items
  const items = await Promise.all(
    rankedScores.map(async (score) => {
      const asset = await aiAssets.getAssetById(score.assetId);
      return {
        id: score.assetId,
        name: asset?.name ?? "Unknown",
        type,
        score: score.score,
        rank: score.rank ?? 0,
        metrics: {
          taskCount: score.taskCount,
          successRate: score.successRate,
          avgCost: score.costPerTask,
        },
      };
    }),
  );

  return {
    type,
    items,
    total: items.length,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Top/Bottom Performers
// ============================================================================

export async function getTopPerformers(
  type: ScoreType,
  date: string,
  limit: number = 10,
): Promise<RankedItem[]> {
  const ranking = await generateRanking(type, date);
  return ranking.items.slice(0, limit);
}

export async function getBottomPerformers(
  type: ScoreType,
  date: string,
  limit: number = 10,
): Promise<RankedItem[]> {
  const ranking = await generateRanking(type, date);
  return ranking.items.slice(-limit).toReversed();
}

// ============================================================================
// Position Rankings (by assets)
// ============================================================================

export async function generatePositionRanking(date: string): Promise<RankingResult> {
  // Get all asset scores
  const allScores = await getScoresByDate(date);

  // Group by position
  const positionMap = new Map<string, { scores: AiScore[]; assetIds: Set<string> }>();

  for (const score of allScores) {
    const asset = await aiAssets.getAssetById(score.assetId);
    if (!asset?.positionId) {
      continue;
    }

    const existing = positionMap.get(asset.positionId);
    if (existing) {
      existing.scores.push(score);
      existing.assetIds.add(asset.id);
    } else {
      positionMap.set(asset.positionId, {
        scores: [score],
        assetIds: new Set([asset.id]),
      });
    }
  }

  // Calculate position scores
  const positionItems: RankedItem[] = [];

  for (const [positionId, data] of positionMap) {
    const avgScore = data.scores.reduce((sum, s) => sum + s.score, 0) / data.scores.length;
    const avgTaskCount = data.scores.reduce((sum, s) => sum + s.taskCount, 0) / data.scores.length;
    const avgSuccessRate =
      data.scores.reduce((sum, s) => sum + s.successRate, 0) / data.scores.length;
    const avgCost = data.scores.reduce((sum, s) => sum + s.costPerTask, 0) / data.scores.length;

    // Get position name from first asset
    const firstAsset = await aiAssets.getAssetById(Array.from(data.assetIds)[0]);

    positionItems.push({
      id: positionId,
      name: firstAsset?.positionId ?? `Position ${positionId}`,
      type: "position",
      score: Math.round(avgScore),
      rank: 0, // Will be assigned after sorting
      metrics: {
        taskCount: Math.round(avgTaskCount),
        successRate: avgSuccessRate,
        avgCost,
      },
    });
  }

  // Sort and assign ranks
  const sorted = positionItems.toSorted((a, b) => b.score - a.score);
  const ranked = sorted.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));

  return {
    type: "position",
    items: ranked,
    total: ranked.length,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Comparison Utilities
// ============================================================================

export interface ScoreComparison {
  assetId: string;
  currentScore: number;
  previousScore: number;
  change: number;
  changePercent: number;
}

export async function compareScores(
  assetId: string,
  currentDate: string,
  previousDate: string,
): Promise<ScoreComparison | null> {
  const { getScore } = await import("./scoring.js");
  const current = await getScore(assetId, currentDate);
  const previous = await getScore(assetId, previousDate);

  if (!current || !previous) {
    return null;
  }

  const change = current.score - previous.score;
  const changePercent = previous.score > 0 ? (change / previous.score) * 100 : 0;

  return {
    assetId,
    currentScore: current.score,
    previousScore: previous.score,
    change,
    changePercent,
  };
}

// ============================================================================
// Score Distribution
// ============================================================================

export interface ScoreDistribution {
  excellent: number; // 90-100
  good: number; // 70-89
  average: number; // 50-69
  poor: number; // 30-49
  critical: number; // 0-29
}

export function calculateScoreDistribution(scores: AiScore[]): ScoreDistribution {
  return {
    excellent: scores.filter((s) => s.score >= 90).length,
    good: scores.filter((s) => s.score >= 70 && s.score < 90).length,
    average: scores.filter((s) => s.score >= 50 && s.score < 70).length,
    poor: scores.filter((s) => s.score >= 30 && s.score < 50).length,
    critical: scores.filter((s) => s.score < 30).length,
  };
}
