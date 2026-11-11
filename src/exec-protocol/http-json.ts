import type { IncomingMessage, ServerResponse } from "node:http";
import { ExecProtocolError, toErrorResponse } from "./errors.js";
import { EXEC_API_VERSION, EXEC_API_VERSION_FIELD, type ExecErrorCode } from "./types.js";

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function hasJsonContentType(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) {
    return false;
  }
  const media = raw.split(";", 1)[0].trim().toLowerCase();
  return media === "application/json";
}

export function readRequestBody(
  req: IncomingMessage,
  maxBytes: number,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(() => {
      finish(new ExecProtocolError("EXEC_INTERNAL", "request body timed out"));
    }, timeoutMs);

    const finish = (error?: Error, body?: Buffer) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      if (error) {
        reject(error);
        return;
      }
      resolve(body ?? Buffer.alloc(0));
    };

    const onData = (chunk: Buffer | string) => {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      size += buffer.byteLength;
      if (size > maxBytes) {
        finish(new ExecProtocolError("EXEC_INTERNAL", "request body exceeds isolation size limit"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish(undefined, Buffer.concat(chunks));
    const onError = (error: Error) => finish(error);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export function parseJsonObject(body: Buffer): Record<string, unknown> {
  if (body.byteLength === 0) {
    throw new ExecProtocolError("EXEC_VERSION_UNSUPPORTED", "request JSON body is required");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new ExecProtocolError("EXEC_VERSION_UNSUPPORTED", "request body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ExecProtocolError("EXEC_VERSION_UNSUPPORTED", "request JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function assertExecApiVersion(payload: Record<string, unknown>): void {
  if (!Object.hasOwn(payload, EXEC_API_VERSION_FIELD)) {
    throw new ExecProtocolError(
      "EXEC_VERSION_UNSUPPORTED",
      `${EXEC_API_VERSION_FIELD} is required and must be integer ${EXEC_API_VERSION}`,
    );
  }
  const value = payload[EXEC_API_VERSION_FIELD];
  if (typeof value !== "number" || !Number.isInteger(value) || value !== EXEC_API_VERSION) {
    throw new ExecProtocolError(
      "EXEC_VERSION_UNSUPPORTED",
      `${EXEC_API_VERSION_FIELD} is required and must be integer ${EXEC_API_VERSION}`,
    );
  }
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": JSON_CONTENT_TYPE,
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function writeProtocolError(
  res: ServerResponse,
  error: ExecProtocolError,
  opts?: { includeTask?: boolean },
): void {
  writeJson(res, error.httpStatus, toErrorResponse(error, opts));
}

export function writeInternalError(res: ServerResponse, message: string): void {
  writeProtocolError(res, new ExecProtocolError("EXEC_INTERNAL", message));
}

export function requiredString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ExecProtocolError("EXEC_INTERNAL", `missing required field ${field}`);
  }
  return value;
}

export function optionalString(
  payload: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ExecProtocolError("EXEC_INTERNAL", `${field} must be a string`);
  }
  return value;
}

export function optionalBoolean(
  payload: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new ExecProtocolError("EXEC_INTERNAL", `${field} must be a boolean`);
  }
  return value;
}

export function optionalNumber(
  payload: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = payload[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExecProtocolError("EXEC_INTERNAL", `${field} must be a number`);
  }
  return value;
}

export function errorCodeOf(error: unknown): ExecErrorCode | undefined {
  if (error instanceof ExecProtocolError) {
    return error.code;
  }
  return undefined;
}
