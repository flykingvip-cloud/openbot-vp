import {
  findDeliverableArchiveByLogicalId,
  getDeliverableArchiveRecord,
  type DeliverableArchiveLookup,
} from "./archive-store.js";
import { resolveSaveArchiveDeliverableId } from "./save-and-archive.js";

/** Chip restore reads archive-store only. Conversation preview never uses this path. */
export function lookupDeliverableArchiveStatus(params: {
  knowledgeBaseId: string;
  deliverableId?: string | null;
  logicalId?: string | null;
  storePath?: string;
}): DeliverableArchiveLookup | null {
  const persistableId = resolveSaveArchiveDeliverableId({
    clientDeliverableId: params.deliverableId,
    captureDeliverableId: null,
    captureSkillId: null,
  });
  if (persistableId) {
    const record = getDeliverableArchiveRecord(persistableId, params.storePath);
    if (record && record.knowledgeBaseId === params.knowledgeBaseId) {
      return { deliverableId: persistableId, record };
    }
  }
  const logicalId = params.logicalId?.trim() || "";
  if (!logicalId) {
    return null;
  }
  return findDeliverableArchiveByLogicalId({
    knowledgeBaseId: params.knowledgeBaseId,
    logicalId,
    storePath: params.storePath,
  });
}
