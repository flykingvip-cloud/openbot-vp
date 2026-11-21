import {
  withRuntimeDeadline,
  RUNTIME_SHUTDOWN_MS,
} from "../../agent-runtime/state/postgres/deadline.js";
import type { GrowthServiceGrant } from "../agent-growth/background-consumer-authority.js";
import {
  assertWithinTenantRoot,
  resolveTenantRuntimeStateRootForContext,
} from "../tenant-store-paths.js";
import { reconcileCommittedInvocationAudits } from "./reconcile-audit.js";

export function startInvocationAuditRecovery(input: {
  tenantId: string;
  authorize: () => Promise<GrowthServiceGrant>;
  onError: (error: unknown) => void;
  intervalMs?: number;
}) {
  const interval = input.intervalMs ?? 30000;
  if (!input.tenantId.trim() || !Number.isSafeInteger(interval) || interval < 1) {
    throw new Error("Invalid audit scheduler scope");
  }
  let stopped = false;
  let pending: Promise<void> | undefined;
  const tick = () => {
    if (stopped || pending) {
      return;
    }
    pending = (async () => {
      const grant = await input.authorize();
      if (stopped) {
        return;
      }
      if (
        !grant.principalId.trim() ||
        grant.context.tenantId !== input.tenantId ||
        !grant.context.userId.trim()
      ) {
        throw new Error("Audit scheduler authority mismatch");
      }
      const root = resolveTenantRuntimeStateRootForContext(grant.context);
      assertWithinTenantRoot(grant.context, root);
      reconcileCommittedInvocationAudits({
        tenantId: input.tenantId,
        userId: grant.context.userId,
        agentIds: grant.agentIds,
        configDir: root,
        limit: 100,
      });
    })()
      .catch((error) => {
        if (!stopped) {
          input.onError(error);
        }
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, interval);
  timer.unref();
  tick();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await withRuntimeDeadline(
        pending ?? Promise.resolve(),
        RUNTIME_SHUTDOWN_MS,
        "Audit scheduler shutdown",
      );
    },
  };
}
