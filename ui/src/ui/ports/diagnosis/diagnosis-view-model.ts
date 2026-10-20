import type { CompositeDiagnosisReport } from "../../../../../src/diagnosis/report.js";
import {
  projectDiagnosisVisualization,
  type DiagnosisVisualizationAudience,
  type DiagnosisVisualizationCatalog,
} from "../../../../../src/diagnosis/visualization.js";
import type { DiagnosisViewModel } from "../platform/diagnosis/platform-diagnosis-surface.ts";
import type {
  DiagnosisReportGetResponse,
  DiagnosisReportProjection,
  DiagnosisReportQueryResponse,
} from "./diagnosis-api.ts";

const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function catalogFromCompositeDiagnosisReport(
  report: CompositeDiagnosisReport,
): DiagnosisVisualizationCatalog {
  const findingById = new Map(report.findings.map((finding) => [finding.findingId, finding]));
  return {
    now: Date.parse(report.generatedAt),
    cases: report.cases.map((caseRow) => ({
      caseId: caseRow.caseId,
      tenantId: caseRow.tenantId,
      status: caseRow.status,
      findingIds: caseRow.findingIds,
      observedAt: report.generatedAt,
      severity:
        caseRow.findingIds
          .map((id) => findingById.get(id)?.severity)
          .find((value) => value === "P0" || value === "P1") ?? undefined,
    })),
    findings: report.findings.map((finding) => ({
      findingId: finding.findingId,
      tenantId: finding.tenantId,
      title: finding.title,
      status: finding.status,
      severity: finding.severity,
      evidenceIds: finding.evidenceIds,
      observedAt: report.generatedAt,
    })),
    evidenceRefs: report.evidenceRefs.map((ref) => ({
      evidenceId: ref.evidenceId,
      tenantId: ref.tenantId,
      observedAt: ref.observedAt,
    })),
    graphEdges: report.graphEdges.map((edge) => ({
      fromId: edge.fromId,
      toId: edge.toId,
      relation: edge.relation,
    })),
  };
}

function emptyViewModel(
  role: DiagnosisViewModel["role"],
  tenantScope: string | null,
): DiagnosisViewModel {
  return {
    role,
    tenantScope,
    redactionProfile: "administrator",
    permissionState: "empty",
    health: {
      tone: "empty",
      label: "暂无数据",
      openP0: 0,
      openP1: 0,
      inconclusive: 0,
      expired: 0,
    },
    cases: [],
    drilldown: [],
    timeline: { events: [] },
    trend: {
      window: { from: "", to: "" },
      completeness: "empty",
      buckets: [],
      missingBuckets: [],
    },
    graph: { nodes: [], edges: [] },
    authorizations: { rows: [], pendingApprovals: [] },
    remediations: [],
    conversationEntries: [],
    reportExport: {
      action: "export_existing_report",
      exporter: "exportCompositeDiagnosisReportJson",
      reportId: null,
    },
  };
}

function bundleToViewModel(
  bundle: ReturnType<typeof projectDiagnosisVisualization>,
  role: DiagnosisViewModel["role"],
  production?: DiagnosisViewModel["production"],
  reportId?: string | null,
): DiagnosisViewModel {
  return {
    role,
    tenantScope: bundle.tenantScope,
    redactionProfile: bundle.redactionProfile,
    permissionState: bundle.permissionState,
    health: bundle.health,
    cases: bundle.cases,
    drilldown: bundle.drilldown,
    timeline: bundle.timeline,
    trend: bundle.trend,
    graph: bundle.graph,
    authorizations: bundle.authorizations,
    remediations: bundle.remediations.rows,
    conversationEntries: bundle.conversationEntries,
    reportExport: {
      ...bundle.reportExport,
      reportId: reportId ?? bundle.reportExport.reportId ?? null,
    },
    loadError: bundle.loadError,
    production,
  };
}

export function diagnosisViewModelFromReport(
  audience: DiagnosisVisualizationAudience,
  report: CompositeDiagnosisReport,
  production?: DiagnosisViewModel["production"],
): DiagnosisViewModel {
  const bundle = projectDiagnosisVisualization(
    audience,
    catalogFromCompositeDiagnosisReport(report),
  );
  return bundleToViewModel(bundle, audience.role, production, report.reportId);
}

export function diagnosisViewModelFromQuery(
  audience: DiagnosisVisualizationAudience,
  query: DiagnosisReportQueryResponse | null,
  getResponse: DiagnosisReportGetResponse | null,
  options: { now?: number; maxAgeMs?: number } = {},
): DiagnosisViewModel {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!query) {
    return {
      ...emptyViewModel(audience.role, audience.trusted.tenantId),
      loadError: "gateway_unavailable",
      production: {
        apiLoadState: "unavailable",
        permissionState: "unavailable",
        auditState: "unavailable",
        freshness: {
          observedAt: null,
          maxAgeMs,
          stale: true,
          completeness: "unavailable",
        },
      },
    };
  }
  if (query.authorization.outcome === "deny") {
    return {
      ...emptyViewModel(audience.role, audience.trusted.tenantId),
      permissionState: "forbidden",
      loadError: query.authorization.reason,
      production: {
        apiLoadState: "forbidden",
        permissionState: "forbidden",
        auditState: query.audit.decision === "allow" ? "recorded" : "missing",
        freshness: {
          observedAt: null,
          maxAgeMs,
          stale: true,
          completeness: "unavailable",
        },
      },
    };
  }
  if (!getResponse?.report) {
    const projection = query.items[0];
    if (!projection) {
      return {
        ...emptyViewModel(audience.role, audience.trusted.tenantId),
        production: {
          apiLoadState: "ready",
          permissionState: "empty",
          auditState: query.audit.decision === "allow" ? "recorded" : "missing",
          freshness: {
            observedAt: null,
            maxAgeMs,
            stale: false,
            completeness: "empty",
          },
        },
      };
    }
    return diagnosisViewModelFromProjection(audience, projection, query, { now, maxAgeMs });
  }
  const report = getResponse.report as CompositeDiagnosisReport;
  const generatedAt = Date.parse(report.generatedAt ?? projectionGeneratedAt(query.items[0]));
  const stale = Number.isNaN(generatedAt) ? true : generatedAt + maxAgeMs < now;
  const production: DiagnosisViewModel["production"] = {
    apiLoadState: stale ? "stale" : "ready",
    permissionState: "allowed",
    auditState: query.audit.decision === "allow" ? "recorded" : "missing",
    freshness: {
      observedAt: report.generatedAt ?? null,
      maxAgeMs,
      stale,
      completeness: query.items.length > 0 ? "complete" : "empty",
    },
  };
  return diagnosisViewModelFromReport(audience, report, production);
}

function projectionGeneratedAt(projection: DiagnosisReportProjection | undefined): string {
  return projection?.generatedAt ?? "";
}

function diagnosisViewModelFromProjection(
  audience: DiagnosisVisualizationAudience,
  projection: DiagnosisReportProjection,
  query: DiagnosisReportQueryResponse,
  options: { now: number; maxAgeMs: number },
): DiagnosisViewModel {
  const catalog: DiagnosisVisualizationCatalog = {
    now: options.now,
    cases: projection.cases.map((row) => ({
      caseId: row.caseId,
      tenantId: projection.tenantId,
      status: row.status,
      findingIds: projection.findings.map((finding) => finding.findingId),
      observedAt: projection.generatedAt,
      severity:
        projection.findings.find(
          (finding) => finding.severity === "P0" || finding.severity === "P1",
        )?.severity ?? undefined,
    })),
    findings: projection.findings.map((finding) => ({
      findingId: finding.findingId,
      tenantId: projection.tenantId,
      status: finding.status,
      severity: finding.severity,
      evidenceIds: projection.evidenceRefIds ?? [],
      observedAt: projection.generatedAt,
    })),
  };
  const generatedAt = Date.parse(projection.generatedAt);
  const stale = Number.isNaN(generatedAt) ? true : generatedAt + options.maxAgeMs < options.now;
  const bundle = projectDiagnosisVisualization(audience, catalog);
  return bundleToViewModel(
    bundle,
    audience.role,
    {
      apiLoadState: stale ? "stale" : "ready",
      permissionState: bundle.permissionState,
      auditState: query.audit.decision === "allow" ? "recorded" : "missing",
      freshness: {
        observedAt: projection.generatedAt,
        maxAgeMs: options.maxAgeMs,
        stale,
        completeness:
          projection.findings.length > 0 || projection.cases.length > 0 ? "partial" : "empty",
      },
    },
    projection.reportId,
  );
}
