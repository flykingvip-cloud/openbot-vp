import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type {
  DistillRequest,
  FrameTaskRequest,
  ReasonRequest,
  RebuildFromTruthRequest,
  RepairIndexesRequest,
  ResolveEvidenceRequest,
  RestHeaders,
  RestResponse,
  WriteBackRequest,
} from "./contracts.js";
import type { CogniWeaveRestService } from "./service.js";

export interface CogniWeaveHttpServerOptions {
  basePath?: string;
}

export interface CogniWeaveRequestEnvelope {
  method: string;
  url: string;
  headers: RestHeaders;
  body?: string;
}

function normalizeHeaders(headers: IncomingMessage["headers"]): RestHeaders {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) => {
      if (value === undefined) {
        return [];
      }
      if (Array.isArray(value)) {
        return [[key.toLowerCase(), value.join(",")]];
      }
      return [[key.toLowerCase(), value]];
    }),
  );
}

function normalizeBasePath(basePath = "/"): string {
  if (!basePath || basePath === "/") {
    return "";
  }
  return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

function parseBody<T>(body: string | undefined): T {
  if (!body || !body.trim()) {
    return {} as T;
  }
  return JSON.parse(body) as T;
}

function responseBody(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): RestResponse<unknown> {
  return { status, body, headers };
}

function writeJsonResponse(res: ServerResponse, response: RestResponse<unknown>): void {
  res.statusCode = response.status;
  for (const [key, value] of Object.entries({
    "content-type": "application/json; charset=utf-8",
    ...response.headers,
  })) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(response.body));
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (!basePath) {
    return pathname;
  }
  if (!pathname.startsWith(basePath)) {
    return null;
  }
  const next = pathname.slice(basePath.length);
  return next.startsWith("/") ? next : `/${next}`;
}

async function routeEnvelope(
  service: CogniWeaveRestService,
  envelope: CogniWeaveRequestEnvelope,
  options?: CogniWeaveHttpServerOptions,
): Promise<RestResponse<unknown>> {
  const url = new URL(envelope.url, "http://localhost");
  const basePath = normalizeBasePath(options?.basePath);
  const pathname = stripBasePath(url.pathname, basePath);
  if (!pathname) {
    return responseBody(404, { error: "not found" });
  }

  const context = { headers: envelope.headers };
  const method = envelope.method.toUpperCase();

  if (method === "POST" && pathname === "/v1/tasks/frame") {
    return service.handleFrameTask(parseBody<FrameTaskRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/reason") {
    return service.handleReason(parseBody<ReasonRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/reason/debug") {
    return service.handleReasonDebug(parseBody<ReasonRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/ingest") {
    return service.handleIngest(parseBody<DistillRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/distill") {
    return service.handleDistill(parseBody<DistillRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/write-back") {
    return service.handleWriteBack(parseBody<WriteBackRequest>(envelope.body), context);
  }

  const traceAtomMatch = pathname.match(/^\/v1\/atoms\/([^/]+)\/trace$/);
  if (method === "GET" && traceAtomMatch) {
    return service.handleTraceAtom(traceAtomMatch[1], context);
  }

  const evidenceRefsMatch = pathname.match(/^\/v1\/atoms\/([^/]+)\/evidence-refs$/);
  if (method === "GET" && evidenceRefsMatch) {
    return service.handleGetEvidenceRefs(evidenceRefsMatch[1], context);
  }

  const packageTraceMatch = pathname.match(/^\/v1\/packages\/([^/]+)\/trace$/);
  if (method === "GET" && packageTraceMatch) {
    return service.handleTracePackage(packageTraceMatch[1], context);
  }

  const reasoningSessionTraceMatch = pathname.match(/^\/v1\/reasoning-sessions\/([^/]+)\/trace$/);
  if (method === "GET" && reasoningSessionTraceMatch) {
    return service.handleTraceReasoningSession(reasoningSessionTraceMatch[1], context);
  }

  if (method === "POST" && pathname === "/v1/evidence/resolve") {
    return service.handleResolveEvidence(parseBody<ResolveEvidenceRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/repair/indexes") {
    return service.handleRepairIndexes(parseBody<RepairIndexesRequest>(envelope.body), context);
  }
  if (method === "POST" && pathname === "/v1/rebuild/from-truth") {
    return service.handleRebuildFromTruth(
      parseBody<RebuildFromTruthRequest>(envelope.body),
      context,
    );
  }

  const journalMatch = pathname.match(/^\/v1\/journals\/([^/]+)$/);
  if (method === "GET" && journalMatch) {
    return service.handleGetWriteJournal(journalMatch[1], context);
  }

  return responseBody(404, { error: "not found" });
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleCogniWeaveHttpRequest(
  service: CogniWeaveRestService,
  req: IncomingMessage,
  res: ServerResponse,
  options?: CogniWeaveHttpServerOptions,
): Promise<void> {
  try {
    const envelope: CogniWeaveRequestEnvelope = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers: normalizeHeaders(req.headers),
      body: await readBody(req),
    };
    const response = await routeEnvelope(service, envelope, options);
    writeJsonResponse(res, response);
  } catch (error) {
    writeJsonResponse(res, {
      status: 500,
      headers: {},
      body: {
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export function createCogniWeaveHttpServer(
  service: CogniWeaveRestService,
  options?: CogniWeaveHttpServerOptions,
): Server {
  return createServer((req, res) => {
    void handleCogniWeaveHttpRequest(service, req, res, options);
  });
}

export { routeEnvelope as routeCogniWeaveHttpRequest };
