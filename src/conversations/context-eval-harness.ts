/**
 * CL-P2-03 evaluation harness: long-dialogue replay comparing
 * baseline (no planner) vs budget planner under small/large windows.
 * Pure functions — no network; suitable for unit CI.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { assembleMessagesWithBudget, estimateMessagesTokensRough } from "./context-assemble.js";
import { buildRuleProjection } from "./projection.js";

export type EvalFixtureMessage = {
  role: "user" | "assistant" | "system";
  text: string;
};

export type EvalFixture = {
  id: string;
  description: string;
  messages: EvalFixtureMessage[];
  /** Strings that must remain in assembled context under planner. */
  mustRetain: string[];
};

export type EvalRunResult = {
  fixtureId: string;
  mode: "baseline" | "planner";
  modelContextTokens: number;
  messageCountIn: number;
  messageCountOut: number;
  estimatedTokens: number;
  trimmed: boolean;
  retainedMust: string[];
  missingMust: string[];
  overflow: boolean;
};

export type EvalReport = {
  fixtures: number;
  plannerRetainRate: number;
  baselineRetainRate: number;
  plannerOverflowCount: number;
  baselineOverflowCount: number;
  runs: EvalRunResult[];
};

function toAgentMessages(messages: EvalFixtureMessage[]): AgentMessage[] {
  return messages.map(
    (m) =>
      ({
        role: m.role,
        content: m.text,
        timestamp: Date.now(),
      }) as AgentMessage,
  );
}

function joinedText(messages: AgentMessage[]): string {
  return messages
    .map((m) => {
      const c = (m as { content?: unknown }).content;
      return typeof c === "string" ? c : JSON.stringify(c ?? "");
    })
    .join("\n");
}

export function runFixture(params: {
  fixture: EvalFixture;
  modelContextTokens: number;
  mode: "baseline" | "planner";
}): EvalRunResult {
  const messages = toAgentMessages(params.fixture.messages);
  if (params.mode === "baseline") {
    const text = joinedText(messages);
    const retained = params.fixture.mustRetain.filter((s) => text.includes(s));
    const missing = params.fixture.mustRetain.filter((s) => !text.includes(s));
    return {
      fixtureId: params.fixture.id,
      mode: "baseline",
      modelContextTokens: params.modelContextTokens,
      messageCountIn: messages.length,
      messageCountOut: messages.length,
      estimatedTokens: estimateMessagesTokensRough(messages),
      trimmed: false,
      retainedMust: retained,
      missingMust: missing,
      overflow: estimateMessagesTokensRough(messages) > params.modelContextTokens,
    };
  }

  const assembled = assembleMessagesWithBudget(messages, {
    tokenBudget: params.modelContextTokens,
    enforce: true,
    outputReserveTokens: Math.min(1024, Math.floor(params.modelContextTokens * 0.1)),
    toolProtocolReserveTokens: Math.min(512, Math.floor(params.modelContextTokens * 0.05)),
    mandatoryPolicyTokens: 200,
  });
  const text = joinedText(assembled.messages);
  const retained = params.fixture.mustRetain.filter((s) => text.includes(s));
  const missing = params.fixture.mustRetain.filter((s) => !text.includes(s));
  return {
    fixtureId: params.fixture.id,
    mode: "planner",
    modelContextTokens: params.modelContextTokens,
    messageCountIn: messages.length,
    messageCountOut: assembled.messages.length,
    estimatedTokens: assembled.estimatedTokens,
    trimmed: assembled.trimmed,
    retainedMust: retained,
    missingMust: missing,
    overflow: assembled.plan.overflow,
  };
}

/** Built-in fixtures: decisions, amounts, dates, IDs, todos, paths. */
export function defaultEvalFixtures(): EvalFixture[] {
  const history: EvalFixtureMessage[] = [];
  for (let i = 0; i < 20; i++) {
    history.push({ role: "user", text: `chatter turn ${i} ${"x".repeat(120)}` });
    history.push({ role: "assistant", text: `ack ${i} ${"y".repeat(120)}` });
  }
  return [
    {
      id: "retain-current-and-deadline",
      description: "Latest user + deadline must survive tight budget",
      messages: [
        ...history,
        {
          role: "user",
          text: "Remember: the report is due Friday and order ORD-99881 is $12,500. Path: /docs/report.pdf",
        },
        { role: "assistant", text: "Noted the Friday deadline for ORD-99881." },
        { role: "user", text: "CURRENT: summarize open todos for me now" },
      ],
      mustRetain: ["CURRENT: summarize", "Friday", "ORD-99881"],
    },
    {
      id: "retain-decision-evidence",
      description: "Approved decision language retained in recent tail",
      messages: [
        ...history.slice(0, 10),
        {
          role: "user",
          text: "We decided: ship v2 to production this week. Do not use legacy API.",
        },
        { role: "assistant", text: "Acknowledged decision to ship v2." },
        { role: "user", text: "What did we decide?" },
      ],
      mustRetain: ["What did we decide?", "ship v2"],
    },
    {
      id: "small-window-current-input",
      description: "Small model window still keeps current user input",
      messages: [
        ...history,
        { role: "user", text: "FINAL_QUESTION: what is the status of task T-42?" },
      ],
      mustRetain: ["FINAL_QUESTION"],
    },
  ];
}

export function runEvalSuite(params?: {
  fixtures?: EvalFixture[];
  smallWindow?: number;
  largeWindow?: number;
}): EvalReport {
  const fixtures = params?.fixtures ?? defaultEvalFixtures();
  const windows = [params?.smallWindow ?? 4_000, params?.largeWindow ?? 32_000];
  const runs: EvalRunResult[] = [];

  for (const fixture of fixtures) {
    for (const window of windows) {
      runs.push(runFixture({ fixture, modelContextTokens: window, mode: "baseline" }));
      runs.push(runFixture({ fixture, modelContextTokens: window, mode: "planner" }));
    }
  }

  const planner = runs.filter((r) => r.mode === "planner");
  const baseline = runs.filter((r) => r.mode === "baseline");
  const rate = (rs: EvalRunResult[]) => {
    let total = 0;
    let hit = 0;
    for (const r of rs) {
      total += r.retainedMust.length + r.missingMust.length;
      hit += r.retainedMust.length;
    }
    return total === 0 ? 1 : hit / total;
  };

  return {
    fixtures: fixtures.length,
    plannerRetainRate: rate(planner),
    baselineRetainRate: rate(baseline),
    plannerOverflowCount: planner.filter((r) => r.overflow).length,
    baselineOverflowCount: baseline.filter((r) => r.overflow).length,
    runs,
  };
}

/** Projection signal regression for evaluation fixtures. */
export function evalProjectionRetention(fixture: EvalFixture): {
  shortSummary: string;
  hasEvidence: boolean;
  approvedWithoutEvidence: number;
} {
  const userTexts = fixture.messages.filter((m) => m.role === "user").map((m) => m.text);
  const assistantTexts = fixture.messages.filter((m) => m.role === "assistant").map((m) => m.text);
  const projection = buildRuleProjection({
    conversationId: `eval_${fixture.id}`,
    participants: ["eval"],
    userTexts,
    assistantTexts,
    sources: [
      {
        sourceIdentityId: "msrc_eval",
        bindingId: "b_eval",
        sessionId: "s_eval",
        firstTurnId: "t0",
        lastTurnId: "t1",
        sourceChecksum: "eval",
      },
    ],
  });
  return {
    shortSummary: projection.shortSummary,
    hasEvidence: projection.importantContext.every((c) => c.evidenceRefs.length > 0),
    approvedWithoutEvidence: projection.decisions.filter(
      (d) => d.status === "APPROVED" && d.evidenceRefs.length === 0,
    ).length,
  };
}
