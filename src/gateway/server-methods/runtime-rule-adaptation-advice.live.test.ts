/**
 * Live verification that official DeepSeek is reached through the default
 * handler assembly and the official authoritative board source, replacing
 * only the real HTTP call (no policyFactSource / compatibility / policy-state
 * injection). An unbound consultation must not invent approved_compatible or
 * active, and must not claim full P1 validation. Test-only. Does not read
 * production machine config or log credentials.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../agent-runtime/contracts/rule-adaptation-activation.js";
import { resolveOfficialDeepSeekCredential } from "../../agent-runtime/model/rule-adaptation/index.js";
import { handleRuntimeRuleAdaptationAdvice } from "./runtime-rule-adaptation-advice.ts";
import type { GatewayRequestHandlerOptions } from "./types.ts";

const EVIDENCE_DIR = "/workspace/t67-advice-status-display-fix/logs";

const seatedContext = {
  tenantId: "tenant-1",
  seatId: "seat-1",
  employeeId: "employee-server",
} as never;

function client(): GatewayRequestHandlerOptions["client"] {
  return { connect: { minProtocol: 3, maxProtocol: 3 } } as GatewayRequestHandlerOptions["client"];
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/gi, "[REDACTED]")
    .replace(
      /("?(?:api[_-]?key|authorization|token|secret)"?\s*[:=]\s*")[^"]+"/gi,
      '$1[REDACTED]"',
    );
}

async function writeEvidence(
  name: string,
  payload: unknown,
): Promise<{ path: string; sha256: string }> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const path = `${EVIDENCE_DIR}/${name}`;
  const body = redact(JSON.stringify(payload, null, 2));
  await writeFile(path, `${body}\n`, "utf8");
  const sha256 = createHash("sha256").update(`${body}\n`).digest("hex");
  return { path, sha256 };
}

const liveCred = resolveOfficialDeepSeekCredential();
const liveIt = liveCred ? it : it.skip;

it("records that the production-resolver live path uses DEEPSEEK_API_KEY and the official base URL", () => {
  expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
  if (!liveCred) {
    expect(liveCred).toBeNull();
    return;
  }
  expect(liveCred.envVarName).toBe("DEEPSEEK_API_KEY");
  expect(liveCred.model).toBe("deepseek-v4-flash");
  expect(liveCred.baseUrl.replace(/\/+$/, "")).toBe("https://api.deepseek.com");
});

liveIt(
  "reaches official DeepSeek through the default handler without injecting policy facts",
  async () => {
    if (!liveCred) {
      throw new Error("live credential unexpectedly missing");
    }
    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question:
          "This personal agent spends too much on long prompts. Tighten agents.defaults.contextTokens from the current 32000 down to 24000, staying at or above the 16000 hard minimum. Do not widen, do not publish a new rule, and do not activate policy. The final JSON proposal must use kind policy_proposal with an items array, bind implementationVersion from knownFacts, and must not include currentEffectiveValue or other host/authorization fields. This is an unbound consultation and must not claim a task was fully validated.",
        targetRef: { sessionKey: "agent:personal-bot:chat", agentId: "personal-bot" },
        identity: { principalId: "user:forged" },
        apiKey: "sk-forged",
        binding: { trigger: true },
      },
      client(),
      {
        loadConfig: () =>
          ({
            agents: {
              defaults: { contextTokens: 32000 },
              list: [{ id: "personal-bot" }],
            },
            models: {
              providers: {
                deepseek: {
                  models: [{ id: "deepseek-v4-flash", contextWindow: 64000 }],
                },
              },
            },
          }) as never,
        resolveTrustedContext: async () => seatedContext,
        checkAgentAccess: async () => ({
          ok: true,
          agentId: "personal-bot",
          tenantId: "tenant-1",
          userId: "employee-server",
          activationAuthorized: false,
        }),
      },
    );

    const evidence = await writeEvidence("16-default-handler-deepseek-live-summary.json", {
      path: "default-handler-official-source",
      injectedPolicyFactSource: false,
      inventedApprovalConstants: false,
      state: advice.state,
      label: advice.label,
      notEffective: advice.notEffective,
      notEffectiveLabel: advice.notEffectiveLabel,
      activationAllowed: advice.activationAllowed,
      proposalFullyValidated: advice.proposalFullyValidated ?? null,
      taskApplicability: advice.taskApplicability ?? null,
      outcomeCode: advice.outcomeCode,
      summary: advice.summary,
      reasons: advice.reasons,
      proposal: advice.proposal,
      modelCalled: advice.modelCalled,
      whitelistLength: PRODUCTION_RUNTIME_RULE_WHITELIST.length,
      credential: {
        provider: liveCred.provider,
        model: liveCred.model,
        envVarName: liveCred.envVarName,
        baseUrl: liveCred.baseUrl,
      },
    });

    expect(advice.notEffective).toBe(true);
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffectiveLabel).toBe("尚未生效");
    expect(advice.proposalFullyValidated).toBe(false);
    expect(advice.taskApplicability).toBe("unbound");
    expect(advice.state).not.toBe("adjustment_suggested");
    expect(advice.label).not.toBe("建议调整");
    const rejectionReason = (advice.reasons ?? []).some((reason) =>
      [
        "structural_invalid_type",
        "structural_forbidden_field",
        "structural_unknown_field",
        "structural_duplicate_field",
        "unknown_rule_id",
        "non_candidate_field",
        "below_hard_min",
        "above_hard_ceiling",
        "above_current_effective",
        "hard_boundary_conflict",
        "hard_rule_conflict",
        "fabricated_rule_id",
        "unknown_parameter",
        "protocol_failure",
      ].includes(reason.code),
    );
    if (
      rejectionReason ||
      [
        "protocol_failure",
        "hard_rule_conflict",
        "malicious_material_rejected",
        "fabricated_rule_id",
        "unknown_parameter",
      ].includes(String(advice.outcomeCode ?? ""))
    ) {
      expect(["blocked", "failed"]).toContain(advice.state);
    } else {
      expect(advice.state).toBe("interpretation_pending");
      expect(advice.label).toBe("规则解释／待核验");
    }
    expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(advice.modelCalled).toBe(true);
    expect(JSON.stringify(advice)).not.toContain("approved_compatible");
  },
  90_000,
);
