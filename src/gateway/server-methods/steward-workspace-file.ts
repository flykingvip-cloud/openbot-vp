import fs from "node:fs";
import path from "node:path";
import { resolveSessionAgentId } from "../../agents/agent-scope.js";
import { isBuiltinStewardAgent } from "../../agents/builtin-steward/identity.js";
import { loadConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import { parseAgentSessionKey } from "../../sessions/session-key-utils.js";
import { loadExistingGovernedWorkspaceIdentity } from "../data-governance/workspace-catalog-projection.js";
import {
  filterAgentsForEmployeeActor,
  isPersonalWorkbenchClient,
  resolveEmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { parseOfficeSlidesInput, patchPptxSlideTexts } from "../office-pptx-text.js";
import { renderOfficePreviewHtml } from "../office-render.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { listAgentsForGateway } from "../session-utils.js";
import { resolveTenantContext } from "../tenant-context.js";
import {
  loadCanonicalWriteOwnership,
  resolveCanonicalRobotWriteRoot,
} from "../workspace-resolver/canonical-write-root.js";
import { alignFormalRootForManagedAddressing } from "../workspace-resolver/formal-deliverable-root.js";
import { resolveWorkspaceWriteLocator } from "../workspace-resolver/workspace-write-contract.js";
import { resolveRobotWriteRoot } from "../workspace-resolver/write-roots.js";
import {
  authorizeAgentWorkspaceFileAccess,
  PRIMARY_CAPABLE_WRITE_CHANNELS,
  resolveTrustedAgentLocator,
} from "../workspace/handler-bridge.js";
import type { WorkspaceResolveOperation } from "../workspace/resource-resolver.js";
import {
  resolveAuthorizedPreviewRelativePath,
  resolvePreviewFilesystemLocator,
  previewTrustedRoots,
} from "./steward-preview-locator.js";
import type { GatewayRequestHandlerOptions, GatewayRequestHandlers } from "./types.js";

const PREVIEW_FILE_NOT_SYNCED = "workspace file not synced for preview";

function containerWorkdirFromConfig(cfg: ReturnType<typeof loadConfig>): string | null {
  const workdir = cfg.agents?.defaults?.sandbox?.docker?.workdir;
  return typeof workdir === "string" && workdir.trim() ? workdir.trim() : null;
}

/**
 * Reads/writes deliverables from the active direct-chat agent workspace. Legacy callers that omit
 * `sessionKey` retain the original per-user builtin-steward behavior.
 *
 * Security model (P0-c):
 * - `sessionKey` determines the agent; a client cannot supply an independent workspace path.
 * - personal-workbench callers may only read agents visible to their authenticated actor.
 * - file access is authorized through the workspace handler bridge (classifier + resolver).
 * - locator comes from trusted adapters only (never concatenated from client path segments).
 * - Steward without sessionKey is the documented system exception (`stewardException`).
 */

/** Hard cap so a huge file can't blow up the RPC frame / browser memory. */
const MAX_STEWARD_FILE_BYTES = 20 * 1024 * 1024;

/** Extensions that render as inline text in the UI; everything else is a download. */
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
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function inferMimeType(ext: string): string {
  return lookupStewardPreviewMime(ext);
}

async function authorizeStewardWorkspaceFile(params: {
  client: GatewayRequestHandlerOptions["client"];
  respond: GatewayRequestHandlerOptions["respond"];
  record: Record<string, unknown>;
  operation: WorkspaceResolveOperation;
  purpose: string;
}): Promise<
  | {
      ok: true;
      authorized: Awaited<ReturnType<typeof authorizeAgentWorkspaceFileAccess>> & { ok: true };
      relativePath: string;
      requested: string;
    }
  | { ok: false }
> {
  const context = await resolveKnowledgeSourceContext(params.client);
  if (!context.userId) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read workspace file"),
    );
    return { ok: false };
  }

  const requestedRaw = typeof params.record.filename === "string" ? params.record.filename : "";
  let requested = requestedRaw;
  const sessionKey =
    typeof params.record.sessionKey === "string" ? params.record.sessionKey.trim() : "";
  const cfg = loadConfig();
  const stateDir = resolveStateDir(process.env);

  let agentId = "main";
  let locator: string;
  let stewardException = false;

  if (sessionKey) {
    const parsed = parseAgentSessionKey(sessionKey);
    if (!parsed && sessionKey.toLowerCase().startsWith("agent:")) {
      params.respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid sessionKey"),
      );
      return { ok: false };
    }
    agentId = resolveSessionAgentId({ sessionKey, config: cfg });
    const agents = listAgentsForGateway(cfg).agents;
    const knownAgent = agents.find((agent) => agent.id === agentId);
    if (!knownAgent) {
      const message = isPersonalWorkbenchClient(params.client)
        ? "not authorized to read session agent file"
        : "session agent not found";
      params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      return { ok: false };
    }
    if (isPersonalWorkbenchClient(params.client)) {
      const actor = await resolveEmployeeWorkbenchActor(params.client);
      if (!actor) {
        params.respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required to read session file"),
        );
        return { ok: false };
      }
      const visibleAgents = filterAgentsForEmployeeActor(agents, actor);
      if (!visibleAgents.some((agent) => agent.id === agentId)) {
        params.respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to read session agent file"),
        );
        return { ok: false };
      }
    }
    let trustedLocator: string | null = null;
    try {
      trustedLocator = await resolveTrustedAgentLocator({
        client: params.client,
        agentId,
        cfg,
      });
    } catch {
      // Dual occupancy (user + seat rows for one asset) fail-closes Item 7
      // as first_canonical_selection_forbidden. Session ACL already bound
      // this read to the agent; preview uses the session write root next.
      trustedLocator = null;
    }
    const tenantCtx = await resolveTenantContext(params.client).catch(() => null);
    const tenantId = context.tenantId?.trim() || tenantCtx?.tenantId?.trim() || "";
    const runtimeWorkspaces: string[] = [];
    let occupiedSeatId: string | null = null;
    try {
      const actor = await resolveEmployeeWorkbenchActor(params.client);
      occupiedSeatId = actor?.currentSeatId?.trim() || null;
    } catch {
      occupiedSeatId = null;
    }
    let catalog = null;
    if (tenantId && context.userId) {
      try {
        const identity = await loadExistingGovernedWorkspaceIdentity({
          tenantId,
          userId: context.userId,
          agentId,
          occupiedSeatId,
          stateDir,
        });
        catalog = identity.catalog ?? null;
      } catch {
        catalog = null;
      }
    }
    const ownership = await loadCanonicalWriteOwnership({
      cfg,
      agentId,
      tenantId,
      chattingUserId: context.userId,
      occupiedSeatId,
      stateDir,
      catalog,
    });
    const canonicalRaw = resolveCanonicalRobotWriteRoot({
      agentId,
      tenantId,
      chattingUserId: context.userId,
      sessionKey,
      stateDir,
      ownership,
    });
    const canonical = canonicalRaw
      ? alignFormalRootForManagedAddressing(canonicalRaw, { config: cfg })
      : null;
    if (canonical) {
      runtimeWorkspaces.push(canonical);
    } else if (ownership.kind !== "seat_owned") {
      // Personal / unknown: prior per-login-user root.
      // Seat-owned without sticky/host fails closed (not synced) instead of
      // forking preview onto the chatting user's empty tree.
      const robotOwn = resolveRobotWriteRoot({
        agentId,
        tenantId,
        userId: context.userId,
        sessionKey,
        stateDir,
      });
      if (robotOwn) {
        runtimeWorkspaces.push(robotOwn);
      }
    }
    try {
      locator = resolvePreviewFilesystemLocator({
        trustedLocator,
        runtimeWorkspaces,
        configuredWorkspace: null,
        configuredDefaultWorkspace: cfg.agents?.defaults?.workspace,
        agentId,
        stateDir,
      });
    } catch {
      params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
      return { ok: false };
    }
  } else {
    stewardException = true;
    const tenantCtx = await resolveTenantContext(params.client).catch(() => null);
    const robotOwn = resolveRobotWriteRoot({
      agentId,
      tenantId: context.tenantId?.trim() || tenantCtx?.tenantId?.trim() || "",
      userId: context.userId,
      stateDir,
    });
    if (!robotOwn) {
      params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
      return { ok: false };
    }
    locator = robotOwn;
  }
  if (params.operation === "write") {
    const decision = resolveWorkspaceWriteLocator({
      workspaceRoot: locator,
      requestedPath: requested,
    });
    if (!decision.ok) {
      params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, decision.message));
      return { ok: false };
    }
    requested = decision.relativePath;
    // Nested deliverables are authorized against an existing parent. Create
    // that parent inside this bot's workspace before the realpath check.
    const parentRel = path.posix.dirname(requested);
    if (parentRel && parentRel !== ".") {
      const parentAbs = path.resolve(locator, parentRel);
      const parentWithin = path.relative(path.resolve(locator), parentAbs);
      if (parentWithin && !parentWithin.startsWith("..") && !path.isAbsolute(parentWithin)) {
        fs.mkdirSync(parentAbs, { recursive: true });
      }
    }
  }
  const located = resolveAuthorizedPreviewRelativePath({
    requested,
    workspaceRoot: locator,
    trustedRoots: previewTrustedRoots(locator, {
      containerWorkdir: containerWorkdirFromConfig(cfg),
    }),
  });
  if (!located.ok) {
    params.respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, located.message));
    return { ok: false };
  }
  requested = located.relativePath;
  // Builtin steward and any session-visible agent already passed ACL above.
  // Unmapped registry ids must not block workbench preview.
  if (sessionKey || isBuiltinStewardAgent(agentId)) {
    stewardException = true;
  }

  const authorized = await authorizeAgentWorkspaceFileAccess({
    client: params.client,
    cfg,
    userId: context.userId,
    agentId,
    relativePath: requested,
    operation: params.operation,
    purpose: params.purpose,
    locator,
    stewardException,
    allowedWriteChannels: params.operation === "write" ? PRIMARY_CAPABLE_WRITE_CHANNELS : undefined,
  });
  if (!authorized.ok) {
    const unavailable =
      authorized.code === "workspace_missing" || authorized.code === "resolver_denied";
    params.respond(
      false,
      undefined,
      errorShape(
        unavailable ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
        authorized.code === "workspace_missing" ? PREVIEW_FILE_NOT_SYNCED : authorized.message,
      ),
    );
    return { ok: false };
  }

  const relativePath = path
    .relative(authorized.access.baseReal, authorized.absoluteFilePath)
    .replace(/\\/g, "/");
  return { ok: true, authorized, relativePath, requested };
}

async function handleStewardFileOpen(params: {
  params: unknown;
  respond: GatewayRequestHandlerOptions["respond"];
  client: GatewayRequestHandlerOptions["client"];
  operation: "read" | "preview";
  purpose: string;
}): Promise<void> {
  const record =
    params.params && typeof params.params === "object"
      ? (params.params as Record<string, unknown>)
      : {};
  const authorized = await authorizeStewardWorkspaceFile({
    client: params.client,
    respond: params.respond,
    record,
    operation: params.operation,
    purpose: params.purpose,
  });
  if (!authorized.ok) {
    return;
  }

  const real = authorized.authorized.absoluteFilePath;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(real);
  } catch {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
    return;
  }
  if (!stat.isFile()) {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
    return;
  }
  // Zero bytes is not an openable deliverable. Same miss as a file that was never synced.
  if (stat.size === 0) {
    params.respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
    return;
  }
  if (stat.size > MAX_STEWARD_FILE_BYTES) {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "workspace file too large to open"),
    );
    return;
  }

  const filename = path.basename(authorized.relativePath);
  const ext = path.extname(filename).toLowerCase();
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(real);
  } catch {
    params.respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "failed to read workspace file"),
    );
    return;
  }

  const wantRender = record.render === true;
  if (wantRender) {
    const rendered = await renderOfficePreviewHtml({ filename, buffer });
    if (rendered) {
      params.respond(true, {
        filename,
        relativePath: authorized.relativePath,
        mimeType: inferMimeType(ext),
        byteLength: buffer.length,
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
    filename,
    relativePath: authorized.relativePath,
    mimeType: inferMimeType(ext),
    byteLength: buffer.length,
    textLike: TEXT_LIKE_EXTENSIONS.has(ext),
    base64: buffer.toString("base64"),
  });
}

export const stewardWorkspaceFileHandlers: GatewayRequestHandlers = {
  "workbench.steward-file.read": async ({ params, respond, client }) => {
    await handleStewardFileOpen({
      params,
      respond,
      client,
      operation: "read",
      purpose: "workbench.steward-file.read",
    });
  },
  "workbench.steward-file.preview": async ({ params, respond, client }) => {
    await handleStewardFileOpen({
      params,
      respond,
      client,
      operation: "preview",
      purpose: "workbench.steward-file.preview",
    });
  },
  "workbench.steward-file.open": async ({ params, respond, client }) => {
    await handleStewardFileOpen({
      params,
      respond,
      client,
      operation: "preview",
      purpose: "workbench.steward-file.open",
    });
  },
  "workbench.steward-file.write": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const content = typeof record.content === "string" ? record.content : null;
    if (content === null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "content required"));
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
    const authorized = await authorizeStewardWorkspaceFile({
      client,
      respond,
      record,
      operation: "write",
      purpose: "workbench.steward-file.write",
    });
    if (!authorized.ok) {
      return;
    }
    const absolutePath = authorized.authorized.absoluteFilePath;
    try {
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, content, "utf8");
      const written = fs.statSync(absolutePath);
      if (!written.isFile() || written.size === 0) {
        fs.unlinkSync(absolutePath);
        throw new Error("empty workspace write refused");
      }
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "failed to write workspace file"),
      );
      return;
    }
    respond(true, {
      ok: true,
      filename: path.basename(authorized.relativePath),
      relativePath: authorized.relativePath,
      byteLength: Buffer.byteLength(content, "utf8"),
    });
  },
  "workbench.steward-file.patch-pptx": async ({ params, respond, client }) => {
    const record = params && typeof params === "object" ? params : {};
    const slides = parseOfficeSlidesInput(record.slides);
    if (!slides) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "slides required"));
      return;
    }
    const authorized = await authorizeStewardWorkspaceFile({
      client,
      respond,
      record,
      operation: "write",
      purpose: "workbench.steward-file.patch-pptx",
    });
    if (!authorized.ok) {
      return;
    }
    const filename = path.basename(authorized.relativePath);
    if (path.extname(filename).toLowerCase() !== ".pptx") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "pptx file required"));
      return;
    }
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(authorized.authorized.absoluteFilePath);
    } catch {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, PREVIEW_FILE_NOT_SYNCED));
      return;
    }
    const patched = await patchPptxSlideTexts(buffer, slides);
    if (!patched) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "failed to patch pptx"));
      return;
    }
    try {
      fs.writeFileSync(authorized.authorized.absoluteFilePath, patched);
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "failed to write workspace file"),
      );
      return;
    }
    const rendered = await renderOfficePreviewHtml({ filename, buffer: patched });
    respond(true, {
      filename,
      relativePath: authorized.relativePath,
      mimeType: inferMimeType(path.extname(filename).toLowerCase()),
      byteLength: patched.length,
      textLike: false,
      renderKind: "html",
      html: rendered?.html,
      base64: patched.toString("base64"),
      ...(rendered?.slides ? { officeSlides: rendered.slides } : { officeSlides: slides }),
    });
  },
};

const STEWARD_PREVIEW_IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

function lookupStewardPreviewMime(ext: string): string {
  return MIME_BY_EXTENSION[ext] ?? STEWARD_PREVIEW_IMAGE_MIME[ext] ?? "application/octet-stream";
}
