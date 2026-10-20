import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findCompletedImportByPackage,
  getTenantImportJob,
  listTenantImportJobs,
  upsertTenantImportJob,
} from "./import-job-store.js";

describe("tenant-import job store", () => {
  let storePath = "";
  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-jobstore-"));
    storePath = path.join(dir, "jobs.json");
  });
  afterEach(async () => {
    await fs.rm(path.dirname(storePath), { recursive: true, force: true });
  });

  it("returns null for an unknown job", async () => {
    expect(await getTenantImportJob("nope", storePath)).toBeNull();
  });

  it("creates a record with timestamps and reads it back", async () => {
    const rec = await upsertTenantImportJob(
      { importJobId: "job-1", targetTenantId: "acme", status: "running", phase: "stage" },
      storePath,
    );
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBeTruthy();
    const read = await getTenantImportJob("job-1", storePath);
    expect(read?.status).toBe("running");
    expect(read?.targetTenantId).toBe("acme");
  });

  it("preserves createdAt across updates and refreshes status/phase (idempotency substrate)", async () => {
    const first = await upsertTenantImportJob(
      { importJobId: "job-2", targetTenantId: "acme", status: "running", phase: "stage" },
      storePath,
    );
    await new Promise((r) => setTimeout(r, 5));
    const second = await upsertTenantImportJob(
      {
        importJobId: "job-2",
        targetTenantId: "acme",
        status: "done",
        phase: "done",
        committedFiles: 3,
        packageSha256: "sha-abc",
      },
      storePath,
    );
    expect(second.createdAt).toBe(first.createdAt); // createdAt preserved
    expect(second.updatedAt >= first.updatedAt).toBe(true);
    expect(second.status).toBe("done");
    expect(second.committedFiles).toBe(3);
  });

  it("finds a completed import by (targetTenantId, packageSha256) for the §10.4 duplicate guard", async () => {
    await upsertTenantImportJob(
      {
        importJobId: "job-3",
        targetTenantId: "acme",
        status: "done",
        phase: "done",
        packageSha256: "sha-xyz",
      },
      storePath,
    );
    expect((await findCompletedImportByPackage("acme", "sha-xyz", storePath))?.importJobId).toBe(
      "job-3",
    );
    // Different tenant / sha / no sha → no match.
    expect(await findCompletedImportByPackage("globex", "sha-xyz", storePath)).toBeNull();
    expect(await findCompletedImportByPackage("acme", "other", storePath)).toBeNull();
    expect(await findCompletedImportByPackage("acme", undefined, storePath)).toBeNull();
  });

  it("does not match a not-yet-completed job in the duplicate guard", async () => {
    await upsertTenantImportJob(
      {
        importJobId: "job-4",
        targetTenantId: "acme",
        status: "running",
        phase: "stage",
        packageSha256: "sha-run",
      },
      storePath,
    );
    expect(await findCompletedImportByPackage("acme", "sha-run", storePath)).toBeNull();
  });

  it("lists jobs newest-first", async () => {
    await upsertTenantImportJob(
      { importJobId: "a", targetTenantId: "acme", status: "done", phase: "done" },
      storePath,
    );
    await new Promise((r) => setTimeout(r, 5));
    await upsertTenantImportJob(
      { importJobId: "b", targetTenantId: "acme", status: "done", phase: "done" },
      storePath,
    );
    const jobs = await listTenantImportJobs(storePath);
    expect(jobs.map((j) => j.importJobId)).toEqual(["b", "a"]);
  });
});
