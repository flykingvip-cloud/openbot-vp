import {
  resolveAttachmentAsset,
  upsertAttachmentAsset,
  type AttachmentAssetResolveInput,
  type AttachmentAssetUpsertInput,
  type AttachmentAssetVersion,
} from "../attachment-assets.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { numberValue, recordOrEmpty as asRecord } from "../records.js";
import type { GatewayRequestHandlers } from "./types.js";

function numberOrUndefined(value: unknown): number | undefined {
  return numberValue(value) ?? undefined;
}

function serializeVersion(version: AttachmentAssetVersion, opts?: { includeContent?: boolean }) {
  return {
    assetId: version.assetId,
    versionId: version.versionId,
    fileName: version.fileName,
    mimeType: version.mimeType,
    contentHash: version.contentHash,
    sizeBytes: version.sizeBytes,
    lastModified: version.lastModified,
    ...(opts?.includeContent === true ? { content: version.content } : {}),
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

function parseUpsertParams(params: unknown): AttachmentAssetUpsertInput | null {
  const input = asRecord(params);
  const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!fileName || !content) {
    return null;
  }
  return {
    fileName,
    content,
    mimeType: typeof input.mimeType === "string" ? input.mimeType : undefined,
    sizeBytes: numberOrUndefined(input.sizeBytes),
    lastModified: numberOrUndefined(input.lastModified),
  };
}

function parseResolveParams(params: unknown): AttachmentAssetResolveInput | null {
  const input = asRecord(params);
  const fileName = typeof input.fileName === "string" ? input.fileName.trim() : "";
  if (!fileName) {
    return null;
  }
  return {
    fileName,
    contentHash: typeof input.contentHash === "string" ? input.contentHash.trim() : undefined,
    sizeBytes: numberOrUndefined(input.sizeBytes),
    lastModified: numberOrUndefined(input.lastModified),
    allowLatestFallback: input.allowLatestFallback === true,
  };
}

export const attachmentAssetHandlers: GatewayRequestHandlers = {
  "attachment.assets.upsert": async ({ params, respond }) => {
    const input = parseUpsertParams(params);
    if (!input) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid attachment asset"));
      return;
    }
    try {
      const result = await upsertAttachmentAsset(input);
      // Upsert ack only needs ids/hashes — echoing multi‑MB base64 back over WS is wasteful
      // and has contributed to client-side stack/OOM failures on large PDF ebooks.
      respond(
        true,
        {
          status: result.status,
          asset: serializeVersion(result.version, { includeContent: false }),
        },
        undefined,
      );
    } catch (err) {
      const message =
        err instanceof Error && /Maximum call stack size exceeded/i.test(err.message)
          ? "attachment asset upsert failed while processing a large file; try a smaller copy"
          : String(err);
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
  "attachment.assets.resolve": async ({ params, respond }) => {
    const input = parseResolveParams(params);
    if (!input) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "fileName is required"));
      return;
    }
    const match = await resolveAttachmentAsset(input);
    respond(
      true,
      { asset: match ? serializeVersion(match, { includeContent: true }) : null },
      undefined,
    );
  },
};
