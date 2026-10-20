import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDiagnosisRecheckBinding,
  assertDiagnosisRecheckRequest,
  assertDiagnosisRecheckResult,
  canonicalizeFindingRefs,
  isDiagnosisRecheckOutcome,
  type DiagnosisRecheckRequest,
  type DiagnosisRecheckResult,
} from "./diagnosis-recheck.js";

const ROOT = dirname(fileURLToPath(import.meta.url));

const verificationRef = {
  schemaVersion: 1 as const,
  proposalId: "prop-1",
  experimentId: "exp-1",
  applicationId: "app-1",
  verificationId: "ver-1",
};

const target = { domain: "agent" as const, agentId: "bot-1" };

function request(over: Partial<DiagnosisRecheckRequest> = {}): DiagnosisRecheckRequest {
  return {
    verificationRef,
    target,
    findingRefs: ["finding:1"],
    surfaceId: "agent.working-dna",
    tenantScope: "tenant-a",
    ...over,
  };
}

function result(over: Partial<DiagnosisRecheckResult> = {}): DiagnosisRecheckResult {
  return {
    outcome: "RESOLVED",
    findingRefs: ["finding:1"],
    target,
    verificationRef,
    observedEvidenceRefs: ["ev:1"],
    reasonCode: "finding_absent",
    ...over,
  };
}

describe("diagnosis recheck contract", () => {
  it("accepts reference-only request and result with target binding", () => {
    const req = assertDiagnosisRecheckRequest(request());
    const res = assertDiagnosisRecheckResult(result());
    expect(isDiagnosisRecheckOutcome(res.outcome)).toBe(true);
    expect(assertDiagnosisRecheckBinding(req, res)).toEqual({ ok: true });
  });

  it("rejects empty or blank finding refs", () => {
    expect(() => assertDiagnosisRecheckRequest(request({ findingRefs: [] }))).toThrow(
      /non-empty reference list/,
    );
    expect(() => assertDiagnosisRecheckRequest(request({ findingRefs: [" "] }))).toThrow(
      /non-empty strings/,
    );
    expect(() => assertDiagnosisRecheckResult(result({ observedEvidenceRefs: [] }))).toThrow(
      /non-empty reference list/,
    );
  });

  it("treats finding refs as a sorted unique set", () => {
    expect(canonicalizeFindingRefs(["finding:2", "finding:1", "finding:1"])).toEqual([
      "finding:1",
      "finding:2",
    ]);
    expect(
      assertDiagnosisRecheckBinding(
        request({ findingRefs: ["finding:2", "finding:1"] }),
        result({ findingRefs: ["finding:1", "finding:2"] }),
      ),
    ).toEqual({ ok: true });
    expect(
      assertDiagnosisRecheckBinding(
        request({ findingRefs: ["finding:1", "finding:1", "finding:2"] }),
        result({ findingRefs: ["finding:2", "finding:1"] }),
      ),
    ).toEqual({ ok: true });
    expect(
      assertDiagnosisRecheckBinding(
        request({ findingRefs: ["finding:1", "finding:2"] }),
        result({ findingRefs: ["finding:1"] }),
      ),
    ).toEqual({ ok: false, code: "finding_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(
        request({ findingRefs: ["finding:1"] }),
        result({ findingRefs: ["finding:1", "finding:3"] }),
      ),
    ).toEqual({ ok: false, code: "finding_mismatch" });
  });

  it("requires request and result to share verification, target, and findings", () => {
    expect(
      assertDiagnosisRecheckBinding(
        request(),
        result({
          verificationRef: { ...verificationRef, verificationId: "ver-other" },
        }),
      ),
    ).toEqual({ ok: false, code: "verification_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(
        request(),
        result({ target: { domain: "agent", agentId: "bot-other" } }),
      ),
    ).toEqual({ ok: false, code: "target_mismatch" });
    expect(
      assertDiagnosisRecheckBinding(request(), result({ findingRefs: ["finding:2"] })),
    ).toEqual({ ok: false, code: "finding_mismatch" });
  });

  it("rejects copied report prose or evidence payload", () => {
    const dirty = { ...result(), reportProse: "copied" };
    expect(() => assertDiagnosisRecheckResult(dirty as DiagnosisRecheckResult)).toThrow(
      /report prose or evidence payload/,
    );
  });

  it("keeps evolution-core free of src/diagnosis imports and StructuralEvolutionCandidate copies", () => {
    const offenders: string[] = [];
    for (const name of readdirSync(ROOT)) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) {
        continue;
      }
      const text = readFileSync(join(ROOT, name), "utf8");
      if (text.includes('from "../../src/diagnosis') || text.includes('from "src/diagnosis')) {
        offenders.push(`${name}:diagnosis-import`);
      }
      if (/export\s+type\s+StructuralEvolutionCandidate\b/.test(text)) {
        offenders.push(`${name}:copied-candidate`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
