import { describe, it, expect, vi } from "vitest";
import { createReasoningGatewayAdapter } from "./reasoning-gateway.js";
const evidence = {
  evidence: [
    {
      evidenceId: "e",
      layer: "execution" as const,
      status: "partial" as const,
      reasonCodes: ["missing_tip"],
    },
  ],
  findings: [
    { findingId: "f", source: "rule_v1" as const, evidenceIds: ["e"], code: "missing_tip" },
  ],
};
const identity = { identityRef: "user", scopeRef: "scope", grantVersion: "1" };
const item = {
  id: "h",
  kind: "hypothesis",
  text: "Possible missing linkage",
  evidenceIds: ["e"],
  source: "reasoning",
  modelRef: "configured-role",
};
function setup() {
  return {
    authorize: vi.fn(async () => identity),
    readEvidence: vi.fn(async () => evidence),
    model: vi.fn(async () => ({ schemaVersion: 1, items: [item] })),
    modelRef: "configured-role",
  };
}
describe("gateway-callable reasoning adapter", () => {
  it("requires explicit request and defaults closed", async () => {
    const p = setup();
    const call = createReasoningGatewayAdapter(p);
    expect(await call(undefined)).toMatchObject({
      reasoningPass: { reason: "reasoning_not_requested" },
    });
    expect(await call({ requested: true })).toMatchObject({
      reasoningPass: { reason: "reasoning_disabled" },
    });
    expect(p.model).not.toHaveBeenCalled();
    expect(p.readEvidence).not.toHaveBeenCalled();
  });
  it("rejects client model configuration or evidence", async () => {
    const p = setup();
    const call = createReasoningGatewayAdapter({ ...p, enabled: true });
    expect(await call({ requested: true, modelRef: "forged" })).toEqual({
      ok: false,
      code: "invalid_reasoning_request",
    });
    expect(p.authorize).not.toHaveBeenCalled();
  });
  it("clips body fields and preserves rules on success", async () => {
    const p = setup();
    const extended: typeof evidence & {
      prompt: string;
      evidence: ((typeof evidence.evidence)[number] & { body: string })[];
    } = {
      ...evidence,
      prompt: "private",
      evidence: [{ ...evidence.evidence[0], body: "private" }],
    };
    p.readEvidence.mockResolvedValue(extended);
    const result = await createReasoningGatewayAdapter({ ...p, enabled: true })({
      requested: true,
    });
    expect(result).toMatchObject({
      ok: true,
      reasoningPass: { reason: "hypotheses_only", findings: evidence.findings },
    });
    expect(JSON.stringify(p.model.mock.calls)).not.toContain("private");
  });
  it("rejects all output on grant changes after model call", async () => {
    const p = setup();
    p.authorize
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce(identity)
      .mockResolvedValue({ ...identity, grantVersion: "2" });
    expect(
      await createReasoningGatewayAdapter({ ...p, enabled: true })({ requested: true }),
    ).toEqual({ ok: false, code: "unauthorized" });
  });
  it("does not call model on invalid evidence links", async () => {
    const p = setup();
    p.readEvidence.mockResolvedValue({
      ...evidence,
      findings: [{ ...evidence.findings[0], evidenceIds: ["forged"] }],
    });
    expect(
      await createReasoningGatewayAdapter({ ...p, enabled: true })({ requested: true }),
    ).toMatchObject({ reasoningPass: { reason: "reasoning_evidence_invalid" } });
    expect(p.model).not.toHaveBeenCalled();
  });
  it("falls back to rule_v1 on model schema failure", async () => {
    const p = setup();
    p.model.mockResolvedValue({ schemaVersion: 1, items: [{ ...item, evidenceIds: ["forged"] }] });
    expect(
      await createReasoningGatewayAdapter({ ...p, enabled: true })({ requested: true }),
    ).toMatchObject({
      reasoningPass: {
        scoringMethod: "rule_v1",
        reason: "reasoning_schema_invalid",
        findings: evidence.findings,
        items: [],
      },
    });
  });
});
