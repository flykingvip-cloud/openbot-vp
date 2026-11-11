import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  HTTP_STATUS_BY_ERROR,
  type ExecErrorCode,
  type ExecErrorResponse,
  type ExecTaskState,
} from "./types.js";

export class ExecProtocolError extends Error {
  readonly code: ExecErrorCode;
  readonly httpStatus: number;
  readonly taskId?: string;
  readonly state?: ExecTaskState;

  constructor(
    code: ExecErrorCode,
    message: string,
    options?: { taskId?: string; state?: ExecTaskState; cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "ExecProtocolError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_ERROR[code];
    this.taskId = options?.taskId;
    this.state = options?.state;
  }
}

export function isExecProtocolError(error: unknown): error is ExecProtocolError {
  return error instanceof ExecProtocolError;
}

export function toErrorResponse(
  error: ExecProtocolError,
  opts?: { includeTask?: boolean },
): ExecErrorResponse {
  const body: ExecErrorResponse = {
    [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    error: { code: error.code, message: error.message },
  };
  if (opts?.includeTask && error.taskId) {
    body.taskId = error.taskId;
    if (error.state) {
      body.state = error.state;
    }
  }
  return body;
}

export class ExecConfigError extends Error {
  readonly missing: string[];

  constructor(message: string, missing: string[] = []) {
    super(message);
    this.name = "ExecConfigError";
    this.missing = missing;
  }
}
