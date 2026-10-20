export type GroupMetrics = {
  collaborationEfficiency: number;
  deliveryStability: number;
  botNoiseRatio: number;
  memoryCompleteness: number;
};

export type RecommendationPriority = "low" | "medium" | "high";

export type Recommendation = {
  recommendationId: string;
  category: string;
  priority: RecommendationPriority;
  title: string;
  description: string;
  actionable: boolean;
};

export type GroupHealth = {
  groupId: string;
  overallScore: number;
  metrics: GroupMetrics;
  recommendations: Recommendation[];
  calculatedAt: number;
};
