import path from "node:path";
import { tenantPartition } from "./cognitive-approval-grant-store.js";
import { writeJsonDurable } from "./cognitive-file-lock.js";
import { resolveCognitiveRecoveryRecordRoot } from "./paths.js";
import { assertSafeRecoveryReceiptToken } from "./recovery-receipt.js";

export type CognitiveRecoveryAlert = {
  kind: "cognitive_recovery_alert";
  mergeId: string;
  tenantId: string | null;
  reason: string;
  createdAt: string;
};

export function appendCognitiveRecoveryAlert(params: {
  mergeId: string;
  tenantId: string | null;
  stateDir: string;
  reason: string;
}): void {
  const mergeId = assertSafeRecoveryReceiptToken(params.mergeId, "operationId");
  const partition = assertSafeRecoveryReceiptToken(tenantPartition(params.tenantId), "operationId");
  const dest = path.resolve(
    resolveCognitiveRecoveryRecordRoot(params.stateDir),
    partition,
    `${mergeId}-${Date.now()}.json`,
  );
  writeJsonDurable(dest, {
    kind: "cognitive_recovery_alert",
    mergeId,
    tenantId: params.tenantId,
    reason: params.reason,
    createdAt: new Date().toISOString(),
  } satisfies CognitiveRecoveryAlert);
}
