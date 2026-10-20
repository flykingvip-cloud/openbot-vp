import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import {
  persistGrowthAssessmentSnapshot,
  readGrowthAssessmentSnapshot,
  validateGrowthAssessmentSnapshot,
} from "./diagnose-growth-snapshot.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-snap-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function assessment(patch: Partial<DiagnoseGrowthAssessment> = {}): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-2",
    tenantId: "tenant-a",
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "市场助手",
    displayName: "市场助手",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: [],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: [],
    installedSkillIds: [],
    memoryFileCount: 2,
    reportFileCount: 1,
    freshArtifactCount: 2,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 1 },
    activitySources: ["memory_file"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
    ...patch,
  };
}

const WINDOW = {
  startedAt: "2026-09-18T00:00:00.000Z",
  endedAt: "2026-09-19T00:00:00.000Z",
};

describe("growth assessment snapshot", () => {
  it("is hash-stable, tenant-isolated, and idempotent for the same content", () => {
    const configDir = tempDir();
    const first = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: WINDOW,
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const second = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: WINDOW,
      configDir,
      nowMs: Date.parse("2026-09-19T01:00:00.000Z"),
    });
    expect(first?.snapshotId).toBe(second?.snapshotId);
    expect(first?.payloadHash).toBe(second?.payloadHash);
    expect(first?.createdAt).toBe("2026-09-19T00:00:00.000Z");
    const changed = persistGrowthAssessmentSnapshot({
      assessment: assessment({ memoryFileCount: 9 }),
      observationWindow: WINDOW,
      configDir,
      nowMs: Date.parse("2026-09-19T02:00:00.000Z"),
    });
    expect(changed?.snapshotId).not.toBe(first?.snapshotId);
    const foreign = readGrowthAssessmentSnapshot({
      tenantId: "tenant-b",
      snapshotId: first!.snapshotId,
      configDir,
    });
    expect(foreign.ok).toBe(false);
    const encoded = JSON.stringify(first);
    expect(encoded).not.toContain("chat body");
    expect(encoded).not.toContain("toolOutput");
  });

  it("rejects expired, corrupt, symlink, and path-traversal reads", () => {
    const configDir = tempDir();
    const saved = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: WINDOW,
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    expect(saved).not.toBeNull();
    const expired = readGrowthAssessmentSnapshot({
      tenantId: "tenant-a",
      snapshotId: saved!.snapshotId,
      configDir,
      nowMs: Date.parse("2026-09-27T00:00:00.000Z"),
    });
    expect(expired).toMatchObject({ ok: false, reason: "expired" });
    const traversal = readGrowthAssessmentSnapshot({
      tenantId: "tenant-a",
      snapshotId: "../etc/passwd",
      configDir,
    });
    expect(traversal).toMatchObject({ ok: false, reason: "path_rejected" });

    const file = path.join(
      configDir,
      "diagnosis-growth-snapshots",
      createHash("sha256").update("tenant-a").digest("hex").slice(0, 16),
      `${saved!.snapshotId}.json`,
    );
    fs.writeFileSync(file, "{not-json");
    expect(
      readGrowthAssessmentSnapshot({
        tenantId: "tenant-a",
        snapshotId: saved!.snapshotId,
        configDir,
      }),
    ).toMatchObject({ ok: false, reason: "snapshot_corrupt" });

    const linkDir = tempDir();
    const real = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: WINDOW,
      configDir: linkDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    const tenantDir = path.dirname(
      path.join(
        linkDir,
        "diagnosis-growth-snapshots",
        createHash("sha256").update("tenant-a").digest("hex").slice(0, 16),
        `${real!.snapshotId}.json`,
      ),
    );
    const linkFile = path.join(tenantDir, `${real!.snapshotId}.json`);
    fs.rmSync(linkFile);
    fs.symlinkSync(path.join(linkDir, "missing-target.json"), linkFile);
    expect(
      readGrowthAssessmentSnapshot({
        tenantId: "tenant-a",
        snapshotId: real!.snapshotId,
        configDir: linkDir,
      }),
    ).toMatchObject({ ok: false, reason: "symlink_rejected" });
    expect(validateGrowthAssessmentSnapshot({ ...real, chatBody: "secret" }).ok).toBe(false);
  });

  it("rejects illegal ISO times, reversed span, and never-expire fixtures", () => {
    const configDir = tempDir();
    const saved = persistGrowthAssessmentSnapshot({
      assessment: assessment(),
      observationWindow: WINDOW,
      configDir,
      nowMs: Date.parse("2026-09-19T00:00:00.000Z"),
    });
    expect(saved).not.toBeNull();
    expect(
      validateGrowthAssessmentSnapshot({
        ...saved,
        createdAt: "not-a-date",
      }),
    ).toMatchObject({ ok: false, reason: "snapshot_time" });
    expect(
      validateGrowthAssessmentSnapshot({
        ...saved,
        createdAt: "2026-02-31T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, reason: "snapshot_time" });
    expect(
      validateGrowthAssessmentSnapshot({
        ...saved,
        createdAt: saved!.expiresAt,
        expiresAt: saved!.createdAt,
      }),
    ).toMatchObject({ ok: false, reason: "snapshot_time" });
    expect(
      validateGrowthAssessmentSnapshot({
        ...saved,
        expiresAt: "9999-12-31T23:59:59.999Z",
      }),
    ).toMatchObject({ ok: false, reason: "ttl_exceeded" });
  });
});
