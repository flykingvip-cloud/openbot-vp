import { request as httpRequest, type RequestOptions } from "node:http";
import { URL } from "node:url";
import type { ExecProtocolConfig } from "./config.js";
import { ExecProtocolError, isExecProtocolError } from "./errors.js";
import { JSON_CONTENT_TYPE, assertExecApiVersion } from "./http-json.js";
import {
  EXEC_API_VERSION,
  EXEC_API_VERSION_FIELD,
  HTTP_STATUS_BY_ERROR,
  type ExecArtifactRequest,
  type ExecArtifactResponse,
  type ExecCancelRequest,
  type ExecErrorCode,
  type ExecReconcileRequest,
  type ExecReconcileResponse,
  type ExecRevokeRequest,
  type ExecStatusRequest,
  type ExecSubmitRequest,
  type ExecTaskResponse,
  type ExecUploadArtifactRequest,
} from "./types.js";

export type ExecClientRuntime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type ExecHttpClientOptions = {
  baseUrl: string;
  config: ExecProtocolConfig;
  leaseToken: string;
  runtime?: ExecClientRuntime;
  maxRequestBodyBytes: number;
};

export type RetryableOperation = "status" | "cancel" | "artifact";

const defaultRuntime: ExecClientRuntime = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type RequestResult = {
  status: number;
  body: Record<string, unknown>;
};

function classifyNoResponse(error: unknown): ExecProtocolError {
  if (isExecProtocolError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ExecProtocolError("EXEC_UNREACHABLE", `B' is unreachable: ${message}`, {
    cause: error,
  });
}

function parseErrorCode(value: unknown): ExecErrorCode | undefined {
  if (
    value === "EXEC_VERSION_UNSUPPORTED" ||
    value === "EXEC_UNAUTHORIZED" ||
    value === "EXEC_REVOKED" ||
    value === "EXEC_NOT_FOUND" ||
    value === "EXEC_CONFLICT" ||
    value === "EXEC_UNREACHABLE" ||
    value === "EXEC_CHECKSUM_MISMATCH" ||
    value === "EXEC_INTERNAL"
  ) {
    return value;
  }
  return undefined;
}

export class ExecHttpClient {
  private readonly baseUrl: URL;
  private readonly config: ExecProtocolConfig;
  private readonly leaseToken: string;
  private readonly runtime: ExecClientRuntime;
  private readonly maxRequestBodyBytes: number;

  constructor(options: ExecHttpClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.config = options.config;
    this.leaseToken = options.leaseToken;
    this.runtime = options.runtime ?? defaultRuntime;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes;
    if (!this.leaseToken) {
      throw new ExecProtocolError("EXEC_UNAUTHORIZED", "client lease token is required");
    }
  }

  async submit(
    body: ExecSubmitRequest,
  ): Promise<{ httpStatus: number; payload: ExecTaskResponse }> {
    const result = await this.requestOnce("POST", "/v1/tasks", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecTaskResponse };
  }

  async status(
    body: ExecStatusRequest,
  ): Promise<{ httpStatus: number; payload: ExecTaskResponse }> {
    const result = await this.requestWithRetry("status", "POST", "/v1/tasks/status", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecTaskResponse };
  }

  async cancel(
    body: ExecCancelRequest,
  ): Promise<{ httpStatus: number; payload: ExecTaskResponse }> {
    const result = await this.requestWithRetry("cancel", "POST", "/v1/tasks/cancel", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecTaskResponse };
  }

  async artifact(
    body: ExecArtifactRequest,
  ): Promise<{ httpStatus: number; payload: ExecArtifactResponse }> {
    const result = await this.requestWithRetry("artifact", "POST", "/v1/tasks/artifact", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecArtifactResponse };
  }

  async upload(
    body: ExecUploadArtifactRequest,
  ): Promise<{ httpStatus: number; payload: Record<string, unknown> }> {
    const result = await this.requestOnce("POST", "/v1/artifacts/upload", body);
    return { httpStatus: result.status, payload: result.body };
  }

  async revoke(
    body: ExecRevokeRequest,
  ): Promise<{ httpStatus: number; payload: Record<string, unknown> }> {
    const result = await this.requestOnce("POST", "/v1/revoke", body);
    return { httpStatus: result.status, payload: result.body };
  }

  async reconcile(
    body: ExecReconcileRequest,
  ): Promise<{ httpStatus: number; payload: ExecReconcileResponse }> {
    const result = await this.requestOnce("POST", "/v1/tasks/reconcile", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecReconcileResponse };
  }

  async reconcileApply(
    body: ExecReconcileRequest,
  ): Promise<{ httpStatus: number; payload: ExecReconcileResponse }> {
    const result = await this.requestOnce("POST", "/v1/tasks/reconcile-apply", body);
    return { httpStatus: result.status, payload: result.body as unknown as ExecReconcileResponse };
  }

  async debug(): Promise<{ httpStatus: number; payload: Record<string, unknown> }> {
    const result = await this.requestWithRetry("status", "POST", "/v1/debug/site", {
      [EXEC_API_VERSION_FIELD]: EXEC_API_VERSION,
    });
    return { httpStatus: result.status, payload: result.body };
  }

  private async requestWithRetry(
    operation: RetryableOperation,
    method: string,
    path: string,
    body: unknown,
  ): Promise<RequestResult> {
    const attempts = this.config.maxTransportRetries;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.requestOnce(method, path, body);
      } catch (error) {
        lastError = error;
        const unreachable = isExecProtocolError(error) && error.code === "EXEC_UNREACHABLE";
        if (!unreachable || attempt >= attempts) {
          throw classifyNoResponse(error);
        }
        const backoff =
          this.config.transportBackoffMs[
            Math.min(attempt - 1, this.config.transportBackoffMs.length - 1)
          ];
        await this.runtime.sleep(backoff);
      }
    }
    throw classifyNoResponse(lastError);
  }

  private requestOnce(method: string, path: string, body: unknown): Promise<RequestResult> {
    const payload = JSON.stringify(body);
    const url = new URL(path, this.baseUrl);
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
        "Content-Length": Buffer.byteLength(payload),
        Authorization: `Bearer ${this.leaseToken}`,
        Accept: JSON_CONTENT_TYPE,
      },
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let requestTimer: ReturnType<typeof setTimeout> | undefined;

      const clearTimers = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = undefined;
        }
        if (requestTimer) {
          clearTimeout(requestTimer);
          requestTimer = undefined;
        }
      };

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimers();
        req.destroy();
        reject(classifyNoResponse(error));
      };

      const armRequestTimer = () => {
        if (requestTimer || settled) {
          return;
        }
        requestTimer = setTimeout(() => {
          fail(
            new ExecProtocolError(
              "EXEC_UNREACHABLE",
              `request timeout after ${this.config.requestTimeoutMs}ms`,
            ),
          );
        }, this.config.requestTimeoutMs);
      };

      const req = httpRequest(options, (res) => {
        clearTimeout(connectTimer);
        connectTimer = undefined;
        armRequestTimer();
        const chunks: Buffer[] = [];
        let size = 0;

        res.on("data", (chunk: Buffer | string) => {
          const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          size += buffer.byteLength;
          if (size > this.maxRequestBodyBytes) {
            fail(
              new ExecProtocolError("EXEC_INTERNAL", "response body exceeds isolation size limit"),
            );
            res.destroy();
            return;
          }
          chunks.push(buffer);
        });
        res.on("end", () => {
          clearTimers();
          if (settled) {
            return;
          }
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed = raw.length > 0 ? (JSON.parse(raw) as unknown) : {};
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              throw new ExecProtocolError("EXEC_INTERNAL", "peer returned a non-object JSON body");
            }
            const record = parsed as Record<string, unknown>;
            assertExecApiVersion(record);
            this.throwIfErrorStatus(res.statusCode ?? 500, record);
            if (settled) {
              return;
            }
            settled = true;
            resolve({ status: res.statusCode ?? 500, body: record });
          } catch (error) {
            fail(error);
          }
        });
        res.on("error", (error) => {
          fail(error);
        });
      });

      connectTimer = setTimeout(() => {
        fail(
          new ExecProtocolError(
            "EXEC_UNREACHABLE",
            `connect timeout after ${this.config.connectTimeoutMs}ms`,
          ),
        );
      }, this.config.connectTimeoutMs);

      req.on("socket", (socket) => {
        const onConnect = () => {
          clearTimeout(connectTimer);
          connectTimer = undefined;
          armRequestTimer();
        };
        socket.once("connect", onConnect);
        if (!socket.connecting && socket.readable) {
          onConnect();
        }
      });

      req.on("error", (error) => fail(error));
      req.on("timeout", () => {
        fail(new ExecProtocolError("EXEC_UNREACHABLE", "socket timeout"));
        req.destroy();
      });
      req.write(payload);
      req.end();
    });
  }

  private throwIfErrorStatus(status: number, body: Record<string, unknown>): void {
    if (status >= 200 && status < 300) {
      return;
    }
    const errorObj =
      body.error && typeof body.error === "object"
        ? (body.error as Record<string, unknown>)
        : undefined;
    const code = parseErrorCode(errorObj?.code) ?? mapStatusToCode(status);
    const message =
      typeof errorObj?.message === "string" ? errorObj.message : `peer returned HTTP ${status}`;
    const taskId = typeof body.taskId === "string" ? body.taskId : undefined;
    const state =
      typeof body.state === "string" ? (body.state as ExecTaskResponse["state"]) : undefined;
    throw new ExecProtocolError(code, message, { taskId, state });
  }
}

function mapStatusToCode(status: number): ExecErrorCode {
  for (const [code, mapped] of Object.entries(HTTP_STATUS_BY_ERROR) as Array<
    [ExecErrorCode, number]
  >) {
    if (mapped === status) {
      return code;
    }
  }
  if (status >= 500) {
    return "EXEC_INTERNAL";
  }
  return "EXEC_INTERNAL";
}

export function createExecHttpClient(options: ExecHttpClientOptions): ExecHttpClient {
  return new ExecHttpClient(options);
}
