import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  getEvolutionSurface,
  type EvolutionProposal,
  type EvolutionTimelineListInput,
  type EvolutionTimelineQueryResult,
  type EvolutionTriggerSighting,
} from "@openbot/evolution-core";
import { PHASE1_FLAGS } from "@openbot/toolkit";
import { afterEach, describe, expect, it } from "vitest";
import { createEvolutionPerceptionTool } from "../../agents/tools/evolution-perception-tool.js";
import type { OpenBotConfig } from "../../config/config.js";
import type { EvolutionAuthorizationInspector } from "../../diagnosis/evolution-proposal.js";
import { ORCHESTRATION_LIVE_INVOKE } from "../../task-orchestration/types.js";
import { createWorkingDnaAdapter } from "../evolution-control/adapters/working-dna.js";
import { createEvolutionControlPlane } from "../evolution-control/control-plane.js";
import {
  publishEvolutionNarration,
  setEvolutionPerceptionSnapshotForTests,
  snapshotEvolutionPerceptionFromPlane,
} from "../evolution-control/perception-runtime.js";
import { testObservation } from "../evolution-control/test-support.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { coreGatewayHandlers } from "../server-methods.js";
import { evolutionPerceptionHandlers } from "./evolution-perception.js";
import { evolutionPerceptionPack } from "./evolution-perception.pack.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";
import type { GatewayClient, GatewayRequestHandler } from "./types.js";

const TENANT_A = "tenant-perception-a";
const TENANT_B = "tenant-perception-b";
const WINDOW = { from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" };

const runtimeSource = readFileSync(
  fileURLToPath(new URL("../evolution-control/perception-runtime.ts", import.meta.url)),
  "utf8",
);
const handlerSource = readFileSync(
  fileURLToPath(new URL("./evolution-perception.ts", import.meta.url)),
  "utf8",
);
const toolSource = readFileSync(
  fileURLToPath(new URL("../../agents/tools/evolution-perception-tool.ts", import.meta.url)),
  "utf8",
);

function inspector(): EvolutionAuthorizationInspector {
  return {
    inspect: () => ({
      grantId: "grant-1",
      status: "APPROVED",
      tenantScope: TENANT_A,
      allowedEvidence: ["ev-a"],
      allowedActions: ["diagnose"],
      confidentialityCeiling: "enterprise",
    }),
  };
}

function clientFor(tenantId: string | null): GatewayClient | null {
  if (!tenantId) {
    return null;
  }
  return {
    connect: {
      minProtocol: 1,
      maxProtocol: 3,
      client: { id: "ctrl", displayName: "ctrl", version: "1", platform: "web", mode: "webchat" },
    },
    user: "ent-admin",
    sessionEnterpriseId: tenantId,
    sessionTenantId: tenantId,
  };
}

function invoke(
  handler: GatewayRequestHandler,
  params: Record<string, unknown>,
  client: GatewayClient | null,
) {
  return new Promise<{
    ok: boolean;
    payload?: Record<string, unknown>;
    error?: { message?: string };
  }>((resolve) => {
    void handler({
      req: { id: "1", method: "test", type: "req" },
      params,
      client,
      isWebchatConnect: () => false,
      respond: (ok, payload, error) => {
        resolve({
          ok,
          payload: payload as Record<string, unknown> | undefined,
          error: error as { message?: string } | undefined,
        });
      },
      context: {} as never,
    });
  });
}

function proposal(
  over: Partial<EvolutionProposal> &
    Pick<EvolutionProposal, "proposalId" | "target" | "tenantScope" | "status" | "surfaceId">,
): EvolutionProposal {
  return {
    schemaVersion: 2,
    sourceEvidenceRefs: ["ev-proposal"],
    sourceMechanismRef: "mechanism:case-1",
    candidateRef: `cand:${over.proposalId}`,
    expectedEffects: [],
    riskLevel: "low",
    confidentialityScope: "personal",
    grantId: "grant-1",
    createdAt: "2026-09-10T00:00:00.000Z",
    expiresAt: "2026-10-10T00:00:00.000Z",
    ...over,
  };
}

function learnedSnapshot(): EvolutionTimelineListInput {
  return {
    events: [
      {
        eventId: "evt-learned",
        type: "verification.completed",
        timestamp: "2026-09-12T00:00:00.000Z",
        proposalId: "prop-learned",
        surfaceId: "agent.working-dna",
        tenantScope: TENANT_A,
        evidenceRefs: ["ev-learned"],
        target: { domain: "agent", agentId: "bot-1" },
        applicationId: "app-learned",
        verificationId: "ver-learned",
      },
      {
        eventId: "evt-system",
        type: "application.applied",
        timestamp: "2026-09-12T01:00:00.000Z",
        proposalId: "prop-system",
        surfaceId: "system.runtime-binding-governance",
        tenantScope: TENANT_A,
        evidenceRefs: ["ev-system"],
        target: { domain: "system", componentId: "runtime-binding" },
        applicationId: "app-system",
      },
      {
        eventId: "evt-other-tenant",
        type: "verification.completed",
        timestamp: "2026-09-12T02:00:00.000Z",
        proposalId: "prop-other",
        surfaceId: "agent.working-dna",
        tenantScope: TENANT_B,
        evidenceRefs: ["ev-other"],
        target: { domain: "agent", agentId: "bot-b" },
        verificationId: "ver-other",
      },
    ],
    proposals: [
      proposal({
        proposalId: "prop-learned",
        target: { domain: "agent", agentId: "bot-1" },
        tenantScope: TENANT_A,
        status: "VERIFIED",
        surfaceId: "agent.working-dna",
        applicationId: "app-learned",
        verificationId: "ver-learned",
      }),
      proposal({
        proposalId: "prop-system",
        target: { domain: "system", componentId: "runtime-binding" },
        tenantScope: TENANT_A,
        status: "ACTIVE",
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
        applicationId: "app-system",
      }),
      proposal({
        proposalId: "prop-other",
        target: { domain: "agent", agentId: "bot-b" },
        tenantScope: TENANT_B,
        status: "VERIFIED",
        surfaceId: "agent.working-dna",
      }),
    ],
    applications: [
      {
        schemaVersion: 1,
        applicationId: "app-learned",
        proposalId: "prop-learned",
        experimentId: "exp-learned",
        adapterId: "working-dna",
        idempotencyKey: "idem-learned",
        targetVersionBefore: "v1",
        targetVersionAfter: "v2",
        rollbackRef: "rb-learned",
        scope: "canary",
        status: "applied",
        appliedToRuntime: true,
      },
      {
        schemaVersion: 1,
        applicationId: "app-system",
        proposalId: "prop-system",
        experimentId: "exp-system",
        adapterId: "runtime",
        idempotencyKey: "idem-system",
        targetVersionBefore: "s1",
        targetVersionAfter: "s2",
        rollbackRef: "rb-system",
        scope: "canary",
        status: "applied",
        appliedToRuntime: true,
      },
    ],
    verifications: [
      {
        schemaVersion: 1,
        verificationId: "ver-learned",
        applicationId: "app-learned",
        baselineWindowRef: "base",
        evaluationWindowRef: "eval",
        primaryEffect: 0.2,
        guardrailResults: [],
        sampleSize: 10,
        confidence: 0.9,
        outcome: "improved",
        evidenceRefs: ["ev-ver"],
        verifiedAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    surfaces: [
      getEvolutionSurface("agent.working-dna"),
      getEvolutionSurface("system.runtime-binding-governance"),
    ].filter((surface) => surface != null),
  };
}

describe("evolution perception runtime wiring", () => {
  afterEach(() => {
    setEvolutionPerceptionSnapshotForTests();
  });

  it("registers read-only gateway methods on the process handler table", () => {
    expect(evolutionPerceptionPack.id).toBe("evolution-perception");
    expect(GATEWAY_METHOD_PACKS.some((pack) => pack.id === "evolution-perception")).toBe(true);
    expect(coreGatewayHandlers["evolution.perception.query"]).toBe(
      evolutionPerceptionHandlers["evolution.perception.query"],
    );
    expect(coreGatewayHandlers["evolution.perception.project"]).toBe(
      evolutionPerceptionHandlers["evolution.perception.project"],
    );
    expect(
      authorizeOperatorScopesForMethod("evolution.perception.query", ["operator.read"]).allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.perception.project", ["operator.read"]).allowed,
    ).toBe(true);
    expect(
      authorizeOperatorScopesForMethod("evolution.perception.project", ["operator.pairing"]),
    ).toEqual({ allowed: false, missingScope: "operator.read" });
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(PHASE1_FLAGS.ORCHESTRATION_LIVE_INVOKE).toBe(false);
    expect(PHASE1_FLAGS.DAG_ENABLED).toBe(false);
  });

  it("queries the live control-plane snapshot without appending", async () => {
    const plane = createEvolutionControlPlane({
      inspector: inspector(),
      workingDnaAdapter: createWorkingDnaAdapter({} as OpenBotConfig),
      observationProvider: testObservation(),
      now: () => "2026-09-20T12:00:00.000Z",
    });
    plane.registerProposal(
      proposal({
        proposalId: "prop-dh",
        target: { domain: "agent", agentId: "bot-1" },
        tenantScope: TENANT_A,
        status: "PENDING_AUTHORITY",
        surfaceId: "agent.working-dna",
      }),
    );
    plane.registerProposal(
      proposal({
        proposalId: "prop-sys",
        target: { domain: "system", componentId: "runtime-binding" },
        tenantScope: TENANT_A,
        status: "ACTIVE",
        surfaceId: "system.runtime-binding-governance",
        confidentialityScope: "platform",
      }),
    );
    plane.registerProposal(
      proposal({
        proposalId: "prop-other",
        target: { domain: "agent", agentId: "bot-b" },
        tenantScope: TENANT_B,
        status: "PENDING_AUTHORITY",
        surfaceId: "agent.working-dna",
      }),
    );
    plane.ledger.append({
      eventId: "evt-sys-applied",
      type: "application.applied",
      timestamp: "2026-09-20T13:00:00.000Z",
      proposalId: "prop-sys",
      target: { domain: "system", componentId: "runtime-binding" },
      surfaceId: "system.runtime-binding-governance",
      tenantScope: TENANT_A,
      principalRef: "control-plane",
      grantId: "grant-1",
      evidenceRefs: ["ev-sys"],
      applicationId: "app-sys",
    });
    const before = JSON.stringify(plane.ledger.list());
    const snapshot = snapshotEvolutionPerceptionFromPlane(plane);
    expect(snapshot.autonomyBySurfaceId).toBeUndefined();
    setEvolutionPerceptionSnapshotForTests(() => snapshot);
    const handler = coreGatewayHandlers["evolution.perception.query"];
    expect(handler).toBeTypeOf("function");
    const pending = await invoke(
      handler,
      {
        intent: "pending",
        window: { from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T14:00:00.000Z" },
        tenantScope: TENANT_B,
      },
      clientFor(TENANT_A),
    );
    expect(pending.ok).toBe(true);
    expect(pending.payload?.denial).toMatchObject({ denied: true, reason: "permission_denied" });
    expect(pending.payload?.narration).toBeNull();
    const unknown = await invoke(
      handler,
      {
        intent: "pending",
        window: { from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T14:00:00.000Z" },
        agentId: "bot-1",
      },
      clientFor(TENANT_A),
    );
    const unknownResult = unknown.payload?.result as {
      items: unknown[];
      unresolvedIntents: string[];
    };
    expect(unknownResult.items).toEqual([]);
    expect(unknownResult.unresolvedIntents).toEqual(["pending"]);
    expect(unknown.payload?.narration).toBeNull();
    expect(JSON.stringify(unknown.payload)).not.toContain("学会了");
    const projected = await invoke(
      coreGatewayHandlers["evolution.perception.project"],
      {
        operation: "pending",
        window: { from: "2026-09-20T11:00:00.000Z", to: "2026-09-20T14:00:00.000Z" },
        agentId: "bot-1",
      },
      clientFor(TENANT_A),
    );
    expect(JSON.stringify(plane.ledger.list())).toBe(before);
    expect(JSON.stringify(snapshot)).toBe(
      JSON.stringify(snapshotEvolutionPerceptionFromPlane(plane)),
    );
    const body = JSON.stringify(projected.payload);
    expect(body).not.toContain("prop-other");
    expect(body).not.toContain("bot-b");
    const pendingProjection = projected.payload?.projection as
      | { items: { factIds: { ledgerEventId: string }; audience: string }[] }
      | undefined;
    const pendingItems = pendingProjection?.items ?? [];
    expect(pendingItems.length).toBeGreaterThan(0);
    expect(pendingItems.every((item) => item.audience === "digital_human")).toBe(true);
    expect(pendingItems.every((item) => item.factIds.ledgerEventId.trim().length > 0)).toBe(true);
  });

  it("keeps system changes out of learned narration and still answers from fact ids", async () => {
    const snapshot = learnedSnapshot();
    const frozen = JSON.stringify(snapshot);
    setEvolutionPerceptionSnapshotForTests(() => snapshot);
    const queried = await invoke(
      coreGatewayHandlers["evolution.perception.query"],
      { intent: "learned_this_week", window: WINDOW },
      clientFor(TENANT_A),
    );
    expect(JSON.stringify(snapshot)).toBe(frozen);
    const result = queried.payload?.result as EvolutionTimelineQueryResult;
    expect(result.items.some((item) => item.factIds.ledgerEventId === "evt-learned")).toBe(true);
    expect(result.items.some((item) => item.changeObject.domain === "system")).toBe(false);
    expect(result.platformItems.some((item) => item.factIds.ledgerEventId === "evt-system")).toBe(
      true,
    );
    const narration = queried.payload?.narration as { learned: string[]; platform: string[] };
    expect(narration.learned.join("\n")).toContain("evt-learned");
    expect(narration.learned.join("\n")).toContain("学会了");
    expect(narration.learned.join("\n")).not.toContain("evt-system");
    expect(narration.platform.join("\n")).toContain("evt-system");
    expect(narration.platform.join("\n")).not.toContain("学会了");
    expect(JSON.stringify(queried.payload)).not.toContain("evt-other-tenant");

    const guarded = publishEvolutionNarration(
      {
        ...result,
        items: result.items.map((item) => ({
          ...item,
          factIds: { ...item.factIds, ledgerEventId: " " },
        })),
      },
      "learned_this_week",
    );
    expect(guarded.narration).toBeNull();
    expect(guarded.narrationGuard).toBe("missing_fact_id");
    expect(JSON.stringify(guarded)).not.toContain("学会了");
  });

  it("projects delivery tiers and trigger classification without a receipt store", async () => {
    const base = learnedSnapshot();
    const snapshot: EvolutionTimelineListInput = {
      ...base,
      events: [
        ...base.events,
        {
          eventId: "evt-pending",
          type: "proposal.created",
          timestamp: "2026-09-13T00:00:00.000Z",
          proposalId: "prop-pending",
          surfaceId: "agent.working-dna",
          tenantScope: TENANT_A,
          evidenceRefs: ["ev-pending"],
          target: { domain: "agent", agentId: "bot-1" },
        },
      ],
      proposals: [
        ...(base.proposals ?? []),
        proposal({
          proposalId: "prop-pending",
          target: { domain: "agent", agentId: "bot-1" },
          tenantScope: TENANT_A,
          status: "PENDING_AUTHORITY",
          surfaceId: "agent.working-dna",
        }),
      ],
    };
    const frozen = JSON.stringify(snapshot);
    setEvolutionPerceptionSnapshotForTests(() => snapshot);
    const delivery = await invoke(
      coreGatewayHandlers["evolution.perception.project"],
      { operation: "delivery", window: WINDOW },
      clientFor(TENANT_A),
    );
    const projection = delivery.payload?.projection as {
      receiptStore: boolean;
      immediate: {
        deliveryId: string;
        status: string;
        item: { factIds: { ledgerEventId: string } };
      }[];
      weekly: {
        deliveryId: string;
        status: string;
        item: { factIds: { ledgerEventId: string } };
      }[];
    };
    expect(projection.receiptStore).toBe(false);
    expect(delivery.payload?.persisted).toBe(false);
    expect(
      projection.immediate.some((row) => row.item.factIds.ledgerEventId === "evt-pending"),
    ).toBe(true);
    expect(
      projection.immediate.every(
        (row) => row.status === "queued" && row.deliveryId.startsWith("dlv:"),
      ),
    ).toBe(true);
    expect(projection.weekly.some((row) => row.item.factIds.ledgerEventId === "evt-system")).toBe(
      true,
    );
    const sightings: EvolutionTriggerSighting[] = [
      {
        kind: "event",
        tenantScope: TENANT_A,
        targetKey: "agent:bot-1",
        reasonCode: "repeat",
        observedAt: "2026-09-12T00:00:00.000Z",
        factId: "evt-learned",
      },
      {
        kind: "event",
        tenantScope: TENANT_A,
        targetKey: "agent:bot-1",
        reasonCode: "repeat",
        observedAt: "2026-09-12T00:10:00.000Z",
        factId: "evt-learned",
      },
      {
        kind: "event",
        tenantScope: TENANT_B,
        targetKey: "agent:bot-b",
        reasonCode: "repeat",
        observedAt: "2026-09-12T00:20:00.000Z",
        factId: "evt-other-tenant",
      },
    ];
    const triggers = await invoke(
      coreGatewayHandlers["evolution.perception.project"],
      { operation: "triggers", sightings },
      clientFor(TENANT_A),
    );
    const triggerProjection = triggers.payload?.projection as
      | { persisted: boolean; rows: { disposition: string; factId: string | null }[] }
      | undefined;
    const rows = triggerProjection?.rows ?? [];
    expect(triggerProjection?.persisted).toBe(false);
    expect(rows.map((row) => row.disposition)).toEqual(["emit", "deduped"]);
    expect(JSON.stringify(triggers.payload)).not.toContain("evt-other-tenant");
    expect(JSON.stringify(snapshot)).toBe(frozen);
    const denied = await invoke(
      coreGatewayHandlers["evolution.perception.query"],
      { intent: "learned_this_week", window: WINDOW },
      clientFor(null),
    );
    expect(denied.payload?.denial).toMatchObject({ denied: true });
    expect(denied.payload?.result).toBeNull();
  });

  it("answers through the Da Bai tool and does not invent a learned sentence", async () => {
    setEvolutionPerceptionSnapshotForTests(learnedSnapshot);
    const tool = createEvolutionPerceptionTool({ tenantId: TENANT_A });
    const result = await tool.execute("call-1", {
      intent: "learned_this_week",
      window: WINDOW,
    });
    const details = result.details as {
      narration: { learned: string[]; platform: string[] };
      result: { items: { changeObject: { domain: string } }[] };
      persisted: boolean;
    };
    expect(details.persisted).toBe(false);
    expect(details.narration.learned.join("\n")).toContain("evt-learned");
    expect(details.result.items.some((item) => item.changeObject.domain === "system")).toBe(false);
    expect(details.narration.platform.join("\n")).not.toContain("学会了");
    const denied = await createEvolutionPerceptionTool().execute("call-2", {
      intent: "learned_this_week",
      window: WINDOW,
    });
    expect((denied.details as { denial: { denied: boolean }; narration: null }).denial.denied).toBe(
      true,
    );
    expect((denied.details as { narration: null }).narration).toBeNull();
  });

  it("forwards an already-read autonomy snapshot into automatic actions without spending budget", async () => {
    const base = getEvolutionSurface("agent.working-dna");
    expect(base?.autoApply).toBe(false);
    const snapshot: EvolutionTimelineListInput = {
      events: [
        {
          eventId: "evt-auto",
          type: "proposal.authorized",
          timestamp: "2026-09-12T00:00:00.000Z",
          proposalId: "prop-auto",
          surfaceId: "agent.working-dna",
          tenantScope: TENANT_A,
          evidenceRefs: ["ev-auto"],
          target: { domain: "agent", agentId: "bot-1" },
        },
      ],
      proposals: [
        proposal({
          proposalId: "prop-auto",
          target: { domain: "agent", agentId: "bot-1" },
          tenantScope: TENANT_A,
          status: "SUGGESTED",
          surfaceId: "agent.working-dna",
        }),
      ],
      surfaces: base ? [{ ...base, autoApply: true }] : [],
      autonomyBySurfaceId: {
        "agent.working-dna": {
          policy: {
            surfaceId: "agent.working-dna",
            mode: "auto",
            maxApplications: 1,
            usedApplications: 0,
            maxImpactScope: "active",
          },
          killSwitch: false,
        },
      },
    };
    setEvolutionPerceptionSnapshotForTests(() => snapshot);
    const projected = await invoke(
      coreGatewayHandlers["evolution.perception.project"],
      { operation: "automatic", window: WINDOW, agentId: "bot-1" },
      clientFor(TENANT_A),
    );
    const automaticProjection = projected.payload?.projection as
      | {
          actions: {
            budget: { available: boolean; usedApplications?: number };
            item: { factIds: { ledgerEventId: string } };
          }[];
        }
      | undefined;
    const actions = automaticProjection?.actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]?.item.factIds.ledgerEventId).toBe("evt-auto");
    expect(actions[0]?.budget).toMatchObject({ available: true, usedApplications: 0 });
    expect(snapshot.autonomyBySurfaceId?.["agent.working-dna"]?.policy?.usedApplications).toBe(0);
    expect(getEvolutionSurface("agent.working-dna")?.autoApply).toBe(false);
  });

  it("stays a read-only adapter over evolution-core", () => {
    const sources = `${runtimeSource}\n${handlerSource}\n${toolSource}`;
    expect(runtimeSource).toContain("queryEvolutionPerception");
    expect(runtimeSource).toContain("projectEvolutionTimeline");
    expect(runtimeSource).toContain("projectWeeklyEvolutionDigest");
    expect(runtimeSource).toContain("projectPendingDecisions");
    expect(runtimeSource).toContain("projectAutomaticActions");
    expect(runtimeSource).toContain("projectObservationQueue");
    expect(runtimeSource).toContain("classifyEvolutionTriggerSightings");
    expect(runtimeSource).toContain("measureEvolutionTriggerCatalog");
    expect(runtimeSource).toContain("projectEvolutionDelivery");
    expect(runtimeSource).toContain("snapshotEvolutionPerceptionFromPlane");
    expect(runtimeSource).toContain("ensureEvolutionControlPlaneStarted");
    expect(sources).not.toMatch(
      /\b(writeFile|appendFile|mkdirSync|unlinkSync|createWriteStream|ledger\.append|evaluateSurfaceAutonomy|ORCHESTRATION_LIVE_INVOKE|user\.daibai\.ask|user\.daibai\.execute)\b/,
    );
  });
});
