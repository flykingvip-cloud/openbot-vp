import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const currentStatePath = ".kiro/specs/constitutional-governance-state-convergence/current-state.md";
const baselinePath =
  "docs/design/evidence/constitutional-governance-state-baseline-2026-09-27.json";
const matrixPath = "docs/design/evidence/constitutional-governance-state-matrix-2026-09-27.json";
const productionBaselinePath =
  "docs/design/evidence/constitutional-governance-production-baseline-2026-09-27.json";
const decisionPath = ".kiro/specs/constitutional-governance-phase-c-decision/decision.md";
const acceptancePath = ".kiro/specs/constitutional-governance-phase-c-decision/final-acceptance.md";
const frozenMarker = "<!-- FROZEN_BODY_BEGIN -->\n\n";
const frozenDecisionSha = "bba958653f902f519f9d902b75423e4510c1d8eb025d3732b0149f3cebfd762b";
const receiptSha = {
  architecture: "df95c2344e2cf6e8ebfed886526a2e3b84c6c5914c7ab0d0581b5a152cab84b9",
  security: "6e8505ab22b394fa50407185e15229d9a3adf981f7e206fa2377a3181838aa39",
  executionChain: "d6132d46d25eb427b13df8642edc43dabc8d9004acb86fd8153c6f6b7065a8d3",
} as const;

type SliceEvidence = {
  status: "found" | "not-found";
  path: string | null;
  commit: string | null;
  contentCommit: string | null;
  pullRequest: number | null;
  searchScope: string | null;
  note: string;
};

type SliceAuthorization = {
  constitutesOverallGovernanceAuthorization: boolean;
  designStatus: "bounded-authorized" | "not-found";
  implementationStatus: "landed" | "authorized-not-landed" | "docs-only" | "not-found";
  ceiling: string;
  coexistence: string;
  acceptance: SliceEvidence;
  scope: SliceEvidence;
  startOrder: SliceEvidence;
  implementation: SliceEvidence;
  additionalSlices?: SliceAuthorization[];
  notThisSlice?: Array<{ path: string; commit: string; contentCommit: string }>;
};

type GovernanceAuthorization = {
  scope: "phase-d-as-a-whole";
  status: "no-go";
  constrainedBy: "phase-c-no-go-accepted";
  sliceConstitutesOverall: boolean;
};

type MatrixModule = {
  id: string;
  phase: string;
  productionObserved: boolean;
  productionProven: boolean;
  runtimeEnabled: boolean;
  enforcementEnabled: boolean;
  liveInvokeEnabled: boolean;
  defaultOn: boolean;
  decision: string;
  designAuthorized?: boolean;
  implementationAuthorized?: boolean;
  governanceAuthorization?: GovernanceAuthorization;
  sliceAuthorization?: SliceAuthorization;
};

type Matrix = {
  authorityFile: string;
  phaseCCurrentDecision: string;
  phaseDModel: string;
  phaseDComponentIds: string[];
  phaseDGovernanceAuthorization: { status: string; note: string };
  profileABMerged: boolean;
  seq98ExtrapolatedToPhaseCOrDPass: boolean;
  receiptTreatedAsProof: boolean;
  pluginInstallTreatedAsCapabilityAuthorized: boolean;
  modules: MatrixModule[];
};

type Baseline = {
  originMainSha: string;
  runningContainerSha: null;
  runningContainerStatus: string;
  ledgerGatewaySha: string;
  releaseSeq: number;
  ledgerOpenLive: boolean;
  containerLedgerAligned: null;
  productionEqualsMain: boolean;
  commitsOriginMainAheadOfLedgerGateway: number;
  constitutionalFlags: {
    CONSTITUTIONAL_CONTRACTS_ENFORCE: boolean;
    CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE: boolean;
    CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON: boolean;
  };
  orchestrationFlags: { ORCHESTRATION_LIVE_INVOKE: boolean };
  hardStopTriggered: boolean;
};

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path, acc);
    } else {
      acc.push(path);
    }
  }
  return acc;
}

const currentState = read(currentStatePath);
const baseline = JSON.parse(read(baselinePath)) as Baseline;
const matrix = JSON.parse(read(matrixPath)) as Matrix;
const acceptance = read(acceptancePath);
const decision = read(decisionPath);

describe("constitutional governance state convergence", () => {
  it("keeps a single current-state authority file", () => {
    const matches = walk(".kiro/specs").filter((path) => path.endsWith("/current-state.md"));
    expect(matches).toEqual([currentStatePath]);
    const sot = walk(".kiro")
      .concat(walk("docs/design"))
      .filter((path) => read(path).includes("authorityRole: current-state-sot"));
    expect(sot).toEqual([currentStatePath]);
    expect(matrix.authorityFile).toBe(currentStatePath);
  });

  it("records one Phase C decision: NO-GO accepted", () => {
    expect(currentState).toContain("phaseCCurrentDecision: no-go-accepted");
    expect(currentState).toContain("NO-GO accepted");
    expect(matrix.phaseCCurrentDecision).toBe("no-go");
    expect(acceptance).toContain("Decision: NO-GO");
    expect(acceptance).toContain("Independent acceptance: COMPLETE");
    expect(decision).toContain("Current authority:");
    expect(decision).toContain("NO-GO accepted");
    const frozen = decision.slice(decision.indexOf(frozenMarker) + frozenMarker.length);
    expect(frozen).toContain("REVISE");
    expect(createHash("sha256").update(frozen).digest("hex")).toBe(frozenDecisionSha);
  });

  it("matches reviewer receipt hashes to final-acceptance", () => {
    expect(
      sha256(
        ".kiro/specs/constitutional-governance-phase-c-decision/reviews/architecture-review.md",
      ),
    ).toBe(receiptSha.architecture);
    expect(
      sha256(".kiro/specs/constitutional-governance-phase-c-decision/reviews/security-review.md"),
    ).toBe(receiptSha.security);
    expect(
      sha256(
        ".kiro/specs/constitutional-governance-phase-c-decision/reviews/execution-chain-review.md",
      ),
    ).toBe(receiptSha.executionChain);
    expect(acceptance).toContain(receiptSha.architecture);
    expect(acceptance).toContain(receiptSha.security);
    expect(acceptance).toContain(receiptSha.executionChain);
  });

  it("keeps constitutional and orchestration execution switches off", () => {
    const flags = read("packages/constitutional-contracts/src/flags.ts");
    expect(flags).toContain("export const CONSTITUTIONAL_CONTRACTS_ENFORCE = false as const;");
    expect(flags).toContain("export const CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE = false as const;");
    expect(flags).toContain(
      "export const CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON = false as const;",
    );
    expect(read("src/task-orchestration/types.ts")).toContain(
      "export const ORCHESTRATION_LIVE_INVOKE = false;",
    );
    expect(baseline.constitutionalFlags.CONSTITUTIONAL_CONTRACTS_ENFORCE).toBe(false);
    expect(baseline.constitutionalFlags.CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE).toBe(false);
    expect(baseline.constitutionalFlags.CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON).toBe(false);
    expect(baseline.orchestrationFlags.ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(baseline.hardStopTriggered).toBe(false);
  });

  it("keeps B2 from enqueue, invoke, and ledger writes", () => {
    const evalSource = read("src/task-orchestration/web-read-shadow-eval.ts");
    const hook = read("src/task-orchestration/gateway-hook.ts");
    expect(evalSource).toContain("enqueue: false");
    expect(evalSource).toContain("invoke: false");
    expect(evalSource).toContain("wroteLedger: false");
    expect(evalSource).not.toMatch(/enqueue:\s*true/);
    expect(evalSource).not.toMatch(/invoke:\s*true/);
    expect(evalSource).not.toMatch(/wroteLedger:\s*true/);
    expect(hook).toContain("wroteLedger: false");
    expect(hook).not.toMatch(/wroteLedger:\s*true/);
    expect(hook).not.toMatch(/releases\.jsonl|appendFile|createWriteStream/);
    expect(hook).toContain("if (!(orchOn && webReadOn))");
  });

  it("does not mark Phase D code-present as production-proven", () => {
    const phaseD = matrix.modules.filter((row) => row.phase === "D");
    expect(phaseD.length).toBeGreaterThanOrEqual(8);
    for (const row of phaseD) {
      expect(row.productionProven).toBe(false);
      expect(row.productionObserved).toBe(false);
      expect(row.runtimeEnabled).toBe(false);
      expect(row.enforcementEnabled).toBe(false);
      expect(row.liveInvokeEnabled).toBe(false);
      expect(row.defaultOn).toBe(false);
      expect(row.decision).toBe("no-go");
      expect(row).not.toHaveProperty("designAuthorized");
      expect(row).not.toHaveProperty("implementationAuthorized");
    }
  });

  it("separates Phase D governance no-go from bounded slice authorization", () => {
    expect(matrix.phaseDModel).toBe("governance-authorization-separated-from-bounded-slice");
    expect(matrix.phaseDGovernanceAuthorization.status).toBe("no-go");
    expect(matrix.phaseDGovernanceAuthorization.note).toContain("不构成");
    expect(currentState).toContain("整体治理授权");
    expect(currentState).toContain("有界切片授权");
    expect(currentState).toContain("不构成整体治理授权");
    expect(currentState).toContain("未找到");

    const slices: SliceAuthorization[] = [];
    const collect = (slice: SliceAuthorization) => {
      slices.push(slice);
      for (const extra of slice.additionalSlices ?? []) {
        collect(extra);
      }
    };

    for (const id of matrix.phaseDComponentIds) {
      const row = matrix.modules.find((item) => item.id === id);
      expect(row, id).toBeDefined();
      expect(row?.governanceAuthorization?.status).toBe("no-go");
      expect(row?.governanceAuthorization?.sliceConstitutesOverall).toBe(false);
      expect(row?.governanceAuthorization?.constrainedBy).toBe("phase-c-no-go-accepted");
      const slice = row?.sliceAuthorization;
      expect(slice, id).toBeDefined();
      if (!slice) {
        continue;
      }
      expect(slice.constitutesOverallGovernanceAuthorization).toBe(false);
      expect(slice.coexistence.length).toBeGreaterThan(0);
      expect(slice.ceiling.length).toBeGreaterThan(0);
      collect(slice);
      if (slice.designStatus === "bounded-authorized") {
        expect(slice.acceptance.status === "found" || slice.scope.status === "found").toBe(true);
      }
      if (slice.designStatus === "not-found") {
        expect(slice.acceptance.status).toBe("not-found");
        expect(slice.scope.status).toBe("not-found");
        expect(slice.startOrder.status).toBe("not-found");
      }
      if (slice.implementationStatus === "landed") {
        expect(slice.implementation.status).toBe("found");
      }
      if (slice.implementationStatus !== "landed") {
        expect(slice.implementation.status).toBe("not-found");
        expect(slice.implementation.searchScope?.length).toBeGreaterThan(10);
      }
    }

    const sha = /^[0-9a-f]{40}$/;
    for (const slice of slices) {
      expect(slice.constitutesOverallGovernanceAuthorization).toBe(false);
      for (const evidence of [
        slice.acceptance,
        slice.scope,
        slice.startOrder,
        slice.implementation,
      ]) {
        if (evidence.status === "found") {
          expect(evidence.path).toEqual(expect.any(String));
          expect(existsSync(evidence.path as string)).toBe(true);
          expect(evidence.commit).toMatch(sha);
          expect(evidence.contentCommit).toMatch(sha);
          expect(evidence.note).not.toContain("整体治理授权：go");
        } else {
          expect(evidence.status).toBe("not-found");
          expect(evidence.path).toBeNull();
          expect(evidence.commit).toBeNull();
          expect(evidence.note).toContain("未找到");
          expect(evidence.searchScope?.length).toBeGreaterThan(10);
        }
      }
      for (const rejected of slice.notThisSlice ?? []) {
        expect(existsSync(rejected.path)).toBe(true);
        expect(rejected.commit).toMatch(sha);
        expect(rejected.contentCommit).toMatch(sha);
      }
    }

    const shadow = matrix.modules.find((row) => row.id === "orchestration-shadow");
    expect(shadow?.phase).toBe("B2");
    expect(shadow?.designAuthorized).toBe(true);
    expect(shadow?.sliceAuthorization?.designStatus).toBe("not-found");
    expect(shadow?.governanceAuthorization?.status).toBe("no-go");
  });

  it("does not extrapolate seq 98 into Phase C or Phase D pass", () => {
    expect(matrix.seq98ExtrapolatedToPhaseCOrDPass).toBe(false);
    expect(baseline.releaseSeq).toBe(98);
    expect(baseline.ledgerOpenLive).toBe(true);
    expect(baseline.productionEqualsMain).toBe(false);
    expect(baseline.originMainSha).not.toBe(baseline.ledgerGatewaySha);
    expect(baseline.commitsOriginMainAheadOfLedgerGateway).toBeGreaterThan(0);
    expect(baseline.runningContainerSha).toBeNull();
    expect(baseline.runningContainerStatus).toBe("unavailable");
    expect(baseline.containerLedgerAligned).toBeNull();
    const observation = matrix.modules.find((row) => row.id === "b2-production-observation");
    expect(observation?.productionObserved).toBe(true);
    expect(observation?.productionProven).toBe(false);
    expect(currentState).toContain(baseline.originMainSha);
    expect(currentState).toContain(baseline.ledgerGatewaySha);
    expect(currentState).toContain("不能得到 Phase C 通过");
  });

  it("keeps Profile A/B split, receipt distinct from proof, and install distinct from authorization", () => {
    expect(matrix.profileABMerged).toBe(false);
    expect(matrix.receiptTreatedAsProof).toBe(false);
    expect(matrix.pluginInstallTreatedAsCapabilityAuthorized).toBe(false);
    expect(currentState).toContain("profileABMerged: false");
    expect(currentState).toContain("receiptTreatedAsProof: false");
    expect(currentState).toContain("pluginInstallTreatedAsCapabilityAuthorized: false");
    const registry = read("packages/constitutional-registry/src/boundary.ts");
    expect(registry).toContain("profileMerge: false");
    expect(registry).toContain("receiptEqualsProof: false");
    expect(registry).toContain("pluginInstalledEqualsAuthorized: false");
    const flags = read("packages/constitutional-contracts/src/flags.ts");
    expect(flags).toContain("receiptIsNotProof: true");
    expect(flags).toContain("pluginInstalledIsNotCapabilityAuthorized: true");
  });

  it("marks conflicting historical files as superseded", () => {
    const historical = [
      ".kiro/specs/constitutional-governance-discovery/tasks.md",
      ".kiro/specs/constitutional-governance-web-read-shadow/tasks.md",
      ".kiro/specs/constitutional-governance-phase-c-decision/tasks.md",
      decisionPath,
      acceptancePath,
    ];
    for (const path of historical) {
      const text = read(path);
      expect(text).toContain("Historical status:");
      expect(text).toContain("Superseded by:");
      expect(text).toContain("Current authority:");
      expect(text).toContain(currentStatePath);
    }
  });

  it("keeps the production baseline readback as supporting evidence with a null container", () => {
    expect(existsSync(productionBaselinePath)).toBe(true);
    const text = read(productionBaselinePath);
    expect(text).toContain('"authorityRole": "supporting-evidence"');
    expect(text).not.toContain("authorityRole: current-state-sot");
    const evidence = JSON.parse(text) as {
      authorityRole: string;
      originMainSha: string;
      runningContainerSha: null;
      containerLedgerAligned: null;
      productionEqualsMain: null;
      containerIdentity: { containerReadStatus: string; failureClass: string; commit: null };
      releaseSeq: number;
      ledgerGatewaySha: string;
      ledgerUiSha: string;
      ledgerAuditExit: number;
      ledgerAuditFirstError: null;
      containerIsAncestorOfMain: null;
      ledgerIsAncestorOfMain: boolean;
      ledgerIsAncestorOfContainer: null;
      containerIsAncestorOfLedger: null;
      containerEqualsLedger: null;
      containerEqualsMain: null;
      ledgerEqualsMain: boolean;
      commitsOriginMainAheadOfLedgerGateway: number;
      ancestry: {
        containerIsAncestorOfMain: { status: string; exitCode: null };
        ledgerIsAncestorOfMain: { exitCode: number };
        ledgerIsAncestorOfContainer: { status: string; exitCode: null };
        containerIsAncestorOfLedger: { status: string; exitCode: null };
      };
      forwardOnly: { exitCode: number; verdict: string; live: null; liveSource: string };
      phaseCDecision: string;
      phaseDOverallGovernanceAuthorization: string;
      productionProven: boolean;
      gateTighteningAuthorized: boolean;
      liveInvokeEnabled: boolean;
      fabricDefaultOn: boolean;
      closeGateMet: boolean;
    };
    expect(evidence.authorityRole).toBe("supporting-evidence");
    expect(evidence.runningContainerSha).toBeNull();
    expect(evidence.containerLedgerAligned).toBeNull();
    expect(evidence.productionEqualsMain).toBeNull();
    expect(evidence.containerIdentity.containerReadStatus).toBe("unavailable");
    expect(evidence.containerIdentity.commit).toBeNull();
    expect(evidence.containerIdentity.failureClass).toContain("production-host-unreachable");
    expect(evidence.runningContainerSha).not.toBe(evidence.ledgerGatewaySha);
    expect(evidence.releaseSeq).toBe(98);
    expect(evidence.ledgerGatewaySha).toBe(baseline.ledgerGatewaySha);
    expect(evidence.ledgerUiSha).toBe(evidence.ledgerGatewaySha);
    expect(evidence.ledgerAuditExit).toBe(0);
    expect(evidence.ledgerAuditFirstError).toBeNull();
    expect(evidence.ancestry.containerIsAncestorOfMain.status).toBe("not-run");
    expect(evidence.ancestry.containerIsAncestorOfMain.exitCode).toBeNull();
    expect(evidence.ancestry.ledgerIsAncestorOfContainer.status).toBe("not-run");
    expect(evidence.ancestry.ledgerIsAncestorOfContainer.exitCode).toBeNull();
    expect(evidence.ancestry.containerIsAncestorOfLedger.status).toBe("not-run");
    expect(evidence.ancestry.containerIsAncestorOfLedger.exitCode).toBeNull();
    expect(evidence.ancestry.ledgerIsAncestorOfMain.exitCode).toBe(0);
    expect(evidence.containerIsAncestorOfMain).toBeNull();
    expect(evidence.ledgerIsAncestorOfMain).toBe(true);
    expect(evidence.ledgerIsAncestorOfContainer).toBeNull();
    expect(evidence.containerIsAncestorOfLedger).toBeNull();
    expect(evidence.containerEqualsLedger).toBeNull();
    expect(evidence.containerEqualsMain).toBeNull();
    expect(evidence.ledgerEqualsMain).toBe(false);
    expect(evidence.commitsOriginMainAheadOfLedgerGateway).toBe(219);
    expect(evidence.forwardOnly.exitCode).toBe(21);
    expect(evidence.forwardOnly.verdict).toBe("block");
    expect(evidence.forwardOnly.live).toBeNull();
    expect(evidence.forwardOnly.liveSource).toBe("none");
    expect(evidence.phaseCDecision).toBe("NO_GO_ACCEPTED");
    expect(evidence.phaseDOverallGovernanceAuthorization).toBe("no-go");
    expect(evidence.productionProven).toBe(false);
    expect(evidence.gateTighteningAuthorized).toBe(false);
    expect(evidence.liveInvokeEnabled).toBe(false);
    expect(evidence.fabricDefaultOn).toBe(false);
    expect(evidence.closeGateMet).toBe(false);
    expect(currentState).toContain(`originMainSha: ${evidence.originMainSha}`);
    expect(currentState).toContain("phaseCDecision: NO_GO_ACCEPTED");
    expect(currentState).toContain("phaseDOverallGovernanceAuthorization: no-go");
    expect(currentState).toContain("productionProven: false");
    expect(currentState).toContain("gateTighteningAuthorized: false");
    expect(currentState).toContain("liveInvokeEnabled: false");
    expect(currentState).toContain("fabricDefaultOn: false");
    expect(currentState).toContain("closeGateMet: false");
    expect(currentState).toContain("runningContainerSha: null");
    expect(currentState).toContain("containerLedgerAligned: null");
    expect(currentState).toContain("productionEqualsMain: null");
    expect(currentState).toContain(String(evidence.commitsOriginMainAheadOfLedgerGateway));
    const matrixText = read(matrixPath);
    expect(matrixText).toContain(productionBaselinePath);
    expect(matrix.phaseDGovernanceAuthorization.status).toBe("no-go");
  });
});
