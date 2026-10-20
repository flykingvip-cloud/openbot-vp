/**
 * artifact.* / artifact.grant.* — cross-agent scoped passport RPCs (MVP).
 *
 * Store root: OPENBOT_ARTIFACT_GRANT_ROOT/<userId> when set; otherwise
 * <CONFIG_DIR>/artifact-grants/<userId>. Production follow-up should prefer
 * sharedArtifactsDir/.grants via resolveAccountExecutionPaths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createArtifactGrantService,
  type ArtifactGrantService,
} from "../../artifact-grant/index.js";
import { CONFIG_DIR } from "../../utils.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

const serviceCache = new Map<string, ArtifactGrantService>();

export function resetArtifactGrantServicesForTests(): void {
  serviceCache.clear();
}

export function resolveArtifactGrantServiceRoot(userId: string): string {
  const base =
    process.env.OPENBOT_ARTIFACT_GRANT_ROOT?.trim() || path.join(CONFIG_DIR, "artifact-grants");
  return path.join(base, userId);
}

function serviceForUser(userId: string): ArtifactGrantService {
  const existing = serviceCache.get(userId);
  if (existing) {
    return existing;
  }
  const rootDir = resolveArtifactGrantServiceRoot(userId);
  fs.mkdirSync(rootDir, { recursive: true });
  const service = createArtifactGrantService({ rootDir });
  serviceCache.set(userId, service);
  return service;
}

/** Test helper: bind a fresh tmp root for a userId. */
export function bindArtifactGrantServiceForTests(
  userId: string,
  rootDir?: string,
): ArtifactGrantService {
  const root = rootDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "ag-gw-"));
  fs.mkdirSync(root, { recursive: true });
  const service = createArtifactGrantService({ rootDir: root });
  serviceCache.set(userId, service);
  return service;
}

function fail(
  respond: (ok: boolean, payload?: unknown, error?: ReturnType<typeof errorShape>) => void,
  message: string,
  reason?: string,
): void {
  respond(false, reason ? { reason } : undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

export const artifactGrantHandlers: GatewayRequestHandlers = {
  "artifact.publish": async ({ params, respond }) => {
    const userId = readString((params as { userId?: unknown }).userId);
    const publisherAgentId = readString(
      (params as { publisherAgentId?: unknown }).publisherAgentId,
    );
    const name = readString((params as { name?: unknown }).name) ?? "untitled";
    const contentType = readString((params as { contentType?: unknown }).contentType);
    const content = (params as { content?: unknown }).content;
    if (!userId || !publisherAgentId) {
      fail(respond, "artifact.publish requires userId and publisherAgentId");
      return;
    }
    if (typeof content !== "string" && !(content instanceof Uint8Array)) {
      fail(respond, "artifact.publish requires string or Uint8Array content");
      return;
    }
    const result = await serviceForUser(userId).publish({
      userId,
      publisherAgentId,
      name,
      contentType,
      content,
    });
    if (!result.ok) {
      fail(respond, `artifact.publish denied: ${result.reason}`, result.reason);
      return;
    }
    respond(true, { artifact: result.artifact });
  },

  "artifact.grant.create": async ({ params, respond }) => {
    const userId = readString((params as { userId?: unknown }).userId);
    const publisherAgentId = readString(
      (params as { publisherAgentId?: unknown }).publisherAgentId,
    );
    const artifactId = readString((params as { artifactId?: unknown }).artifactId);
    const granteeAgentId = readString((params as { granteeAgentId?: unknown }).granteeAgentId);
    const ttlMs = readNumber((params as { ttlMs?: unknown }).ttlMs);
    const singleUse = readBool((params as { singleUse?: unknown }).singleUse);
    if (!userId || !publisherAgentId || !artifactId || !granteeAgentId || ttlMs == null) {
      fail(
        respond,
        "artifact.grant.create requires userId, publisherAgentId, artifactId, granteeAgentId, ttlMs",
      );
      return;
    }
    const result = await serviceForUser(userId).createGrant({
      userId,
      publisherAgentId,
      artifactId,
      granteeAgentId,
      ttlMs,
      singleUse,
    });
    if (!result.ok) {
      fail(respond, `artifact.grant.create denied: ${result.reason}`, result.reason);
      return;
    }
    respond(true, { grant: result.grant });
  },

  "artifact.grant.redeem": async ({ params, respond }) => {
    const userId = readString((params as { userId?: unknown }).userId);
    const actorAgentId = readString((params as { actorAgentId?: unknown }).actorAgentId);
    const grantId = readString((params as { grantId?: unknown }).grantId);
    if (!userId || !actorAgentId || !grantId) {
      fail(respond, "artifact.grant.redeem requires userId, actorAgentId, grantId");
      return;
    }
    const result = await serviceForUser(userId).redeem({
      userId,
      actorAgentId,
      grantId,
    });
    if (!result.ok) {
      fail(respond, `artifact.grant.redeem denied: ${result.reason}`, result.reason);
      return;
    }
    respond(true, {
      artifact: result.artifact,
      grant: result.grant,
      text: result.text,
      contentBase64: result.content.toString("base64"),
    });
  },

  "artifact.grant.revoke": async ({ params, respond }) => {
    const userId = readString((params as { userId?: unknown }).userId);
    const actorAgentId = readString((params as { actorAgentId?: unknown }).actorAgentId);
    const grantId = readString((params as { grantId?: unknown }).grantId);
    if (!userId || !actorAgentId || !grantId) {
      fail(respond, "artifact.grant.revoke requires userId, actorAgentId, grantId");
      return;
    }
    const result = await serviceForUser(userId).revoke({
      userId,
      actorAgentId,
      grantId,
    });
    if (!result.ok) {
      fail(respond, `artifact.grant.revoke denied: ${result.reason}`, result.reason);
      return;
    }
    respond(true, { grant: result.grant });
  },

  "artifact.grant.get": async ({ params, respond }) => {
    const userId = readString((params as { userId?: unknown }).userId);
    const grantId = readString((params as { grantId?: unknown }).grantId);
    if (!userId || !grantId) {
      fail(respond, "artifact.grant.get requires userId and grantId");
      return;
    }
    const result = await serviceForUser(userId).getGrant(userId, grantId);
    if (!result.ok) {
      fail(respond, `artifact.grant.get denied: ${result.reason}`, result.reason);
      return;
    }
    respond(true, { grant: result.grant });
  },
};
