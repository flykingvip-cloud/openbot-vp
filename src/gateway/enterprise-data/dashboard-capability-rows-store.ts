// Enterprise Data Capability Center — home capability usage board aggregator.
// Spec: .kiro/specs/enterprise-data-capability-center/tasks.md (Task 2.2)
//
// Per-capability read-only aggregation, entirely in-store (no cross-store org
// resolution). Does NOT include "last run" (no runtime/audit rollup yet — Phase 4).

import { listInvocationAuditEvents } from "./audit-runtime.js";
import { resolveCapabilityGovernanceView } from "./capability-governance-store.js";
import { listDataCapabilities } from "./data-capability-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { buildConnectorActionRefKey, type EnterpriseDataStore } from "./types.js";

export type DataCapabilityUsageRow = {
  capabilityId: string;
  displayName: string;
  /** Source display names backing this capability (via sourceIds). */
  sourceNames: string[];
  /** Human labels of access-scope policies touching this capability (in-store displayName). */
  targetLabels: string[];
  /** Produced knowledge objects (feed items) across this capability's projections. */
  knowledgeObjectCount: number;
  enabled: boolean;
  /** Latest invocation timestamp across this capability's actionRefs (real audit data); null if never run. */
  lastRunAt: string | null;
};

export function resolveDataCapabilityUsageRows(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  /** Top N by knowledgeObjectCount (default 10). */
  limit?: number;
}): DataCapabilityUsageRow[] {
  const { store, tenantId } = params;
  const limit = params.limit ?? 10;

  const capabilities = listDataCapabilities({ store, tenantId });

  // 预聚合：每个 action ref → 最近一次调用时间戳（真实审计数据）。
  const lastRunByActionKey = new Map<string, string>();
  for (const event of listInvocationAuditEvents({ store, tenantId, limit: 1000 })) {
    const key = buildConnectorActionRefKey(event);
    const existing = lastRunByActionKey.get(key);
    if (!existing || event.timestamp > existing) {
      lastRunByActionKey.set(key, event.timestamp);
    }
  }

  const rows: DataCapabilityUsageRow[] = capabilities.map((capability) => {
    const view = resolveCapabilityGovernanceView({
      store,
      tenantId,
      capabilityId: capability.capabilityId,
    });

    const sourceNames = view.sourceMappings.map((mapping) => mapping.source.displayName);

    // 去重的策略人类标签（in-store，不依赖跨库组织映射）。
    const targetLabels = [
      ...new Set(view.accessScope.policies.map((policy) => policy.displayName)),
    ];

    // 该能力所有 projection 产出的知识对象（feed item）总数。
    const knowledgeObjectCount = view.projectionSpecs.reduce(
      (total, spec) =>
        total + listKnowledgeFeedItems({ store, tenantId, projectionId: spec.projectionId }).length,
      0,
    );

    // 最近运行：该能力任一 actionRef 的最新调用时间戳。
    let lastRunAt: string | null = null;
    for (const ref of capability.actionRefs) {
      const ts = lastRunByActionKey.get(buildConnectorActionRefKey(ref));
      if (ts && (!lastRunAt || ts > lastRunAt)) {
        lastRunAt = ts;
      }
    }

    return {
      capabilityId: capability.capabilityId,
      displayName: capability.displayName,
      sourceNames,
      targetLabels,
      knowledgeObjectCount,
      enabled: capability.enabled,
      lastRunAt,
    };
  });

  return rows
    .toSorted((left, right) => {
      if (right.knowledgeObjectCount !== left.knowledgeObjectCount) {
        return right.knowledgeObjectCount - left.knowledgeObjectCount;
      }
      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, limit);
}
