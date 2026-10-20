import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resetEvolutionLoopLogsForTests,
  listEvolutionLoopLogsForTests,
} from "./evolution-loop-log.js";
import {
  buildObservationIdempotencyKey,
  readEvolutionObservationAudits,
  resetEvolutionObservationIndexForTests,
  writeEvolutionObservationAudit,
} from "./observation-audit.js";

let tmpDir = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-obs-audit-"));
  resetEvolutionLoopLogsForTests();
  resetEvolutionObservationIndexForTests();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  resetEvolutionLoopLogsForTests();
  resetEvolutionObservationIndexForTests();
});

describe("observation audit", () => {
  it("writes an observation only when runId, tenantId, and agentId are present", () => {
    const created = writeEvolutionObservationAudit({
      runId: "run-obs",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: "binding:run-obs:v1",
      attributionSource: "binding",
      persistDir: tmpDir,
    });
    expect(created).toMatchObject({
      runId: "run-obs",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
    });
    expect(readEvolutionObservationAudits(tmpDir)).toHaveLength(1);
    expect(
      listEvolutionLoopLogsForTests().some((row) => row.event === "evolution.observation.created"),
    ).toBe(true);
  });

  it("returns the same observationId for duplicate runId + source ingest", () => {
    const base = {
      runId: "run-dup",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: "binding:run-dup:v1",
      attributionSource: "binding",
      inputStructureHash: "in-a",
      outputStructureHash: "out-a",
      persistDir: tmpDir,
    };
    const first = writeEvolutionObservationAudit(base);
    const second = writeEvolutionObservationAudit(base);
    expect(first?.observationId).toBe(second?.observationId);
    expect(readEvolutionObservationAudits(tmpDir)).toHaveLength(1);
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) => row.event === "evolution.observation.idempotent",
      ),
    ).toBe(true);
  });

  it("allows multiple observations for the same runId with different stage sources", () => {
    const shared = {
      runId: "run-stages",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      ownershipProof: "binding:run-stages:v1",
      attributionSource: "binding",
      persistDir: tmpDir,
    };
    writeEvolutionObservationAudit({
      ...shared,
      source: "pattern-detection.ingest-sample",
      inputStructureHash: "in-1",
      outputStructureHash: "out-1",
    });
    writeEvolutionObservationAudit({
      ...shared,
      source: "evolution.task-outcomes.record",
      inputStructureHash: "in-2",
      outputStructureHash: "out-2",
    });
    expect(readEvolutionObservationAudits(tmpDir)).toHaveLength(2);
    expect(
      buildObservationIdempotencyKey({
        runId: "run-stages",
        source: "pattern-detection.ingest-sample",
        surfaceId: "pattern-detection.sample",
        inputStructureHash: "in-1",
        outputStructureHash: "out-1",
      }),
    ).not.toBe(
      buildObservationIdempotencyKey({
        runId: "run-stages",
        source: "evolution.task-outcomes.record",
        surfaceId: "pattern-detection.sample",
        inputStructureHash: "in-2",
        outputStructureHash: "out-2",
      }),
    );
  });

  it("does not append duplicate rows under concurrent duplicate writes", async () => {
    const base = {
      runId: "run-concurrent",
      agentId: "growth-bot",
      tenantId: "tenant-acme",
      surfaceId: "pattern-detection.sample",
      source: "pattern-detection.ingest-sample",
      ownershipProof: "binding:run-concurrent:v1",
      attributionSource: "binding",
      inputStructureHash: "in-c",
      outputStructureHash: "out-c",
      persistDir: tmpDir,
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => Promise.resolve(writeEvolutionObservationAudit(base))),
    );
    const ids = new Set(results.map((row) => row?.observationId));
    expect(ids.size).toBe(1);
    expect(readEvolutionObservationAudits(tmpDir)).toHaveLength(1);
  });

  it("stays unavailable when runId is missing", () => {
    expect(
      writeEvolutionObservationAudit({
        agentId: "growth-bot",
        tenantId: "tenant-acme",
        source: "pattern-detection.ingest-sample",
        ownershipProof: "missing",
        attributionSource: "unattributed",
        persistDir: tmpDir,
      }),
    ).toBeNull();
    expect(readEvolutionObservationAudits(tmpDir)).toHaveLength(0);
    expect(
      listEvolutionLoopLogsForTests().some(
        (row) =>
          row.event === "evolution.observation.unavailable" && row.reason === "missing_run_id",
      ),
    ).toBe(true);
  });
});
