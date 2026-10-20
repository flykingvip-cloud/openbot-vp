// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMeeting } from "../organization/meeting-store.js";
import {
  registerEnterpriseIdentity,
  upsertEmployeeEnterpriseIdentityEnrollment,
  upsertIdentityUsagePolicy,
} from "./enterprise-operational-identity-store.js";
import { normalizeEnterpriseSeatAssetsStore } from "./enterprise-seat-assets-backend.js";
import {
  registerConnectorCredentialBinding,
  type EnterpriseSeatAssetsStore,
} from "./enterprise-seat-assets-store.js";
import {
  maybeCancelTencentMeetingForMeeting,
  maybeProvisionTencentMeetingForMeeting,
  shouldAutoProvisionTencentMeeting,
} from "./meeting-tencent-meeting-bridge.js";

const executeMock = vi.hoisted(() => vi.fn());
const loadStoreMock = vi.hoisted(() => vi.fn());
const saveStoreMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));

vi.mock("./enterprise-operational-identity-execution.js", () => ({
  executeEnterpriseOperationalIdentityAction: executeMock,
}));

vi.mock("./enterprise-seat-assets-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-seat-assets-store.js")>();
  return {
    ...actual,
    loadEnterpriseSeatAssetsStore: (...args: unknown[]) => loadStoreMock(...args),
    saveEnterpriseSeatAssetsStore: (...args: unknown[]) => saveStoreMock(...args),
  };
});

vi.mock("./tenant-context.js", () => ({
  resolveControlPlaneStorePathForTenantId: vi.fn(() => "/tmp/oi-meeting-bridge-test-store.json"),
}));

const NOW = "2026-09-25T00:00:00.000Z";

function createStore(): EnterpriseSeatAssetsStore {
  return normalizeEnterpriseSeatAssetsStore(null, 4);
}

function seedTencentMeetingIdentity(
  store: EnterpriseSeatAssetsStore,
  params?: { enroll?: boolean; policyActions?: string[] },
): string {
  store.seats["seat-1"] = {
    seatId: "seat-1",
    tenantId: "tenant-a",
    title: "Ops",
    status: "occupied",
    defaultSpaceIds: [],
    defaultAgentAssetIds: ["main"],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const credential = registerConnectorCredentialBinding({
    store,
    tenantId: "tenant-a",
    connectorId: "tencent-meeting",
    ownerType: "seat",
    ownerId: "seat-1",
    nowIso: NOW,
  });
  const identity = registerEnterpriseIdentity({
    store,
    tenantId: "tenant-a",
    displayName: "腾讯会议",
    credentialBindingId: credential.credentialBindingId,
    nowIso: NOW,
  });
  if (!identity.ok) {
    throw new Error("failed to register tencent meeting identity");
  }
  upsertIdentityUsagePolicy({
    store,
    tenantId: "tenant-a",
    identityId: identity.identity.identityId,
    seatIds: ["seat-1"],
    allowedAgentIds: [],
    allowedActions: params?.policyActions ?? [
      "schedule_meeting",
      "cancel_meeting",
      "list_meetings",
    ],
    nowIso: NOW,
  });
  if (params?.enroll) {
    upsertEmployeeEnterpriseIdentityEnrollment({
      store,
      tenantId: "tenant-a",
      employeeId: "u1",
      agentId: "main",
      identityId: identity.identity.identityId,
      allowedActions: ["schedule_meeting", "cancel_meeting", "list_meetings"],
      nowIso: NOW,
    });
  }
  return identity.identity.identityId;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveStoreMock.mockResolvedValue(undefined);
});

describe("shouldAutoProvisionTencentMeeting", () => {
  it("detects online location labels", () => {
    const meeting = createMeeting({
      organizerUserId: "u1",
      title: "Sync",
      startAtMs: 1,
      location: "线上",
    });
    expect(shouldAutoProvisionTencentMeeting(meeting)).toBe(true);
    expect(shouldAutoProvisionTencentMeeting(meeting, false)).toBe(false);
  });

  it("skips when joinUrl already set", () => {
    const meeting = createMeeting({
      organizerUserId: "u1",
      title: "Sync",
      startAtMs: 1,
      joinUrl: "https://meet.example/x",
      location: "线上",
    });
    expect(shouldAutoProvisionTencentMeeting(meeting)).toBe(false);
  });

  it("respects explicit meetingMode=online without location label", () => {
    const meeting = createMeeting({
      organizerUserId: "u1",
      title: "Sync",
      startAtMs: 1,
      meetingMode: "online",
    });
    expect(shouldAutoProvisionTencentMeeting(meeting)).toBe(true);
  });

  it("respects explicit meetingMode=offline even when location looks online", () => {
    const meeting = createMeeting({
      organizerUserId: "u1",
      title: "Sync",
      startAtMs: 1,
      meetingMode: "offline",
      location: "线上",
    });
    expect(shouldAutoProvisionTencentMeeting(meeting)).toBe(false);
  });
});

describe("maybeProvisionTencentMeetingForMeeting PDP coverage", () => {
  it("fills joinUrl when enrolled (allow path goes through computeEffectiveAccess)", async () => {
    const store = createStore();
    seedTencentMeetingIdentity(store, { enroll: true });
    loadStoreMock.mockResolvedValue(store);
    executeMock.mockResolvedValueOnce({
      ok: true,
      provider: "tencent-meeting",
      action: "schedule_meeting",
      executionId: "exec-1",
      output: {
        meetingId: "7567173273889276131",
        meetingCode: "123456789",
        joinUrl: "https://meeting.tencent.com/dm/abc",
      },
    });
    const meeting = createMeeting({
      organizerUserId: "u1",
      tenantId: "tenant-a",
      title: "Weekly",
      startAtMs: 1_700_000_000_000,
      location: "腾讯会议",
    });
    const result = await maybeProvisionTencentMeetingForMeeting({
      meeting,
      ctx: {
        tenantId: "tenant-a",
        seatId: "seat-1",
        agentId: "main",
        actorEmployeeId: "u1",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.meeting.joinUrl).toBe("https://meeting.tencent.com/dm/abc");
      expect(result.meeting.externalMeetingProvider).toBe("tencent-meeting");
      expect(result.meeting.externalMeetingId).toBe("7567173273889276131");
    }
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "schedule_meeting",
        payload: expect.objectContaining({
          subject: "Weekly",
          startTime: Math.floor(1_700_000_000_000 / 1000),
        }),
      }),
    );
  });

  it("denies schedule_meeting with OWNER_GRANT_REQUIRED when zero enrollment (bypass gone)", async () => {
    const store = createStore();
    seedTencentMeetingIdentity(store, { enroll: false });
    loadStoreMock.mockResolvedValue(store);
    const meeting = createMeeting({
      organizerUserId: "u1",
      tenantId: "tenant-a",
      title: "Weekly",
      startAtMs: 1_700_000_000_000,
      location: "腾讯会议",
    });
    const result = await maybeProvisionTencentMeetingForMeeting({
      meeting,
      ctx: {
        tenantId: "tenant-a",
        seatId: "seat-1",
        agentId: "main",
        actorEmployeeId: "u1",
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("policy_denied");
      expect(result.detail).toMatch(/OWNER_GRANT_REQUIRED/);
    }
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("denies cancel_meeting with OWNER_GRANT_REQUIRED when zero enrollment", async () => {
    const store = createStore();
    seedTencentMeetingIdentity(store, { enroll: false });
    loadStoreMock.mockResolvedValue(store);
    const meeting = createMeeting({
      organizerUserId: "u1",
      tenantId: "tenant-a",
      title: "Weekly",
      startAtMs: 1_700_000_000_000,
      location: "腾讯会议",
      joinUrl: "https://meeting.tencent.com/dm/abc",
    });
    meeting.externalMeetingProvider = "tencent-meeting";
    meeting.externalMeetingId = "7567173273889276131";
    const result = await maybeCancelTencentMeetingForMeeting({
      meeting,
      ctx: {
        tenantId: "tenant-a",
        seatId: "seat-1",
        agentId: "main",
        actorEmployeeId: "u1",
      },
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/OWNER_GRANT_REQUIRED/);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
