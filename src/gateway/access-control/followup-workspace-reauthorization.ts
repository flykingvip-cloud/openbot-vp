/**
 * Access-control plane entry for followup workspace reauthorization.
 *
 * Tenant, ownership, or permission changes stay in `reauthorization_required`
 * until this existing grant/confirmation surface is given authorization
 * evidence. It is a thin wrapper around the durable resume entry, not a
 * parallel UI or a second policy engine. Gateway boot must not call this
 * without a grant.
 */
import type { ResumeFollowupDeliveryAfterReauthorizationResult } from "../../agent-runtime/state/index.js";
import { resumeFollowupDeliveryAfterReauthorization } from "../../agent-runtime/state/index.js";
import type { FollowupReauthorizationGrant } from "../../auto-reply/reply/followup-workspace-change.js";
import type { OpenBotConfig } from "../../config/config.js";

export type ConfirmAccessReauthorizationParams = {
  persistRoot: string;
  cfg?: OpenBotConfig;
  id?: string;
  runId?: string;
  deliveryId?: string;
  jobId?: string;
  sessionKey?: string;
  /**
   * Authorization evidence from the access-control / grant confirmation
   * path. A missing or invalid grant must not continue delivery.
   */
  authorization?: FollowupReauthorizationGrant | null;
};

/**
 * Production control-plane hook used when a tenant, ownership, or permission
 * change has been reauthorized. Callers must go through this function (not
 * only the lower-level resume entry) so grant checks stay on the existing
 * authorization surface.
 */
export async function confirmAccessReauthorization(
  params: ConfirmAccessReauthorizationParams,
): Promise<ResumeFollowupDeliveryAfterReauthorizationResult> {
  return resumeFollowupDeliveryAfterReauthorization({
    persistRoot: params.persistRoot,
    cfg: params.cfg,
    id: params.id,
    runId: params.runId,
    deliveryId: params.deliveryId,
    jobId: params.jobId,
    sessionKey: params.sessionKey,
    authorization: params.authorization,
  });
}
