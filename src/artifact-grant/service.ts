/**
 * ArtifactGrantService — publish / createGrant / redeem / revoke.
 * B never sees A's workspace path; only user-scoped blob + grant ACL.
 */
import { newArtifactId, newGrantId, sanitizeAgentId, sanitizeUserId, sha256Of } from "./ids.js";
import {
  appendAudit,
  readArtifactBytes,
  readArtifactRecord,
  readAuditLines,
  readGrant,
  resolveStorePaths,
  type ArtifactGrantStorePaths,
  writeArtifact,
  writeGrant,
} from "./store.js";
import type {
  ArtifactGrant,
  ArtifactGrantScope,
  ArtifactRecord,
  CreateGrantInput,
  GrantFailure,
  PublishInput,
  RedeemInput,
  RedeemSuccess,
  RevokeInput,
} from "./types.js";

const DEFAULT_CONTENT_TYPE = "text/plain; charset=utf-8";
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const MAX_BYTES = 5 * 1024 * 1024;

export type ArtifactGrantService = {
  readonly paths: ArtifactGrantStorePaths;
  publish(input: PublishInput): Promise<{ ok: true; artifact: ArtifactRecord } | GrantFailure>;
  createGrant(input: CreateGrantInput): Promise<{ ok: true; grant: ArtifactGrant } | GrantFailure>;
  redeem(input: RedeemInput): Promise<RedeemSuccess | GrantFailure>;
  revoke(input: RevokeInput): Promise<{ ok: true; grant: ArtifactGrant } | GrantFailure>;
  getGrant(
    userId: string,
    grantId: string,
  ): Promise<{ ok: true; grant: ArtifactGrant } | GrantFailure>;
  listAudit(): Promise<Awaited<ReturnType<typeof readAuditLines>>>;
};

function toBuffer(content: string | Uint8Array): Buffer {
  if (typeof content === "string") {
    return Buffer.from(content, "utf8");
  }
  return Buffer.from(content);
}

function deny(
  paths: ArtifactGrantStorePaths,
  event: {
    userId: string;
    actorAgentId: string;
    reason: GrantFailure["reason"];
    artifactId?: string;
    grantId?: string;
  },
): Promise<GrantFailure> {
  return appendAudit(paths, {
    at: Date.now(),
    type: "grant.deny",
    userId: event.userId,
    actorAgentId: event.actorAgentId,
    artifactId: event.artifactId,
    grantId: event.grantId,
    reason: event.reason,
  }).then(() => ({ ok: false as const, reason: event.reason }));
}

export function createArtifactGrantService(params: { rootDir: string }): ArtifactGrantService {
  const paths = resolveStorePaths(params.rootDir);

  return {
    paths,

    async publish(input) {
      let userId: string;
      let publisherAgentId: string;
      try {
        userId = sanitizeUserId(input.userId);
        publisherAgentId = sanitizeAgentId(input.publisherAgentId);
      } catch {
        return { ok: false, reason: "invalid_identity" };
      }
      const name = input.name?.trim() || "untitled";
      const content = toBuffer(input.content);
      if (content.byteLength > MAX_BYTES) {
        return deny(paths, {
          userId,
          actorAgentId: publisherAgentId,
          reason: "scope_denied",
        });
      }
      const artifactId = newArtifactId();
      const record: ArtifactRecord = {
        artifactId,
        userId,
        publisherAgentId,
        name,
        contentType: input.contentType?.trim() || DEFAULT_CONTENT_TYPE,
        sha256: sha256Of(content),
        byteLength: content.byteLength,
        createdAt: Date.now(),
      };
      await writeArtifact(paths, record, content);
      await appendAudit(paths, {
        at: record.createdAt,
        type: "publish",
        userId,
        actorAgentId: publisherAgentId,
        artifactId,
      });
      return { ok: true, artifact: record };
    },

    async createGrant(input) {
      let userId: string;
      let publisherAgentId: string;
      let granteeAgentId: string;
      try {
        userId = sanitizeUserId(input.userId);
        publisherAgentId = sanitizeAgentId(input.publisherAgentId);
        granteeAgentId = sanitizeAgentId(input.granteeAgentId);
      } catch {
        return { ok: false, reason: "invalid_identity" };
      }
      const ttlMs = input.ttlMs;
      if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
        return deny(paths, {
          userId,
          actorAgentId: publisherAgentId,
          artifactId: input.artifactId,
          reason: "invalid_ttl",
        });
      }
      const artifact = await readArtifactRecord(paths, input.artifactId);
      if (!artifact || artifact.userId !== userId) {
        return deny(paths, {
          userId,
          actorAgentId: publisherAgentId,
          artifactId: input.artifactId,
          reason: "artifact_not_found",
        });
      }
      if (artifact.publisherAgentId !== publisherAgentId) {
        return deny(paths, {
          userId,
          actorAgentId: publisherAgentId,
          artifactId: input.artifactId,
          reason: "not_publisher",
        });
      }
      const scopes: ArtifactGrantScope[] = input.scopes?.length
        ? input.scopes.filter((s) => s === "read")
        : ["read"];
      if (scopes.length === 0) {
        return deny(paths, {
          userId,
          actorAgentId: publisherAgentId,
          artifactId: input.artifactId,
          reason: "scope_denied",
        });
      }
      const now = input.nowMs ?? Date.now();
      const grant: ArtifactGrant = {
        grantId: newGrantId(),
        artifactId: artifact.artifactId,
        userId,
        publisherAgentId,
        granteeAgentId,
        scopes,
        expiresAt: now + ttlMs,
        singleUse: Boolean(input.singleUse),
        redeemedCount: 0,
        createdAt: now,
      };
      await writeGrant(paths, grant);
      await appendAudit(paths, {
        at: now,
        type: "grant.create",
        userId,
        actorAgentId: publisherAgentId,
        artifactId: grant.artifactId,
        grantId: grant.grantId,
      });
      return { ok: true, grant };
    },

    async redeem(input) {
      let userId: string;
      let actorAgentId: string;
      try {
        userId = sanitizeUserId(input.userId);
        actorAgentId = sanitizeAgentId(input.actorAgentId);
      } catch {
        return { ok: false, reason: "invalid_identity" };
      }
      const now = input.nowMs ?? Date.now();
      const grant = await readGrant(paths, input.grantId);
      if (!grant || grant.userId !== userId) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: input.grantId,
          reason: "grant_not_found",
        });
      }
      if (grant.granteeAgentId !== actorAgentId) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "not_grantee",
        });
      }
      if (grant.revokedAt != null) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "revoked",
        });
      }
      if (now >= grant.expiresAt) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "expired",
        });
      }
      if (grant.singleUse && grant.redeemedCount > 0) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "single_use_exhausted",
        });
      }
      if (!grant.scopes.includes("read")) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "scope_denied",
        });
      }
      const artifact = await readArtifactRecord(paths, grant.artifactId);
      const bytes = await readArtifactBytes(paths, grant.artifactId);
      if (!artifact || !bytes || artifact.userId !== userId) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "artifact_not_found",
        });
      }
      const updated: ArtifactGrant = {
        ...grant,
        redeemedCount: grant.redeemedCount + 1,
      };
      await writeGrant(paths, updated);
      await appendAudit(paths, {
        at: now,
        type: "grant.redeem",
        userId,
        actorAgentId,
        artifactId: grant.artifactId,
        grantId: grant.grantId,
      });
      const text =
        artifact.contentType.includes("text") ||
        artifact.contentType.includes("json") ||
        artifact.contentType.includes("markdown")
          ? bytes.toString("utf8")
          : null;
      return {
        ok: true,
        grant: updated,
        artifact,
        content: bytes,
        text,
      };
    },

    async revoke(input) {
      let userId: string;
      let actorAgentId: string;
      try {
        userId = sanitizeUserId(input.userId);
        actorAgentId = sanitizeAgentId(input.actorAgentId);
      } catch {
        return { ok: false, reason: "invalid_identity" };
      }
      const now = input.nowMs ?? Date.now();
      const grant = await readGrant(paths, input.grantId);
      if (!grant || grant.userId !== userId) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: input.grantId,
          reason: "grant_not_found",
        });
      }
      if (grant.publisherAgentId !== actorAgentId) {
        return deny(paths, {
          userId,
          actorAgentId,
          grantId: grant.grantId,
          artifactId: grant.artifactId,
          reason: "not_publisher",
        });
      }
      const updated: ArtifactGrant = {
        ...grant,
        revokedAt: now,
      };
      await writeGrant(paths, updated);
      await appendAudit(paths, {
        at: now,
        type: "grant.revoke",
        userId,
        actorAgentId,
        artifactId: grant.artifactId,
        grantId: grant.grantId,
      });
      return { ok: true, grant: updated };
    },

    async getGrant(userIdRaw, grantId) {
      let userId: string;
      try {
        userId = sanitizeUserId(userIdRaw);
      } catch {
        return { ok: false, reason: "invalid_identity" };
      }
      const grant = await readGrant(paths, grantId);
      if (!grant || grant.userId !== userId) {
        return { ok: false, reason: "grant_not_found" };
      }
      return { ok: true, grant };
    },

    listAudit() {
      return readAuditLines(paths);
    },
  };
}

/** Prefer user sharedArtifactsDir/.grants when available. */
export function resolveArtifactGrantRootUnderSharedArtifacts(sharedArtifactsDir: string): string {
  return resolveStorePaths(`${sharedArtifactsDir.replace(/\/+$/, "")}/.grants`).rootDir;
}
