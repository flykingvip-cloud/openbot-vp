import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const ALLOWED_PROPOSAL_EXPORTS = new Set([
  "src/diagnosis/evolution-proposal.ts",
  "packages/evolution-core/src/types.ts",
]);

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

describe("evolution unification guardrails", () => {
  it("allows only Diagnosis v1 and evolution-core to export EvolutionProposal", () => {
    const files = [
      ...walkTsFiles(join(ROOT, "src")),
      ...walkTsFiles(join(ROOT, "packages/evolution-core/src")),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      if (!/export\s+type\s+EvolutionProposal\b/.test(text)) {
        continue;
      }
      if (!ALLOWED_PROPOSAL_EXPORTS.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the passing observation provider out of production modules", () => {
    for (const rel of [
      "src/gateway/evolution-control/observation.ts",
      "src/gateway/evolution-control/index.ts",
      "src/gateway/evolution-control/gateway-plane.ts",
      "src/gateway/evolution-control/control-plane.ts",
    ] as const) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text).not.toMatch(/createPassingObservationProvider/);
    }
  });

  it("keeps Tick writer capability inside the governance SoT closure", () => {
    const capabilityRel = "src/gateway/evolution-governance/tick-writer-capability.ts";
    const allowedImporters = new Set([
      "src/gateway/evolution-governance/tick-pipeline.ts",
      "src/gateway/evolution-governance/effect-observations.ts",
      "src/gateway/evolution-governance/effect-verifications.ts",
    ]);
    const allTs: string[] = [];
    const walkAll = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walkAll(full);
          continue;
        }
        if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
          allTs.push(full);
        }
      }
    };
    walkAll(join(ROOT, "src"));
    walkAll(join(ROOT, "packages/evolution-core/src"));
    const importOffenders: string[] = [];
    const issuerOffenders: string[] = [];
    for (const file of allTs) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      const text = readFileSync(file, "utf8");
      if (rel !== capabilityRel && /from\s+["'][^"']*tick-writer-capability\.js["']/.test(text)) {
        if (!allowedImporters.has(rel)) {
          importOffenders.push(rel);
        }
      }
      if (
        rel !== capabilityRel &&
        !rel.endsWith(".test.ts") &&
        /\bissueGovernanceTickWriterCapability\b/.test(text)
      ) {
        issuerOffenders.push(rel);
      }
    }
    expect(importOffenders).toEqual([]);
    expect(issuerOffenders).toEqual([]);
    const capabilityText = readFileSync(join(ROOT, capabilityRel), "utf8");
    expect(capabilityText).not.toMatch(/export function issueGovernanceTickWriterCapability/);
    expect(capabilityText).toMatch(/export const governanceTickWriters/);
    expect(capabilityText).toMatch(/module-private brand \+ import guard/);
    expect(capabilityText).toMatch(/not a cryptographic or process-level unforgeable capability/);
    const observations = readFileSync(
      join(ROOT, "src/gateway/evolution-governance/effect-observations.ts"),
      "utf8",
    );
    const verifications = readFileSync(
      join(ROOT, "src/gateway/evolution-governance/effect-verifications.ts"),
      "utf8",
    );
    expect(observations).toMatch(/assertTickWriterCapability/);
    expect(observations).not.toMatch(/governanceTickWriters/);
    expect(verifications).toMatch(/assertTickWriterCapability/);
    expect(verifications).not.toMatch(/governanceTickWriters/);
  });

  it("keeps verifier install handles inside the composition root", () => {
    const allowedImporters = new Set([
      "src/gateway/evolution-control/external-effect-registry.ts",
      "src/gateway/evolution-control/gateway-plane.ts",
      "src/gateway/evolution-control/test-support.ts",
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts") || entry.endsWith(".d.ts")) {
          continue;
        }
        const rel = relative(ROOT, full).replaceAll("\\", "/");
        const text = readFileSync(full, "utf8");
        if (/createCompositionRootVerifierHandle/.test(text) && !allowedImporters.has(rel)) {
          offenders.push(rel);
        }
      }
    };
    walk(join(ROOT, "src"));
    walk(join(ROOT, "packages/evolution-core/src"));
    expect(offenders).toEqual([]);
    const index = readFileSync(join(ROOT, "src/gateway/evolution-control/index.ts"), "utf8");
    expect(index).not.toMatch(/createCompositionRootVerifierHandle/);
    const skillVerifier = readFileSync(
      join(ROOT, "src/gateway/evolution-control/verifiers/skill-installation-raw.ts"),
      "utf8",
    );
    const dnaVerifier = readFileSync(
      join(ROOT, "src/gateway/evolution-control/verifiers/working-dna-raw.ts"),
      "utf8",
    );
    expect(skillVerifier).not.toMatch(/adapters\/skill/);
    expect(skillVerifier).not.toMatch(/installSkillToRobotAsset|upgradeRobotSkillAsset/);
    expect(dnaVerifier).not.toMatch(/adapters\/working-dna/);
    expect(dnaVerifier).not.toMatch(/from ["'].*working-dna\.js["']/);
  });

  it("keeps Diagnosis off mutation adapters and runtime actions", () => {
    const text = readFileSync(join(ROOT, "src/diagnosis/evolution-proposal.ts"), "utf8");
    expect(text).not.toMatch(/evolution-control\/adapters/);
    expect(text).not.toMatch(/evolution-governance\/runtime-actions/);
    expect(text).not.toMatch(/working-style-store/);
    expect(text).not.toMatch(/skill-lifecycle-store/);
  });

  it("does not add legacy Capsule failureCluster backfill or migration scripts", () => {
    const forbidden = [
      /backfill.*failureCluster/i,
      /migrate.*capsule.*cluster/i,
      /repair.*legacy.*capsule/i,
      /infer.*failureClusterRef/i,
      /batch.*failureCluster/i,
    ];
    const scanRoots = [
      join(ROOT, "scripts"),
      join(ROOT, "src/gateway/collaboration-learning"),
      join(ROOT, "src/gateway/evolution-control"),
      join(ROOT, "packages/evolution-core/src"),
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      if (!statSync(dir).isDirectory()) {
        return;
      }
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|js|sh|mjs)$/.test(entry) || entry.endsWith(".d.ts")) {
          continue;
        }
        if (/historical-closure(\.test)?\.ts$/.test(entry)) {
          continue;
        }
        const rel = relative(ROOT, full).replaceAll("\\", "/");
        const text = readFileSync(full, "utf8");
        if (forbidden.some((pattern) => pattern.test(text))) {
          offenders.push(rel);
        }
      }
    };
    for (const root of scanRoots) {
      walk(root);
    }
    expect(offenders).toEqual([]);
    const eligibility = readFileSync(
      join(ROOT, "packages/evolution-core/src/capsule-eligibility.ts"),
      "utf8",
    );
    expect(eligibility).toMatch(
      /infers a cluster from title, body, sourceIds, or embedding similarity/,
    );
    expect(eligibility).toMatch(/legacy_missing_failure_cluster/);
    const historical = readFileSync(
      join(ROOT, "packages/evolution-core/src/historical-closure.ts"),
      "utf8",
    );
    expect(historical).toMatch(/accepted_permanent_exclusion/);
    expect(historical).toMatch(/recoverable: false/);
    expect(historical).toMatch(/"migrate"/);
    expect(historical).toMatch(/"infer"/);
    expect(historical).toMatch(/"backfill"/);
    const docs = [
      "docs/design/openbot-evolution-control-state-mapping-v1.md",
      "docs/design/openbot-evolution-eligible-data-closure-report-v1.md",
    ].map((rel) => readFileSync(join(ROOT, rel), "utf8"));
    for (const doc of docs) {
      expect(doc).toMatch(/accepted_permanent_exclusion/);
      expect(doc).toMatch(/不得宣称[\s\S]*五链全历史生产闭环已完成/);
      expect(doc).toMatch(/不得宣称[\s\S]*所有 Capsule 都可计算 recurrence/);
    }
  });

  it("keeps external effect submitResult fail closed", () => {
    const service = readFileSync(
      join(ROOT, "src/gateway/evolution-control/external-effect-service.ts"),
      "utf8",
    );
    expect(service).toMatch(/submitResult\(_input: unknown\): never/);
    expect(service).toMatch(/only be produced by verifyBoundRequest/);
  });
});
