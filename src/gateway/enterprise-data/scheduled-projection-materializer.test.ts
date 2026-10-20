// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import { listEnterpriseKnowledgeProjectionBindings } from "./enterprise-knowledge-projection-binding-store.js";
import * as materializer from "./projection-materializer.js";
import {
  computeFailureBackoffMs,
  isScheduledBindingDue,
  isScheduledTickInFlightForTests,
  readScheduleCursor,
  resetScheduledTickInFlightForTests,
  runScheduledProjectionsForStore,
  scheduleCursorKey,
  setScheduleCursorPathForTests,
  tickScheduledProjectionMaterialization,
  writeScheduleCursor,
  type ScheduleCursor,
} from "./scheduled-projection-materializer.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore, saveEnterpriseDataStore } from "./store.js";

const nowIso = "2026-07-19T12:00:00.000Z";
const nowMs = Date.parse(nowIso);

function emptyCursor(): ScheduleCursor {
  return {
    lastRunByBindingId: {},
    lastFailureByBindingId: {},
    failureCountByBindingId: {},
  };
}

function seedStore(tenantId: string) {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  return store;
}

function scheduledBindings(store: ReturnType<typeof seedStore>, tenantId: string) {
  return listEnterpriseKnowledgeProjectionBindings({
    store,
    tenantId,
    enabled: true,
  }).filter((binding) => binding.materializationMode === "scheduled");
}

describe("scheduled projection materializer", () => {
  let tmpDir = "";
  let cursorPath = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sched-proj-"));
    cursorPath = path.join(tmpDir, "schedule-cursor.json");
    setScheduleCursorPathForTests(cursorPath);
    resetScheduledTickInFlightForTests();
  });

  afterEach(() => {
    setScheduleCursorPathForTests(null);
    resetScheduledTickInFlightForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("discovers scheduled bindings and records due runs with interval guard", async () => {
    const tenantId = "tenant-sched";
    const store = seedStore(tenantId);
    expect(scheduledBindings(store, tenantId).length).toBeGreaterThan(0);

    const runSpy = vi
      .spyOn(materializer, "runProjectionMaterialization")
      .mockResolvedValue({ objectId: "feed-1" } as never);

    const first = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: emptyCursor(),
    });
    expect(first.succeeded).toBeGreaterThan(0);
    expect(runSpy).toHaveBeenCalled();
    const bindingId = scheduledBindings(store, tenantId)[0].bindingId;
    expect(first.cursor.lastRunByBindingId[scheduleCursorKey(tenantId, bindingId)]).toBe(nowIso);

    runSpy.mockClear();
    const second = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: first.cursor,
    });
    expect(second.succeeded).toBe(0);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("applies exponential failure backoff and does not retry immediately", async () => {
    const tenantId = "tenant-backoff";
    const store = seedStore(tenantId);
    const bindingId = scheduledBindings(store, tenantId)[0].bindingId;
    const runSpy = vi
      .spyOn(materializer, "runProjectionMaterialization")
      .mockRejectedValue(new Error("materialize failed"));

    const first = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: emptyCursor(),
    });
    expect(first.failed).toBe(1);
    expect(first.succeeded).toBe(0);
    expect(first.cursorChanged).toBe(true);
    const key = scheduleCursorKey(tenantId, bindingId);
    expect(first.cursor.failureCountByBindingId[key]).toBe(1);
    expect(first.cursor.lastFailureByBindingId[key]).toBe(nowIso);
    expect(first.cursor.lastRunByBindingId[key]).toBeUndefined();

    runSpy.mockClear();
    // Still inside first-failure backoff (5m): must skip.
    const soonIso = new Date(nowMs + 60_000).toISOString();
    const second = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso: soonIso,
      cursor: first.cursor,
    });
    expect(second.failed).toBe(0);
    expect(second.succeeded).toBe(0);
    expect(runSpy).not.toHaveBeenCalled();

    // After backoff elapses, retry and escalate failure count.
    const afterBackoffIso = new Date(nowMs + computeFailureBackoffMs(1) + 1_000).toISOString();
    const third = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso: afterBackoffIso,
      cursor: first.cursor,
    });
    expect(third.failed).toBe(1);
    expect(third.cursor.failureCountByBindingId[key]).toBe(2);
    expect(computeFailureBackoffMs(2)).toBe(computeFailureBackoffMs(1) * 2);

    // Success clears failure state.
    runSpy.mockResolvedValueOnce({ objectId: "feed-ok" } as never);
    const afterSecondBackoff = new Date(
      Date.parse(afterBackoffIso) + computeFailureBackoffMs(2) + 1_000,
    ).toISOString();
    const fourth = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso: afterSecondBackoff,
      cursor: third.cursor,
    });
    expect(fourth.succeeded).toBe(1);
    expect(fourth.cursor.failureCountByBindingId[key]).toBeUndefined();
    expect(fourth.cursor.lastFailureByBindingId[key]).toBeUndefined();
    expect(fourth.cursor.lastRunByBindingId[key]).toBe(afterSecondBackoff);
  });

  it("isScheduledBindingDue respects legacy bare binding keys", () => {
    const tenantId = "tenant-legacy";
    const bindingId = "binding-legacy";
    const cursor: ScheduleCursor = {
      lastRunByBindingId: { [bindingId]: nowIso },
      lastFailureByBindingId: {},
      failureCountByBindingId: {},
    };
    expect(
      isScheduledBindingDue({
        tenantId,
        bindingId,
        cursor,
        nowMs,
      }),
    ).toBe(false);
    expect(
      isScheduledBindingDue({
        tenantId,
        bindingId,
        cursor,
        nowMs: nowMs + 60 * 60 * 1000 + 1,
      }),
    ).toBe(true);
  });

  it("persists cursor across process restart (disk round-trip)", async () => {
    const tenantId = "tenant-restart";
    const store = seedStore(tenantId);
    const bindingId = scheduledBindings(store, tenantId)[0].bindingId;
    const runSpy = vi
      .spyOn(materializer, "runProjectionMaterialization")
      .mockResolvedValue({ objectId: "feed-1" } as never);

    const first = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: emptyCursor(),
    });
    writeScheduleCursor(first.cursor, cursorPath);
    expect(runSpy).toHaveBeenCalledTimes(1);

    // Simulate new process: read cursor from disk, interval still active → no re-run.
    const reloaded = readScheduleCursor(cursorPath);
    expect(reloaded.lastRunByBindingId[scheduleCursorKey(tenantId, bindingId)]).toBe(nowIso);
    runSpy.mockClear();
    const second = await runScheduledProjectionsForStore({
      store,
      tenantId,
      nowIso,
      cursor: reloaded,
    });
    expect(second.succeeded).toBe(0);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("tick scans multiple tenants and writes cursor on failure backoff", async () => {
    const tenantsRoot = path.join(tmpDir, "tenants");
    for (const tenantId of ["tenant-a", "tenant-b"]) {
      const controlPlane = path.join(tenantsRoot, tenantId, "control-plane");
      fs.mkdirSync(controlPlane, { recursive: true });
      const store = seedStore(tenantId);
      await saveEnterpriseDataStore(store, path.join(controlPlane, TENANT_ENTERPRISE_DATA_FILE));
    }

    const runSpy = vi
      .spyOn(materializer, "runProjectionMaterialization")
      .mockResolvedValue({ objectId: "feed-mt" } as never);

    const result = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    expect(result.tenantsScanned).toBe(2);
    expect(result.succeeded).toBeGreaterThanOrEqual(2);
    expect(runSpy.mock.calls.length).toBeGreaterThanOrEqual(2);

    const cursor = readScheduleCursor(cursorPath);
    expect(Object.keys(cursor.lastRunByBindingId).some((key) => key.startsWith("tenant-a::"))).toBe(
      true,
    );
    expect(Object.keys(cursor.lastRunByBindingId).some((key) => key.startsWith("tenant-b::"))).toBe(
      true,
    );

    // Failure path persists backoff without success.
    runSpy.mockRejectedValue(new Error("boom"));
    // Advance past success interval so bindings are due again.
    const laterIso = new Date(nowMs + 60 * 60 * 1000 + 5_000).toISOString();
    const failResult = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso: laterIso,
      cursorPath,
    });
    expect(failResult.failed).toBeGreaterThan(0);
    const failedCursor = readScheduleCursor(cursorPath);
    expect(Object.keys(failedCursor.lastFailureByBindingId).length).toBeGreaterThan(0);
    expect(Object.keys(failedCursor.failureCountByBindingId).length).toBeGreaterThan(0);
  });

  it("tick is overlap-safe under concurrent reentry", async () => {
    const tenantsRoot = path.join(tmpDir, "tenants-overlap");
    const controlPlane = path.join(tenantsRoot, "tenant-x", "control-plane");
    fs.mkdirSync(controlPlane, { recursive: true });
    await saveEnterpriseDataStore(
      seedStore("tenant-x"),
      path.join(controlPlane, TENANT_ENTERPRISE_DATA_FILE),
    );

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredMaterialize = 0;
    vi.spyOn(materializer, "runProjectionMaterialization").mockImplementation(async () => {
      enteredMaterialize += 1;
      await gate;
      return { objectId: "feed-overlap" } as never;
    });

    const firstPromise = tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    // Wait until first tick has entered materialization (holds in-flight lock).
    await vi.waitFor(() => {
      expect(enteredMaterialize).toBeGreaterThanOrEqual(1);
    });
    expect(isScheduledTickInFlightForTests()).toBe(true);

    const second = await tickScheduledProjectionMaterialization({
      tenantsRoot,
      nowIso,
      cursorPath,
    });
    expect(second).toEqual({ tenantsScanned: 0, succeeded: 0, failed: 0 });

    release();
    const firstResult = await firstPromise;
    expect(firstResult.tenantsScanned).toBe(1);
    expect(enteredMaterialize).toBeGreaterThanOrEqual(1);
    expect(isScheduledTickInFlightForTests()).toBe(false);
  });
});
