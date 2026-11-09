import fs from "node:fs";
import path from "node:path";
import { patchAuthorizedPptx, artifactContentHash } from "../../agent-runtime/delivery/index.js";
import { loadConfig } from "../../config/config.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import {
  pruneExpiredGroupDeliverableDrafts,
  readGroupDeliverableManifest,
  slugifyLogicalId,
} from "../knowledge/deliverables/group-manifest.js";
import { parseOfficeSlidesInput } from "../office-pptx-text.js";
import { renderOfficePreviewHtml } from "../office-render.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { resolveTenantContext } from "../tenant-context.js";
import {
  getGatewayWorkspaceCutoverStore,
  InMemoryWorkspaceResourceCatalog,
  listGroupWorkspaceRelativeDir,
  resolveWorkspaceActorTenantId,
} from "../workspace-resolver/index.js";
import { assertGroupMemberAccess } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  authorizeGroupWorkspaceFileAccess,
  PRIMARY_CAPABLE_WRITE_CHANNELS,
} from "../workspace/handler-bridge.js";
import type { WorkspaceResolveOperation } from "../workspace/resource-resolver.js";
import {
  previewTrustedRoots,
  resolveAuthorizedPreviewRelativePath,
} from "./steward-preview-locator.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

/**
 * Group workspace file RPCs.
 */
/** List-dir catalog lookup uses an existing-shape read view. */
const MAX_GROUP_FILE_BYTES = 20 * 1024 * 1024;

const TEXT_LIKE_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".log",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
  ".canvas",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".html": "text/html",
  ".htm": "text/html",
  ".xml": "application/xml",
  ".canvas": "application/x-openbot-canvas",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function inferMimeType(ext: string): string {
  return lookupGroupPreviewMime(ext);
}

function mapResolverReadFailure(reason: string): {
  code: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  message: string;
} {
  if (reason === "file_too_large") {
    return { code: ErrorCodes.INVALID_REQUEST, message: "group file too large to open" };
  }
  if (
    reason === "tenant_mismatch" ||
    reason === "unknown_ownership" ||
    reason === "catalog_unavailable"
  ) {
    return {
      code: ErrorCodes.INVALID_REQUEST,
      message: "not authorized to read group workspace file",
    };
  }
  return { code: ErrorCodes.UNAVAILABLE, message: "group file not found" };
}

/** Collapse to a safe workspace-relative path (allows deliverables/foo.md, rejects ..). */
export function normalizeGroupWorkspaceRelativePath(requested: string): string | null {
  const trimmed = requested.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\0")) {
    return null;
  }
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    return null;
  }
  return segments.join("/");
}

async function resolveGroupAccessContext(params: {
  client: GatewayRequestHandlerOptions["client"];
  respond: GatewayRequestHandlerOptions["respond"];
  groupId: string;
  userId: string;
}): Promise<
  | {
      ok: true;
      cfg: ReturnType<typeof loadConfig>;
      profile: ReturnType<typeof resolveSecurityProfile>;
      tenantId: string | null;
      locator: string;
    }
  | { ok: false }
> {
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  let tenantId: string | null = null;
  if (profile.profile === "managed_enterprise") {
    const tenantCtx = await resolveTenantContext(params.client);
    tenantId = tenantCtx?.tenantId ?? null;
    if (!tenantId) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "trusted tenant context required"),
      );
      return { ok: false };
    }
  }

  const denied = await assertGroupMemberAccess({
    groupId: params.groupId,
    userId: params.userId,
    tenantId,
    profile: profile.profile,
    cfg,
    identityAliases: [params.client?.user ?? ""].map((entry) => entry.trim()).filter(Boolean),
  });
  if (denied) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, denied));
    return { ok: false };
  }

  let locator: string;
  try {
    locator = resolveTrustedGroupLocator({
      groupId: params.groupId,
      tenantId,
      profile: profile.profile,
      cfg,
    });
  } catch (error) {
    params.respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        error instanceof Error ? error.message : "failed to resolve group workspace",
      ),
    );
    return { ok: false };
  }

  return { ok: true, cfg, profile, tenantId, locator };
}

async function handleGroupFileOpen(params: {
  params: unknown;
  respond: GatewayRequestHandlerOptions["respond"];
  client: GatewayRequestHandlerOptions["client"];
  operation: WorkspaceResolveOperation;
  purpose: string;
}): Promise<void> {
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read group file"),
    );
    return;
  }

  const record =
    params.params && typeof params.params === "object"
      ? (params.params as Record<string, unknown>)
      : {};
  const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
  const requested = typeof record.filename === "string" ? record.filename : "";
  if (!groupId || !requested.trim()) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid groupId or filename"),
    );
    return;
  }

  const access = await resolveGroupAccessContext({
    client: params.client,
    respond: params.respond,
    groupId,
    userId: context.userId,
  });
  if (!access.ok) {
    return;
  }
  const located = resolveAuthorizedPreviewRelativePath({
    requested,
    workspaceRoot: access.locator,
    trustedRoots: previewTrustedRoots(access.locator, {
      containerWorkdir: access.cfg.agents?.defaults?.sandbox?.docker?.workdir,
    }),
  });
  if (!located.ok) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, located.message));
    return;
  }
  const relativePath = located.relativePath;

  const authorized = await authorizeGroupWorkspaceFileAccess({
    client: params.client,
    cfg: access.cfg,
    userId: context.userId,
    groupId,
    relativePath,
    operation: params.operation,
    purpose: params.purpose,
    locator: access.locator,
    groupAclVerified: true,
    authoritativeTenantId: access.tenantId,
  });
  if (!authorized.ok) {
    const unavailable =
      authorized.code === "workspace_missing" || authorized.code === "resolver_denied";
    params.respond(
      false,
      undefined,
      errorShape(
        unavailable ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
        authorized.message,
      ),
    );
    return;
  }

  const real = authorized.absoluteFilePath;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group file not found"));
    return;
  }
  if (!stat.isFile()) {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group file not found"));
    return;
  }
  // Zero bytes is not an openable deliverable. Same miss as a file that was never written.
  if (stat.size === 0) {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group file not found"));
    return;
  }
  if (stat.size > MAX_GROUP_FILE_BYTES) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "group file too large to open"),
    );
    return;
  }

  const filename = path.basename(relativePath);
  const ext = path.extname(filename).toLowerCase();
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(real);
  } catch {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "failed to read group file"),
    );
    return;
  }

  const wantRender = record.render === true;
  if (wantRender) {
    const rendered = await renderOfficePreviewHtml({ filename, buffer });
    if (rendered) {
      params.respond(true, {
        groupId,
        relativePath,
        filename,
        mimeType: inferMimeType(ext),
        byteLength: buffer.length,
        contentHash: artifactContentHash(buffer),
        textLike: false,
        renderKind: "html",
        html: rendered.html,
        ...(rendered.keepBytes ? { base64: buffer.toString("base64") } : {}),
        ...(rendered.slides ? { officeSlides: rendered.slides } : {}),
      });
      return;
    }
  }

  params.respond(true, {
    groupId,
    relativePath,
    filename,
    mimeType: inferMimeType(ext),
    byteLength: buffer.length,
    contentHash: artifactContentHash(buffer),
    textLike: TEXT_LIKE_EXTENSIONS.has(ext),
    base64: buffer.toString("base64"),
  });
}

export const groupWorkspaceFileHandlers: GatewayRequestHandlers = {
  "workbench.group-file.read": async ({ params, respond, client }) => {
    await handleGroupFileOpen({
      params,
      respond,
      client,
      operation: "read",
      purpose: "workbench.group-file.read",
    });
  },
  "workbench.group-file.preview": async ({ params, respond, client }) => {
    await handleGroupFileOpen({
      params,
      respond,
      client,
      operation: "preview",
      purpose: "workbench.group-file.preview",
    });
  },
  "workbench.group-file.open": async ({ params, respond, client }) => {
    await handleGroupFileOpen({
      params,
      respond,
      client,
      operation: "preview",
      purpose: "workbench.group-file.open",
    });
  },
  "workbench.group-file.write": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to write group file"),
      );
      return;
    }

    const record = params && typeof params === "object" ? params : {};
    const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
    const relativePath = normalizeGroupWorkspaceRelativePath(
      typeof record.filename === "string" ? record.filename : "",
    );
    const content = typeof record.content === "string" ? record.content : null;
    if (!groupId || !relativePath || content === null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid groupId, filename, or content"),
      );
      return;
    }
    if (Buffer.byteLength(content, "utf8") === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "empty workspace write refused"),
      );
      return;
    }

    const access = await resolveGroupAccessContext({
      client,
      respond,
      groupId,
      userId: context.userId,
    });
    if (!access.ok) {
      return;
    }

    const authorized = await authorizeGroupWorkspaceFileAccess({
      client,
      cfg: access.cfg,
      userId: context.userId,
      groupId,
      relativePath,
      operation: "write",
      purpose: "workbench.group-file.write",
      locator: access.locator,
      groupAclVerified: true,
      authoritativeTenantId: access.tenantId,
      allowedWriteChannels: PRIMARY_CAPABLE_WRITE_CHANNELS,
    });
    if (!authorized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, authorized.message));
      return;
    }

    try {
      fs.mkdirSync(path.dirname(authorized.absoluteFilePath), { recursive: true });
      fs.writeFileSync(authorized.absoluteFilePath, content, "utf8");
      const written = fs.statSync(authorized.absoluteFilePath);
      if (!written.isFile() || written.size === 0) {
        fs.unlinkSync(authorized.absoluteFilePath);
        throw new Error("empty workspace write refused");
      }
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to write group file"));
      return;
    }

    respond(true, {
      ok: true,
      groupId,
      relativePath,
      filename: path.basename(relativePath),
      byteLength: Buffer.byteLength(content, "utf8"),
    });
  },

  "workbench.group-file.patch-pptx": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to write group file"),
      );
      return;
    }

    const record = params && typeof params === "object" ? params : {};
    const slides = parseOfficeSlidesInput(record.slides);
    const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
    const requested = typeof record.filename === "string" ? record.filename : "";
    if (!groupId || !requested.trim() || !slides) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid groupId, filename, or slides"),
      );
      return;
    }

    const access = await resolveGroupAccessContext({
      client,
      respond,
      groupId,
      userId: context.userId,
    });
    if (!access.ok) {
      return;
    }
    const located = resolveAuthorizedPreviewRelativePath({
      requested,
      workspaceRoot: access.locator,
      trustedRoots: previewTrustedRoots(access.locator, {
        containerWorkdir: access.cfg.agents?.defaults?.sandbox?.docker?.workdir,
      }),
    });
    if (!located.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, located.message));
      return;
    }
    const relativePath = located.relativePath;
    if (path.extname(relativePath).toLowerCase() !== ".pptx") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "pptx file required"));
      return;
    }

    const authorized = await authorizeGroupWorkspaceFileAccess({
      client,
      cfg: access.cfg,
      userId: context.userId,
      groupId,
      relativePath,
      operation: "write",
      purpose: "workbench.group-file.patch-pptx",
      locator: access.locator,
      groupAclVerified: true,
      authoritativeTenantId: access.tenantId,
      allowedWriteChannels: PRIMARY_CAPABLE_WRITE_CHANNELS,
    });
    if (!authorized.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, authorized.message));
      return;
    }

    const expectedHash =
      typeof record.expectedContentHash === "string" ? record.expectedContentHash : "";
    let edited: Awaited<ReturnType<typeof patchAuthorizedPptx>>;
    try {
      edited = await patchAuthorizedPptx(authorized.absoluteFilePath, expectedHash, slides);
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "group file not found"));
      return;
    }
    if (edited.kind !== "saved") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          edited.kind === "conflict"
            ? "ARTIFACT_VERSION_CONFLICT: reload the latest original before editing"
            : "expectedContentHash and valid pptx required",
        ),
      );
      return;
    }
    const patched = edited.bytes;

    const filename = path.basename(relativePath);
    const rendered = await renderOfficePreviewHtml({ filename, buffer: patched });
    respond(true, {
      groupId,
      relativePath,
      filename,
      mimeType: inferMimeType(path.extname(filename).toLowerCase()),
      byteLength: patched.length,
      contentHash: edited.contentHash,
      textLike: false,
      renderKind: "html",
      html: rendered?.html,
      base64: patched.toString("base64"),
      ...(rendered?.slides ? { officeSlides: rendered.slides } : { officeSlides: slides }),
    });
  },

  "workbench.group-file.list": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to list group files"),
      );
      return;
    }

    const record = params && typeof params === "object" ? params : {};
    const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
    const relativeDirRaw =
      typeof record.relativeDir === "string"
        ? record.relativeDir
        : typeof record.directory === "string"
          ? record.directory
          : "";
    const relativeDir = relativeDirRaw.trim()
      ? normalizeGroupWorkspaceRelativePath(relativeDirRaw.trim())
      : "";
    if (relativeDirRaw.trim() && !relativeDir) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid relativeDir"));
      return;
    }
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId required"));
      return;
    }

    const access = await resolveGroupAccessContext({
      client,
      respond,
      groupId,
      userId: context.userId,
    });
    if (!access.ok) {
      return;
    }

    const tenantId = resolveWorkspaceActorTenantId(context.tenantId);
    const listResult = listGroupWorkspaceRelativeDir({
      // Existing-shape read view only. Do not synthesize an empty Catalog
      // and do not write a production Catalog row.
      catalog: new InMemoryWorkspaceResourceCatalog({
        governanceVersion: 1,
        status: "available",
        resources: {},
        bindings: {},
      }),
      cfg: access.cfg,
      cutoverStore: getGatewayWorkspaceCutoverStore(access.cfg),
      actor: { tenantId, userId: context.userId },
      tenantId,
      groupId,
      workspaceRoot: access.locator,
      relativeDir: relativeDir ?? "",
    });
    void import("../workspace-resolver/item7-w3-shadow.js").then(
      ({ scheduleItem7W3CatalogSynthesisShadow }) =>
        scheduleItem7W3CatalogSynthesisShadow({ ledgerId: "S17", existingResourceId: null }),
    );
    if (!listResult.ok) {
      const mapped = mapResolverReadFailure(listResult.reason);
      respond(false, undefined, errorShape(mapped.code, mapped.message));
      return;
    }

    respond(true, {
      groupId,
      relativeDir: relativeDir || ".",
      entries: listResult.entries,
    });
  },

  "workbench.group-manifest.read": async ({ params, respond, client }) => {
    const context = await resolveKnowledgeSourceContext(client);
    if (!context.userId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read group manifest"),
      );
      return;
    }

    const record = params && typeof params === "object" ? params : {};
    const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
    const logicalIdRaw = typeof record.logicalId === "string" ? record.logicalId.trim() : "";
    const logicalId = logicalIdRaw ? slugifyLogicalId(logicalIdRaw) : "";
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId required"));
      return;
    }

    const access = await resolveGroupAccessContext({
      client,
      respond,
      groupId,
      userId: context.userId,
    });
    if (!access.ok) {
      return;
    }

    pruneExpiredGroupDeliverableDrafts({ workspacePath: access.locator });
    const manifest = readGroupDeliverableManifest(access.locator);
    if (logicalId) {
      respond(true, {
        groupId,
        logicalId,
        draft: manifest.drafts?.[logicalId] ?? null,
        canonical: manifest.canonical?.[logicalId] ?? null,
      });
      return;
    }
    respond(true, {
      groupId,
      manifest,
    });
  },
};

const GROUP_PREVIEW_IMAGE_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

function lookupGroupPreviewMime(ext: string): string {
  return MIME_BY_EXTENSION[ext] ?? GROUP_PREVIEW_IMAGE_MIME[ext] ?? "application/octet-stream";
}
