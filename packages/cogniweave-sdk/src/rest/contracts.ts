import type { IngestResult } from "../contracts.js";
import type {
  CognitivePackage,
  DistillationResult,
  MemoryTrace,
  ReasonDebugPayload,
  Scope,
  SourceType,
  TaskFrame,
  TracePackageResult,
  TraceReasoningSessionResult,
  WriteBackResult,
  WriteJournal,
} from "../index.js";

export interface RestHeaders {
  [name: string]: string | undefined;
}

export interface RestContext {
  headers?: RestHeaders;
}

export interface RestResponse<T> {
  status: number;
  headers: Record<string, string>;
  body: T;
}

export interface FrameTaskRequest {
  rawInput: string | Record<string, unknown>;
  scope?: Scope;
  hints?: Record<string, string | string[]>;
  forceLlm?: boolean;
}

export interface ReasonRequest {
  taskFrame: TaskFrame;
  maxPaths?: number;
  includeExplainability?: boolean;
  includeOptionalEvidenceRefs?: boolean;
}

export interface ReasonDebugResponse {
  package: CognitivePackage;
  debug: ReasonDebugPayload;
}

export interface DistillRequest {
  rawInput: string | Record<string, unknown>;
  scope: Scope;
  sourceType: SourceType;
  sourceSessionId?: string;
  sourceTurnRange?: [number, number];
  forceRebuild?: boolean;
}

export interface WriteBackRequest extends DistillRequest {
  package?: CognitivePackage | null;
}

export interface ResolveEvidenceRequest {
  atomId?: string;
  evidenceId?: string;
  includeContent?: boolean;
  scope?: Scope;
}

export interface RepairIndexesRequest {
  journalId?: string;
  scope?: Scope;
}

export interface RebuildFromTruthRequest {
  objectType: string;
  objectId: string;
}

export interface RestApiSurface {
  frameTask(request: FrameTaskRequest): Promise<TaskFrame>;
  reason(request: ReasonRequest): Promise<CognitivePackage>;
  reasonDebug(request: ReasonRequest): Promise<ReasonDebugResponse>;
  ingest(request: DistillRequest): Promise<IngestResult>;
  distill(request: DistillRequest): Promise<DistillationResult>;
  writeBack(request: WriteBackRequest): Promise<WriteBackResult>;
  tracePackage(packageId: string): Promise<TracePackageResult>;
  trace(atomId: string): Promise<MemoryTrace>;
  traceReasoningSession(sessionId: string): Promise<TraceReasoningSessionResult>;
  getEvidenceRefs(atomId: string): Promise<string[]>;
  resolveEvidence(request: ResolveEvidenceRequest): Promise<unknown>;
  repairIndexes(request: RepairIndexesRequest): Promise<Record<string, unknown>>;
  rebuildFromTruth(request: RebuildFromTruthRequest): Promise<Record<string, unknown>>;
  getWriteJournal(journalId: string): Promise<WriteJournal>;
}

export interface RestHttpSurface {
  handleFrameTask(
    request: FrameTaskRequest,
    context?: RestContext,
  ): Promise<RestResponse<TaskFrame>>;
  handleReason(
    request: ReasonRequest,
    context?: RestContext,
  ): Promise<RestResponse<CognitivePackage>>;
  handleReasonDebug(
    request: ReasonRequest,
    context?: RestContext,
  ): Promise<RestResponse<ReasonDebugResponse>>;
  handleIngest(request: DistillRequest, context?: RestContext): Promise<RestResponse<IngestResult>>;
  handleDistill(
    request: DistillRequest,
    context?: RestContext,
  ): Promise<RestResponse<DistillationResult>>;
  handleWriteBack(
    request: WriteBackRequest,
    context?: RestContext,
  ): Promise<RestResponse<WriteBackResult>>;
  handleTracePackage(
    packageId: string,
    context?: RestContext,
  ): Promise<RestResponse<TracePackageResult>>;
  handleTraceAtom(atomId: string, context?: RestContext): Promise<RestResponse<MemoryTrace>>;
  handleTraceReasoningSession(
    sessionId: string,
    context?: RestContext,
  ): Promise<RestResponse<TraceReasoningSessionResult>>;
  handleGetEvidenceRefs(atomId: string, context?: RestContext): Promise<RestResponse<string[]>>;
  handleResolveEvidence(
    request: ResolveEvidenceRequest,
    context?: RestContext,
  ): Promise<RestResponse<unknown>>;
  handleRepairIndexes(
    request: RepairIndexesRequest,
    context?: RestContext,
  ): Promise<RestResponse<Record<string, unknown>>>;
  handleRebuildFromTruth(
    request: RebuildFromTruthRequest,
    context?: RestContext,
  ): Promise<RestResponse<Record<string, unknown>>>;
  handleGetWriteJournal(
    journalId: string,
    context?: RestContext,
  ): Promise<RestResponse<WriteJournal>>;
}
