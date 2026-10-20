import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  vaultSyncObjectStorageKey,
  type VaultSyncObjectPutResult,
  type VaultSyncObjectStore,
  type VaultSyncPresignedGet,
  type VaultSyncPresignedPut,
} from "./object-store.js";

export type S3VaultSyncObjectStoreConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** path-style (MinIO default) vs virtual-hosted */
  forcePathStyle?: boolean;
  /** Injected fetch for tests */
  fetchImpl?: typeof fetch;
};

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * S3/MinIO-compatible ciphertext object store (SigV4).
 * No new AWS SDK dependency — uses fetch + AWS4 signing.
 */
export class S3VaultSyncObjectStore implements VaultSyncObjectStore {
  readonly kind = "s3" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: S3VaultSyncObjectStoreConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  buildStorageKey(vaultId: string, blobId: string): string {
    return vaultSyncObjectStorageKey(vaultId, blobId);
  }

  put(params: { vaultId: string; blobId: string; ciphertext: Buffer }): VaultSyncObjectPutResult {
    // Custom fetchImpl (tests) → async path via sync child is skipped; use putAsync in tests.
    if (this.config.fetchImpl) {
      throw new Error("S3VaultSyncObjectStore.put requires default fetch; use putAsync in tests");
    }
    const storageKey = this.buildStorageKey(params.vaultId, params.blobId);
    this.runSignedRequestSync({
      method: "PUT",
      objectKey: storageKey,
      body: params.ciphertext,
      extraHeaders: {
        "content-type": "application/octet-stream",
        "content-length": String(params.ciphertext.length),
      },
    });
    return { storageKey, sizeBytes: params.ciphertext.length };
  }

  get(params: { vaultId: string; storageKey: string }): Buffer | null {
    void params.vaultId;
    if (this.config.fetchImpl) {
      throw new Error("S3VaultSyncObjectStore.get requires default fetch; use getAsync in tests");
    }
    return this.runSignedRequestSync({
      method: "GET",
      objectKey: params.storageKey,
      body: Buffer.alloc(0),
    });
  }

  delete(params: { vaultId: string; storageKey: string }): void {
    void params.vaultId;
    if (this.config.fetchImpl) {
      throw new Error(
        "S3VaultSyncObjectStore.delete requires default fetch; use deleteAsync in tests",
      );
    }
    this.runSignedRequestSync({
      method: "DELETE",
      objectKey: params.storageKey,
      body: Buffer.alloc(0),
      allowNotFound: true,
    });
  }

  /** Async variants for unit tests with injected fetchImpl. */
  async putAsync(params: {
    vaultId: string;
    blobId: string;
    ciphertext: Buffer;
  }): Promise<VaultSyncObjectPutResult> {
    const storageKey = this.buildStorageKey(params.vaultId, params.blobId);
    const { url, headers } = this.signRequest({
      method: "PUT",
      objectKey: storageKey,
      body: params.ciphertext,
      extraHeaders: {
        "content-type": "application/octet-stream",
        "content-length": String(params.ciphertext.length),
      },
    });
    const res = await this.fetchImpl(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(params.ciphertext),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`s3 put failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return { storageKey, sizeBytes: params.ciphertext.length };
  }

  async getAsync(params: { vaultId: string; storageKey: string }): Promise<Buffer | null> {
    void params.vaultId;
    const { url, headers } = this.signRequest({
      method: "GET",
      objectKey: params.storageKey,
      body: Buffer.alloc(0),
    });
    const res = await this.fetchImpl(url, { method: "GET", headers });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`s3 get failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  createPresignedPut(params: {
    vaultId: string;
    blobId: string;
    contentLength: number;
    expiresSeconds?: number;
  }): VaultSyncPresignedPut {
    const storageKey = this.buildStorageKey(params.vaultId, params.blobId);
    const expiresSeconds = Math.min(Math.max(params.expiresSeconds ?? 900, 60), 3600);
    const signed = this.presign({
      method: "PUT",
      objectKey: storageKey,
      expiresSeconds,
      unsignedHeaders: {
        "content-type": "application/octet-stream",
        "content-length": String(params.contentLength),
      },
    });
    return {
      url: signed.url,
      method: "PUT",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(params.contentLength),
      },
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
      storageKey,
    };
  }

  createPresignedGet(params: {
    vaultId: string;
    storageKey: string;
    expiresSeconds?: number;
  }): VaultSyncPresignedGet {
    void params.vaultId;
    const expiresSeconds = Math.min(Math.max(params.expiresSeconds ?? 900, 60), 3600);
    const signed = this.presign({
      method: "GET",
      objectKey: params.storageKey,
      expiresSeconds,
    });
    return {
      url: signed.url,
      method: "GET",
      expiresAt: new Date(Date.now() + expiresSeconds * 1000).toISOString(),
      storageKey: params.storageKey,
    };
  }

  private objectUrl(objectKey: string): URL {
    const endpoint = new URL(this.config.endpoint);
    const keyPath = objectKey
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");
    if (this.config.forcePathStyle !== false) {
      endpoint.pathname = `/${this.config.bucket}/${keyPath}`.replace(/\/+/g, "/");
    } else {
      endpoint.hostname = `${this.config.bucket}.${endpoint.hostname}`;
      endpoint.pathname = `/${keyPath}`;
    }
    return endpoint;
  }

  private signRequest(params: {
    method: "GET" | "PUT" | "DELETE";
    objectKey: string;
    body: Buffer;
    extraHeaders?: Record<string, string>;
  }): { url: string; headers: Record<string, string> } {
    const date = new Date();
    const { amzDate, dateStamp } = toAmzDate(date);
    const url = this.objectUrl(params.objectKey);
    const payloadHash = sha256Hex(params.body);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...params.extraHeaders,
    };
    const signedHeaderNames = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .toSorted();
    const canonicalHeaders = signedHeaderNames
      .map((name) => {
        const value =
          headers[name] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name)!];
        return `${name}:${value.trim()}\n`;
      })
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      params.method,
      url.pathname || "/",
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = this.signingKey(dateStamp);
    const signature = hmac(signingKey, stringToSign).toString("hex");
    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const outHeaders: Record<string, string> = {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...params.extraHeaders,
    };
    return { url: url.toString(), headers: outHeaders };
  }

  private presign(params: {
    method: "GET" | "PUT";
    objectKey: string;
    expiresSeconds: number;
    unsignedHeaders?: Record<string, string>;
  }): { url: string } {
    void params.unsignedHeaders;
    const date = new Date();
    const { amzDate, dateStamp } = toAmzDate(date);
    const url = this.objectUrl(params.objectKey);
    const credentialScope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const credential = `${this.config.accessKeyId}/${credentialScope}`;
    const signedHeaders = "host";
    const query: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": credential,
      "X-Amz-Date": amzDate,
      "X-Amz-Expires": String(params.expiresSeconds),
      "X-Amz-SignedHeaders": signedHeaders,
    };
    const canonicalQuery = Object.keys(query)
      .toSorted()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
      .join("&");
    const canonicalHeaders = `host:${url.host}\n`;
    const canonicalRequest = [
      params.method,
      url.pathname || "/",
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signature = hmac(this.signingKey(dateStamp), stringToSign).toString("hex");
    url.search = `${canonicalQuery}&X-Amz-Signature=${encodeURIComponent(signature)}`;
    return { url: url.toString() };
  }

  private signingKey(dateStamp: string): Buffer {
    const kDate = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.config.region);
    const kService = hmac(kRegion, "s3");
    return hmac(kService, "aws4_request");
  }

  /**
   * Sync HTTP for control-plane (legacy sync engine). Signs in-process, then
   * runs a tiny Node child that performs fetch and returns body on stdout.
   */
  private runSignedRequestSync(params: {
    method: "GET" | "PUT" | "DELETE";
    objectKey: string;
    body: Buffer;
    extraHeaders?: Record<string, string>;
    allowNotFound?: boolean;
  }): Buffer | null {
    const signed = this.signRequest({
      method: params.method,
      objectKey: params.objectKey,
      body: params.body,
      extraHeaders: params.extraHeaders,
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-sync-s3-"));
    const bodyPath = path.join(tmpDir, "body.bin");
    const outPath = path.join(tmpDir, "out.bin");
    const metaPath = path.join(tmpDir, "meta.json");
    try {
      fs.writeFileSync(bodyPath, params.body);
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          method: params.method,
          url: signed.url,
          headers: signed.headers,
          bodyPath,
          outPath,
          allowNotFound: Boolean(params.allowNotFound),
        }),
      );
      const script = `
import fs from "node:fs";
const meta = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const body = meta.method === "PUT" ? fs.readFileSync(meta.bodyPath) : undefined;
const res = await fetch(meta.url, { method: meta.method, headers: meta.headers, body });
if (res.status === 404 && meta.allowNotFound) { process.exit(0); }
if (res.status === 404 && meta.method === "GET") { process.exit(3); }
if (!res.ok) {
  const t = await res.text();
  console.error(t.slice(0, 400));
  process.exit(2);
}
if (meta.method === "GET") {
  const ab = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(meta.outPath, ab);
}
`;
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script, metaPath], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.status === 3) {
        return null;
      }
      if (result.status !== 0) {
        throw new Error(
          `s3 ${params.method} failed: ${(result.stderr || result.stdout || "unknown").slice(0, 300)}`,
        );
      }
      if (params.method === "GET") {
        if (!fs.existsSync(outPath)) {
          return null;
        }
        return fs.readFileSync(outPath);
      }
      return null;
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

export function resolveS3VaultSyncObjectStoreConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): S3VaultSyncObjectStoreConfig | null {
  const endpoint = env.OPENBOT_VAULT_SYNC_S3_ENDPOINT?.trim();
  const bucket = env.OPENBOT_VAULT_SYNC_S3_BUCKET?.trim();
  const accessKeyId = env.OPENBOT_VAULT_SYNC_S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.OPENBOT_VAULT_SYNC_S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    endpoint,
    region: env.OPENBOT_VAULT_SYNC_S3_REGION?.trim() || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.OPENBOT_VAULT_SYNC_S3_FORCE_PATH_STYLE !== "0",
  };
}
