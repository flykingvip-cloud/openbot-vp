import type { CogniWeaveEngine, IngestInput } from "../contracts.js";
import type { IngestResult } from "../contracts.js";
import type {
  CognitivePackage,
  DistillationResult,
  MemoryTrace,
  Scope,
  TaskFrame,
  TracePackageResult,
  TraceReasoningSessionResult,
  WriteBackResult,
  WriteJournal,
} from "../models.js";
import type {
  DistillRequest,
  FrameTaskRequest,
  ReasonDebugResponse,
  ReasonRequest,
  RebuildFromTruthRequest,
  RepairIndexesRequest,
  ResolveEvidenceRequest,
  RestApiSurface,
  RestContext,
  RestHttpSurface,
  RestResponse,
  WriteBackRequest,
} from "./contracts.js";

function normalizeHeaders(headers?: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).flatMap(([key, value]) =>
      value === undefined ? [] : [[key.toLowerCase(), value]],
    ),
  );
}

function buildMetadata(
  requestMetadata: Record<string, string> | undefined,
  context?: RestContext,
): Record<string, string> | undefined {
  const headers = normalizeHeaders(context?.headers);
  const idempotencyKey = headers["idempotency-key"];
  const metadata: Record<string, string> = { ...(requestMetadata ?? {}) };
  if (idempotencyKey) {
    metadata.idempotency_key = idempotencyKey;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function response<T>(status: number, body: T, headers?: Record<string, string>): RestResponse<T> {
  return {
    status,
    headers: headers ?? {},
    body,
  };
}

function parseScopeFromHeaders(headers?: Record<string, string | undefined>): Scope | undefined {
  const normalized = normalizeHeaders(headers);
  const workspaceId = normalized["x-cogniweave-workspace-id"];
  const projectId = normalized["x-cogniweave-project-id"];
  const agentId = normalized["x-cogniweave-agent-id"];
  const visibility = normalized["x-cogniweave-visibility"];
  const hasScopeSignal = Boolean(workspaceId || projectId || agentId || visibility);
  if (!hasScopeSignal) {
    return undefined;
  }
  return {
    workspaceId: workspaceId ?? "",
    projectId: projectId ?? "",
    agentId: agentId ?? "",
    visibility: visibility === "shared" ? "shared" : "private",
  };
}

function mapWriteBackStatus(result: WriteBackResult): number {
  if (result.status === "COMPLETED") {
    return 200;
  }
  if (result.status === "PARTIAL_SUCCESS") {
    return 202;
  }
  return 500;
}

function toIngestInput(
  request: DistillRequest | WriteBackRequest,
  context?: RestContext,
): IngestInput {
  return {
    rawInput: request.rawInput,
    scope: request.scope,
    sourceType: request.sourceType,
    sourceSessionId: request.sourceSessionId,
    sourceTurnRange: request.sourceTurnRange,
    metadata: buildMetadata(undefined, context),
  };
}

export class CogniWeaveRestService implements RestApiSurface, RestHttpSurface {
  constructor(private readonly engine: CogniWeaveEngine) {}

  async frameTask(request: FrameTaskRequest): Promise<TaskFrame> {
    return this.engine.frameTask(request.rawInput, {
      scope: request.scope,
      hints: request.hints,
      forceLlm: request.forceLlm,
    });
  }

  async reason(request: ReasonRequest): Promise<CognitivePackage> {
    return this.engine.reason(request.taskFrame, {
      maxPaths: request.maxPaths,
      includeExplainability: request.includeExplainability,
      includeOptionalEvidenceRefs: request.includeOptionalEvidenceRefs,
    });
  }

  async reasonDebug(request: ReasonRequest): Promise<ReasonDebugResponse> {
    const [pkg, debug] = await this.engine.reasonWithDebug(request.taskFrame, {
      maxPaths: request.maxPaths,
    });
    return { package: pkg, debug };
  }

  async ingest(request: DistillRequest, context?: RestContext): Promise<IngestResult> {
    return this.engine.ingest(toIngestInput(request, context));
  }

  async distill(request: DistillRequest, context?: RestContext): Promise<DistillationResult> {
    return this.engine.distill({
      ...toIngestInput(request, context),
      forceRebuild: request.forceRebuild,
    });
  }

  async writeBack(request: WriteBackRequest, context?: RestContext): Promise<WriteBackResult> {
    return this.engine.writeBack({
      ...toIngestInput(request, context),
      package: request.package,
    });
  }

  async tracePackage(packageId: string): Promise<TracePackageResult> {
    return this.engine.tracePackage(packageId);
  }

  async trace(atomId: string): Promise<MemoryTrace> {
    return this.engine.trace(atomId);
  }

  async traceAtom(atomId: string): Promise<MemoryTrace> {
    return this.engine.trace(atomId);
  }

  async traceReasoningSession(sessionId: string): Promise<TraceReasoningSessionResult> {
    return this.engine.traceReasoningSession(sessionId);
  }

  async getEvidenceRefs(atomId: string): Promise<string[]> {
    return this.engine.getEvidenceRefs(atomId);
  }

  async resolveEvidence(request: ResolveEvidenceRequest): Promise<unknown> {
    return this.engine.resolveEvidence(request);
  }

  async repairIndexes(request: RepairIndexesRequest): Promise<Record<string, unknown>> {
    return this.engine.repairIndexes(request);
  }

  async rebuildFromTruth(request: RebuildFromTruthRequest): Promise<Record<string, unknown>> {
    return this.engine.rebuildFromTruth(request);
  }

  async getWriteJournal(journalId: string): Promise<WriteJournal> {
    return this.engine.getWriteJournal(journalId);
  }

  async handleFrameTask(
    request: FrameTaskRequest,
    context?: RestContext,
  ): Promise<RestResponse<TaskFrame>> {
    return response(200, await this.frameTask(request), normalizeHeaders(context?.headers));
  }

  async handleReason(
    request: ReasonRequest,
    context?: RestContext,
  ): Promise<RestResponse<CognitivePackage>> {
    return response(200, await this.reason(request), normalizeHeaders(context?.headers));
  }

  async handleReasonDebug(
    request: ReasonRequest,
    context?: RestContext,
  ): Promise<RestResponse<ReasonDebugResponse>> {
    return response(200, await this.reasonDebug(request), normalizeHeaders(context?.headers));
  }

  async handleIngest(
    request: DistillRequest,
    context?: RestContext,
  ): Promise<RestResponse<IngestResult>> {
    return response(202, await this.ingest(request, context), normalizeHeaders(context?.headers));
  }

  async handleDistill(
    request: DistillRequest,
    context?: RestContext,
  ): Promise<RestResponse<DistillationResult>> {
    const result = await this.distill(request, context);
    return response(200, result, {
      ...normalizeHeaders(context?.headers),
      "x-cogniweave-event-key": result.keys.eventKey,
    });
  }

  async handleWriteBack(
    request: WriteBackRequest,
    context?: RestContext,
  ): Promise<RestResponse<WriteBackResult>> {
    const result = await this.writeBack(request, context);
    return response(mapWriteBackStatus(result), result, {
      ...normalizeHeaders(context?.headers),
      "x-cogniweave-journal-id": result.journalId,
    });
  }

  async handleTracePackage(
    packageId: string,
    context?: RestContext,
  ): Promise<RestResponse<TracePackageResult>> {
    const scope = parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.tracePackage(packageId, { scope }),
      normalizeHeaders(context?.headers),
    );
  }

  async handleTraceAtom(atomId: string, context?: RestContext): Promise<RestResponse<MemoryTrace>> {
    const scope = parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.trace(atomId, { scope }),
      normalizeHeaders(context?.headers),
    );
  }

  async handleTraceReasoningSession(
    sessionId: string,
    context?: RestContext,
  ): Promise<RestResponse<TraceReasoningSessionResult>> {
    const scope = parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.traceReasoningSession(sessionId, { scope }),
      normalizeHeaders(context?.headers),
    );
  }

  async handleGetEvidenceRefs(
    atomId: string,
    context?: RestContext,
  ): Promise<RestResponse<string[]>> {
    const scope = parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.getEvidenceRefs(atomId, scope),
      normalizeHeaders(context?.headers),
    );
  }

  async handleResolveEvidence(
    request: ResolveEvidenceRequest,
    context?: RestContext,
  ): Promise<RestResponse<unknown>> {
    const scope = request.scope ?? parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.resolveEvidence({ ...request, scope }),
      normalizeHeaders(context?.headers),
    );
  }

  async handleRepairIndexes(
    request: RepairIndexesRequest,
    context?: RestContext,
  ): Promise<RestResponse<Record<string, unknown>>> {
    return response(200, await this.repairIndexes(request), normalizeHeaders(context?.headers));
  }

  async handleRebuildFromTruth(
    request: RebuildFromTruthRequest,
    context?: RestContext,
  ): Promise<RestResponse<Record<string, unknown>>> {
    return response(200, await this.rebuildFromTruth(request), normalizeHeaders(context?.headers));
  }

  async handleGetWriteJournal(
    journalId: string,
    context?: RestContext,
  ): Promise<RestResponse<WriteJournal>> {
    const scope = parseScopeFromHeaders(context?.headers);
    return response(
      200,
      await this.engine.getWriteJournal(journalId, scope),
      normalizeHeaders(context?.headers),
    );
  }
}
