/**
 * Stable business error codes for the device digital-human integrations v1 stub.
 * HTTP status is part of the frozen contract. Do not rename codes.
 */

export const ERROR_HTTP_STATUS = {
  AUTH_INVALID: 401,
  AUTH_REVOKED: 401,
  OBJECT_NOT_FOUND: 404,
  SCOPE_DENIED: 403,
  BINDING_MISMATCH: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SESSION_BUSY: 409,
  CURSOR_EXPIRED: 409,
  TOOL_TIMEOUT: 504,
  MEDIA_INVALID: 400,
  RUN_FAILED: 409,
  PARAM_UNSUPPORTED: 400,
  DEVICE_OFFLINE: 409,
  CAMERA_BUSY: 409,
  USER_DENIED: 403,
  TIMEOUT: 504,
  CANCELLED: 409,
  UPLOAD_FAILED: 400,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UNKNOWN_AFTER_RESTART: 409,
  LATE_RESULT: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

const RETRYABLE: ReadonlySet<ErrorCode> = new Set([
  "SESSION_BUSY",
  "TOOL_TIMEOUT",
  "TIMEOUT",
  "RATE_LIMITED",
  "DEVICE_OFFLINE",
  "CAMERA_BUSY",
  "UPLOAD_FAILED",
  "UNKNOWN_AFTER_RESTART",
]);

export class DeviceDhError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    extras?: { retryable?: boolean; headers?: Record<string, string> },
  ) {
    super(message);
    this.name = "DeviceDhError";
    this.code = code;
    this.httpStatus = ERROR_HTTP_STATUS[code];
    this.retryable = extras?.retryable ?? RETRYABLE.has(code);
    this.headers = extras?.headers ?? {};
  }
}

export function notFound(): DeviceDhError {
  return new DeviceDhError("OBJECT_NOT_FOUND", "Object is not available");
}

export function authInvalid(message = "Authentication failed"): DeviceDhError {
  return new DeviceDhError("AUTH_INVALID", message);
}
