import type { DefaultMetricSet } from "./contracts.js";
import type { MetricContract } from "./types.js";

export const PRIMARY_METRIC_IDS = [
  "task_success_rate",
  "first_delivery_pass_rate",
  "human_revision_rate",
  "governance_human_intervention_rate",
  "issue_recurrence_rate",
  "skill_success_rate",
  "user_satisfaction",
] as const;

export const GUARDRAIL_METRIC_IDS = [
  "security_violations",
  "human_takeover_rate",
  "error_retry_rate",
  "p95_latency",
  "token_cost",
  "delivery_failure_rate",
  "cross_tenant_contamination",
] as const;

export function requiredGuardrails(): MetricContract[] {
  return [
    {
      metricId: "security_violations",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0,
      critical: true,
    },
    {
      metricId: "human_takeover_rate",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0.02,
    },
    {
      metricId: "error_retry_rate",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0.03,
    },
    {
      metricId: "p95_latency",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 250,
    },
    {
      metricId: "token_cost",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0.15,
    },
    {
      metricId: "delivery_failure_rate",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0.01,
    },
    {
      metricId: "cross_tenant_contamination",
      kind: "guardrail",
      improveWhen: "decrease",
      minimumEffect: 0,
      maxRegression: 0,
      critical: true,
    },
  ];
}

export function workingDnaMetricSet(): DefaultMetricSet {
  return {
    primary: {
      metricId: "task_success_rate",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0.02,
    },
    guardrails: requiredGuardrails(),
  };
}

export function capsuleMetricSet(): DefaultMetricSet {
  return {
    primary: {
      metricId: "issue_recurrence_rate",
      kind: "primary",
      improveWhen: "decrease",
      minimumEffect: 0.02,
    },
    guardrails: requiredGuardrails(),
  };
}

export function skillMetricSet(): DefaultMetricSet {
  return {
    primary: {
      metricId: "skill_success_rate",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0.02,
    },
    guardrails: requiredGuardrails(),
  };
}

export function organizationMetricSet(): DefaultMetricSet {
  return {
    primary: {
      metricId: "first_delivery_pass_rate",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0.02,
    },
    guardrails: requiredGuardrails(),
  };
}

export function runtimeGovernanceMetricSet(): DefaultMetricSet {
  return {
    primary: {
      metricId: "governance_human_intervention_rate",
      kind: "primary",
      improveWhen: "decrease",
      minimumEffect: 0.02,
    },
    guardrails: requiredGuardrails(),
  };
}

export function assertSinglePrimaryMetric(metrics: readonly MetricContract[]): MetricContract {
  const primaries = metrics.filter((row) => row.kind === "primary");
  if (primaries.length !== 1) {
    throw new Error("each experiment must declare exactly one primary metric");
  }
  return primaries[0];
}
