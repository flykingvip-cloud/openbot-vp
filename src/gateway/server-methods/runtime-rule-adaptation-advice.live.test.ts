/**
 * Live verification that official DeepSeek is reached through the production
 * fact resolver (readable fixture facts + view access), not by stuffing
 * approved/compatibility/policy state onto the host and skipping the resolver.
 * Test-only. Does not read production machine config or log credentials.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../agent-runtime/contracts/rule-adaptation-activation.js";
import { INVENTORY_PIN } from "../../agent-runtime/contracts/rule-adaptation-shadow.js";
import { resolveOfficialDeepSeekCredential } from "../../agent-runtime/model/rule-adaptation/index.js";
import { createEmployeeAdvicePolicyFactSource } from "./runtime-rule-adaptation-advice-facts.ts";
import { handleRuntimeRuleAdaptationAdvice } from "./runtime-rule-adaptation-advice.ts";
import type { GatewayRequestHandlerOptions } from "./types.ts";

const EVIDENCE_DIR = "/workspace/t65-employee-advice-fact-resolution/logs";

const POLICY_VERSION = {
  policyHash: "fixture-policy-hash-aaaa",
  protocolVersion: "1.1",
  compilerRevision: "1.2.0",
};

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
  "reaches official DeepSeek after the production resolver reads fixture facts and view access",
  async () => {
    if (!liveCred) {
      throw new Error("live credential unexpectedly missing");
    }
    const advice = await handleRuntimeRuleAdaptationAdvice(
      {
        question:
          "This personal agent spends too much on long prompts. Tighten agents.defaults.contextTokens from the current 32000 down to 24000, staying at or above the 16000 hard minimum. Do not widen, do not publish a new rule, and do not activate policy. The final JSON proposal must use kind policy_proposal with an items array, bind implementationVersion and expectedPolicyVersion from knownFacts, and must not include currentEffectiveValue or other host/authorization fields.",
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
        policyFactSource: createEmployeeAdvicePolicyFactSource([
          {
            tenantId: "tenant-1",
            agentId: "personal-bot",
            sessionKey: "agent:personal-bot:chat",
            facts: {
              compatibilityRecord: {
                status: "approved_compatible",
                boundImplementationVersion: INVENTORY_PIN,
                boundExpectedPolicyVersion: POLICY_VERSION,
              },
              expectedPolicyState: "active",
              expectedPolicyVersion: POLICY_VERSION,
              hardMinContextTokens: 16000,
              activationAuthorized: false,
              requiredProposalShape: {
                kind: "policy_proposal",
                scope: { type: "personal", id: "personal-bot" },
                implementationVersion: INVENTORY_PIN,
                expectedPolicyVersion: POLICY_VERSION,
                items: [
                  {
                    ruleId: "model.context_window.guard",
                    field: "agents.defaults.contextTokens",
                    action: "tune",
                    proposedValue: 24000,
                  },
                ],
              },
            },
          },
        ]),
      },
    );

    const evidence = await writeEvidence("15-production-resolver-deepseek-live-summary.json", {
      path: "production-resolver",
      skippedResolver: false,
      state: advice.state,
      label: advice.label,
      notEffective: advice.notEffective,
      notEffectiveLabel: advice.notEffectiveLabel,
      activationAllowed: advice.activationAllowed,
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
    expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(advice.modelCalled).toBe(true);
    expect(advice.state).toBe("adjustment_suggested");
    expect(advice.label).toBe("建议调整");
    expect(advice.outcomeCode).toBe("shadow_recorded");
    expect(advice.proposal).toMatchObject({
      kind: "policy_proposal",
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 24000,
        },
      ],
    });
  },
  90_000,
);
