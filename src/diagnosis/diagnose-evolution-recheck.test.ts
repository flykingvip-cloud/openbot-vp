import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDiagnosisRecheckBinding,
  type DiagnosisRecheckRequest,
} from "@openbot/evolution-core";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import {
  createDiagnosisRecheckPort,
  DIAGNOSIS_RECHECK_SURFACES,
  type DiagnosisRecheckObservation,
} from "./diagnose-evolution-recheck.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";

const DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(DIR, "diagnose-evolution-recheck.ts"), "utf8");

const VERIFICATION = {
  schemaVersion: 1 as const,
  proposalId: "evo:recheck-1",
  experimentId: "exp-recheck-1",
  applicationId: "app-recheck-1",
  verificationId: "ver-recheck-1",
};

function request(over: Partial<DiagnosisRecheckRequest> = {}): DiagnosisRecheckRequest {
  return {
    verificationRef: VERIFICATION,
    target: { domain: "capability", skillId: "briefing" },
    findingRefs: ["finding-skill-1"],
    surfaceId: "capability.skill-installation",
    tenantScope: "tenant-a",
    ...over,
  };
}

function wdnaRequest(over: Partial<DiagnosisRecheckRequest> = {}): DiagnosisRecheckRequest {
  return request({
    target: { domain: "agent", agentId: "bot-2" },
    surfaceId: "agent.working-dna",
    findingRefs: ["finding-wdna-1"],
    ...over,
  });
}

function observation(over: Partial<DiagnosisRecheckObservation> = {}): DiagnosisRecheckObservation {
  return {
    status: "ok",
    observedHash: "after",
    baselineHash: "before",
    expectedHash: "after",
    ...over,
  };
}

describe("createDiagnosisRecheckPort", () => {
  it("registers Working DNA and skill-installation only", () => {
    expect(DIAGNOSIS_RECHECK_SURFACES).toEqual([
      "agent.working-dna",
      "capability.skill-installation",
    ]);
    expect(SOURCE).not.toMatch(/from ["'].*evolution-control/);
    expect(SOURCE).not.toMatch(/applyWorkingDna|applySkill|startExperiment/);
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
  });

  it("blocks skill-installation without an existing skillId", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => observation(),
    });
    const result = await port.recheck(
      request({ target: { domain: "capability", skillId: "   " } }),
    );
    expect(result).toMatchObject({ outcome: "BLOCKED", reasonCode: "unknown_target" });
  });

  it("blocks unregistered surfaces such as skill-spec", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => {
        throw new Error("observer must not run for unsupported surfaces");
      },
    });
    await expect(
      port.recheck(request({ surfaceId: "capability.skill-spec" })),
    ).resolves.toMatchObject({ outcome: "BLOCKED", reasonCode: "unsupported_surface" });
  });

  it("keeps the finding open when a claimed verification left the store unchanged", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "skill:missing",
          baselineHash: "skill:missing",
          expectedHash: "skill:installed",
        }),
    });
    const result = await port.recheck(request());
    expect(result).toMatchObject({ outcome: "STILL_OPEN", reasonCode: "sot_unchanged" });
    expect(result.findingRefs).toEqual(["finding-skill-1"]);
    expect(JSON.stringify(result)).not.toMatch(/reportProse|evidencePayload/);
  });

  it("resolves a skill install only when the live relation matches the expected hash", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "skill:published:1.0.0:installed",
          baselineHash: "skill:published:1.0.0:missing",
          expectedHash: "skill:published:1.0.0:installed",
          agentMatched: true,
          versionMatched: true,
          enabled: true,
        }),
    });
    await expect(port.recheck(request())).resolves.toMatchObject({
      outcome: "RESOLVED",
      reasonCode: "sot_confirmed",
    });
  });

  it("resolves Working DNA only when the store changed and the effect window is readable", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "style:markdown:milestone:ask:balanced:professional",
          baselineHash: "style:markdown:on_completion:ask:balanced:professional",
          expectedHash: "style:markdown:milestone:ask:balanced:professional",
          effectWindowRef: "obs:window:wdna-1",
        }),
    });
    await expect(port.recheck(wdnaRequest())).resolves.toMatchObject({
      outcome: "RESOLVED",
      reasonCode: "sot_confirmed",
    });
  });

  it("keeps Working DNA open when the store is unchanged", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "style:default",
          baselineHash: "style:default",
          expectedHash: "style:next",
          effectWindowRef: "obs:window:wdna-1",
        }),
    });
    await expect(port.recheck(wdnaRequest())).resolves.toMatchObject({
      outcome: "STILL_OPEN",
      reasonCode: "sot_unchanged",
    });
  });

  it("returns inconclusive when Working DNA is unreadable", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => observation({ status: "unreadable", observedHash: null }),
    });
    await expect(port.recheck(wdnaRequest())).resolves.toMatchObject({
      outcome: "INCONCLUSIVE",
      reasonCode: "sot_unreadable",
    });
  });

  it("does not resolve a skill when the agent, version, or enabled bit is wrong", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "skill:published:1.0.0:missing",
          baselineHash: "skill:published:1.0.0:missing",
          expectedHash: "skill:published:1.0.0:installed",
          agentMatched: false,
          versionMatched: false,
          enabled: false,
        }),
    });
    await expect(port.recheck(request())).resolves.toMatchObject({
      outcome: "STILL_OPEN",
      reasonCode: "sot_relation_mismatch",
    });
  });

  it("returns inconclusive when the domain store times out", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => observation({ status: "timeout", observedHash: null }),
    });
    await expect(port.recheck(request())).resolves.toMatchObject({
      outcome: "INCONCLUSIVE",
      reasonCode: "sot_timeout",
    });
  });

  it("blocks an incomplete EvolutionVerificationRef", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => observation(),
    });
    await expect(
      port.recheck(
        request({
          verificationRef: { ...VERIFICATION, applicationId: "" },
        }),
      ),
    ).resolves.toMatchObject({ outcome: "BLOCKED", reasonCode: "verification_incomplete" });
  });

  it("blocks a trusted-tenant mismatch", async () => {
    const port = createDiagnosisRecheckPort(
      { observe: async () => observation() },
      { trustedTenantScope: "tenant-a" },
    );
    await expect(port.recheck(request({ tenantScope: "tenant-b" }))).resolves.toMatchObject({
      outcome: "BLOCKED",
      reasonCode: "tenant_mismatch",
    });
  });

  it("treats findingRefs as a sorted unique set", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () =>
        observation({
          observedHash: "skill:installed",
          baselineHash: "skill:missing",
          expectedHash: "skill:installed",
        }),
    });
    const result = await port.recheck(
      request({ findingRefs: ["finding-b", "finding-a", "finding-b"] }),
    );
    expect(result.findingRefs).toEqual(["finding-a", "finding-b"]);
    expect(
      assertDiagnosisRecheckBinding(request({ findingRefs: ["finding-a", "finding-b"] }), result),
    ).toEqual({ ok: true });
  });

  it("blocks binding when findingRefs are missing or added", () => {
    const base = {
      outcome: "RESOLVED" as const,
      reasonCode: "sot_confirmed",
      target: request().target,
      verificationRef: VERIFICATION,
      observedEvidenceRefs: ["obs:recheck:after"],
    };
    expect(
      assertDiagnosisRecheckBinding(request({ findingRefs: ["finding-1", "finding-2"] }), {
        ...base,
        findingRefs: ["finding-2", "finding-1"],
      }),
    ).toEqual({ ok: true });
    expect(
      assertDiagnosisRecheckBinding(request({ findingRefs: ["finding-1"] }), {
        ...base,
        findingRefs: ["finding-1", "finding-2"],
      }),
    ).toEqual({ ok: false, code: "finding_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(request(), {
        ...base,
        findingRefs: ["finding-skill-1"],
        target: { domain: "agent", agentId: "bot-other" },
      }),
    ).toEqual({ ok: false, code: "target_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(request(), {
        ...base,
        findingRefs: ["finding-skill-1"],
        verificationRef: { ...VERIFICATION, verificationId: "ver-other" },
      }),
    ).toEqual({ ok: false, code: "verification_mismatch" });
  });

  it("rejects report prose or evidence payload on the request", async () => {
    const port = createDiagnosisRecheckPort({
      observe: async () => observation(),
    });
    await expect(
      port.recheck(
        Object.assign(request(), { reportProse: "do not copy" }) as DiagnosisRecheckRequest,
      ),
    ).rejects.toThrow(/report prose or evidence payload/);
  });

  it("does not live in evolution-control", () => {
    expect(join(DIR, "diagnose-evolution-recheck.ts")).toContain(`${sep}src${sep}diagnosis${sep}`);
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
