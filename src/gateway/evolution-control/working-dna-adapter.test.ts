import { classifyBaselineCapture, workingDnaMetricSet } from "@openbot/evolution-core";
import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import {
  createMemoryWorkingDnaObservationPort,
  createWorkingDnaAdapter,
  type WorkingDnaTaskOutcome,
} from "./adapters/working-dna.js";

const AGENT_ID = "dna-bot";
const TENANT_A = "tenant-fixture-a";

function windowFor(
  over: { startedAt?: string; endedAt?: string; phase?: "baseline" | "treatment" } = {},
) {
  return {
    windowId: "w",
    experimentId: "exp-dna",
    phase: over.phase ?? "baseline",
    startedAt: over.startedAt ?? "2026-09-06T10:00:00.000Z",
    endedAt: over.endedAt ?? "2026-09-06T11:00:00.000Z",
    tenantScope: TENANT_A,
    targetKey: `agent:${AGENT_ID}`,
    modelRevision: "m",
    configRevision: "c",
    cohortRef: "co",
  };
}

function outcomes(count: number): WorkingDnaTaskOutcome[] {
  return Array.from({ length: count }, (_, index) => ({
    agentId: AGENT_ID,
    tenantId: TENANT_A,
    experimentId: "exp-dna",
    cohortRef: "co",
    occurredAt: Date.parse("2026-09-06T10:00:00.000Z") + index * 1_000,
    succeeded: index < count - 2,
    latencyMs: 10 + index,
    securityViolation: false,
    crossTenantContamination: false,
  }));
}

describe("working-dna observation", () => {
  it("does not map a single Working Style change to sampleSize 1", async () => {
    const adapter = createWorkingDnaAdapter({} as OpenBotConfig, {
      observationPort: createMemoryWorkingDnaObservationPort([]),
    });
    const measured = await adapter.observeTarget?.(
      { domain: "agent", agentId: AGENT_ID },
      "w",
      windowFor(),
    );
    expect(measured).toEqual([]);
  });

  it("aggregates windowed task outcomes and can freeze a complete baseline", async () => {
    const adapter = createWorkingDnaAdapter({} as OpenBotConfig, {
      observationPort: createMemoryWorkingDnaObservationPort(outcomes(20)),
    });
    const measured = await adapter.observeTarget?.(
      { domain: "agent", agentId: AGENT_ID },
      "w",
      windowFor(),
    );
    expect(measured?.[0]).toEqual(
      expect.objectContaining({
        metricId: "task_success_rate",
        sampleSize: 20,
        value: 0.9,
      }),
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "security_violations", value: 0, sampleSize: 20 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 20,
        }),
      ]),
    );
    const metrics = workingDnaMetricSet();
    expect(
      classifyBaselineCapture({
        experiment: {
          experimentId: "exp-dna",
          primaryMetric: metrics.primary,
          guardrailMetrics: metrics.guardrails,
        },
        samples: measured ?? [],
        window: windowFor(),
      }).status,
    ).toBe("frozen");
  });

  it("filters by experimentId so another cohort cannot contaminate the window", async () => {
    const adapter = createWorkingDnaAdapter({} as OpenBotConfig, {
      observationPort: createMemoryWorkingDnaObservationPort([
        ...outcomes(20),
        {
          agentId: AGENT_ID,
          tenantId: TENANT_A,
          experimentId: "exp-other",
          cohortRef: "co",
          occurredAt: Date.parse("2026-09-06T10:00:30.000Z"),
          succeeded: false,
          latencyMs: 1,
          securityViolation: true,
          crossTenantContamination: true,
        },
      ]),
    });
    const measured = await adapter.observeTarget?.(
      { domain: "agent", agentId: AGENT_ID },
      "w",
      windowFor(),
    );
    expect(measured?.[0]?.sampleSize).toBe(20);
    expect(measured?.find((row) => row.metricId === "security_violations")?.value).toBe(0);
  });

  it("treatment requires an explicit matching experimentId", async () => {
    const adapter = createWorkingDnaAdapter({} as OpenBotConfig, {
      observationPort: createMemoryWorkingDnaObservationPort([
        {
          agentId: AGENT_ID,
          tenantId: TENANT_A,
          occurredAt: Date.parse("2026-09-06T10:00:00.000Z"),
          succeeded: true,
          latencyMs: 10,
          securityViolation: false,
          crossTenantContamination: false,
        },
        {
          agentId: AGENT_ID,
          tenantId: TENANT_A,
          experimentId: "exp-other",
          occurredAt: Date.parse("2026-09-06T10:00:01.000Z"),
          succeeded: true,
          latencyMs: 10,
          securityViolation: false,
          crossTenantContamination: false,
        },
        {
          agentId: AGENT_ID,
          tenantId: TENANT_A,
          experimentId: "exp-dna",
          applicationId: "app-dna",
          cohortRef: "co",
          runId: "run-dna",
          occurredAt: Date.parse("2026-09-06T10:00:02.000Z"),
          succeeded: true,
          latencyMs: 10,
          securityViolation: false,
          crossTenantContamination: false,
        },
      ]),
    });
    const measured = await adapter.observeTarget?.(
      { domain: "agent", agentId: AGENT_ID },
      "w",
      windowFor({ phase: "treatment" }),
    );
    expect(measured?.[0]?.sampleSize).toBe(1);
  });

  it("derives cross-tenant from event tenant vs window without inventing security", async () => {
    const adapter = createWorkingDnaAdapter({} as OpenBotConfig, {
      observationPort: createMemoryWorkingDnaObservationPort([
        {
          agentId: AGENT_ID,
          tenantId: TENANT_A,
          experimentId: "exp-dna",
          cohortRef: "co",
          runId: "run-dna",
          occurredAt: Date.parse("2026-09-06T10:00:00.000Z"),
          succeeded: true,
          latencyMs: 12,
        },
      ]),
    });
    const measured = await adapter.observeTarget?.(
      { domain: "agent", agentId: AGENT_ID },
      "w",
      windowFor({ phase: "treatment" }),
    );
    expect(measured).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: "task_success_rate", sampleSize: 1 }),
        expect.objectContaining({
          metricId: "cross_tenant_contamination",
          value: 0,
          sampleSize: 1,
        }),
        expect.objectContaining({ metricId: "p95_latency", value: 12, sampleSize: 1 }),
      ]),
    );
    expect(measured?.find((row) => row.metricId === "security_violations")).toBeUndefined();
  });
});
