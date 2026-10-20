// @vitest-environment node
// CollabDispatch Sprint D3 — deploy / notice / summon shared pipeline.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CollabDispatchDeliveryAdapters } from "./collab-dispatch-delivery.js";
import {
  applyCollabDispatchRecipientDecision,
  approveCollabDispatchRelease,
  releaseCollabDispatchSideEffects,
  submitCollabDispatch,
} from "./collab-dispatch-lifecycle.js";
import {
  type CollabDispatchKind,
  createCollabDispatch,
  transitionCollabDispatch,
  upsertCollabDispatch,
} from "./collab-dispatch-store.js";
import { readUserScheduleEntries } from "./schedule-store.js";
import { readManagedOrganizationTaskAssignments } from "./task-assignment.js";

let stateDir: string;
let prevStateDir: string | undefined;

beforeEach(() => {
  prevStateDir = process.env.OPENBOT_STATE_DIR;
  stateDir = mkdtempSync(path.join(tmpdir(), "collab-dispatch-d3-"));
  process.env.OPENBOT_STATE_DIR = stateDir;
});

afterEach(() => {
  if (prevStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = prevStateDir;
  }
  rmSync(stateDir, { recursive: true, force: true });
});

function okAdapters(): CollabDispatchDeliveryAdapters {
  return {
    deliverHuman: async () => ({ ok: true }),
    deliverAgent: async () => ({ ok: true }),
  };
}

async function releaseKind(params: {
  kind: CollabDispatchKind;
  id: string;
  withTimeWindow?: boolean;
  recipients?: Array<{ id: string; kind?: "human" | "agent" }>;
}) {
  const draft = createCollabDispatch({
    organizerUserId: "user-1",
    tenantId: "tenant-1",
    kind: params.kind,
    title: `${params.kind} title`,
    body: `${params.kind} body`,
    id: params.id,
    recipients: params.recipients ?? [
      { id: "user-2", kind: "human" },
      { id: "user-3", kind: "human" },
    ],
    ...(params.withTimeWindow
      ? {
          timeWindow: {
            startAtMs: Date.now() + 120_000,
            endAtMs: Date.now() + 180_000,
            timezone: "Asia/Shanghai",
          },
        }
      : {}),
    audience: { mode: "roster", spaceId: "space-1" },
  });
  await upsertCollabDispatch(transitionCollabDispatch(draft, "pending_organizer_confirm"));
  return approveCollabDispatchRelease({
    organizerUserId: "user-1",
    dispatchId: params.id,
    adapters: okAdapters(),
  });
}

describe.each(["deploy", "notice", "summon"] as const)(
  "CollabDispatch D3 kind=%s without time window → todo projection",
  (kind) => {
    it("release writes organizer todo only; no recipient projection before ack", async () => {
      const released = await releaseKind({ kind, id: `${kind}-todo`, withTimeWindow: false });
      expect(released.ok).toBe(true);
      if (!released.ok) {
        return;
      }
      expect(released.projectedCount).toBe(1);
      expect(released.dispatch.status).toBe("released");
      expect(released.dispatch.recipients.find((r) => r.id === "user-2")?.ackStatus).toBe(
        "pending",
      );
      expect(released.dispatch.recipients.find((r) => r.id === "user-2")?.deliveryStatus).toBe(
        "sent",
      );

      const todos = await readManagedOrganizationTaskAssignments("space-1");
      const orgTodos = todos.filter(
        (t) => t.sourceRef?.kind === "collab-dispatch" && t.sourceRef.id === `${kind}-todo`,
      );
      expect(orgTodos.some((t) => t.assigneeUserId === "user-1")).toBe(true);
      expect(orgTodos.some((t) => t.assigneeUserId === "user-2")).toBe(false);
      expect(orgTodos.some((t) => t.assigneeUserId === "user-3")).toBe(false);

      const schedules = await Promise.all([
        readUserScheduleEntries("user-1"),
        readUserScheduleEntries("user-2"),
        readUserScheduleEntries("user-3"),
      ]);
      for (const entries of schedules) {
        expect(entries.some((e) => e.sourceRef.id === `${kind}-todo`)).toBe(false);
      }
    });

    it("ack writes recipient todo; uses shared delivery helper statuses", async () => {
      const released = await releaseKind({ kind, id: `${kind}-ack`, withTimeWindow: false });
      expect(released.ok).toBe(true);
      if (!released.ok) {
        return;
      }
      const acked = await applyCollabDispatchRecipientDecision({
        actorUserId: "user-2",
        dispatchId: `${kind}-ack`,
        decision: "acked",
      });
      expect(acked.ok).toBe(true);
      if (!acked.ok) {
        return;
      }
      expect(acked.projected).toBe(true);
      expect(acked.projection?.mode).toBe("todo");

      const todos = await readManagedOrganizationTaskAssignments("space-1");
      const forDispatch = todos.filter(
        (t) => t.sourceRef?.kind === "collab-dispatch" && t.sourceRef.id === `${kind}-ack`,
      );
      expect(forDispatch.some((t) => t.assigneeUserId === "user-2")).toBe(true);
      expect(forDispatch.some((t) => t.assigneeUserId === "user-3")).toBe(false);

      const again = await applyCollabDispatchRecipientDecision({
        actorUserId: "user-2",
        dispatchId: `${kind}-ack`,
        decision: "acked",
      });
      expect(again.ok).toBe(true);
      const after = await readManagedOrganizationTaskAssignments("space-1");
      expect(
        after.filter(
          (t) =>
            t.sourceRef?.kind === "collab-dispatch" &&
            t.sourceRef.id === `${kind}-ack` &&
            t.assigneeUserId === "user-2",
        ),
      ).toHaveLength(1);
    });
  },
);

describe.each(["deploy", "notice", "summon"] as const)(
  "CollabDispatch D3 kind=%s with time window → ScheduleEntry",
  (kind) => {
    it("release writes organizer schedule only; recipient after ack", async () => {
      const released = await releaseKind({ kind, id: `${kind}-sched`, withTimeWindow: true });
      expect(released.ok).toBe(true);
      if (!released.ok) {
        return;
      }
      const org = await readUserScheduleEntries("user-1");
      const a2 = await readUserScheduleEntries("user-2");
      expect(
        org.some(
          (e) =>
            e.sourceRef.kind === "collab-dispatch" &&
            e.sourceRef.id === `${kind}-sched` &&
            e.kind === "notice" &&
            e.status === "confirmed",
        ),
      ).toBe(true);
      expect(a2.some((e) => e.sourceRef.id === `${kind}-sched`)).toBe(false);

      const todos = await readManagedOrganizationTaskAssignments("space-1");
      expect(
        todos.some(
          (t) => t.sourceRef?.kind === "collab-dispatch" && t.sourceRef.id === `${kind}-sched`,
        ),
      ).toBe(false);

      const acked = await applyCollabDispatchRecipientDecision({
        actorUserId: "user-2",
        dispatchId: `${kind}-sched`,
        decision: "acked",
      });
      expect(acked.ok).toBe(true);
      if (acked.ok) {
        expect(acked.projection?.mode).toBe("schedule");
      }
      const a2After = await readUserScheduleEntries("user-2");
      expect(
        a2After.some(
          (e) => e.sourceRef.id === `${kind}-sched` && e.sourceRef.kind === "collab-dispatch",
        ),
      ).toBe(true);
      const a3 = await readUserScheduleEntries("user-3");
      expect(a3.some((e) => e.sourceRef.id === `${kind}-sched`)).toBe(false);
    });
  },
);

describe("CollabDispatch D3 shared pipeline edges", () => {
  it("decline does not write recipient projection", async () => {
    const released = await releaseKind({
      kind: "notice",
      id: "notice-decline",
      withTimeWindow: false,
    });
    expect(released.ok).toBe(true);
    const declined = await applyCollabDispatchRecipientDecision({
      actorUserId: "user-2",
      dispatchId: "notice-decline",
      decision: "declined",
    });
    expect(declined.ok).toBe(true);
    if (declined.ok) {
      expect(declined.projected).toBe(false);
    }
    const todos = await readManagedOrganizationTaskAssignments("space-1");
    expect(
      todos.some((t) => t.sourceRef?.id === "notice-decline" && t.assigneeUserId === "user-2"),
    ).toBe(false);
  });

  it("agent recipients auto-ack on release and get projection", async () => {
    const released = await releaseKind({
      kind: "summon",
      id: "summon-agent",
      withTimeWindow: false,
      recipients: [
        { id: "user-2", kind: "human" },
        { id: "agent-bot-1", kind: "agent" },
      ],
    });
    expect(released.ok).toBe(true);
    if (!released.ok) {
      return;
    }
    expect(released.dispatch.recipients.find((r) => r.id === "agent-bot-1")?.ackStatus).toBe(
      "acked",
    );
    expect(released.dispatch.recipients.find((r) => r.id === "user-2")?.ackStatus).toBe("pending");
    const todos = await readManagedOrganizationTaskAssignments("space-1");
    expect(
      todos.some((t) => t.sourceRef?.id === "summon-agent" && t.assigneeUserId === "agent-bot-1"),
    ).toBe(true);
  });

  it("submit moves draft to pending_organizer_confirm", async () => {
    const draft = createCollabDispatch({
      organizerUserId: "user-1",
      tenantId: "tenant-1",
      kind: "deploy",
      title: "Ship",
      id: "deploy-submit",
      recipients: [{ id: "user-2" }],
    });
    await upsertCollabDispatch(draft);
    const submitted = await submitCollabDispatch({
      organizerUserId: "user-1",
      dispatchId: "deploy-submit",
    });
    expect(submitted.ok).toBe(true);
    if (submitted.ok) {
      expect(submitted.dispatch.status).toBe("pending_organizer_confirm");
    }
  });

  it("releaseCollabDispatchSideEffects uses injected delivery adapters", async () => {
    const pending = await upsertCollabDispatch(
      transitionCollabDispatch(
        createCollabDispatch({
          organizerUserId: "user-1",
          tenantId: "tenant-1",
          kind: "notice",
          title: "Adapter path",
          id: "notice-adapter",
          recipients: [{ id: "user-ok" }, { id: "user-fail" }],
          audience: { mode: "roster", spaceId: "space-1" },
        }),
        "pending_organizer_confirm",
      ),
    );
    const ready = await upsertCollabDispatch(transitionCollabDispatch(pending, "released"));
    const adapters: CollabDispatchDeliveryAdapters = {
      deliverHuman: async (params) =>
        params.recipientUserId === "user-fail" ? { ok: false, error: "boom" } : { ok: true },
      deliverAgent: async () => ({ ok: true }),
    };
    const effects = await releaseCollabDispatchSideEffects(ready, { adapters });
    expect(effects.dispatch.recipients.find((r) => r.id === "user-ok")?.deliveryStatus).toBe(
      "sent",
    );
    expect(effects.dispatch.recipients.find((r) => r.id === "user-fail")?.deliveryStatus).toBe(
      "failed",
    );
    expect(effects.deliveryProgress.deliveredCount).toBe(1);
    expect(effects.deliveryProgress.failedCount).toBe(1);
  });
});
