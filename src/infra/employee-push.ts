/**
 * Employee-scoped remote push (Wave 2 / D-PUSH-W2).
 *
 * Isolation: registrations live under push/employee-registrations.json and are
 * keyed by accountId + deviceId + platform. NEVER writes to
 * registrationsByNodeId / push/apns-registrations.json (node companion channel).
 *
 * Delivery index: platformUserId (from authenticated session) so @mention
 * (targetUserId) can enqueue without inventing a new event bus.
 */

import { createHash, createPrivateKey, sign as signJwt } from "node:crypto";
import fs from "node:fs/promises";
import http2 from "node:http2";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "./json-files.js";
import {
  normalizeApnsEnvironment,
  type ApnsAuthConfig,
  type ApnsAuthConfigResolution,
  type ApnsEnvironment,
  type ApnsPushAlertResult,
} from "./push-apns.js";

export type EmployeePushPlatform = "ios" | "android" | "macos";

export type EmployeePushRegistration = {
  accountId: string;
  deviceId: string;
  platform: EmployeePushPlatform;
  /** Platform-auth user id — authoritative for mention delivery. */
  platformUserId: string;
  token: string;
  topic: string;
  environment: ApnsEnvironment;
  updatedAtMs: number;
};

export type EmployeePushRegistrationState = {
  version: 1;
  /** Composite key: `${accountId}::${deviceId}::${platform}` */
  byKey: Record<string, EmployeePushRegistration>;
};

export type EmployeePushPayload = {
  deepLink: string;
  title: string;
  body: string;
  accountId?: string;
  kind?: string;
};

export type EmployeePushSendResult = {
  accountId: string;
  deviceId: string;
  platform: EmployeePushPlatform;
  ok: boolean;
  status: number;
  reason?: string;
  skipped?: "no_credentials" | "unsupported_platform";
  tokenSuffix?: string;
  topic?: string;
  environment?: ApnsEnvironment;
};

const EMPLOYEE_APNS_STATE_FILENAME = "push/employee-registrations.json";
const APNS_JWT_TTL_MS = 50 * 60 * 1000;
const DEFAULT_APNS_TIMEOUT_MS = 10_000;
const withLock = createAsyncLock();

let cachedJwt: { cacheKey: string; token: string; expiresAtMs: number } | null = null;

export function employeePushRegistrationKey(params: {
  accountId: string;
  deviceId: string;
  platform: EmployeePushPlatform;
}): string {
  return `${params.accountId}::${params.deviceId}::${params.platform}`;
}

function resolveEmployeePushPath(baseDir?: string): string {
  const root = baseDir ?? resolveStateDir();
  return path.join(root, EMPLOYEE_APNS_STATE_FILENAME);
}

function normalizeId(value: string): string {
  return value.trim();
}

function normalizeApnsToken(value: string): string {
  return value
    .trim()
    .replace(/[<>\s]/g, "")
    .toLowerCase();
}

function isLikelyApnsToken(value: string): boolean {
  return /^[0-9a-f]{32,}$/i.test(value);
}

function normalizePlatform(value: unknown): EmployeePushPlatform | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "ios" || normalized === "android" || normalized === "macos") {
    return normalized;
  }
  return null;
}

function emptyState(): EmployeePushRegistrationState {
  return { version: 1, byKey: {} };
}

async function loadState(baseDir?: string): Promise<EmployeePushRegistrationState> {
  const filePath = resolveEmployeePushPath(baseDir);
  const existing = await readJsonFile<EmployeePushRegistrationState>(filePath);
  if (!existing || typeof existing !== "object" || existing.version !== 1) {
    return emptyState();
  }
  return {
    version: 1,
    byKey:
      existing.byKey && typeof existing.byKey === "object" && !Array.isArray(existing.byKey)
        ? existing.byKey
        : {},
  };
}

async function persistState(state: EmployeePushRegistrationState, baseDir?: string): Promise<void> {
  const filePath = resolveEmployeePushPath(baseDir);
  await writeJsonAtomic(filePath, state);
}

function normalizeNonEmptyString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePrivateKey(value: string): string {
  return value.trim().replace(/\\n/g, "\n");
}

/**
 * Employee APNs credentials — independent of OPENCLAW_APNS_* (node companion).
 * Placeholders OK; missing creds → clear error, never fake delivery.
 */
export async function resolveEmployeeApnsAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ApnsAuthConfigResolution> {
  const teamId = normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_TEAM_ID);
  const keyId = normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_KEY_ID);
  if (!teamId || !keyId) {
    return {
      ok: false,
      error:
        "Employee APNs auth missing: set OPENBOT_EMPLOYEE_APNS_TEAM_ID and OPENBOT_EMPLOYEE_APNS_KEY_ID",
    };
  }

  const inlineKeyRaw =
    normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_PRIVATE_KEY_P8) ??
    normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_PRIVATE_KEY);
  if (inlineKeyRaw) {
    return {
      ok: true,
      value: {
        teamId,
        keyId,
        privateKey: normalizePrivateKey(inlineKeyRaw),
      },
    };
  }

  const keyPath = normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_KEY_PATH);
  if (!keyPath) {
    return {
      ok: false,
      error:
        "Employee APNs private key missing: set OPENBOT_EMPLOYEE_APNS_PRIVATE_KEY_P8 or OPENBOT_EMPLOYEE_APNS_KEY_PATH",
    };
  }
  try {
    const privateKey = normalizePrivateKey(await fs.readFile(keyPath, "utf8"));
    return {
      ok: true,
      value: {
        teamId,
        keyId,
        privateKey,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `failed reading OPENBOT_EMPLOYEE_APNS_KEY_PATH (${keyPath}): ${message}`,
    };
  }
}

export function resolveEmployeeApnsTopicFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallbackTopic?: string,
): string | null {
  return (
    normalizeNonEmptyString(env.OPENBOT_EMPLOYEE_APNS_TOPIC) ??
    normalizeNonEmptyString(fallbackTopic) ??
    null
  );
}

export function resolveEmployeeApnsEnvironmentFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallback?: unknown,
): ApnsEnvironment {
  return (
    normalizeApnsEnvironment(env.OPENBOT_EMPLOYEE_APNS_ENVIRONMENT) ??
    normalizeApnsEnvironment(fallback) ??
    "sandbox"
  );
}

export async function registerEmployeePushToken(params: {
  accountId: string;
  deviceId: string;
  platform: string;
  platformUserId: string;
  token: string;
  topic?: string;
  environment?: unknown;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<EmployeePushRegistration> {
  const accountId = normalizeId(params.accountId);
  const deviceId = normalizeId(params.deviceId);
  const platformUserId = normalizeId(params.platformUserId);
  const platform = normalizePlatform(params.platform);
  const token = normalizeApnsToken(params.token);
  const env = params.env ?? process.env;
  const topic =
    resolveEmployeeApnsTopicFromEnv(env, params.topic) ??
    normalizeNonEmptyString(params.topic) ??
    "";
  const environment = resolveEmployeeApnsEnvironmentFromEnv(env, params.environment);

  if (!accountId) {
    throw new Error("accountId required");
  }
  if (!deviceId) {
    throw new Error("deviceId required");
  }
  if (!platformUserId) {
    throw new Error("platformUserId required");
  }
  if (!platform) {
    throw new Error("platform must be ios|android|macos");
  }
  if (platform === "ios" || platform === "macos") {
    if (!topic) {
      throw new Error(
        "topic required (set OPENBOT_EMPLOYEE_APNS_TOPIC or pass topic; usually employee app bundle id)",
      );
    }
    if (!isLikelyApnsToken(token)) {
      throw new Error("invalid APNs token");
    }
  } else if (!token) {
    throw new Error("token required");
  }

  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    const key = employeePushRegistrationKey({ accountId, deviceId, platform });
    const next: EmployeePushRegistration = {
      accountId,
      deviceId,
      platform,
      platformUserId,
      token,
      topic,
      environment,
      updatedAtMs: Date.now(),
    };
    state.byKey[key] = next;
    await persistState(state, params.baseDir);
    return next;
  });
}

export async function unregisterEmployeePushToken(params: {
  accountId: string;
  deviceId?: string;
  platform?: string;
  /** When true, remove every registration for this accountId. */
  allDevices?: boolean;
  baseDir?: string;
}): Promise<{ removed: number }> {
  const accountId = normalizeId(params.accountId);
  if (!accountId) {
    throw new Error("accountId required");
  }
  return await withLock(async () => {
    const state = await loadState(params.baseDir);
    let removed = 0;
    const platform = params.platform ? normalizePlatform(params.platform) : null;
    const deviceId = params.deviceId ? normalizeId(params.deviceId) : "";

    for (const [key, reg] of Object.entries(state.byKey)) {
      if (reg.accountId !== accountId) {
        continue;
      }
      if (params.allDevices) {
        delete state.byKey[key];
        removed += 1;
        continue;
      }
      if (deviceId && reg.deviceId !== deviceId) {
        continue;
      }
      if (platform && reg.platform !== platform) {
        continue;
      }
      if (!params.allDevices && !deviceId) {
        continue;
      }
      delete state.byKey[key];
      removed += 1;
    }
    if (removed > 0) {
      await persistState(state, params.baseDir);
    }
    return { removed };
  });
}

export async function listEmployeePushRegistrationsForAccount(
  accountId: string,
  baseDir?: string,
): Promise<EmployeePushRegistration[]> {
  const normalized = normalizeId(accountId);
  if (!normalized) {
    return [];
  }
  const state = await loadState(baseDir);
  return Object.values(state.byKey).filter((reg) => reg.accountId === normalized);
}

export async function listEmployeePushRegistrationsForPlatformUser(
  platformUserId: string,
  baseDir?: string,
): Promise<EmployeePushRegistration[]> {
  const normalized = normalizeId(platformUserId);
  if (!normalized) {
    return [];
  }
  const state = await loadState(baseDir);
  return Object.values(state.byKey).filter((reg) => reg.platformUserId === normalized);
}

/** Assert store path is not the node companion registrations file. */
export function employeePushStorePath(baseDir?: string): string {
  return resolveEmployeePushPath(baseDir);
}

export function assertEmployeePushIsolatedFromNode(baseDir?: string): {
  employeePath: string;
  nodePath: string;
} {
  const employeePath = resolveEmployeePushPath(baseDir);
  const root = baseDir ?? resolveStateDir();
  const nodePath = path.join(root, "push/apns-registrations.json");
  if (employeePath === nodePath) {
    throw new Error("employee push store must not share node APNs path");
  }
  return { employeePath, nodePath };
}

function toBase64UrlBytes(value: Uint8Array): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toBase64UrlJson(value: object): string {
  return toBase64UrlBytes(Buffer.from(JSON.stringify(value)));
}

function getJwtCacheKey(auth: ApnsAuthConfig): string {
  const keyHash = createHash("sha256").update(auth.privateKey).digest("hex");
  return `employee:${auth.teamId}:${auth.keyId}:${keyHash}`;
}

function getApnsBearerToken(auth: ApnsAuthConfig, nowMs: number = Date.now()): string {
  const cacheKey = getJwtCacheKey(auth);
  if (cachedJwt && cachedJwt.cacheKey === cacheKey && nowMs < cachedJwt.expiresAtMs) {
    return cachedJwt.token;
  }
  const iat = Math.floor(nowMs / 1000);
  const header = toBase64UrlJson({ alg: "ES256", kid: auth.keyId, typ: "JWT" });
  const payload = toBase64UrlJson({ iss: auth.teamId, iat });
  const signingInput = `${header}.${payload}`;
  const signature = signJwt("sha256", Buffer.from(signingInput, "utf8"), {
    key: createPrivateKey(auth.privateKey),
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${toBase64UrlBytes(signature)}`;
  cachedJwt = {
    cacheKey,
    token,
    expiresAtMs: nowMs + APNS_JWT_TTL_MS,
  };
  return token;
}

function parseReason(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as { reason?: unknown };
    return typeof parsed.reason === "string" && parsed.reason.trim().length > 0
      ? parsed.reason.trim()
      : trimmed.slice(0, 200);
  } catch {
    return trimmed.slice(0, 200);
  }
}

type ApnsRequestSender = (params: {
  token: string;
  topic: string;
  environment: ApnsEnvironment;
  bearerToken: string;
  payload: object;
  timeoutMs: number;
}) => Promise<{ status: number; apnsId?: string; body: string }>;

async function sendApnsRequest(params: {
  token: string;
  topic: string;
  environment: ApnsEnvironment;
  bearerToken: string;
  payload: object;
  timeoutMs: number;
}): Promise<{ status: number; apnsId?: string; body: string }> {
  const authority =
    params.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  const body = JSON.stringify(params.payload);
  const requestPath = `/3/device/${params.token}`;

  return await new Promise((resolve, reject) => {
    const client = http2.connect(authority);
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      client.destroy();
      reject(err);
    };
    const finish = (result: { status: number; apnsId?: string; body: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      client.close();
      resolve(result);
    };

    client.once("error", (err) => fail(err));
    const req = client.request({
      ":method": "POST",
      ":path": requestPath,
      authorization: `bearer ${params.bearerToken}`,
      "apns-topic": params.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": "0",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body).toString(),
    });

    let statusCode = 0;
    let apnsId: string | undefined;
    let responseBody = "";
    req.setEncoding("utf8");
    req.setTimeout(params.timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      fail(new Error(`APNs request timed out after ${params.timeoutMs}ms`));
    });
    req.on("response", (headers) => {
      const statusHeader = headers[":status"];
      statusCode = typeof statusHeader === "number" ? statusHeader : Number(statusHeader ?? 0);
      const idHeader = headers["apns-id"];
      if (typeof idHeader === "string" && idHeader.trim().length > 0) {
        apnsId = idHeader.trim();
      }
    });
    req.on("data", (chunk) => {
      if (typeof chunk === "string") {
        responseBody += chunk;
      }
    });
    req.on("end", () => finish({ status: statusCode, apnsId, body: responseBody }));
    req.on("error", (err) => fail(err));
    req.end(body);
  });
}

/**
 * Build APNs alert payload. deepLink is REQUIRED (Wave 1 Router contract).
 * No message body / secrets — metadata + short title/body only (R10.5).
 */
export function buildEmployeeApnsAlertPayload(params: EmployeePushPayload): object {
  const deepLink = params.deepLink.trim();
  if (!deepLink) {
    throw new Error("deepLink required");
  }
  if (!/^open(claw|bot):\/\//i.test(deepLink)) {
    throw new Error("deepLink must use openclaw:// or openbot:// scheme");
  }
  return {
    aps: {
      alert: {
        title: params.title,
        body: params.body,
      },
      sound: "default",
    },
    deepLink,
    ...(params.accountId ? { accountId: params.accountId } : {}),
    openbot: {
      kind: params.kind ?? "employee.push",
      ts: Date.now(),
    },
  };
}

export async function sendEmployeeApnsAlert(params: {
  auth: ApnsAuthConfig;
  registration: EmployeePushRegistration;
  payload: EmployeePushPayload;
  timeoutMs?: number;
  requestSender?: ApnsRequestSender;
}): Promise<ApnsPushAlertResult> {
  if (params.registration.platform !== "ios" && params.registration.platform !== "macos") {
    throw new Error(`unsupported platform for APNs: ${params.registration.platform}`);
  }
  const token = normalizeApnsToken(params.registration.token);
  if (!isLikelyApnsToken(token)) {
    throw new Error("invalid APNs token");
  }
  const topic = params.registration.topic.trim();
  if (!topic) {
    throw new Error("topic required");
  }
  const apnsPayload = buildEmployeeApnsAlertPayload(params.payload);
  const sender = params.requestSender ?? sendApnsRequest;
  const response = await sender({
    token,
    topic,
    environment: params.registration.environment,
    bearerToken: getApnsBearerToken(params.auth),
    payload: apnsPayload,
    timeoutMs:
      typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
        ? Math.max(1000, Math.trunc(params.timeoutMs))
        : DEFAULT_APNS_TIMEOUT_MS,
  });
  return {
    ok: response.status === 200,
    status: response.status,
    apnsId: response.apnsId,
    reason: parseReason(response.body),
    tokenSuffix: token.slice(-8),
    topic,
    environment: params.registration.environment,
  };
}

export type EnqueueEmployeePushParams = {
  platformUserId: string;
  payload: EmployeePushPayload;
  baseDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected for tests. */
  sendAlert?: typeof sendEmployeeApnsAlert;
  resolveAuth?: typeof resolveEmployeeApnsAuthConfigFromEnv;
};

/**
 * Best-effort fan-out to all registered devices for a platform user.
 * Skips when no registrations or credentials — never throws to callers.
 */
export async function enqueueEmployeePushForPlatformUser(
  params: EnqueueEmployeePushParams,
): Promise<EmployeePushSendResult[]> {
  const results: EmployeePushSendResult[] = [];
  try {
    const regs = await listEmployeePushRegistrationsForPlatformUser(
      params.platformUserId,
      params.baseDir,
    );
    if (regs.length === 0) {
      return results;
    }
    const resolveAuth = params.resolveAuth ?? resolveEmployeeApnsAuthConfigFromEnv;
    const auth = await resolveAuth(params.env ?? process.env);
    const sendAlert = params.sendAlert ?? sendEmployeeApnsAlert;

    for (const registration of regs) {
      if (registration.platform === "android") {
        results.push({
          accountId: registration.accountId,
          deviceId: registration.deviceId,
          platform: registration.platform,
          ok: false,
          status: 0,
          skipped: "unsupported_platform",
          reason: "Android FCM deferred to Wave 2.2",
        });
        continue;
      }
      if (!auth.ok) {
        results.push({
          accountId: registration.accountId,
          deviceId: registration.deviceId,
          platform: registration.platform,
          ok: false,
          status: 0,
          skipped: "no_credentials",
          reason: auth.error,
        });
        continue;
      }
      try {
        const payload: EmployeePushPayload = {
          ...params.payload,
          accountId: params.payload.accountId ?? registration.accountId,
        };
        const sent = await sendAlert({
          auth: auth.value,
          registration,
          payload,
        });
        results.push({
          accountId: registration.accountId,
          deviceId: registration.deviceId,
          platform: registration.platform,
          ok: sent.ok,
          status: sent.status,
          reason: sent.reason,
          tokenSuffix: sent.tokenSuffix,
          topic: sent.topic,
          environment: sent.environment,
        });
      } catch (err) {
        results.push({
          accountId: registration.accountId,
          deviceId: registration.deviceId,
          platform: registration.platform,
          ok: false,
          status: 0,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch {
    // best-effort: swallow store errors
  }
  return results;
}

export function buildMentionDeepLink(params: { sessionKey?: string; groupId?: string }): string {
  const sessionKey = params.sessionKey?.trim() ?? "";
  if (sessionKey) {
    return `openclaw://chat?sessionKey=${encodeURIComponent(sessionKey)}`;
  }
  const groupId = params.groupId?.trim() ?? "";
  if (groupId) {
    return `openclaw://space/${encodeURIComponent(groupId)}`;
  }
  return "openclaw://employee/overview";
}
