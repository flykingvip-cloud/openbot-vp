/**
 * Live employee-advice verification: official DeepSeek is resolved only by
 * the trusted host and is reached through the official shadow entry, without
 * a placeholder contrast interaction. Test-only. Does not extend the official
 * production runner, does not read production machine config, and does not
 * log credentials.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveEmbeddedModelGovernance } from "../../../agents/embedded-model-governance.js";
import { makeZeroUsageSnapshot } from "../../../agents/usage.js";
import { PRODUCTION_RUNTIME_RULE_WHITELIST } from "../../contracts/rule-adaptation-activation.js";
import { INVENTORY_PIN } from "../../contracts/rule-adaptation-shadow.js";
import type { ModelSessionPorts } from "../../model/index.js";
import {
  createOfficialDeepSeekShadowCompletion,
  resolveOfficialDeepSeekCredential,
} from "../../model/rule-adaptation/index.js";
import * as activate from "./activate.js";
import { runEmployeeRuleAdaptationAdvice } from "./employee-advice.js";

const EVIDENCE_DIR = "/workspace/t64-employee-advice-wiring-fix/logs";

const calls = vi.hoisted(() => ({ complete: vi.fn() }));
const candidateMocks = vi.hoisted(() => ({
  transport: vi.fn(),
  ensure: vi.fn(),
  resolve: vi.fn(),
  auth: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", async (original) => ({
  ...(await original<typeof import("@earendil-works/pi-ai/compat")>()),
  complete: calls.complete,
}));
vi.mock("../../../gateway/enterprise-model/embedded-transport.js", () => ({
  resolveEnterpriseEmbeddedTransport: candidateMocks.transport,
}));
vi.mock("../../../agents/models-config.js", () => ({
  ensureOpenClawModelsJson: candidateMocks.ensure,
}));
vi.mock("../../../agents/pi-embedded-runner/model.js", () => ({
  resolveModel: candidateMocks.resolve,
}));
vi.mock("../../../agents/model-auth.js", () => ({
  getApiKeyForModel: candidateMocks.auth,
}));

const model = {
  id: "test",
  provider: "test",
  api: "openai-completions",
  reasoning: false,
  input: ["text"],
  contextWindow: 8192,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>;

function stubShadowPorts(): ModelSessionPorts {
  return {
    accounting: { recordCreditUsage: vi.fn(async () => undefined) },
    admission: {
      tryAcquireEnterpriseAgentRun: vi.fn(async () => ({
        acquired: false as const,
        skipped: true as const,
      })),
      releaseEnterpriseAgentRun: vi.fn(async () => {}),
    },
    model: {
      resolveEmbeddedModelGovernance,
      buildRunModelSetSnapshot: vi.fn(() => undefined),
      forgetRunModelSet: vi.fn(),
      rememberRunModelSet: vi.fn(),
      snapshotCreditReportingFromGate: vi.fn(() => undefined),
      resolvePlatformModelsMode: vi.fn(() => "default"),
      runWithModelFallback: vi.fn(
        async (options: {
          run: (provider: string, model: string, extra?: unknown) => Promise<unknown>;
        }) => ({
          result: await options.run("deepseek", "deepseek-v4-flash"),
          provider: "deepseek",
          model: "deepseek-v4-flash",
          attempts: [],
        }),
      ),
    },
  } as unknown as ModelSessionPorts;
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

beforeEach(() => {
  calls.complete.mockReset();
  calls.complete.mockResolvedValue({
    role: "assistant",
    content: [{ type: "text", text: JSON.stringify({ kind: "reply", text: "对照回合" }) }],
    usage: makeZeroUsageSnapshot(),
    stopReason: "stop",
  });
  candidateMocks.transport.mockReset();
  candidateMocks.ensure.mockReset();
  candidateMocks.resolve.mockReset();
  candidateMocks.auth.mockReset();
  candidateMocks.transport.mockImplementation(
    async (params: { provider: string; model: string }) => ({
      provider: params.provider,
      model: params.model,
    }),
  );
  candidateMocks.resolve.mockResolvedValue({ model });
  candidateMocks.auth.mockResolvedValue({ apiKey: "fixture-interaction-key", mode: "api-key" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("records that the official DeepSeek employee-advice live call uses DEEPSEEK_API_KEY and the official base URL", () => {
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
  "reaches official DeepSeek through the employee advice host chain and returns a validated, not-yet-effective suggestion",
  async () => {
    if (!liveCred) {
      throw new Error("live credential unexpectedly missing");
    }
    const complete = vi.fn(createOfficialDeepSeekShadowCompletion(liveCred));
    const activateSpy = vi.spyOn(activate, "activateApprovedRuntimeRuleProposal");
    const revokeSpy = vi.spyOn(activate, "revokeActivatedRuntimeRulePolicy");
    const rollbackSpy = vi.spyOn(activate, "rollbackActivatedRuntimeRulePolicy");
    const advice = await runEmployeeRuleAdaptationAdvice(
      {
        question:
          "This personal agent spends too much on long prompts. Tighten agents.defaults.contextTokens from the current 32000 down to 24000, staying at or above the 16000 hard minimum. Do not widen, do not publish a new rule, and do not activate policy. The final JSON proposal must use kind policy_proposal with an items array, bind implementationVersion and expectedPolicyVersion from knownFacts, and must not include currentEffectiveValue or other host/authorization fields.",
        targetRef: { sessionKey: "agent:real-chat", agentId: "agent:fixture-personal-1" },
        identity: { principalId: "user:forged" },
        apiKey: "sk-forged",
        binding: { trigger: true },
      },
      {
        identity: {
          employeeId: "employee-live-1",
          principalId: "user:employee-live-1",
          tenantId: "tenant-live-1",
          seatId: "seat-live-1",
          authorizationStatus: "authorized",
        },
        facts: {
          currentContextTokens: 32000,
          currentContextTokenSource: "agentContextTokens",
          modelContextWindow: 64000,
          configContextTokenCap: 32000,
          targetAuthorization: "approved",
          approvedTarget: {
            agentId: "agent:fixture-personal-1",
            scopeId: "agent:fixture-personal-1",
          },
          compatibilityRecord: {
            status: "approved_compatible",
            boundImplementationVersion: INVENTORY_PIN,
            boundExpectedPolicyVersion: {
              policyHash: "fixture-policy-hash-aaaa",
              protocolVersion: "1.1",
              compilerRevision: "1.2.0",
            },
          },
          expectedPolicyState: "active",
          hardMinContextTokens: 16000,
          expectedPolicyVersion: {
            policyHash: "fixture-policy-hash-aaaa",
            protocolVersion: "1.1",
            compilerRevision: "1.2.0",
          },
          requiredProposalShape: {
            kind: "policy_proposal",
            scope: { type: "personal", id: "agent:fixture-personal-1" },
            implementationVersion: INVENTORY_PIN,
            expectedPolicyVersion: {
              policyHash: "fixture-policy-hash-aaaa",
              protocolVersion: "1.1",
              compilerRevision: "1.2.0",
            },
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
        model: {
          provider: liveCred.provider,
          model: liveCred.model,
          complete,
          sessionPorts: stubShadowPorts(),
        },
      },
    );

    const evidence = await writeEvidence("14-employee-advice-deepseek-live-summary.json", {
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
      officialShadowCalls: complete.mock.calls.length,
      placeholderInteractionCalls: calls.complete.mock.calls.length,
      activationCalled: activateSpy.mock.calls.length,
      revokeCalled: revokeSpy.mock.calls.length,
      rollbackCalled: rollbackSpy.mock.calls.length,
      whitelistLength: PRODUCTION_RUNTIME_RULE_WHITELIST.length,
      credential: {
        provider: liveCred.provider,
        model: liveCred.model,
        envVarName: liveCred.envVarName,
        baseUrl: liveCred.baseUrl,
      },
    });

    expect(complete.mock.calls.length).toBeGreaterThan(0);
    expect(advice.notEffective).toBe(true);
    expect(advice.activationAllowed).toBe(false);
    expect(advice.notEffectiveLabel).toBe("尚未生效");
    expect(advice.modelCalled).toBe(true);
    expect(calls.complete).not.toHaveBeenCalled();
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
    expect(activateSpy).not.toHaveBeenCalled();
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  },
  90_000,
);
