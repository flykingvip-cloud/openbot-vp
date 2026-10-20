import type { GroupMetrics, Recommendation } from "../types/health.js";

export function calculateOverallScore(metrics: GroupMetrics): number {
  return Math.round(
    metrics.collaborationEfficiency * 0.3 +
      metrics.deliveryStability * 0.3 +
      (100 - metrics.botNoiseRatio) * 0.2 +
      metrics.memoryCompleteness * 0.2,
  );
}

export function generateRecommendations(params: {
  groupId: string;
  metrics: GroupMetrics;
}): Recommendation[] {
  const { metrics } = params;
  const recommendations: Recommendation[] = [];
  let recId = 1;

  if (metrics.collaborationEfficiency < 50) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "collaboration",
      priority: "high",
      title: "提高协作效率",
      description:
        "当前协作效率较低。建议：1) 明确任务 owner；2) 设置合理的任务优先级；3) 及时更新任务状态。",
      actionable: true,
    });
  } else if (metrics.collaborationEfficiency < 70) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "collaboration",
      priority: "medium",
      title: "优化协作流程",
      description: "协作效率有提升空间。建议：1) 减少任务阻塞时间；2) 提高任务完成率。",
      actionable: true,
    });
  }

  if (metrics.deliveryStability < 50) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "delivery",
      priority: "high",
      title: "提高交付稳定性",
      description:
        "当前交付稳定性较低。建议：1) 确保交付物经过充分评审；2) 提高交付物发布率；3) 建立稳定的交付流程。",
      actionable: true,
    });
  } else if (metrics.deliveryStability < 70) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "delivery",
      priority: "medium",
      title: "优化交付流程",
      description: "交付稳定性有提升空间。建议：1) 减少交付物迭代次数；2) 提高首次交付质量。",
      actionable: true,
    });
  }

  if (metrics.botNoiseRatio > 70) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "noise",
      priority: "high",
      title: "降低机器人噪音",
      description:
        "机器人噪音率过高。建议：1) 增加人类主导的任务和交付物；2) 让机器人更多地扮演支持角色。",
      actionable: true,
    });
  } else if (metrics.botNoiseRatio > 50) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "noise",
      priority: "medium",
      title: "平衡人机协作",
      description: "建议增加人类在协作中的主导作用，让机器人更多地提供辅助支持。",
      actionable: true,
    });
  }

  if (metrics.memoryCompleteness < 30) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "memory",
      priority: "high",
      title: "建立群记忆",
      description:
        "当前群记忆不足。建议：1) 记录重要的群共识；2) 记录关键约束条件；3) 记录经验教训。",
      actionable: true,
    });
  } else if (metrics.memoryCompleteness < 60) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "memory",
      priority: "medium",
      title: "完善群记忆",
      description: "建议继续积累群记忆，特别是关键决策的上下文和经验教训。",
      actionable: true,
    });
  }

  if (
    metrics.collaborationEfficiency >= 70 &&
    metrics.deliveryStability >= 70 &&
    metrics.botNoiseRatio <= 50 &&
    metrics.memoryCompleteness >= 60
  ) {
    recommendations.push({
      recommendationId: `rec-${recId++}`,
      category: "general",
      priority: "low",
      title: "保持良好状态",
      description: "群健康度良好，继续保持当前的协作模式和流程。",
      actionable: false,
    });
  }

  return recommendations;
}
