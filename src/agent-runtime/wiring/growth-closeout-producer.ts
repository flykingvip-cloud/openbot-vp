import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { listTenantRobotSkillAssets } from "../../gateway/skill-lifecycle-store.js";
import {
  resolveTenantAgentDirForContext,
  assertWithinTenantRoot,
} from "../../gateway/tenant-store-paths.js";
import type { RuntimeSqlClient } from "../state/postgres/execution.js";
import { enqueueOperationalGrowth } from "../state/postgres/growth-event-producer.js";
import { createGrowthServiceAuthorizer } from "../state/postgres/growth-service-authority.js";
import { rebuildOperationalMetrics } from "../state/postgres/operational-metrics.js";

/** Refuse legacy/global metric sources that do not coincide with authorized tenant storage. */
export async function captureAuthorizedCloseoutGrowth(input: {
  db: RuntimeSqlClient;
  cfg: OpenBotConfig;
  tenantId: string;
  executionId: string;
  agentId: string;
  principalId: string;
}) {
  const grant = await createGrowthServiceAuthorizer(input.db, input.tenantId, input.principalId)();
  if (!grant.agentIds.includes(input.agentId)) {
    throw new Error("Growth producer agent grant missing");
  }
  const authorized = resolveTenantAgentDirForContext(grant.context, input.agentId);
  assertWithinTenantRoot(grant.context, authorized);
  const configured = resolveAgentDir(input.cfg, input.agentId);
  if (path.resolve(configured) !== path.resolve(authorized)) {
    throw new Error("Growth metric source does not match authorized tenant agent directory");
  }
  const metrics = await rebuildOperationalMetrics(input.db, {
    tenantId: input.tenantId,
    agentId: input.agentId,
  });
  const installedSkillKeys = listTenantRobotSkillAssets({
    tenantId: input.tenantId,
    userId: grant.context.userId,
    agentId: input.agentId,
  })
    .filter((entry) => entry.enabled)
    .flatMap((entry) => [entry.id]);
  return { metrics, observedAtMs: metrics.updatedAtMs, installedSkillKeys };
}

export async function produceCloseoutGrowth(
  input: Parameters<typeof captureAuthorizedCloseoutGrowth>[0],
): Promise<void> {
  const snapshot = await captureAuthorizedCloseoutGrowth(input);
  await enqueueOperationalGrowth(input.db, {
    tenantId: input.tenantId,
    executionId: input.executionId,
    eventId: `growth-closeout:${input.executionId}`,
    agentId: input.agentId,
    ...snapshot,
  });
}
