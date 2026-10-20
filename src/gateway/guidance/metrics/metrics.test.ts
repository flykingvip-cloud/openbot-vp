import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileGuidanceMetricsStore,
  parseGuidanceMetricInput,
  recordGuidanceMetricSafe,
  resolveGuidanceMetricsPath,
} from "./index.js";

const tmp = path.join(os.tmpdir(), `guidance-metrics-${Date.now()}`);

describe("guidance metrics P3.3", () => {
  beforeEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("parses required isolation fields and redacts secrets from metadata", () => {
    const parsed = parseGuidanceMetricInput({
      event: "guidance_primary_clicked",
      tenantId: "t1",
      userId: "u1",
      scope: "robot",
      entityId: "bot-1",
      scenario: "growth.onboarding",
      actionKind: "install_capabilities",
      contentVersion: "2026.09.03",
      timestamp: 100,
      metadata: {
        api_key: "sk-secret",
        taskBody: "do not store",
        note: "ok",
      },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.event.metadata?.api_key).toBeUndefined();
    expect(parsed.event.metadata?.taskBody).toBeUndefined();
    expect(parsed.event.metadata?.note).toBe("ok");
  });

  it("appends events under tenant/user path and lists them", async () => {
    const store = createFileGuidanceMetricsStore({ rootDir: tmp });
    const result = await recordGuidanceMetricSafe(
      store,
      {
        event: "guidance_shown",
        tenantId: "t1",
        userId: "u1",
        scope: "user",
        entityId: "steward",
        scenario: "daibai.onboarding",
        actionKind: "open_settings",
        contentVersion: "v1",
        timestamp: 50,
      },
      parseGuidanceMetricInput,
    );
    expect(result.ok).toBe(true);
    const listed = await store.list({ tenantId: "t1", userId: "u1" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.event).toBe("guidance_shown");
  });

  it("fail-soft: store failures do not throw", async () => {
    const store = {
      async append() {
        throw new Error("disk full");
      },
      async list() {
        return [];
      },
    };
    const result = await recordGuidanceMetricSafe(
      store,
      {
        event: "guidance_deferred",
        tenantId: "t1",
        userId: "u1",
        scope: "team",
        entityId: "space-1",
        scenario: "team.stale",
        actionKind: "advance_mission",
        contentVersion: "v1",
      },
      parseGuidanceMetricInput,
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.message).toContain("disk full");
  });

  it("refuses to resolve a path outside the metrics root", () => {
    expect(() => resolveGuidanceMetricsPath("..", "u1", { rootDir: tmp })).toThrow(/escapes/);
  });

  it("rejects path-escaping isolation keys", () => {
    for (const tenantId of ["..", "../etc", "/tmp/evil", "t1/../t2"]) {
      const parsed = parseGuidanceMetricInput({
        event: "guidance_shown",
        tenantId,
        userId: "u1",
        scope: "user",
        entityId: "steward",
        scenario: "x",
        actionKind: "none",
        contentVersion: "v1",
      });
      expect(parsed.ok).toBe(false);
    }
  });

  it("rejects invalid event types without writing", () => {
    const parsed = parseGuidanceMetricInput({
      event: "guidance_event",
      tenantId: "t1",
      userId: "u1",
      scope: "user",
      entityId: "steward",
      scenario: "x",
      actionKind: "none",
      contentVersion: "v1",
    });
    expect(parsed.ok).toBe(false);
  });
});
