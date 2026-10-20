import { BUILTIN_STEWARD_AGENT_ID } from "../agents/builtin-steward/identity.js";
import { isOnlineMeeting } from "../organization/meeting-mode.js";
import type { Meeting } from "../organization/meeting-store.js";
import type { EmployeeWorkbenchActor } from "./employee-workbench-scope.js";
import { listOperationalIdentityAccessForSeatAgent } from "./enterprise-operational-identity-access.js";
import { executeEnterpriseOperationalIdentityAction } from "./enterprise-operational-identity-execution.js";
import {
  computeEffectiveAccess,
  computeEffectiveAccessEntries,
} from "./enterprise-operational-identity-runtime.js";
import {
  getTenantEnterpriseIdentity,
  refreshEnterpriseIdentityStatus,
} from "./enterprise-operational-identity-store.js";
import { logTencentMeetingScheduleOutbound } from "./enterprise-operational-identity-tencent-meeting-logging.js";
import {
  loadEnterpriseSeatAssetsStore,
  saveEnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import { resolveControlPlaneStorePathForTenantId } from "./tenant-context.js";
import { TENANT_SEAT_ASSETS_FILE } from "./tenant-store-paths.js";

export type MeetingTencentMeetingBridgeContext = {
  tenantId: string;
  seatId: string;
  agentId: string;
  actorEmployeeId?: string;
};

export type MeetingTencentMeetingProvisionResult =
  | {
      ok: true;
      meeting: Meeting;
      identityId: string;
      joinUrl: string;
      externalMeetingId?: string;
      externalMeetingCode?: string;
    }
  | {
      ok: false;
      reason:
        | "skipped"
        | "no_context"
        | "no_identity"
        | "policy_denied"
        | "execution_failed"
        | "missing_join_url";
      detail?: string;
      meeting: Meeting;
    };

export function shouldAutoProvisionTencentMeeting(meeting: Meeting, explicit?: boolean): boolean {
  if (meeting.joinUrl?.trim()) {
    return false;
  }
  if (explicit === false) {
    return false;
  }
  if (explicit === true) {
    return true;
  }
  // Prefer explicit meetingMode; location regex is legacy compat only.
  return isOnlineMeeting(meeting);
}

export function resolveMeetingTencentMeetingBridgeContext(params: {
  actor: EmployeeWorkbenchActor;
  agentId?: string;
}): MeetingTencentMeetingBridgeContext | null {
  const tenantId = params.actor.tenantId?.trim();
  const seatId = params.actor.currentSeatId?.trim();
  if (!tenantId || !seatId) {
    return null;
  }
  const agentId = params.agentId?.trim() || BUILTIN_STEWARD_AGENT_ID;
  return {
    tenantId,
    seatId,
    agentId,
    actorEmployeeId: params.actor.userId,
  };
}

function resolveTencentMeetingIdentity(params: {
  store: Awaited<ReturnType<typeof loadEnterpriseSeatAssetsStore>>;
  ctx: MeetingTencentMeetingBridgeContext;
  action: string;
  nowIso: string;
}):
  | { ok: true; identityId: string; policyId: string }
  | { ok: false; reason: "no_identity" | "policy_denied"; detail?: string; code?: string } {
  const employeeId = params.ctx.actorEmployeeId?.trim();
  if (!employeeId) {
    // High-risk meeting side effects require an employee scope so PDP can evaluate enrollment.
    return {
      ok: false,
      reason: "policy_denied",
      code: "OWNER_GRANT_REQUIRED",
      detail: "缺少员工上下文，无法完成企业身份授权校验。",
    };
  }

  const scope = {
    tenantId: params.ctx.tenantId,
    seatId: params.ctx.seatId,
    agentId: params.ctx.agentId,
    employeeId,
  };

  // Allow path: only identities whose EffectiveAccess (unique PDP) still includes the action.
  const effectiveEntries = computeEffectiveAccessEntries({
    store: params.store,
    scope,
    nowIso: params.nowIso,
  }).filter(
    (entry) => entry.provider === "tencent-meeting" && entry.allowedActions.includes(params.action),
  );
  for (const entry of effectiveEntries) {
    const access = computeEffectiveAccess({
      store: params.store,
      tenantId: scope.tenantId,
      seatId: scope.seatId,
      agentId: scope.agentId,
      employeeId: scope.employeeId,
      identityId: entry.identityId,
      action: params.action,
      nowIso: params.nowIso,
    });
    if (access.allowed) {
      return { ok: true, identityId: entry.identityId, policyId: access.policy.policyId };
    }
  }

  // No EffectiveAccess hit. Discover seat-policy candidates so high-risk + zero enrollment
  // surfaces OWNER_GRANT_REQUIRED (policy_denied) instead of a silent no_identity.
  const policyCandidates = listOperationalIdentityAccessForSeatAgent({
    store: params.store,
    tenantId: params.ctx.tenantId,
    seatId: params.ctx.seatId,
    agentId: params.ctx.agentId,
    nowIso: params.nowIso,
  }).filter(
    (entry) => entry.provider === "tencent-meeting" && entry.allowedActions.includes(params.action),
  );
  if (policyCandidates.length === 0) {
    return { ok: false, reason: "no_identity" };
  }

  let denial: { code: string; message: string } | undefined;
  for (const candidate of policyCandidates) {
    const access = computeEffectiveAccess({
      store: params.store,
      tenantId: scope.tenantId,
      seatId: scope.seatId,
      agentId: scope.agentId,
      employeeId: scope.employeeId,
      identityId: candidate.identityId,
      action: params.action,
      nowIso: params.nowIso,
    });
    if (access.allowed) {
      return { ok: true, identityId: candidate.identityId, policyId: access.policy.policyId };
    }
    denial = { code: access.code, message: access.message };
    if (access.code === "OWNER_GRANT_REQUIRED") {
      break;
    }
  }
  return {
    ok: false,
    reason: "policy_denied",
    code: denial?.code,
    detail: denial?.message ?? "策略未授权该腾讯会议动作。",
  };
}

function meetingEndAtSeconds(meeting: Meeting): number {
  if (meeting.endAtMs != null && Number.isFinite(meeting.endAtMs)) {
    return Math.floor(meeting.endAtMs / 1000);
  }
  return Math.floor(meeting.startAtMs / 1000) + 3600;
}

function enrichMeetingWithExternalTencentMeeting(
  meeting: Meeting,
  output: Record<string, unknown>,
): Meeting {
  const joinUrl = typeof output.joinUrl === "string" ? output.joinUrl.trim() : "";
  if (!joinUrl) {
    return meeting;
  }
  const externalMeetingId =
    typeof output.meetingId === "string" ? output.meetingId.trim() : undefined;
  const externalMeetingCode =
    typeof output.meetingCode === "string" ? output.meetingCode.trim() : undefined;
  return {
    ...meeting,
    joinUrl,
    ...(externalMeetingId
      ? {
          externalMeetingProvider: "tencent-meeting",
          externalMeetingId,
          ...(externalMeetingCode ? { externalMeetingCode } : {}),
        }
      : {}),
    updatedAt: new Date().toISOString(),
  };
}

export async function maybeProvisionTencentMeetingForMeeting(params: {
  meeting: Meeting;
  ctx: MeetingTencentMeetingBridgeContext | null;
  explicit?: boolean;
}): Promise<MeetingTencentMeetingProvisionResult> {
  if (!shouldAutoProvisionTencentMeeting(params.meeting, params.explicit)) {
    return { ok: false, reason: "skipped", meeting: params.meeting };
  }
  if (!params.ctx) {
    return {
      ok: false,
      reason: "no_context",
      detail: "缺少 tenant/seat 上下文，无法调用腾讯会议企业身份。",
      meeting: params.meeting,
    };
  }
  const nowIso = new Date().toISOString();
  const storePath = resolveControlPlaneStorePathForTenantId(
    params.ctx.tenantId,
    TENANT_SEAT_ASSETS_FILE,
  );
  const store = await loadEnterpriseSeatAssetsStore(storePath);
  const resolved = resolveTencentMeetingIdentity({
    store,
    ctx: params.ctx,
    action: "schedule_meeting",
    nowIso,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      detail:
        resolved.code && resolved.detail
          ? `${resolved.code}: ${resolved.detail}`
          : (resolved.detail ?? resolved.code),
      meeting: params.meeting,
    };
  }
  refreshEnterpriseIdentityStatus({
    store,
    tenantId: params.ctx.tenantId,
    identityId: resolved.identityId,
    nowIso,
  });
  const identity = getTenantEnterpriseIdentity(store, params.ctx.tenantId, resolved.identityId);
  if (!identity) {
    return { ok: false, reason: "no_identity", meeting: params.meeting };
  }
  const startTime = Math.floor(params.meeting.startAtMs / 1000);
  const endTime = meetingEndAtSeconds(params.meeting);
  logTencentMeetingScheduleOutbound({
    channel: "bridge",
    action: "schedule_meeting",
    meetingId: params.meeting.id,
    subject: params.meeting.title,
    startAtMs: params.meeting.startAtMs,
    startTime,
    endTime,
    timeZone: params.meeting.timezone,
  });
  const execution = await executeEnterpriseOperationalIdentityAction({
    store,
    tenantId: params.ctx.tenantId,
    identity,
    action: "schedule_meeting",
    payload: {
      subject: params.meeting.title,
      startTime,
      endTime,
      timeZone: params.meeting.timezone,
    },
    seatId: params.ctx.seatId,
    agentId: params.ctx.agentId,
    policyId: resolved.policyId,
    actorEmployeeId: params.ctx.actorEmployeeId,
    nowIso,
  });
  await saveEnterpriseSeatAssetsStore(storePath, store);
  if (!execution.ok) {
    return {
      ok: false,
      reason: "execution_failed",
      detail: execution.message,
      meeting: params.meeting,
    };
  }
  const output = execution.output ?? {};
  const enriched = enrichMeetingWithExternalTencentMeeting(params.meeting, output);
  const joinUrl = enriched.joinUrl?.trim();
  if (!joinUrl) {
    return {
      ok: false,
      reason: "missing_join_url",
      detail: "腾讯会议 API 未返回 joinUrl。",
      meeting: params.meeting,
    };
  }
  return {
    ok: true,
    meeting: enriched,
    identityId: resolved.identityId,
    joinUrl,
    externalMeetingId: enriched.externalMeetingId,
    externalMeetingCode: enriched.externalMeetingCode,
  };
}

export async function maybeCancelTencentMeetingForMeeting(params: {
  meeting: Meeting;
  ctx: MeetingTencentMeetingBridgeContext | null;
}): Promise<{ ok: boolean; detail?: string }> {
  if (
    params.meeting.externalMeetingProvider !== "tencent-meeting" ||
    !params.meeting.externalMeetingId?.trim()
  ) {
    return { ok: true };
  }
  if (!params.ctx) {
    return { ok: false, detail: "缺少 tenant/seat 上下文，无法取消腾讯会议。" };
  }
  const nowIso = new Date().toISOString();
  const storePath = resolveControlPlaneStorePathForTenantId(
    params.ctx.tenantId,
    TENANT_SEAT_ASSETS_FILE,
  );
  const store = await loadEnterpriseSeatAssetsStore(storePath);
  const resolved = resolveTencentMeetingIdentity({
    store,
    ctx: params.ctx,
    action: "cancel_meeting",
    nowIso,
  });
  if (!resolved.ok) {
    const detail = resolved.detail ?? "未找到可用的腾讯会议企业身份或策略未授权 cancel_meeting。";
    return {
      ok: false,
      detail: resolved.code ? `${resolved.code}: ${detail}` : detail,
    };
  }
  refreshEnterpriseIdentityStatus({
    store,
    tenantId: params.ctx.tenantId,
    identityId: resolved.identityId,
    nowIso,
  });
  const identity = getTenantEnterpriseIdentity(store, params.ctx.tenantId, resolved.identityId);
  if (!identity) {
    return { ok: false, detail: "腾讯会议企业身份不存在。" };
  }
  const execution = await executeEnterpriseOperationalIdentityAction({
    store,
    tenantId: params.ctx.tenantId,
    identity,
    action: "cancel_meeting",
    payload: {
      meetingId: params.meeting.externalMeetingId,
    },
    seatId: params.ctx.seatId,
    agentId: params.ctx.agentId,
    policyId: resolved.policyId,
    actorEmployeeId: params.ctx.actorEmployeeId,
    nowIso,
  });
  await saveEnterpriseSeatAssetsStore(storePath, store);
  if (!execution.ok) {
    return { ok: false, detail: execution.message };
  }
  return { ok: true };
}
