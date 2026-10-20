import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeGovernanceEffectWindow,
  listGovernanceEffectVerifications,
  openGovernanceEffectWindow,
  persistOpenWindowEvaluation,
  registerRuntimeEffectVerifier,
  revokeGovernanceEffectWindowsForApplication,
  submitGovernanceEffectDecision,
  submitTickEffectDecision,
} from "./effect-verifications.js";
import * as governanceBarrel from "./index.js";

describe("governance effect verification API", () => {
  let configDir = "";

  afterEach(() => {
    if (configDir) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  function isolatedDir(): string {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "obx-gov-effect-"));
    return configDir;
  }

  it("does not export Tick writer capability or probe writer from the public barrel", () => {
    expect("issueGovernanceTickWriterCapability" in governanceBarrel).toBe(false);
    expect("governanceTickWriters" in governanceBarrel).toBe(false);
    expect("assertTickWriterCapability" in governanceBarrel).toBe(false);
    expect("recordRuntimeProbeEffectObservation" in governanceBarrel).toBe(false);
    expect("submitTickEffectDecision" in governanceBarrel).toBe(false);
    expect("persistOpenWindowEvaluation" in governanceBarrel).toBe(false);
    expect("runInGovernanceTickScope" in governanceBarrel).toBe(false);
  });

  it("opens a bound window once per commandId and rejects a second live application", () => {
    const dir = isolatedDir();
    const first = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "evolution:a",
        action: "pause",
        commandId: "cmd-a",
        binding: {
          proposalId: "evo:a",
          experimentId: "exp-a",
          applicationId: "app:a",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:a",
        },
      },
      dir,
    );
    const again = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "evolution:a",
        action: "pause",
        commandId: "cmd-a",
        binding: {
          proposalId: "evo:a",
          experimentId: "exp-a",
          applicationId: "app:a",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:a",
        },
      },
      dir,
    );
    expect(again.id).toBe(first.id);
    expect(first.minimumSampleSize).toBe(20);
    expect(first.evaluationCount).toBe(0);
    expect(first.nextEvaluateAt).toBeTruthy();
    expect(listGovernanceEffectVerifications(dir)).toHaveLength(1);
    expect(() =>
      openGovernanceEffectWindow(
        {
          runtimeAgentId: "bot-a",
          reason: "evolution:b",
          action: "limit",
          commandId: "cmd-b",
          binding: {
            proposalId: "evo:b",
            experimentId: "exp-b",
            applicationId: "app:b",
            tenantId: "tenant-a",
            domainReceiptRef: "rollback:b",
          },
        },
        dir,
      ),
    ).toThrow(/multiple-live-applications/);
  });

  it("keeps verifier self-registration, plaintext tokens, and operator grant strings fail-closed", () => {
    const dir = isolatedDir();
    const opened = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-a",
        reason: "evolution:a",
        action: "pause",
        commandId: "cmd-a",
        binding: {
          proposalId: "evo:a",
          experimentId: "exp-a",
          applicationId: "app:a",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:a",
        },
      },
      dir,
    );
    expect(() =>
      closeGovernanceEffectWindow({ effectVerificationId: opened.id, status: "resumed" }, dir),
    ).toThrow(/untrusted-status-close/);
    expect(() => registerRuntimeEffectVerifier()).toThrow(
      /runtime-verifier-self-registration-forbidden/,
    );
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-tick",
          effectVerificationId: opened.id,
          decidedBy: "governance_tick",
          decision: "resume",
          evidenceRefs: ["ev"],
          sourceReceiptRef: "receipt-a",
        },
        dir,
      ),
    ).toThrow(/governance_tick-decision-forbidden/);
    expect(() =>
      submitTickEffectDecision(
        {
          decisionId: "tick-bare",
          effectVerificationId: opened.id,
          decision: "resume",
          evidenceRefs: ["ev"],
          sourceReceiptRef: "tick-receipt",
          capability: { forged: true },
        },
        dir,
      ),
    ).toThrow(/tick-writer-capability-required/);
    expect(() =>
      persistOpenWindowEvaluation(
        {
          effectVerificationId: opened.id,
          evaluationCount: 1,
          lastEvaluationAt: new Date().toISOString(),
          lastEvaluationReceiptRef: "forged",
          nextEvaluateAt: new Date().toISOString(),
          capability: "token-i-chose",
        },
        dir,
      ),
    ).toThrow(/tick-writer-capability-required/);
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-unreg",
          effectVerificationId: opened.id,
          decidedBy: "runtime_verifier",
          decision: "resume",
          evidenceRefs: ["ev-a"],
          sourceReceiptRef: "verifier:verifier-a:ok",
          verifierId: "verifier-a",
          capabilityToken: "token-i-chose",
        },
        dir,
      ),
    ).toThrow(/runtime-verifier-unavailable/);
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-expired",
          effectVerificationId: opened.id,
          decidedBy: "runtime_verifier",
          decision: "resume",
          evidenceRefs: ["ev-a"],
          sourceReceiptRef: "verifier:expired:ok",
          verifierId: "expired-verifier",
          capabilityToken: "expired-token",
        },
        dir,
      ),
    ).toThrow(/runtime-verifier-unavailable/);
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-revoked",
          effectVerificationId: opened.id,
          decidedBy: "runtime_verifier",
          decision: "hold",
          evidenceRefs: ["ev-a"],
          sourceReceiptRef: "verifier:revoked:ok",
          verifierId: "revoked-verifier",
          capabilityToken: "revoked-token",
        },
        dir,
      ),
    ).toThrow(/runtime-verifier-unavailable/);
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-wrong-tenant",
          effectVerificationId: opened.id,
          decidedBy: "runtime_verifier",
          decision: "resume",
          evidenceRefs: ["ev-a"],
          sourceReceiptRef: "verifier:other-tenant:ok",
          verifierId: "other-tenant",
          capabilityToken: "token-other",
        },
        dir,
      ),
    ).toThrow(/runtime-verifier-unavailable/);
    expect(() =>
      submitGovernanceEffectDecision(
        {
          decisionId: "d-op",
          effectVerificationId: opened.id,
          decidedBy: "authorized_operator",
          decision: "hold",
          evidenceRefs: ["ev-c"],
          sourceReceiptRef: "receipt-c",
          principalRef: "operator-1",
          grantId: "grant-only-a-string",
        },
        dir,
      ),
    ).toThrow(/operator-effect-decision-unavailable/);
    const verificationSource = fs.readFileSync(
      new URL("./effect-verifications.ts", import.meta.url),
      "utf8",
    );
    expect(verificationSource).toMatch(/decidedBy === "authorized_operator"/);
    expect(verificationSource).toMatch(/operator-effect-decision-unavailable/);
    expect(verificationSource).toMatch(/checkEvolutionAuthority/);
    expect(verificationSource).not.toMatch(
      /if\s*\(\s*(?:hasId\(input\.(?:principalRef|grantId)\)|input\.(?:principalRef|grantId))\s*&&/,
    );
    expect(listGovernanceEffectVerifications(dir).find((row) => row.id === opened.id)?.status).toBe(
      "open",
    );
  });

  it("revokes an open application window without inventing an evaluation sample", () => {
    const dir = isolatedDir();
    const stillOpen = openGovernanceEffectWindow(
      {
        runtimeAgentId: "bot-b",
        reason: "evolution:b",
        action: "pause",
        commandId: "cmd-b",
        binding: {
          proposalId: "evo:b",
          experimentId: "exp-b",
          applicationId: "app:b",
          tenantId: "tenant-a",
          domainReceiptRef: "rollback:b",
        },
      },
      dir,
    );
    revokeGovernanceEffectWindowsForApplication({ applicationId: "app:b" }, dir);
    expect(
      listGovernanceEffectVerifications(dir).find((row) => row.id === stillOpen.id)?.status,
    ).toBe("escalated");
  });
});
