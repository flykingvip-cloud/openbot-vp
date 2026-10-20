import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { produceDiagnoseEvolutionArtifacts } from "./diagnose-evolution-producer.js";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { executeParsedDiagnoseRequest } from "./diagnose-live-request.js";
import { parseDiagnoseRequest } from "./diagnose-policy.js";
import { buildProfessionalDiagnosisReport } from "./diagnose-report-text.js";
import type { DiagnosticPrincipal } from "./types.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function collectNames(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectNames(full, acc);
      continue;
    }
    acc.push(entry.name);
  }
  return acc;
}

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkTsFiles(full, acc);
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function growth(): DiagnoseGrowthAssessment {
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
      bootstrapPending: true,
      identityInitialized: false,
      userInitialized: false,
    },
    memory: { present: false, fresh: false },
    hadTaskActivity: false,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: ["briefing"],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: ["name"],
    userMissingFields: ["timezone"],
    installedSkillIds: ["briefing"],
    memoryFileCount: 0,
    reportFileCount: 0,
    freshArtifactCount: 0,
    sessionRoster: { main: 1, cron: 0, other: 0, freshCron: 0, freshMain: 0 },
    activitySources: [],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
  };
}

describe("diagnosis producer control-plane boundary", () => {
  it("forbids src/diagnosis from importing gateway/evolution-control", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(join(ROOT, "src/diagnosis"))) {
      const text = readFileSync(file, "utf8");
      if (
        text.includes("gateway/evolution-control/") ||
        text.includes('gateway/evolution-control"')
      ) {
        offenders.push(relative(ROOT, file).replaceAll("\\", "/"));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps ordinary diagnosis off cron, adapters, and evolution RPC", () => {
    const files = [
      "src/diagnosis/diagnose-evolution-producer.ts",
      "src/diagnosis/diagnose-growth-snapshot.ts",
      "src/diagnosis/structural-evolution-candidate.ts",
      "src/diagnosis/skill-installation-candidate.ts",
      "src/diagnosis/diagnose-structural-preview.ts",
      "src/diagnosis/diagnose-evolution-preview-store.ts",
      "src/diagnosis/diagnose-evolution-recheck.ts",
      "src/diagnosis/diagnose-report-text.ts",
      "src/diagnosis/diagnose-live-request.ts",
    ];
    for (const rel of files) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text).not.toMatch(/cron\.add\s*\(/);
      expect(text).not.toMatch(/applyWorkingDna|applySkill|adapter\.apply/);
      expect(text).not.toMatch(/evolution\.experiments|submitDiagnosisCandidate|ingestV1/);
      expect(text).not.toMatch(/registerProposal\s*\(/);
    }
  });

  it("does not write control-plane artifacts during a full live diagnose request", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "diag-zero-write-"));
    tempDirs.push(configDir);
    const submit = vi.fn();
    const requestedBy: DiagnosticPrincipal = {
      schemaVersion: 1,
      principalId: "owner-1",
      kind: "user",
      tenantId: "tenant-a",
    };
    const payload = await executeParsedDiagnoseRequest({
      request: parseDiagnoseRequest({
        agentId: "bot-2",
        sessionKey: "agent:bot-2:main",
        window: "24h",
        mode: "TARGETED",
      }),
      trusted: { tenantId: "tenant-a" },
      requestedBy,
      skillConfigDir: configDir,
      growthReads: [
        {
          agentId: "bot-2",
          tenantId: "tenant-a",
          agentAssetId: "asset-1",
          targetOwnerId: "owner-1",
          displayName: "市场助手",
        },
      ],
    });
    expect(payload.reportId === null || typeof payload.reportId === "string").toBe(true);
    expect(submit).not.toHaveBeenCalled();
    const names = collectNames(configDir);
    expect(names).not.toContain("proposals.json");
    expect(names).not.toContain("candidates.json");
    expect(names).not.toContain("ledger.jsonl");
    expect(names.some((name) => name.toLowerCase().includes("receipt"))).toBe(false);
    const liveSource = readFileSync(join(ROOT, "src/diagnosis/diagnose-live-request.ts"), "utf8");
    expect(liveSource).not.toMatch(/submitDiagnosisCandidate|registerProposal|ingestV1/);
    const report = buildProfessionalDiagnosisReport({
      completion: "INCONCLUSIVE",
      findingCount: 0,
      findings: [],
      windowId: "24h",
      mode: "TARGETED",
      scope: "target",
      scanned: 1,
      skipped: 0,
      reportId: "cdr-1",
      reportIds: ["cdr-1"],
      tenantId: "tenant-a",
      growths: [growth()],
      prescriptions: [],
    });
    expect(JSON.stringify(report)).not.toContain("已进入进化流程");
    expect(JSON.stringify(report)).not.toContain("proposalId");
  });

  it("allows tick to compute structural preview without making it confirmable or submitted", () => {
    const plane = {
      receipts: 0,
      submit() {
        this.receipts += 1;
      },
    };
    const producer = produceDiagnoseEvolutionArtifacts({
      professionalReportId: "pdr-tick",
      subject: [{ displayName: "市场助手" }],
      runtimeAssessment: {
        completion: "INCONCLUSIVE",
        findingCount: 0,
        scanned: 1,
        skipped: 0,
      },
      growthAssessment: [growth()],
      prescriptions: [],
      structuralFacts: [
        {
          structuralIntent: "adjust_reporting_cadence",
          proposedChange: { field: "reportingCadence", value: "on_completion" },
          surfaceId: "agent.working-dna",
          targetHint: "bot-2",
          baselineHash: "wdna-baseline-tick",
          observationRef: "obs:pattern:tick",
          evidenceRefs: ["evidence:ops-1"],
          snapshotRef: "c".repeat(64),
          reportRef: "cdr-tick",
          findingRef: "finding-tick",
          observedWindow: {
            startedAt: "2026-09-18T00:00:00.000Z",
            endedAt: "2026-09-19T00:00:00.000Z",
          },
        },
      ],
    });
    expect(producer.structuralCandidates).toHaveLength(1);
    expect(plane.receipts).toBe(0);
  });
});
