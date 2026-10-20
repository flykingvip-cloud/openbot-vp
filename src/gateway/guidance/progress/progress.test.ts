import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  abandonGuidanceProgress,
  advanceGuidanceProgress,
  applyGuidanceEventToProgress,
  authorizeGuidanceProgressAccess,
  createFileGuidanceProgressStore,
  GUIDANCE_PROGRESS_DEFAULT_RETENTION_MS,
  mapGuidanceEventToProgressFields,
  normalizeGuidanceProgressKey,
  readGuidanceProgress,
  resolveAuthorizedProgressKey,
  sanitizeGuidanceProgressMetadata,
  upsertGuidanceProgress,
  GuidanceProgressAuthError,
  GuidanceProgressValidationError,
} from "./index.js";

const tmpRoot = path.join(os.tmpdir(), `guidance-progress-${Date.now()}`);

function clean() {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });
}

const key = normalizeGuidanceProgressKey({
  tenantId: "tenant-a",
  userId: "user-a",
  scope: "user",
  entityId: "steward",
});

describe("guidance progress P1", () => {
  beforeEach(() => {
    clean();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("stores under tenantId/userId/scope/entityId and reads back", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    const written = await upsertGuidanceProgress(store, key, {
      scenario: "wechat_oa_setup",
      currentStage: "open_settings",
      nextActionKind: "open_settings",
      confidence: "high",
      completedSteps: ["enter_mp"],
      nowMs: 1_000,
    });
    expect(written.tenantId).toBe("tenant-a");
    expect(written.userId).toBe("user-a");
    expect(written.scope).toBe("user");
    expect(written.entityId).toBe("steward");
    expect(written.expiresAt).toBe(1_000 + GUIDANCE_PROGRESS_DEFAULT_RETENTION_MS);

    const filePath = path.join(tmpRoot, "tenant-a", "user-a", "user", "steward.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const read = await readGuidanceProgress(store, key, { nowMs: 1_000 });
    expect(read?.scenario).toBe("wechat_oa_setup");
    expect(read?.completedSteps).toEqual(["enter_mp"]);
  });

  it("upsert and advance are idempotent", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    const a = await upsertGuidanceProgress(store, key, {
      scenario: "wechat_oa_setup",
      currentStage: "open_settings",
      nextActionKind: "open_settings",
      confidence: "medium",
      nowMs: 2_000,
    });
    const b = await upsertGuidanceProgress(store, key, {
      scenario: "wechat_oa_setup",
      currentStage: "open_settings",
      nextActionKind: "open_settings",
      confidence: "medium",
      nowMs: 3_000,
    });
    expect(b.updatedAt).toBe(a.updatedAt);

    const advanced = await advanceGuidanceProgress(store, key, {
      stepId: "open_settings",
      nextStage: "fill_appid",
      nextActionKind: "fill_appid",
      nowMs: 4_000,
    });
    expect(advanced.completedSteps).toEqual(["open_settings"]);
    const again = await advanceGuidanceProgress(store, key, {
      stepId: "open_settings",
      nextStage: "fill_appid",
      nextActionKind: "fill_appid",
      nowMs: 5_000,
    });
    expect(again.updatedAt).toBe(advanced.updatedAt);
    expect(again.completedSteps).toEqual(["open_settings"]);
  });

  it("abandon is idempotent and does not invent Growth lifecycle fields", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    await upsertGuidanceProgress(store, key, {
      scenario: "personal_email",
      currentStage: "open_mail",
      nextActionKind: "open_mail",
      confidence: "low",
      nowMs: 10,
    });
    const abandoned = await abandonGuidanceProgress(store, key, {
      reason: "user_said_later",
      nowMs: 20,
    });
    expect(abandoned.status).toBe("abandoned");
    expect(abandoned.abandonedAt).toBe(20);
    expect((abandoned as { lifecycleState?: unknown }).lifecycleState).toBeUndefined();
    expect((abandoned as { growthStatus?: unknown }).growthStatus).toBeUndefined();

    const again = await abandonGuidanceProgress(store, key, { nowMs: 30 });
    expect(again.abandonedAt).toBe(20);
  });

  it("enforces auth + tenant isolation", () => {
    expect(() =>
      authorizeGuidanceProgressAccess({
        actor: { userId: "user-b", tenantId: "tenant-a" },
        key,
      }),
    ).toThrow(GuidanceProgressAuthError);

    expect(() =>
      authorizeGuidanceProgressAccess({
        actor: { userId: "user-a", tenantId: "tenant-b" },
        key,
      }),
    ).toThrow(GuidanceProgressAuthError);

    expect(() =>
      resolveAuthorizedProgressKey({
        actor: { userId: "user-a", tenantId: "tenant-a" },
        tenantId: "tenant-a",
        userId: "user-a",
        scope: "user",
        entityId: "../evil",
      }),
    ).toThrow(GuidanceProgressValidationError);

    const ok = resolveAuthorizedProgressKey({
      actor: { userId: "user-a", tenantId: "tenant-a" },
      tenantId: "tenant-a",
      userId: "user-a",
      scope: "robot",
      entityId: "bot-1",
    });
    expect(ok.scope).toBe("robot");

    // Local/single-tenant actors omit tenantId; user isolation still holds.
    expect(() =>
      resolveAuthorizedProgressKey({
        actor: { userId: "user-a" },
        tenantId: "tenant-a",
        userId: "user-b",
        scope: "user",
        entityId: "steward",
      }),
    ).toThrow(GuidanceProgressAuthError);
  });

  it("purges expired records on read (retention)", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    await upsertGuidanceProgress(store, key, {
      scenario: "wechat_oa_setup",
      currentStage: "s1",
      nextActionKind: "s1",
      confidence: "high",
      expiresAt: 50,
      nowMs: 10,
    });
    const gone = await readGuidanceProgress(store, key, { nowMs: 100 });
    expect(gone).toBeNull();
    expect(fs.existsSync(path.join(tmpRoot, "tenant-a", "user-a", "user", "steward.json"))).toBe(
      false,
    );
  });

  it("redacts secrets and drops forbidden metadata keys", () => {
    const sanitized = sanitizeGuidanceProgressMetadata({
      appSecret: "0123456789abcdef0123456789abcdef",
      api_key: "sk-abcdefghijklmnopqrstuvwxyz",
      taskBody: "do not store the full task",
      password: "hunter2",
      issueClass: "ui_changed",
      note: "token=abc123secret and Bearer eyJhbGciOiJIUzI1NiJ9.xx",
    });
    expect(sanitized?.appSecret).toBeUndefined();
    expect(sanitized?.api_key).toBeUndefined();
    expect(sanitized?.taskBody).toBeUndefined();
    expect(sanitized?.password).toBeUndefined();
    expect(sanitized?.issueClass).toBe("ui_changed");
    expect(sanitized?.note).not.toContain("abc123secret");
    expect(sanitized?.note).toContain("***");
  });

  it("aligns guidance_event fields and correlates lastGuidanceEventId", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    const mapped = mapGuidanceEventToProgressFields({
      event: "guidance_step_failed",
      scenario: "wechat_oa_setup",
      stepId: "enter_settings",
      failureReason: "button_missing",
      contextConfidence: "medium",
      issueClass: "ui_changed",
      skill: "user-guidance-protocol",
    });
    expect(mapped.currentStage).toBe("enter_settings");
    expect(mapped.failureCountDelta).toBe(1);

    const record = await applyGuidanceEventToProgress(
      store,
      key,
      {
        event: "guidance_step_failed",
        scenario: "wechat_oa_setup",
        stepId: "enter_settings",
        failureReason: "button_missing AppSecret=0123456789abcdef0123456789abcdef",
        contextConfidence: "medium",
        issueClass: "ui_changed",
        userAction: "searched",
      },
      { nowMs: 9_000 },
    );
    expect(record.scenario).toBe("wechat_oa_setup");
    expect(record.currentStage).toBe("enter_settings");
    expect(record.confidence).toBe("medium");
    expect(record.failureCount).toBe(1);
    expect(record.lastGuidanceEventType).toBe("guidance_step_failed");
    expect(record.lastGuidanceEventId).toContain("guidance_step_failed");
    expect(record.metadata?.issueClass).toBe("ui_changed");
    // failureReason is not stored raw on progress; event parser redacts before incubation bridge.
    expect(JSON.stringify(record)).not.toMatch(/0123456789abcdef0123456789abcdef/i);

    const completed = await applyGuidanceEventToProgress(
      store,
      key,
      {
        event: "guidance_completed",
        scenario: "wechat_oa_setup",
        contextConfidence: "high",
        stepsCompleted: 8,
      },
      { nowMs: 10_000 },
    );
    expect(completed.status).toBe("completed");
    expect(completed.nextActionKind).toBe("none");

    const abandoned = await applyGuidanceEventToProgress(
      store,
      key,
      {
        event: "guidance_abandoned",
        scenario: "wechat_oa_setup",
        contextConfidence: "low",
        userAction: "later",
      },
      { nowMs: 11_000 },
    );
    expect(abandoned.status).toBe("abandoned");
  });

  it("rejects cross-tenant file pollution", async () => {
    const store = createFileGuidanceProgressStore({ rootDir: tmpRoot });
    await upsertGuidanceProgress(store, key, {
      scenario: "x",
      currentStage: "s",
      nextActionKind: "s",
      confidence: "high",
      nowMs: 1,
    });
    const forgedPath = path.join(tmpRoot, "tenant-a", "user-a", "user", "steward.json");
    const forged = JSON.parse(fs.readFileSync(forgedPath, "utf8"));
    forged.tenantId = "other-tenant";
    fs.writeFileSync(forgedPath, JSON.stringify(forged));
    const read = await readGuidanceProgress(store, key, { nowMs: 1 });
    expect(read).toBeNull();
  });
});
