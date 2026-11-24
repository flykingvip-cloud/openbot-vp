import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { coreGatewayHandlers } from "../gateway/server-methods.js";
import { GATEWAY_METHOD_PACK_MANIFEST } from "../gateway/server-methods/packs/manifest.js";
import { GATEWAY_METHOD_PACKS } from "../gateway/server-methods/packs/registry.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import {
  DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST,
  DIAGNOSIS_PRODUCTION_COVERED_INCREMENTS,
  DIAGNOSIS_PRODUCTION_PENDING_HUMAN_APPROVALS,
  assertDiagnosisProductionApprovalUndeployed,
  evaluateDiagnosisProductionApproval,
  isDiagnosisProductionApprovalReady,
} from "./report-query-production-approval.js";
import { evaluateDiagnosisProductionReadiness } from "./report-query-production-rehearsal.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const fixtureTaskId = "diagnosis-write-policy-test-fixtures";
const fixturePaths = new Set([
  "src/batch1-capability-enablement/demos.test.ts",
  "src/batch1-capability-enablement/isolated-gateway.test.ts",
  "src/batch1-capability-enablement/isolated-loops.test.ts",
  "src/task-outcome/closed-loop-isolation-contract.test.ts",
]);
type AuditRegistry = {
  tasks: Array<{ id: string; paths: string[] }>;
  sharedPaths: Array<{ glob: string; landerTask: string }>;
  [key: string]: unknown;
};
function isAuthorizedFixtureRegistration(
  message: string,
  paths: string[],
  before: AuditRegistry,
  after: AuditRegistry,
): boolean {
  if (
    !message.split("\n").includes(`Task: ${fixtureTaskId}`) ||
    paths.length !== 1 ||
    paths[0] !== ".loom/registry.yaml"
  ) {
    return false;
  }
  const added = after.tasks.filter((task) => task.id === fixtureTaskId);
  const entries = after.sharedPaths.filter((entry) => entry.landerTask === fixtureTaskId);
  if (
    before.tasks.some((task) => task.id === fixtureTaskId) ||
    added.length !== 1 ||
    added[0].paths.length !== fixturePaths.size ||
    !added[0].paths.every((p) => fixturePaths.has(p)) ||
    entries.length !== fixturePaths.size ||
    !entries.every((entry) => fixturePaths.has(entry.glob))
  ) {
    return false;
  }
  // Only the explicitly authorized task and exact mappings may be added.
  return isDeepStrictEqual(before, {
    ...after,
    tasks: after.tasks.filter((task) => task.id !== fixtureTaskId),
    sharedPaths: after.sharedPaths.filter((entry) => entry.landerTask !== fixtureTaskId),
  });
}

const FORBIDDEN_SIDE_EFFECTS = [
  "appendSkillInvocationEvent",
  "writeConfigFile",
  "doctorCommand",
  "startChannel",
  "--fix",
  "createReportDatabase",
  "SkillHealthDB",
];

const FOREIGN_CHANGE_PREFIXES = [
  "ui/",
  "src/telegram/",
  "src/discord/",
  "src/slack/",
  "src/signal/",
  "src/imessage/",
  "src/web/",
  "src/channels/",
  "src/routing/",
  "apps/",
];

const DIAGNOSIS_UI_ALLOWLIST = [
  "ui/src/ui/ports/platform/diagnosis/",
  "ui/src/ui/ports/enterprise/diagnosis/",
  "ui/src/i18n/locales/",
  "ui/src/styles/enterprise-foundation.css",
  "ui/src/ui/app-settings.ts",
  "ui/src/ui/navigation.ts",
  "ui/src/ui/ports/enterprise/views/",
];

describe("Phase 3.10 — production approval pack", () => {
  it("summarizes P3.5-P3.9 contracts and keeps cutover closed", () => {
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.coveredIncrements).toEqual(
      DIAGNOSIS_PRODUCTION_COVERED_INCREMENTS,
    );
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.api.methods).toEqual([
      "diagnosis.reports.query",
      "diagnosis.reports.get",
    ]);
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.api.statusMapping.unavailable).toBe(503);
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.auth.trustedTenantSource).toBe(
      "server_membership_only",
    );
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.auth.nonAuthoritativeTenantSources).toContain(
      "sessionTenantId",
    );
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.reader.checks).toEqual([
      "schemaVersion",
      "tenantId",
      "maxAge",
      "payload",
    ]);
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.audit.persist).toBe("async_await_required");
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.quota.consume).toBe("consumeWindow");
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.redaction.profiles).toEqual([
      "administrator",
      "user",
      "system_local",
    ]);
    expect(
      DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.dependenciesRequireExplicitInjectionAndApproval,
    ).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.approvedForProductionCutover).toBe(false);
    expect(DIAGNOSIS_PRODUCTION_APPROVAL_MANIFEST.pendingHumanApprovals).toEqual(
      DIAGNOSIS_PRODUCTION_PENDING_HUMAN_APPROVALS,
    );
  });

  it("passes pre-merge security gates without registering live entrypoints", () => {
    const report = evaluateDiagnosisProductionApproval({
      livePacks: GATEWAY_METHOD_PACKS,
      coreHandlerNames: Object.keys(coreGatewayHandlers),
      readiness: evaluateDiagnosisProductionReadiness({ livePacks: GATEWAY_METHOD_PACKS }),
    });
    expect(DIAGNOSIS_REPORT_API_DEPLOYED).toBe(true);
    expect(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED).toBe(true);
    expect(report.preMerge.livePackRegistered).toBe(true);
    expect(report.preMerge.diagnosisHandlersRegistered).toBe(true);
    expect(GATEWAY_METHOD_PACKS.find((pack) => pack.id === "diagnosis-reports")).toBeDefined();
    expect(
      GATEWAY_METHOD_PACK_MANIFEST.find((entry) => entry.id === "diagnosis-reports"),
    ).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.query"]).toBeDefined();
    expect(coreGatewayHandlers["diagnosis.reports.get"]).toBeDefined();
    expect(isDiagnosisProductionApprovalReady(report)).toBe(true);
    expect(() => assertDiagnosisProductionApprovalUndeployed(report)).not.toThrow();
  });

  it("scans diagnosis production sources for side effects and secret hosts", () => {
    const files = [
      "report-query-production-approval.ts",
      "report-query-production-config.ts",
      "report-query-production-rehearsal.ts",
      "report-query-production-adapters.ts",
      "report-query-deploy.ts",
      "production-cutover.ts",
      "production-preflight.ts",
      "production-admission.ts",
      "production-approval-freeze.ts",
      "production-trunk-convergence.ts",
      path.join("..", "gateway", "server-methods", "packs", "registry.ts"),
      path.join("..", "gateway", "server-methods", "packs", "manifest.ts"),
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(here, file), "utf8");
      if (file === "report-query-deploy.ts") {
        expect(source).toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
      } else {
        expect(source).not.toContain("DIAGNOSIS_REPORT_API_DEPLOYED = true");
      }
      if (file === "report-query-production-adapters.ts") {
        expect(source).toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
      } else {
        expect(source).not.toContain("DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED = true");
      }
      expect(source).not.toContain("https://");
      expect(source).not.toContain("process.env");
      for (const token of FORBIDDEN_SIDE_EFFECTS) {
        expect(source).not.toContain(token);
      }
    }
    const approval = fs.readFileSync(
      path.join(here, "report-query-production-approval.ts"),
      "utf8",
    );
    expect(approval).toContain("Does not deploy");
    expect(approval).not.toContain("GATEWAY_METHOD_PACKS.push");
  });

  it("attributes diagnosis dirty files and keeps registry.yaml uncommitted", () => {
    const json = execFileSync("bun", ["scripts/agent-attribution.ts", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const payload = JSON.parse(json) as {
      unattributedCount?: number;
      conflictCount?: number;
      results: Array<{ path: string; owners?: Array<{ agentId: string }>; status?: string }>;
    };
    const diagnosisConflicts = payload.results.filter(
      (row) =>
        row.status === "conflict" &&
        (row.path.startsWith("src/diagnosis/") ||
          row.path.startsWith(".kiro/specs/openbot-diagnosis-platform/") ||
          row.path.startsWith("docs/design/openbot-diagnosis-")),
    );
    expect(diagnosisConflicts).toEqual([]);
    const agentsBlock = fs.readFileSync(
      path.join(repoRoot, ".kiro/specs/openbot-diagnosis-platform/tasks.md"),
      "utf8",
    );
    const claimed = payload.results.filter(
      (row) =>
        row.path.startsWith("src/diagnosis/") ||
        row.path.startsWith(".kiro/specs/openbot-diagnosis-platform/") ||
        row.path.startsWith("docs/design/openbot-diagnosis-"),
    );
    for (const row of claimed) {
      const signed =
        (row.owners ?? []).some((owner) => owner.agentId === "cursor-grok-diagnosis") ||
        agentsBlock.includes(row.path);
      expect(signed, row.path).toBe(true);
    }
    const log = execFileSync(
      "git",
      ["log", "origin/main..HEAD", "--format=%H %s", "--", ".loom/registry.yaml"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    // Loom task registration on feature branches may touch registry.yaml; diagnosis
    // work itself must not land those edits (message must not claim diagnosis task).
    const diagnosisRegistryCommits = log
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((line) => /diagnosis|openbot-diagnosis/i.test(line));
    const disallowedDiagnosisRegistryCommits = diagnosisRegistryCommits.filter((line) => {
      const [hash] = line.split(" ");
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      const message = git("show", "-s", "--format=%B", hash);
      const paths = git("diff-tree", "--no-commit-id", "--name-only", "-r", hash)
        .trim()
        .split("\n")
        .filter(Boolean);
      return !isAuthorizedFixtureRegistration(
        message,
        paths,
        parseYaml(git("show", `${hash}^:.loom/registry.yaml`)),
        parseYaml(git("show", `${hash}:.loom/registry.yaml`)),
      );
    });
    expect(disallowedDiagnosisRegistryCommits).toEqual([]);
  });

  it("keeps diagnosis commits attributed and free of UI or channel mix-ins", () => {
    const hashes = execFileSync("git", ["log", "origin/main..HEAD", "--no-merges", "--format=%H"], {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    if (hashes.length === 0) {
      const head = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
      const originMain = execFileSync("git", ["rev-parse", "origin/main"], {
        cwd: repoRoot,
        encoding: "utf8",
      }).trim();
      expect(head).toBe(originMain);
      return;
    }
    for (const hash of hashes) {
      const message = execFileSync("git", ["show", "-s", "--format=%B", hash], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      if (!message.includes("Task: openbot-diagnosis-platform")) {
        continue;
      }
      expect(message).toMatch(/Agent: cursor-grok(-diagnosis)?/);
      const files = execFileSync(
        "git",
        ["diff-tree", "--no-commit-id", "--name-only", "-r", hash],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const file of files) {
        const allowlisted = DIAGNOSIS_UI_ALLOWLIST.some((prefix) => file.startsWith(prefix));
        expect(
          allowlisted || !FOREIGN_CHANGE_PREFIXES.some((prefix) => file.startsWith(prefix)),
        ).toBe(true);
        expect(file).not.toBe(".loom/registry.yaml");
      }
    }
  });
});

describe("authorized fixture registration audit", () => {
  const before: AuditRegistry = { tasks: [], sharedPaths: [], landingStreams: [] };
  const after: AuditRegistry = {
    ...before,
    tasks: [{ id: fixtureTaskId, paths: [...fixturePaths] }],
    sharedPaths: [...fixturePaths].map((glob) => ({ glob, landerTask: fixtureTaskId })),
  };
  const message = `Governance registration\n\nTask: ${fixtureTaskId}`;
  it("accepts only the explicit test-only additive registration", () => {
    expect(isAuthorizedFixtureRegistration(message, [".loom/registry.yaml"], before, after)).toBe(
      true,
    );
  });
  it("rejects production paths, mixed commits and unrelated registry edits", () => {
    expect(
      isAuthorizedFixtureRegistration(
        message,
        [".loom/registry.yaml", "src/diagnosis/diagnose.ts"],
        before,
        after,
      ),
    ).toBe(false);
    expect(
      isAuthorizedFixtureRegistration(message, [".loom/registry.yaml"], before, {
        ...after,
        tasks: [{ id: fixtureTaskId, paths: ["src/diagnosis/diagnose.ts"] }],
      }),
    ).toBe(false);
    expect(
      isAuthorizedFixtureRegistration(message, [".loom/registry.yaml"], before, {
        ...after,
        landingStreams: [{ id: "unauthorized" }],
      }),
    ).toBe(false);
  });
});
