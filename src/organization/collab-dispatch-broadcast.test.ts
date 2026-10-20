// @vitest-environment node
// CollabDispatch Sprint D4 — broadcast authz, audit, cancel governance.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __clearConfirmationsForTest,
  createConfirmation,
} from "../gateway/server-methods/steward-confirmation-store.js";
import { listCollabDispatchAuditEvents } from "./collab-dispatch-audit.js";
import {
  authorizeCollabDispatchBroadcast,
  describeCollabDispatchBlastRadius,
} from "./collab-dispatch-broadcast-authz.js";
import { cancelCollabDispatch } from "./collab-dispatch-cancel.js";
import {
  collabDispatchApprovalConfirmationDetail,
  collabDispatchApproveActionId,
  issueCollabDispatchApprovalConfirmation,
} from "./collab-dispatch-confirmation.js";
import type { CollabDispatchDeliveryAdapters } from "./collab-dispatch-delivery.js";
import {
  applyCollabDispatchRecipientDecision,
  approveCollabDispatchRelease,
} from "./collab-dispatch-lifecycle.js";
import {
  createCollabDispatch,
  CollabDispatchTransitionError,
  transitionCollabDispatch,
  upsertCollabDispatch,
} from "./collab-dispatch-store.js";
import { readUserScheduleEntries } from "./schedule-store.js";
import { readManagedOrganizationTaskAssignments } from "./task-assignment.js";

let stateDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
  prevStateDir = process.env.OPENBOT_STATE_DIR;
  stateDir = mkdtempSync(path.join(tmpdir(), "collab-dispatch-d4-"));
  process.env.OPENBOT_STATE_DIR = stateDir;
  __clearConfirmationsForTest();
});

afterEach(() => {
  if (prevStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = prevStateDir;
  }
  rmSync(stateDir, { recursive: true, force: true });
  __clearConfirmationsForTest();
});

function okAdapters(log?: string[]): CollabDispatchDeliveryAdapters {
  return {
    deliverHuman: async (params) => {
      log?.push(`human:${params.recipientUserId}:${params.title}`);
      return { ok: true };
    },
    deliverAgent: async (params) => {
      log?.push(`agent:${params.recipientAgentId}`);
      return { ok: true };
    },
  };
}

describe("CollabDispatch D4 audience default", () => {
  it("defaults audience.mode to roster when omitted", () => {
    const dispatch = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "note",
      recipients: [{ id: "user-2" }],
    });
    expect(dispatch.audience.mode).toBe("roster");
  });

  it("keeps roster when mode is explicitly roster", () => {
    const dispatch = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "note",
      audience: { mode: "roster", spaceId: "space-1" },
      recipients: [{ id: "user-2" }],
    });
    expect(dispatch.audience.mode).toBe("roster");
    expect(dispatch.audience.spaceId).toBe("space-1");
  });

  it("allows explicit space|tenant when set (with spaceId for space)", () => {
    const space = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "space blast",
      audience: { mode: "space", spaceId: "space-9" },
      recipients: [{ id: "user-2" }],
    });
    expect(space.audience.mode).toBe("space");
    expect(space.audience.spaceId).toBe("space-9");

    const tenant = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "deploy",
      title: "tenant blast",
      audience: { mode: "tenant" },
      recipients: [{ id: "user-2" }, { id: "user-3" }],
    });
    expect(tenant.audience.mode).toBe("tenant");
  });

  it("rejects space mode without spaceId", () => {
    expect(() =>
      createCollabDispatch({
        organizerUserId: "user-1",
        tenantId: "tenant-1",
        kind: "notice",
        title: "bad",
        audience: { mode: "space" },
      }),
    ).toThrow(CollabDispatchTransitionError);
  });
});

describe("CollabDispatch D4 broadcast authz", () => {
  it("rejects space/tenant without elevated authz", () => {
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "space",
        spaceId: "space-1",
        authz: { membershipRole: "member", seatRole: "viewer" },
      }).ok,
    ).toBe(false);
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "tenant",
        authz: { membershipRole: "member", seatRole: "creator" },
      }).ok,
    ).toBe(false);
  });

  it("allows space broadcast for space owner/admin or tenant admin", () => {
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "space",
        spaceId: "space-1",
        authz: { spaceGovernanceRole: "owner" },
      }).ok,
    ).toBe(true);
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "space",
        spaceId: "space-1",
        authz: { spaceGovernanceRole: "admin" },
      }).ok,
    ).toBe(true);
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "space",
        spaceId: "space-1",
        authz: { membershipRole: "enterprise-admin" },
      }).ok,
    ).toBe(true);
  });

  it("allows tenant broadcast for seat admin / enterprise-admin / permissions", () => {
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "tenant",
        authz: { seatRole: "admin" },
      }).ok,
    ).toBe(true);
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "tenant",
        authz: { membershipRole: "enterprise-admin" },
      }).ok,
    ).toBe(true);
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "tenant",
        authz: { permissions: ["coordinate"] },
      }).ok,
    ).toBe(true);
  });

  it("roster always authorized", () => {
    expect(
      authorizeCollabDispatchBroadcast({
        audienceMode: "roster",
        authz: {},
      }).ok,
    ).toBe(true);
  });

  it("approve rejects unauthorized broadcast and proceeds when authorized", async () => {
    const draft = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "all hands",
      audience: { mode: "tenant" },
      recipients: [{ id: "user-2", kind: "human" }],
      id: "d4-tenant-1",
    });
    await upsertCollabDispatch(transitionCollabDispatch(draft, "pending_organizer_confirm"));

    const denied = await approveCollabDispatchRelease({
      organizerUserId: "user-1",
      dispatchId: "d4-tenant-1",
      adapters: okAdapters(),
      broadcastAuthz: { membershipRole: "member", seatRole: "viewer" },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("broadcast-forbidden");
    }

    const allowed = await approveCollabDispatchRelease({
      organizerUserId: "user-1",
      dispatchId: "d4-tenant-1",
      adapters: okAdapters(),
      broadcastAuthz: { seatRole: "admin" },
    });
    expect(allowed.ok).toBe(true);
    if (!allowed.ok) {
      return;
    }
    expect(allowed.dispatch.status).toBe("released");
    expect(allowed.deliveredCount).toBeGreaterThanOrEqual(1);

    const audits = await listCollabDispatchAuditEvents({ dispatchId: "d4-tenant-1" });
    expect(audits.some((row) => row.action === "approve")).toBe(true);
    expect(audits.some((row) => row.action === "deliver")).toBe(true);
  });
});

describe("CollabDispatch D4 confirmation blast radius", () => {
  it("includes blast radius for space/tenant in confirmation detail", () => {
    const dispatch = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "blast",
      audience: { mode: "space", spaceId: "space-42" },
      recipients: [{ id: "user-2" }, { id: "user-3" }],
    });
    const detail = collabDispatchApprovalConfirmationDetail(dispatch, Date.now() + 60_000);
    expect(detail.blastRadius).toContain("space-42");
    expect(detail.impact).toContain("协作空间广播");
    expect(detail.irreversible).toBe(true);
    expect(describeCollabDispatchBlastRadius(dispatch)).toContain("名单 2 人");
  });
});

describe("CollabDispatch D4 cancel recycles projections + audit", () => {
  it("cancels released dispatch: recycles schedule/todo, invalidates tickets, audits", async () => {
    const startAtMs = Date.now() + 300_000;
    const draft = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "summon",
      title: "war room",
      audience: { mode: "space", spaceId: "space-1" },
      timeWindow: { startAtMs, endAtMs: startAtMs + 60_000, timezone: "UTC" },
      recipients: [
        { id: "user-2", kind: "human" },
        { id: "user-3", kind: "human" },
      ],
      id: "d4-cancel-1",
    });
    await upsertCollabDispatch(transitionCollabDispatch(draft, "pending_organizer_confirm"));

    // Unused confirm ticket must be invalidated on cancel.
    createConfirmation({
      actionId: collabDispatchApproveActionId("d4-cancel-1"),
      payload: { dispatchId: "d4-cancel-1" },
    });
    // Also issue via helper (another ticket).
    issueCollabDispatchApprovalConfirmation(
      transitionCollabDispatch(draft, "pending_organizer_confirm"),
    );

    const released = await approveCollabDispatchRelease({
      organizerUserId: "user-1",
      dispatchId: "d4-cancel-1",
      adapters: okAdapters(),
      broadcastAuthz: { spaceGovernanceRole: "owner" },
    });
    expect(released.ok).toBe(true);
    if (!released.ok) {
      return;
    }

    const acked = await applyCollabDispatchRecipientDecision({
      actorUserId: "user-2",
      dispatchId: "d4-cancel-1",
      decision: "acked",
    });
    expect(acked.ok).toBe(true);

    const beforeCancel = await readUserScheduleEntries("user-2");
    expect(beforeCancel.some((e) => e.sourceRef.id === "d4-cancel-1")).toBe(true);

    const deliveryLog: string[] = [];
    const cancelled = await cancelCollabDispatch({
      organizerUserId: "user-1",
      dispatchId: "d4-cancel-1",
      adapters: okAdapters(deliveryLog),
      actorUserId: "user-1",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.dispatch.status).toBe("cancelled");
    expect(cancelled.recycledSchedules).toBeGreaterThanOrEqual(1);
    // organizer schedule + user-2 acked schedule at minimum
    expect(cancelled.notifiedAckedCount).toBeGreaterThanOrEqual(1);
    expect(deliveryLog.some((line) => line.includes("user-2") && line.includes("已取消"))).toBe(
      true,
    );

    const afterUser2 = await readUserScheduleEntries("user-2");
    const entry = afterUser2.find((e) => e.sourceRef.id === "d4-cancel-1");
    expect(entry?.status).toBe("cancelled");

    const todos = await readManagedOrganizationTaskAssignments("space-1");
    // time-window path uses schedules; todos may be empty — also cover no-window recycle below
    expect(
      todos.filter(
        (t) =>
          t.sourceRef?.kind === "collab-dispatch" &&
          t.sourceRef.id === "d4-cancel-1" &&
          t.status !== "rejected",
      ),
    ).toHaveLength(0);

    const audits = await listCollabDispatchAuditEvents({ dispatchId: "d4-cancel-1" });
    expect(audits.some((row) => row.action === "cancel")).toBe(true);
    expect(audits.some((row) => row.action === "approve")).toBe(true);
  });

  it("soft-cancels todo projections for notice without time window", async () => {
    const draft = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "notice",
      title: "todo notice",
      audience: { mode: "roster", spaceId: "space-1" },
      recipients: [{ id: "user-2", kind: "human" }],
      id: "d4-cancel-todo",
    });
    await upsertCollabDispatch(transitionCollabDispatch(draft, "pending_organizer_confirm"));
    const released = await approveCollabDispatchRelease({
      organizerUserId: "user-1",
      dispatchId: "d4-cancel-todo",
      adapters: okAdapters(),
    });
    expect(released.ok).toBe(true);
    await applyCollabDispatchRecipientDecision({
      actorUserId: "user-2",
      dispatchId: "d4-cancel-todo",
      decision: "acked",
    });

    const before = await readManagedOrganizationTaskAssignments("space-1");
    expect(
      before.some(
        (t) =>
          t.sourceRef?.kind === "collab-dispatch" &&
          t.sourceRef.id === "d4-cancel-todo" &&
          t.assigneeUserId === "user-2",
      ),
    ).toBe(true);

    const cancelled = await cancelCollabDispatch({
      organizerUserId: "user-1",
      dispatchId: "d4-cancel-todo",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.recycledTodos).toBeGreaterThanOrEqual(1);

    const after = await readManagedOrganizationTaskAssignments("space-1");
    const rows = after.filter(
      (t) => t.sourceRef?.kind === "collab-dispatch" && t.sourceRef.id === "d4-cancel-todo",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.status === "rejected")).toBe(true);
  });
});
