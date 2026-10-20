/**
 * HTTP binary blob upload for Vault Sync (Wave D).
 * Large ciphertext chunks use PUT application/octet-stream — not WebSocket Base64.
 *
 * PUT /__openbot/vault-sync/v1/{vaultId}/{uploadId}/chunks/{chunkIndex}
 * Auth: X-OpenBot-Vault-Upload-Token (issued by upload-session.create)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../gateway/http-common.js";
import {
  isRequestBodyLimitError,
  RequestBodyLimitError,
  requestBodyErrorToText,
} from "../infra/http-body.js";
import { safeEqualSecret } from "../security/secret-equal.js";
import { createVaultSyncControlPlane } from "./store/create-control-plane.js";
import { VAULT_SYNC_MAX_CHUNK_SIZE } from "./types.js";

export const VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX = "/__openbot/vault-sync/v1";

export function vaultSyncHttpChunkPutPathTemplate(): string {
  return `${VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX}/{vaultId}/{uploadId}/chunks/{chunkIndex}`;
}

function getPlane() {
  return createVaultSyncControlPlane();
}

function parseChunkPath(pathname: string): {
  vaultId: string;
  uploadId: string;
  chunkIndex: number;
} | null {
  const prefix = `${VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX}/`;
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const rest = pathname.slice(prefix.length);
  const parts = rest.split("/").filter(Boolean);
  // {vaultId}/{uploadId}/chunks/{chunkIndex}
  if (parts.length !== 4 || parts[2] !== "chunks") {
    return null;
  }
  const vaultId = decodeURIComponent(parts[0] ?? "");
  const uploadId = decodeURIComponent(parts[1] ?? "");
  const chunkIndex = Number.parseInt(parts[3] ?? "", 10);
  if (!vaultId || !uploadId || !Number.isFinite(chunkIndex) || chunkIndex < 0) {
    return null;
  }
  return { vaultId, uploadId, chunkIndex };
}

function readUploadToken(req: IncomingMessage): string {
  const header = req.headers["x-openbot-vault-upload-token"];
  const raw = Array.isArray(header) ? header[0] : header;
  return typeof raw === "string" ? raw.trim() : "";
}

async function readBinaryBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = req.headers["content-length"];
  const declaredRaw = Array.isArray(declared) ? declared[0] : declared;
  if (typeof declaredRaw === "string") {
    const n = Number.parseInt(declaredRaw, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new RequestBodyLimitError({ code: "PAYLOAD_TOO_LARGE" });
    }
  }
  return await new Promise<Buffer>((resolve, reject) => {
    let done = false;
    let total = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      fail(new RequestBodyLimitError({ code: "REQUEST_BODY_TIMEOUT" }));
    }, 120_000);
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("close", onClose);
    };
    const finish = (cb: () => void) => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      cb();
    };
    const fail = (error: Error) => {
      finish(() => {
        if (!req.destroyed) {
          req.destroy();
        }
        reject(error);
      });
    };
    const onData = (chunk: Buffer | string) => {
      if (done) {
        return;
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        fail(new RequestBodyLimitError({ code: "PAYLOAD_TOO_LARGE" }));
        return;
      }
      chunks.push(buf);
    };
    const onEnd = () => {
      finish(() => resolve(Buffer.concat(chunks, total)));
    };
    const onError = () => {
      fail(new RequestBodyLimitError({ code: "CONNECTION_CLOSED" }));
    };
    const onClose = () => {
      if (!done) {
        fail(new RequestBodyLimitError({ code: "CONNECTION_CLOSED" }));
      }
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("close", onClose);
  });
}

export async function handleVaultSyncHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const urlRaw = req.url ?? "";
  const pathname = urlRaw.split("?")[0] ?? "";
  if (!pathname.startsWith(VAULT_SYNC_HTTP_CHUNK_PATH_PREFIX)) {
    return false;
  }

  const method = (req.method ?? "GET").toUpperCase();
  const parsed = parseChunkPath(pathname);
  if (!parsed) {
    sendJson(res, 404, { error: "not found" });
    return true;
  }

  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "PUT, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-OpenBot-Vault-Upload-Token, Authorization",
    );
    res.end();
    return true;
  }

  if (method !== "PUT") {
    res.statusCode = 405;
    res.setHeader("Allow", "PUT, OPTIONS");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  const token = readUploadToken(req);
  if (!token) {
    sendJson(res, 401, { error: "upload token required" });
    return true;
  }

  try {
    const plane = getPlane();
    const session = plane.getUploadSession(parsed.vaultId, parsed.uploadId);
    if (!session || session.status !== "open") {
      sendJson(res, 404, { error: "upload session not found" });
      return true;
    }
    const expected = session.httpUploadToken?.trim() ?? "";
    if (!expected || !safeEqualSecret(expected, token)) {
      sendJson(res, 403, { error: "invalid upload token" });
      return true;
    }

    const data = await readBinaryBody(req, VAULT_SYNC_MAX_CHUNK_SIZE);
    const updated = plane.putUploadChunk({
      vaultId: parsed.vaultId,
      uploadId: parsed.uploadId,
      chunkIndex: parsed.chunkIndex,
      data,
    });
    sendJson(res, 200, {
      uploadId: updated.uploadId,
      chunkIndex: parsed.chunkIndex,
      receivedChunkIndexes: updated.receivedChunkIndexes,
      status: updated.status,
    });
  } catch (error) {
    if (isRequestBodyLimitError(error)) {
      sendJson(res, error.statusCode, { error: requestBodyErrorToText(error.code) });
      return true;
    }
    const message = error instanceof Error ? error.message : "upload failed";
    const status =
      message.includes("chunk size") || message.includes("invalid chunk")
        ? 400
        : message.includes("not active") || message.includes("not open")
          ? 409
          : 500;
    sendJson(res, status, { error: message });
  }
  return true;
}
