import { describe, it, expect, vi } from "vitest";
import { runReasoningPass, type ReasoningInput } from "./reasoning-pass.js";
const input: ReasoningInput = {
  evidence: [
    { evidenceId: "ev", layer: "execution", status: "partial", reasonCodes: ["missing_tip"] },
  ],
  findings: [{ findingId: "f", source: "rule_v1", evidenceIds: ["ev"], code: "missing_tip" }],
};
const row = {
  id: "h",
  kind: "hypothesis",
  text: "Possible missing linkage",
  evidenceIds: ["ev"],
  source: "reasoning",
  modelRef: "test-model",
};
describe("optional reasoning pass", () => {
  it("is disabled by default and makes no model call", async () => {
    const model = vi.fn();
    expect((await runReasoningPass(input, { model })).reason).toBe("reasoning_disabled");
    expect(model).not.toHaveBeenCalled();
  });
  it("returns labelled hypotheses without changing rule findings", async () => {
    const result = await runReasoningPass(input, {
      enabled: true,
      modelRef: "test-model",
      model: async () => ({ schemaVersion: 1, items: [row] }),
    });
    expect(result.items[0]).toMatchObject({ source: "reasoning", modelRef: "test-model" });
    expect(result.findings).toEqual(input.findings);
    expect(result.reason).toBe("hypotheses_only");
  });
  it("discards the entire model batch on forbidden fields or unbound evidence", async () => {
    for (const invalid of [
      { ...row, taskJudgement: "success" },
      { ...row, command: "apply" },
      { ...row, evidenceIds: ["invented"] },
      { ...row, source: "rule_v1" },
      { ...row, modelRef: "other" },
    ]) {
      const result = await runReasoningPass(input, {
        enabled: true,
        modelRef: "test-model",
        model: async () => ({ schemaVersion: 1, items: [row, invalid] }),
      });
      expect(result.scoringMethod).toBe("rule_v1");
      expect(result.items).toEqual([]);
    }
  });
  it("falls back on thrown errors and timeout", async () => {
    expect(
      (
        await runReasoningPass(input, {
          enabled: true,
          modelRef: "test-model",
          model: async () => {
            throw new Error("provider");
          },
        })
      ).reason,
    ).toBe("reasoning_model_error");
    let signal: AbortSignal | undefined;
    const result = await runReasoningPass(input, {
      enabled: true,
      modelRef: "test-model",
      timeoutMs: 1,
      model: async (_input, context) => {
        signal = context.signal;
        return new Promise(() => {});
      },
    });
    expect(result.reason).toBe("reasoning_timeout");
    expect(signal?.aborted).toBe(true);
  });
  it("sends only whitelisted input and protects rule fallback from model mutation", async () => {
    const extended = { ...input, prompt: "secret" };
    const result = await runReasoningPass(extended, {
      enabled: true,
      modelRef: "test-model",
      model: async (value) => {
        expect(JSON.stringify(value)).not.toContain("secret");
        return { schemaVersion: 1, items: [] };
      },
    });
    expect(result.findings).toEqual(input.findings);
  });
  it("does not accept model-mutated evidence ids or rule findings", async () => {
    const result = await runReasoningPass(input, {
      enabled: true,
      modelRef: "test-model",
      model: async (value) => {
        (value.evidence as { evidenceId: string }[])[0].evidenceId = "invented";
        (value.findings as { code: string }[])[0].code = "forged";
        return { schemaVersion: 1, items: [{ ...row, evidenceIds: ["invented"] }] };
      },
    });
    expect(result.reason).toBe("reasoning_schema_invalid");
    expect(result.findings).toEqual(input.findings);
    expect(result.items).toEqual([]);
  });
});
