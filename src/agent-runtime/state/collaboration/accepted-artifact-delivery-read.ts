import fs from "node:fs/promises";
import path from "node:path";
import { normalizeDeliveryTarget } from "../../policy/accepted-artifact-delivery.js";
import {
  readMemberArtifactDeliveryIntent,
  type MemberArtifactDeliveryIntent,
} from "./accepted-artifact-delivery-txn.js";

export type AcceptedArtifactDeliveryView = {
  phase: string;
  authorization: string | null;
  queueId: string | null;
  receiptMessageIds: string[] | null;
  keyHash: string | null;
};

export function viewAcceptedArtifactDelivery(
  intent: MemberArtifactDeliveryIntent | null,
): AcceptedArtifactDeliveryView {
  if (!intent) {
    return {
      phase: "missing",
      authorization: null,
      queueId: null,
      receiptMessageIds: null,
      keyHash: null,
    };
  }
  return {
    phase: intent.phase,
    authorization: intent.authorization,
    queueId: intent.queueId,
    receiptMessageIds: intent.receiptMessageIds,
    keyHash: intent.keyHash,
  };
}

/** Locate an intent by tenant/group/task/item/target. Pure state read. */
export async function findMemberArtifactDeliveryIntent(params: {
  rootDir: string;
  tenantId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  target: { channel: string; accountId?: string | null; to: string };
}): Promise<MemberArtifactDeliveryIntent | null> {
  const target = normalizeDeliveryTarget(params.target);
  if (!target) {
    return null;
  }
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(params.rootDir, "intents"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith(".intent.json")) {
      continue;
    }
    const intent = await readMemberArtifactDeliveryIntent(
      params.rootDir,
      name.slice(0, -".intent.json".length),
    );
    if (!intent) {
      continue;
    }
    const same =
      intent.tenantId === params.tenantId &&
      intent.groupId === params.groupId &&
      intent.taskId === params.taskId &&
      intent.itemId === params.itemId &&
      intent.normalizedTarget.channel === target.channel &&
      intent.normalizedTarget.accountId === target.accountId &&
      intent.normalizedTarget.to === target.to;
    if (same) {
      return intent;
    }
  }
  return null;
}

export async function readAcceptedArtifactDelivery(params: {
  tenantId: string;
  actorId: string;
  groupId: string;
  taskId: string;
  itemId: string;
  target: { channel: string; accountId?: string | null; to: string };
  rootDir: string;
}): Promise<{ ok: true; delivery: AcceptedArtifactDeliveryView } | { ok: false; reason: string }> {
  if (!params.tenantId.trim() || !params.actorId.trim() || !params.groupId.trim()) {
    return { ok: false, reason: "trusted_issuance_required" };
  }
  const intent = await findMemberArtifactDeliveryIntent({
    rootDir: params.rootDir,
    tenantId: params.tenantId,
    groupId: params.groupId,
    taskId: params.taskId,
    itemId: params.itemId,
    target: params.target,
  });
  return { ok: true, delivery: viewAcceptedArtifactDelivery(intent) };
}
