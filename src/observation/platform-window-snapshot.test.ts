import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { createExecutionEvidenceStore } from "./execution-evidence-store.js";
import { queryPlatformObservationSnapshot } from "./platform-window-snapshot.js";

let dir = "";
let cfg: OpenBotConfig;
const time = Date.parse("2026-11-06T00:00:00Z");
const scope = {
  kind: "enterprise" as const,
  tenantId: "tenant",
  enterpriseDomainId: "domain",
  subjectRef: "subject:alice",
  authzScopeRef: "auth",
};
const row = (taskId: string, extra: Record<string, unknown> = {}) => ({
  taskId,
  outcomeVersion: 1,
  scope,
  lifecycle: "closed",
  taskJudgement: "success",
  decidedAt: new Date(time).toISOString(),
  acceptance: { status: "passed" },
  delivery: { status: "delivered" },
  runs: [
    { runId: "run", attemptIds: ["attempt"], effectiveAttemptId: "attempt", status: "succeeded" },
  ],
  attempts: [
    {
      attemptId: "attempt",
      runId: "run",
      status: "succeeded",
      observedAt: new Date(time).toISOString(),
    },
  ],
  ...extra,
});

describe("platform window snapshot", () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-window-"));
    cfg = { agents: { list: [{ id: "bot", agentDir: dir }] } } as OpenBotConfig;
    fs.mkdirSync(path.join(dir, "task-outcomes/tips"), { recursive: true });
    fs.mkdirSync(path.join(dir, "task-outcomes/versions"), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("stays unknown when the window has no attempted samples and does not invent 0%", () => {
    const snapshot = queryPlatformObservationSnapshot({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      executionStore: createExecutionEvidenceStore({ enabled: () => true, now: () => time + 1 }),
      activity: null,
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.coverage.attemptedCount).toBe(0);
    expect(snapshot.coverage.link).toBeNull();
    expect(snapshot.coverage.reasons).toContain("no_candidates");
    expect(snapshot.heartbeat.expectedSamples).toBeNull();
    expect(snapshot.heartbeat.observedSamples).toBeNull();
    expect(snapshot.capacity.concurrency.limit).toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain("subject:alice");
    expect(JSON.stringify(snapshot)).not.toContain("0%");
  });

  it("assembles coverage over the window cohort, not a single precise task id", () => {
    for (const taskId of ["task-a", "task-b"]) {
      const record = row(taskId);
      fs.writeFileSync(
        path.join(dir, "task-outcomes/tips", `${taskId}.json`),
        JSON.stringify(record),
      );
      fs.writeFileSync(
        path.join(dir, "task-outcomes/versions", `${taskId}__v1.json`),
        JSON.stringify(record),
      );
    }
    const executionStore = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => time + 1,
    });
    for (const [eventId, stage] of [
      ["s", "started"],
      ["e", "completed"],
    ] as const) {
      executionStore.recordFact({
        eventId,
        stage,
        occurredAt: time,
        scope,
        taskId: "task-a",
        runId: "run",
      });
    }
    executionStore.recordLink({
      receiptId: "l",
      taskId: "task-a",
      runId: "run",
      scope,
      outcomeVersion: 1,
      attemptId: "attempt",
      attemptGranularity: "turn",
      eventIds: ["s", "e"],
    });
    const snapshot = queryPlatformObservationSnapshot({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      executionStore,
      activity: null,
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.coverage.attemptedCount).toBe(2);
    expect(snapshot.coverage.fullyLinkedCount).toBe(1);
    expect(snapshot.coverage.invalidCount).toBe(0);
    expect(snapshot.coverage.link).toBe(0.5);
    expect(snapshot.heartbeat.expectedSamples).toBeNull();
  });

  it("uses collector heartbeat samples when a real expected period exists", () => {
    const scheduled = {
      agents: { list: [{ id: "bot", agentDir: dir, heartbeat: { every: "100ms" } }] },
    } as OpenBotConfig;
    const snapshot = queryPlatformObservationSnapshot({
      cfg: scheduled,
      from: time,
      to: time + 400,
      projectedAt: time + 400,
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
      activity: {
        collectorState: "collecting",
        collectionStartedAt: time,
        evictedCount: 0,
        expiredCount: 0,
        events: [
          { ts: time + 10, status: "sent", agentId: "bot" },
          { ts: time + 110, status: "ok-empty", agentId: "bot" },
          { ts: time + 210, status: "sent", agentId: "bot" },
        ],
        reasons: ["heartbeat_activity_not_liveness"],
      },
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.heartbeat.scheduledRobotCount).toBe(1);
    expect(snapshot.heartbeat.confirmedRobotCount).toBe(1);
    expect(snapshot.heartbeat.onCadenceRobotCount).toBe(0);
    expect(snapshot.heartbeat.expectedPeriodMs).toBe(100);
    expect(snapshot.heartbeat.expectedSamples).toBe(4);
    expect(snapshot.heartbeat.observedSamples).toBe(3);
    expect(snapshot.heartbeat.robots[0]).toMatchObject({
      agentId: "bot",
      expectedSamples: 4,
      observedSamples: 3,
      onCadence: false,
    });
  });

  it("rolls up mixed periods as a robot cadence cohort, not a mashed tick ratio", () => {
    const mixed = {
      agents: {
        list: [
          { id: "fast", agentDir: dir, heartbeat: { every: "100ms" } },
          { id: "slow", agentDir: dir, heartbeat: { every: "200ms" } },
        ],
      },
    } as OpenBotConfig;
    const snapshot = queryPlatformObservationSnapshot({
      cfg: mixed,
      from: time,
      to: time + 400,
      projectedAt: time + 400,
      executionStore: createExecutionEvidenceStore({ enabled: () => false, now: () => time + 1 }),
      activity: {
        collectorState: "collecting",
        collectionStartedAt: time,
        evictedCount: 0,
        expiredCount: 0,
        events: [
          { ts: time + 10, status: "sent", agentId: "fast" },
          { ts: time + 110, status: "sent", agentId: "fast" },
          { ts: time + 210, status: "sent", agentId: "fast" },
          { ts: time + 310, status: "sent", agentId: "fast" },
          { ts: time + 50, status: "sent", agentId: "slow" },
        ],
        reasons: [],
      },
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.heartbeat.onCadenceRobotCount).toBe(1);
    expect(snapshot.heartbeat.confirmedRobotCount).toBe(2);
    expect(snapshot.heartbeat.expectedSamples).toBeNull();
    expect(snapshot.heartbeat.observedSamples).toBeNull();
    expect(snapshot.heartbeat.reasons).toContain("mixed_heartbeat_periods");
  });

  it("marks coverage unknown with tips_outside_window when durable tips exist outside the window", () => {
    const record = row("task-old");
    fs.writeFileSync(path.join(dir, "task-outcomes/tips", "task-old.json"), JSON.stringify(record));
    fs.writeFileSync(
      path.join(dir, "task-outcomes/versions", "task-old__v1.json"),
      JSON.stringify(record),
    );
    const snapshot = queryPlatformObservationSnapshot({
      cfg,
      from: time + 60_000,
      to: time + 120_000,
      projectedAt: time + 120_000,
      executionStore: createExecutionEvidenceStore({
        enabled: () => false,
        now: () => time + 61_000,
      }),
      activity: null,
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.coverage.attemptedCount).toBe(0);
    expect(snapshot.coverage.link).toBeNull();
    expect(snapshot.coverage.reasons).toContain("no_candidates");
    expect(snapshot.coverage.reasons).toContain("tips_outside_window");
    expect(snapshot.unmappedEvents.count).toBe(0);
  });

  it("counts unmapped execution events and forwards heartbeat activity marks", () => {
    const executionStore = createExecutionEvidenceStore({
      enabled: () => true,
      now: () => time + 1,
    });
    executionStore.recordFact({
      eventId: "u1",
      stage: "started",
      occurredAt: time,
      scope: {
        kind: "personal",
        personalDomainId: "personal",
        subjectRef: "subject:alice",
        authzScopeRef: "auth",
      },
      taskId: "task-u",
      runId: "run-u",
    });
    const snapshot = queryPlatformObservationSnapshot({
      cfg,
      from: time,
      to: time + 1000,
      projectedAt: time + 1000,
      executionStore,
      activity: {
        expectedPeriodMs: null,
        expectedSamples: null,
        observedSamples: null,
        events: [
          { ts: time, status: "sent" },
          { ts: time + 400, status: "ok-empty" },
          { ts: time - 1, status: "skipped" },
        ],
        reasons: ["expected_period_unknown"],
      },
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) {
      throw new Error("snapshot_failed");
    }
    expect(snapshot.unmappedEvents.count).toBe(1);
    expect(snapshot.heartbeat.expectedSamples).toBeNull();
    expect(snapshot.heartbeat.observedEventCount).toBe(2);
    expect(snapshot.heartbeat.lastEventAt).toBe(time + 400);
    expect(snapshot.heartbeat.events.map((row) => row.status)).toEqual(["sent", "ok-empty"]);
    expect(JSON.stringify(snapshot)).not.toContain("subject:alice");
  });
});
