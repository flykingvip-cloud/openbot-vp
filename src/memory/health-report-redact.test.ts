import { describe, expect, it } from "vitest";
import {
  assertNoAbsolutePathLeak,
  collectAbsolutePathStrings,
  redactHealthReportForArchive,
  sha256Utf8,
} from "./health-report-redact.js";
import type { HealthReport } from "./health-report.js";
import { isValidHealthReport } from "./health-report.schema.js";

const opsReport: HealthReport = {
  schema: "memory-health-report/v2",
  reportKind: "ops",
  status: "ok",
  reasonCode: "probe.ok",
  callerScope: "platform",
  authorizedAgentIds: ["main"],
  runtime: { stateDir: "/root/.openbot", tenantsRoot: "/root/openbot-tenants" },
  agents: [
    {
      agentId: "main",
      storage: "ready",
      authority: "unknown",
      rootTopology: "unobserved",
      topologyEvidence: "unknown",
      destructiveOps: "maintenance-grant-required",
      search: "empty",
      documentState: "empty",
      searchableDocumentCount: 0,
      reasonCode: "search.empty",
      reason: "empty",
      backend: "unknown",
      workspaceRoot: "/root/.openbot/workspace-main",
      workspaceFingerprint: "fp",
      indexPath: "/root/.openbot/memory/main.sqlite",
      sqliteInstanceId: "id",
      sidecarFingerprintCount: 0,
      guardIndexStatus: "unknown",
      lastSyncAt: null,
      lastRebuildAt: null,
    },
  ],
  groups: [
    {
      groupId: "g1",
      memoryMdCount: 1,
      mirrorDivergence: "none",
      transcriptPath: "/root/.openbot/transcripts/g1.jsonl",
      memoryDir: "/root/.openbot/workspace-main/memory",
    },
  ],
  probeIntegrity: {
    preSnapshotHash: "aa",
    postSnapshotHash: "aa",
    mutationsDetected: false,
    changedPaths: ["/root/.openbot/memory/main.sqlite-wal"],
  },
  instanceSha: "x",
  probeModuleSha: "y",
  probeModuleVersion: "z",
  probeUtc: "t",
};

describe("redactHealthReportForArchive", () => {
  it("strips absolute paths and keeps integrity plus search status", () => {
    const redacted = redactHealthReportForArchive(opsReport);
    expect(isValidHealthReport(redacted)).toBe(true);
    expect(collectAbsolutePathStrings(redacted)).toEqual([]);
    expect(redacted).toMatchObject({
      schema: "memory-health-report/v2",
      status: "ok",
      reasonCode: "probe.ok",
    });
    if (redacted.status !== "ok" || redacted.reportKind !== "ops") {
      throw new Error("expected redacted ops report");
    }
    expect(redacted.runtime.stateDir).toBe("redacted");
    expect(redacted.runtime.tenantsRoot).toBe("redacted");
    expect(redacted.agents[0]).not.toHaveProperty("workspaceRoot");
    expect(redacted.agents[0]).not.toHaveProperty("indexPath");
    expect(redacted.agents[0]?.search).toBe("empty");
    expect(redacted.agents[0]?.documentState).toBe("empty");
    expect(redacted.agents[0]?.workspaceFingerprint).toBe("fp");
    expect(redacted.groups[0]).not.toHaveProperty("transcriptPath");
    expect(redacted.groups[0]).not.toHaveProperty("memoryDir");
    expect(redacted.probeIntegrity.preSnapshotHash).toBe("aa");
    expect(redacted.probeIntegrity.changedPaths).toEqual(["redacted"]);
    expect(sha256Utf8(JSON.stringify(redacted))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps scope.denied as a minimal envelope", () => {
    const redacted = redactHealthReportForArchive({
      schema: "memory-health-report/v2",
      status: "denied",
      reasonCode: "scope.denied",
      reason: "Tenant context required for memory health probe",
      probeUtc: "t",
    });
    expect(redacted).toEqual({
      schema: "memory-health-report/v2",
      status: "denied",
      reasonCode: "scope.denied",
      reason: "Tenant context required for memory health probe",
      probeUtc: "t",
    });
    expect(redacted).not.toHaveProperty("agents");
    expect(redacted).not.toHaveProperty("runtime");
  });

  it("fail-closes when an absolute path remains", () => {
    expect(() => assertNoAbsolutePathLeak({ reason: "/secret/path" })).toThrow(/absolute paths/);
  });
});
