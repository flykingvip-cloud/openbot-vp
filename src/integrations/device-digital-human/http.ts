import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  CLAW4_RECORD_UPLOAD_PATH,
  CLAW4_UPLOAD_PATH,
  CLAW4_WAV_LIMIT,
  claw4Error,
  claw4Success,
  authenticateClaw4Grant,
  handleClaw4ListMessages,
  handleClaw4Upload,
} from "./claw4-firmware-compat.js";
import { authInvalid, DeviceDhError } from "./errors.js";
import type { DeviceDhService } from "./service.js";
import { API_PREFIX, API_VERSION, PROTOCOL_VERSION, type EventEnvelope } from "./types.js";
import { isRecord, parseBasic, randomId } from "./util.js";

const JSON_LIMIT = 256 * 1024;
const UPLOAD_LIMIT = 2_000_000;
const FIXTURES = new Set(["frame.png", "frame.jpg"]);
const TERMINAL_EVENTS = new Set(["run.completed", "run.failed", "run.cancelled"]);

export type DeviceDhServerOptions = {
  service: DeviceDhService;
  fixtureDir: string;
};

export function createDeviceDhServer(options: DeviceDhServerOptions): http.Server {
  return http.createServer((req, res) => {
    void handle(options, req, res);
  });
}

export async function listenDeviceDh(
  options: DeviceDhServerOptions & { port: number; host?: string },
): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("device digital-human stub binds loopback only");
  }
  const server = createDeviceDhServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const sweeper = setInterval(() => options.service.sweep(), 250);
  sweeper.unref?.();
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        clearInterval(sweeper);
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  options: DeviceDhServerOptions,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const traceId = headerString(req, "x-trace-id") ?? `trace_${randomId(8)}`;
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true, service: "device-digital-human-stub" }, traceId);
      return;
    }
    // Claw4 firmware HTTP compat (Scheme B1) — adjacent to integrations, same store.
    if (await handleClaw4OnStub(options.service, req, res, url, traceId)) {
      return;
    }
    if (!url.pathname.startsWith(API_PREFIX)) {
      throw new DeviceDhError("OBJECT_NOT_FOUND", "Object is not available");
    }
    assertNoUntrustedIdentity(req);
    const relative = url.pathname.slice(API_PREFIX.length) || "/";
    const remote = req.socket.remoteAddress ?? "unknown";
    options.service.takeRate(basicClientId(req) ?? remote);
    if (req.method === "GET" && relative.startsWith("/media/fixtures/")) {
      await serveFixture(options.fixtureDir, relative.slice("/media/fixtures/".length), req, res);
      return;
    }
    if (req.method === "PUT" && relative.startsWith("/media/uploads/")) {
      const ticket = decodeURIComponent(relative.slice("/media/uploads/".length));
      const bytes = await readLimited(req, UPLOAD_LIMIT);
      const contentType = headerString(req, "content-type")?.split(";")[0]?.trim();
      sendJson(res, 200, options.service.acceptUpload(ticket, bytes, contentType), traceId);
      return;
    }
    await dispatch(options.service, req, res, relative, url, traceId);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    const deviceError =
      error instanceof DeviceDhError ? error : new DeviceDhError("INTERNAL", "Internal error");
    sendJson(
      res,
      deviceError.httpStatus,
      {
        error: {
          code: deviceError.code,
          message: deviceError.message,
          retryable: deviceError.retryable,
        },
      },
      traceId,
      deviceError.headers,
    );
  }
}

/**
 * Grant lifecycle surface: consent → PKCE authorization-code → grants/exchange,
 * GET /grants/{authorizationRef}, and POST /grants/{authorizationRef}/revoke
 * (credential optional; revoke-by-ref for hash-only recovery after restart).
 * Shared by the loopback stub and the gateway co-located mount.
 * Returns true when `relative` is owned by this surface (including wrong method).
 */
export async function handleDeviceDhGrantMint(
  service: DeviceDhService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  relative: string,
  traceId: string,
): Promise<boolean> {
  const method = req.method ?? "GET";
  if (relative === "/consent/authorization-codes") {
    if (method !== "POST") {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "POST required");
    }
    const client = service.authenticate(...basicParts(req), "consent");
    const body = await readJson(req);
    sendJson(res, 201, service.issueAuthorizationCode(client, body, traceId), traceId);
    return true;
  }
  if (relative === "/grants/exchange") {
    if (method !== "POST") {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "POST required");
    }
    const client = service.authenticate(...basicParts(req), "service");
    const body = await readJson(req);
    sendJson(
      res,
      200,
      service.exchangeGrant(client, body, headerString(req, "idempotency-key"), traceId),
      traceId,
    );
    return true;
  }
  const revokeMint = /^\/grants\/([^/]+)\/revoke$/.exec(relative);
  if (revokeMint) {
    if (method !== "POST") {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "POST required");
    }
    const client = service.authenticate(...basicParts(req), "service");
    const credential = headerString(req, "x-openbot-grant-credential");
    const authorizationRef = decodeURIComponent(revokeMint[1] ?? "");
    if (credential) {
      const grant = service.requireGrant(client, credential, true);
      sendJson(res, 200, service.revokeGrant(grant, authorizationRef, traceId), traceId);
    } else {
      sendJson(res, 200, service.revokeGrantByRef(client, authorizationRef, traceId), traceId);
    }
    return true;
  }
  const grantId = /^\/grants\/([^/]+)$/.exec(relative);
  if (grantId) {
    if (method !== "GET") {
      // rebind is under /grants/{id}/rebind — not owned here.
      return false;
    }
    const client = service.authenticate(...basicParts(req), "service");
    const credential = headerString(req, "x-openbot-grant-credential");
    // Grant GET stays readable after revoke so device-control sees status.
    const grant = service.requireGrant(client, credential, true);
    sendJson(res, 200, service.getGrant(grant, decodeURIComponent(grantId[1] ?? "")), traceId);
    return true;
  }
  return false;
}

async function dispatch(
  service: DeviceDhService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  relative: string,
  url: URL,
  traceId: string,
): Promise<void> {
  const method = req.method ?? "GET";
  if (method === "GET" && relative === "/internal/audit") {
    sendJson(res, 200, service.listAudit(headerString(req, "x-openbot-approval-token")), traceId);
    return;
  }
  const approvalMatch = /^\/internal\/approvals\/([^/]+)$/.exec(relative);
  if (method === "POST" && approvalMatch) {
    const body = await readJson(req);
    const approvalId = decodeURIComponent(approvalMatch[1] ?? "");
    sendJson(
      res,
      200,
      service.decideApproval(headerString(req, "x-openbot-approval-token"), approvalId, body),
      traceId,
    );
    return;
  }

  if (await handleDeviceDhGrantMint(service, req, res, relative, traceId)) {
    return;
  }

  const rebind = /^\/grants\/([^/]+)\/rebind$/.exec(relative);
  if (method === "POST" && rebind) {
    const client = service.authenticate(...basicParts(req), "consent");
    const body = await readJson(req);
    sendJson(
      res,
      200,
      service.rebind(client, decodeURIComponent(rebind[1] ?? ""), body, traceId),
      traceId,
    );
    return;
  }

  // Revoke before requireGrant so hash-only / missing-plaintext callers can
  // revoke by authorizationRef with service Basic auth (same ownership model
  // as rebind-by-ref). Credential header remains accepted when present.
  const revoke = /^\/grants\/([^/]+)\/revoke$/.exec(relative);
  if (method === "POST" && revoke) {
    const client = service.authenticate(...basicParts(req), "service");
    const credential = headerString(req, "x-openbot-grant-credential");
    const authorizationRef = decodeURIComponent(revoke[1] ?? "");
    if (credential) {
      const grant = service.requireGrant(client, credential, true);
      sendJson(res, 200, service.revokeGrant(grant, authorizationRef, traceId), traceId);
    } else {
      sendJson(res, 200, service.revokeGrantByRef(client, authorizationRef, traceId), traceId);
    }
    return;
  }

  const client = service.authenticate(...basicParts(req), "service");
  const credential = headerString(req, "x-openbot-grant-credential");
  // Grant GET stays readable after revoke so device-control sees status.
  // Tool-result retries are allowed through after revoke so an accepted
  // Idempotency-Key can be replayed. The service still refuses a new result.
  const grantRead = method === "GET" && /^\/grants\/[^/]+$/.test(relative);
  const allowRevoked =
    grantRead || (method === "POST" && /^\/device-tool-requests\/[^/]+\/result$/.test(relative));
  const grant = service.requireGrant(client, credential, allowRevoked);

  // GET /grants/{id} is owned by handleDeviceDhGrantMint (above).
  const caps = /^\/grants\/([^/]+)\/device-capabilities$/.exec(relative);
  if (method === "PUT" && caps) {
    const body = await readJson(req);
    sendJson(
      res,
      200,
      service.putCapabilities(grant, decodeURIComponent(caps[1] ?? ""), body),
      traceId,
    );
    return;
  }
  const deviceEvents = /^\/grants\/([^/]+)\/device-events$/.exec(relative);
  if (method === "GET" && deviceEvents) {
    const ref = decodeURIComponent(deviceEvents[1] ?? "");
    const cursor = url.searchParams.get("cursor") ?? headerString(req, "last-event-id");
    streamEvents(
      req,
      res,
      service.listDeviceEvents(grant, ref, cursor),
      (listener) => service.subscribeDevice(grant.authorizationRef, listener),
      false,
    );
    return;
  }
  const human = /^\/digital-humans\/([^/]+)$/.exec(relative);
  if (method === "GET" && human) {
    sendJson(res, 200, service.digitalHuman(grant, decodeURIComponent(human[1] ?? "")), traceId);
    return;
  }
  if (method === "POST" && relative === "/conversations") {
    const body = await readJson(req);
    sendJson(res, 201, service.createConversation(grant, body, traceId), traceId);
    return;
  }
  const conversation = /^\/conversations\/([^/]+)$/.exec(relative);
  if (method === "GET" && conversation) {
    sendJson(
      res,
      200,
      service.getConversation(grant, decodeURIComponent(conversation[1] ?? "")),
      traceId,
    );
    return;
  }
  const conversationMessages = /^\/conversations\/([^/]+)\/messages$/.exec(relative);
  if (method === "GET" && conversationMessages) {
    sendJson(
      res,
      200,
      service.listConversationMessages(grant, decodeURIComponent(conversationMessages[1] ?? "")),
      traceId,
    );
    return;
  }
  const close = /^\/conversations\/([^/]+)\/close$/.exec(relative);
  if (method === "POST" && close) {
    sendJson(
      res,
      200,
      service.closeConversation(grant, decodeURIComponent(close[1] ?? "")),
      traceId,
    );
    return;
  }
  const turns = /^\/conversations\/([^/]+)\/turns$/.exec(relative);
  if (method === "POST" && turns) {
    const body = await readJson(req);
    sendJson(
      res,
      202,
      await service.submitTurn(
        grant,
        decodeURIComponent(turns[1] ?? ""),
        body,
        headerString(req, "idempotency-key"),
        traceId,
      ),
      traceId,
    );
    return;
  }
  const run = /^\/runs\/([^/]+)$/.exec(relative);
  if (method === "GET" && run) {
    sendJson(res, 200, service.getRun(grant, decodeURIComponent(run[1] ?? "")), traceId);
    return;
  }
  const events = /^\/runs\/([^/]+)\/events$/.exec(relative);
  if (method === "GET" && events) {
    const runId = decodeURIComponent(events[1] ?? "");
    const cursor = url.searchParams.get("cursor") ?? headerString(req, "last-event-id");
    const snapshot = service.listRunEvents(grant, runId, cursor);
    const terminal = service.runIsTerminal(grant, runId);
    streamEvents(
      req,
      res,
      snapshot,
      (listener) => service.subscribeRun(runId, listener),
      true,
      terminal,
    );
    return;
  }
  const cancel = /^\/runs\/([^/]+)\/cancel$/.exec(relative);
  if (method === "POST" && cancel) {
    const body = await readJson(req);
    sendJson(
      res,
      200,
      service.cancelRun(grant, decodeURIComponent(cancel[1] ?? ""), body, traceId),
      traceId,
    );
    return;
  }
  const tool = /^\/device-tool-requests\/([^/]+)\/result$/.exec(relative);
  if (method === "POST" && tool) {
    const body = await readJson(req);
    sendJson(
      res,
      200,
      await service.submitToolResult(
        grant,
        decodeURIComponent(tool[1] ?? ""),
        body,
        headerString(req, "idempotency-key"),
        traceId,
      ),
      traceId,
    );
    return;
  }
  if (method === "POST" && relative === "/media/upload-tickets") {
    const body = await readJson(req);
    sendJson(res, 201, service.createUploadTicket(grant, body), traceId);
    return;
  }
  throw new DeviceDhError("OBJECT_NOT_FOUND", "Object is not available");
}

function streamEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  snapshot: EventEnvelope[],
  subscribe: (listener: (event: EventEnvelope) => void) => () => void,
  endOnTerminal = false,
  alreadyTerminal = false,
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": ok\n\n");
  for (const event of snapshot) {
    writeSse(res, event);
  }
  const snapshotTerminal = snapshot.some((event) => TERMINAL_EVENTS.has(event.type));
  if (endOnTerminal && (alreadyTerminal || snapshotTerminal)) {
    res.end();
    return;
  }
  const unsubscribe = subscribe((event) => {
    if (res.writableEnded) {
      return;
    }
    writeSse(res, event);
    if (endOnTerminal && TERMINAL_EVENTS.has(event.type)) {
      res.end();
    }
  });
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": ping\n\n");
    }
  }, 15_000);
  heartbeat.unref?.();
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function writeSse(res: http.ServerResponse, event: EventEnvelope): void {
  res.write(`id: ${event.eventId}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function assertNoUntrustedIdentity(req: http.IncomingMessage): void {
  const authorization = headerString(req, "authorization");
  if (authorization && !authorization.startsWith("Basic ")) {
    throw authInvalid();
  }
  if (req.headers.cookie || req.headers["x-forwarded-user"] || req.headers["x-openbot-user"]) {
    throw authInvalid();
  }
}

function basicParts(req: http.IncomingMessage): [string, string] {
  const parsed = parseBasic(headerString(req, "authorization"));
  if (!parsed) {
    throw authInvalid();
  }
  return [parsed.clientId, parsed.secret];
}

function basicClientId(req: http.IncomingMessage): string | undefined {
  return parseBasic(headerString(req, "authorization"))?.clientId;
}

function headerString(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return undefined;
  }
  return value;
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const bytes = await readLimited(req, JSON_LIMIT);
  if (bytes.length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "JSON body is invalid");
  }
  if (!isRecord(parsed)) {
    throw new DeviceDhError("PARAM_UNSUPPORTED", "JSON body must be an object");
  }
  return parsed;
}

async function readLimited(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limit) {
      throw new DeviceDhError("PARAM_UNSUPPORTED", "Request body is too large");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function serveFixture(
  fixtureDir: string,
  name: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const remote = req.socket.remoteAddress ?? "";
  if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
    throw new DeviceDhError("OBJECT_NOT_FOUND", "Object is not available");
  }
  if (!FIXTURES.has(name)) {
    throw new DeviceDhError("OBJECT_NOT_FOUND", "Object is not available");
  }
  const filePath = path.join(fixtureDir, name);
  const info = await stat(filePath);
  const contentType = name.endsWith(".png") ? "image/png" : "image/jpeg";
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": info.size,
    "cache-control": "no-store",
  });
  await pipeline(createReadStream(filePath), res);
}

async function handleClaw4OnStub(
  service: DeviceDhService,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  traceId: string,
): Promise<boolean> {
  const pathname = url.pathname;
  const auth = {
    authorization: headerString(req, "authorization"),
    grantCredential: headerString(req, "x-openbot-grant-credential"),
    deviceId: headerString(req, "x-device-id"),
    transcriptText: headerString(req, "x-transcript-text"),
  };
  try {
    if (pathname === CLAW4_UPLOAD_PATH) {
      if (req.method !== "POST") {
        throw new DeviceDhError("PARAM_UNSUPPORTED", "POST required");
      }
      const wavBytes = await readLimited(req, CLAW4_WAV_LIMIT);
      const result = await handleClaw4Upload(service, {
        headers: auth,
        contentType: headerString(req, "content-type"),
        wavBytes,
        conversationId: url.searchParams.get("conversationId") ?? undefined,
        transcriptQuery: url.searchParams.get("transcript") ?? undefined,
        idempotencyKey: headerString(req, "idempotency-key"),
      });
      sendClaw4Json(res, 200, claw4Success(result), traceId);
      return true;
    }
    if (pathname === CLAW4_RECORD_UPLOAD_PATH) {
      if (req.method !== "POST") {
        throw new DeviceDhError("PARAM_UNSUPPORTED", "POST required");
      }
      authenticateClaw4Grant(service, auth);
      await readLimited(req, CLAW4_WAV_LIMIT);
      sendClaw4Json(
        res,
        200,
        claw4Success({
          text: "",
          conversationId: url.searchParams.get("conversationId")?.trim() || "",
          reserved: true,
          todo: "POST /api/v1/record/upload body semantics reserved for a later slice",
        }),
        traceId,
      );
      return true;
    }
    const messages = /^\/api\/v1\/conversation\/([^/]+)\/messages$/.exec(pathname);
    if (messages) {
      if (req.method !== "GET") {
        throw new DeviceDhError("PARAM_UNSUPPORTED", "GET required");
      }
      const listed = handleClaw4ListMessages(service, auth, decodeURIComponent(messages[1] ?? ""));
      sendClaw4Json(res, 200, claw4Success(listed), traceId);
      return true;
    }
    return false;
  } catch (error) {
    const deviceError =
      error instanceof DeviceDhError ? error : new DeviceDhError("INTERNAL", "Internal error");
    sendClaw4Json(
      res,
      deviceError.httpStatus,
      claw4Error(deviceError),
      traceId,
      deviceError.headers,
    );
    return true;
  }
}

function sendClaw4Json(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
  traceId: string,
  headers?: Record<string, string>,
): void {
  const payload = JSON.stringify({ ...body, traceId });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
  traceId: string,
  headers?: Record<string, string>,
): void {
  const payload = JSON.stringify({
    apiVersion: API_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    traceId,
    timestamp: new Date().toISOString(),
    ...body,
  });
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}
