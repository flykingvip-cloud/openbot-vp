import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { HealthReport } from "./health-report.js";

const HealthReportMetaSchema = Type.Object({
  schema: Type.Literal("memory-health-report/v2"),
  instanceSha: Type.String(),
  probeModuleSha: Type.String(),
  probeModuleVersion: Type.String(),
  probeUtc: Type.String(),
});

export const HealthReportScopeDeniedSchema = Type.Object(
  {
    schema: Type.Literal("memory-health-report/v2"),
    status: Type.Literal("denied"),
    reasonCode: Type.Literal("scope.denied"),
    reason: Type.String(),
    probeUtc: Type.String(),
  },
  { additionalProperties: false },
);

export const HealthReportProbeInvalidSchema = Type.Object(
  {
    ...HealthReportMetaSchema.properties,
    reportKind: Type.Literal("ops"),
    status: Type.Literal("invalid"),
    reasonCode: Type.Literal("probe.invalid"),
    reason: Type.String(),
    callerScope: Type.Union([
      Type.Literal("platform"),
      Type.Literal("steward"),
      Type.Literal("tenant"),
    ]),
    probeIntegrity: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

export const HealthReportOpsOkSchema = Type.Object({
  ...HealthReportMetaSchema.properties,
  reportKind: Type.Literal("ops"),
  status: Type.Literal("ok"),
  reasonCode: Type.Literal("probe.ok"),
  callerScope: Type.Union([
    Type.Literal("platform"),
    Type.Literal("steward"),
    Type.Literal("tenant"),
  ]),
  authorizedAgentIds: Type.Array(Type.String()),
  runtime: Type.Object({
    stateDir: Type.String(),
    tenantsRoot: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  agents: Type.Array(Type.Unknown()),
  groups: Type.Array(Type.Unknown()),
  probeIntegrity: Type.Object({
    preSnapshotHash: Type.String(),
    postSnapshotHash: Type.String(),
    mutationsDetected: Type.Literal(false),
    changedPaths: Type.Optional(Type.Array(Type.String())),
  }),
});

export const HealthReportSummaryOkSchema = Type.Object(
  {
    ...HealthReportMetaSchema.properties,
    reportKind: Type.Literal("summary"),
    status: Type.Literal("ok"),
    reasonCode: Type.Literal("probe.ok"),
    callerScope: Type.Union([Type.Literal("steward"), Type.Literal("tenant")]),
    authorizedAgentIds: Type.Optional(Type.Array(Type.String())),
    agents: Type.Array(Type.Unknown()),
    groups: Type.Optional(Type.Array(Type.Unknown())),
  },
  { additionalProperties: false },
);

export const HealthReportUnionSchema = Type.Union([
  HealthReportScopeDeniedSchema,
  HealthReportProbeInvalidSchema,
  HealthReportOpsOkSchema,
  HealthReportSummaryOkSchema,
]);

export function isValidHealthReport(value: unknown): value is HealthReport {
  return Value.Check(HealthReportUnionSchema, value);
}

export function assertHealthReportHasNoPathLeak(report: HealthReport): void {
  if (report.status === "denied" || report.status === "invalid") {
    if ("agents" in report && report.agents !== undefined) {
      throw new Error("error envelope must not include agents");
    }
    if ("runtime" in report && report.runtime !== undefined) {
      throw new Error("error envelope must not include runtime");
    }
  }
  if (report.status === "ok" && report.reportKind === "summary") {
    for (const agent of report.agents) {
      if ("workspaceRoot" in agent || "indexPath" in agent) {
        throw new Error("summary agents must not include absolute paths");
      }
    }
  }
}
