import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataMode, resolveDataRoot } from "../config/data-space.js";
import { openBoundaryFileSync } from "../infra/boundary-file-read.js";
import {
  isPackageProvenControlUiRootSync,
  resolveControlUiRootSync,
} from "../infra/control-ui-assets.js";
import { isWithinDir } from "../infra/path-safety.js";
import { openVerifiedFileSync } from "../infra/safe-open-sync.js";
import { AVATAR_MAX_BYTES } from "../shared/avatar-policy.js";
import { shortenHomePath } from "../utils.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";
import {
  authorizeHttpGatewayConnect,
  isLocalDirectRequest,
  resolveControlUiBrowserAuthMode,
  type ResolvedGatewayAuth,
} from "./auth.js";
import {
  resolveControlUiBootstrapConfigPath,
  type ControlUiPlatformAuthState,
  type ControlUiBootstrapConfig,
  type ControlUiTrustedProxySession,
} from "./control-ui-contract.js";
import { buildControlUiCspHeader } from "./control-ui-csp.js";
import {
  isReadHttpMethod,
  respondNotFound as respondControlUiNotFound,
  respondPlainText,
} from "./control-ui-http-utils.js";
import {
  isRetiredControlUiAsset,
  sanitizeControlUiIndexHtml,
} from "./control-ui-index-sanitize.js";
import { classifyControlUiRequest } from "./control-ui-routing.js";
import {
  buildControlUiAvatarUrl,
  CONTROL_UI_AVATAR_PREFIX,
  normalizeControlUiBasePath,
  resolveAssistantAvatarUrl,
} from "./control-ui-shared.js";
import { handleEnterpriseDataConnectorOAuthHttpRequest } from "./enterprise-data/connector-oauth-http.js";
import { handleEnterpriseOperationalIdentityHttpRequest } from "./enterprise-operational-identity.js";
import { handleEnterpriseSeatAssetsHttpRequest } from "./enterprise-seat-assets.js";
import { resolvePlatformModelsConfig } from "./models/platform-models-config.js";
import {
  handleControlUiPlatformAuthRequest,
  resolveControlUiPlatformAuthState,
} from "./platform-auth.js";
import { handleUserOperationalIdentityHttpRequest } from "./user-operational-identity-http.js";

const ROOT_PREFIX = "/";
const LEGACY_CONTROL_UI_RESERVED_PREFIXES = ["/__openclaw", "/__openclaw/"] as const;
const CONTROL_UI_ASSETS_MISSING_MESSAGE =
  "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.";
const CONTROL_UI_TOP_LEVEL_ASSET_FILENAMES = new Set([
  "apple-touch-icon.png",
  "cosmic-bg.png",
  "favicon-32.png",
  "favicon.ico",
  "favicon.svg",
  "openbot-logo.png",
  "trial-apply-product-ui.jpg",
]);

export type ControlUiRequestOptions = {
  basePath?: string;
  config?: OpenBotConfig;
  agentId?: string;
  root?: ControlUiRootState;
  resolvedAuth?: ResolvedGatewayAuth;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
};

export type ControlUiRootState =
  | { kind: "bundled"; path: string }
  | { kind: "resolved"; path: string }
  | { kind: "invalid"; path: string }
  | { kind: "missing" };

function contentTypeForExt(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/**
 * Extensions recognised as static assets.  Missing files with these extensions
 * return 404 instead of the SPA index.html fallback.  `.html` is intentionally
 * excluded — actual HTML files on disk are served earlier, and missing `.html`
 * paths should fall through to the SPA router (client-side routers may use
 * `.html`-suffixed routes).
 */
const STATIC_ASSET_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".txt",
]);

export type ControlUiAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

type ControlUiAvatarMeta = {
  avatarUrl: string | null;
};

function applyControlUiSecurityHeaders(res: ServerResponse) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", buildControlUiCspHeader());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(body));
}

function respondControlUiAssetsUnavailable(
  res: ServerResponse,
  options?: { configuredRootPath?: string },
) {
  if (options?.configuredRootPath) {
    respondPlainText(
      res,
      503,
      `Control UI assets not found at ${options.configuredRootPath}. Build them with \`pnpm ui:build\` (auto-installs UI deps), or update gateway.controlUi.root.`,
    );
    return;
  }
  respondPlainText(res, 503, CONTROL_UI_ASSETS_MISSING_MESSAGE);
}

function respondHeadForFile(req: IncomingMessage, res: ServerResponse, filePath: string): boolean {
  if (req.method !== "HEAD") {
    return false;
  }
  res.statusCode = 200;
  setStaticFileHeaders(res, filePath);
  res.end();
  return true;
}

function isValidAgentId(agentId: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(agentId);
}

export function handleControlUiAvatarRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { basePath?: string; resolveAvatar: (agentId: string) => ControlUiAvatarResolution },
): boolean {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  if (!isReadHttpMethod(req.method)) {
    return false;
  }

  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts.basePath);
  const pathname = url.pathname;
  const pathWithBase = basePath
    ? `${basePath}${CONTROL_UI_AVATAR_PREFIX}/`
    : `${CONTROL_UI_AVATAR_PREFIX}/`;
  if (!pathname.startsWith(pathWithBase)) {
    return false;
  }

  applyControlUiSecurityHeaders(res);

  const agentIdParts = pathname.slice(pathWithBase.length).split("/").filter(Boolean);
  const agentId = agentIdParts[0] ?? "";
  if (agentIdParts.length !== 1 || !agentId || !isValidAgentId(agentId)) {
    respondControlUiNotFound(res);
    return true;
  }

  if (url.searchParams.get("meta") === "1") {
    const resolved = opts.resolveAvatar(agentId);
    const avatarUrl =
      resolved.kind === "local"
        ? buildControlUiAvatarUrl(basePath, agentId)
        : resolved.kind === "remote" || resolved.kind === "data"
          ? resolved.url
          : null;
    sendJson(res, 200, { avatarUrl } satisfies ControlUiAvatarMeta);
    return true;
  }

  const resolved = opts.resolveAvatar(agentId);
  if (resolved.kind !== "local") {
    respondControlUiNotFound(res);
    return true;
  }

  const safeAvatar = resolveSafeAvatarFile(resolved.filePath);
  if (!safeAvatar) {
    respondControlUiNotFound(res);
    return true;
  }
  try {
    if (respondHeadForFile(req, res, safeAvatar.path)) {
      return true;
    }

    serveResolvedFile(
      res,
      safeAvatar.path,
      fs.readFileSync(safeAvatar.fd),
      req.headers?.["accept-encoding"],
    );
    return true;
  } finally {
    fs.closeSync(safeAvatar.fd);
  }
}

// Vite emits content-hashed asset filenames (e.g. `index-BnCxdOS4.js`,
// `zh-CN-6uBRhIJX.js`) under `assets/`. Because the hash changes whenever the
// file content changes, those URLs are safe to cache indefinitely. Everything
// else (index.html, favicons, unhashed top-level assets like cosmic-bg.png)
// keeps `no-cache` so UI/config updates land on the next load.
const HASHED_ASSET_BASENAME_RE = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

// Text assets worth gzipping on the wire. The main UI bundle is several MB
// uncompressed, which stalls easily over flaky proxies; gzip cuts it ~4x.
const COMPRESSIBLE_ASSET_EXTENSIONS = new Set([".js", ".css", ".json", ".svg", ".txt"]);
const MIN_COMPRESSIBLE_BYTES = 1024;

// Cache gzip output for immutable (content-hashed) assets so each file is
// compressed at most once instead of on every cold client fetch.
const immutableGzipCache = new Map<string, Buffer>();

function isImmutableHashedAsset(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.includes("/assets/")) {
    return false;
  }
  return HASHED_ASSET_BASENAME_RE.test(path.basename(normalized));
}

function acceptsGzip(acceptEncoding: string | string[] | undefined): boolean {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : (acceptEncoding ?? "");
  return /(^|,)\s*gzip\b/i.test(header);
}

function setStaticFileHeaders(res: ServerResponse, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", contentTypeForExt(ext));
  if (isImmutableHashedAsset(filePath)) {
    // Content-hashed filenames never change in place, so cache for a year and
    // avoid re-downloading the multi-MB bundle on every page load.
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    // Unhashed files must revalidate so UI/config updates take effect promptly.
    res.setHeader("Cache-Control", "no-cache");
  }
}

function serveResolvedFile(
  res: ServerResponse,
  filePath: string,
  body: Buffer,
  acceptEncoding?: string | string[],
) {
  setStaticFileHeaders(res, filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (COMPRESSIBLE_ASSET_EXTENSIONS.has(ext) && body.byteLength >= MIN_COMPRESSIBLE_BYTES) {
    // Content varies by negotiated encoding; keep caches from mixing variants.
    res.setHeader("Vary", "Accept-Encoding");
    if (acceptsGzip(acceptEncoding)) {
      const immutable = isImmutableHashedAsset(filePath);
      let compressed = immutable ? immutableGzipCache.get(filePath) : undefined;
      if (!compressed) {
        compressed = zlib.gzipSync(body);
        if (immutable) {
          immutableGzipCache.set(filePath, compressed);
        }
      }
      res.setHeader("Content-Encoding", "gzip");
      res.end(compressed);
      return;
    }
  }
  res.end(body);
}

function serveResolvedIndexHtml(res: ServerResponse, body: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(sanitizeControlUiIndexHtml(body));
}

function resolveControlUiRelativePath(uiPath: string): string {
  if (uiPath === ROOT_PREFIX) {
    return "";
  }
  const assetsIndex = uiPath.indexOf("/assets/");
  if (assetsIndex >= 0) {
    return uiPath.slice(assetsIndex + 1);
  }
  const filename = uiPath.slice(uiPath.lastIndexOf("/") + 1);
  if (CONTROL_UI_TOP_LEVEL_ASSET_FILENAMES.has(filename)) {
    return filename;
  }
  return uiPath.slice(1);
}

function isExpectedSafePathError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP";
}

function resolveSafeAvatarFile(filePath: string): { path: string; fd: number } | null {
  const opened = openVerifiedFileSync({
    filePath,
    rejectPathSymlink: true,
    maxBytes: AVATAR_MAX_BYTES,
  });
  if (!opened.ok) {
    return null;
  }
  return { path: opened.path, fd: opened.fd };
}

function resolveSafeControlUiFile(
  rootReal: string,
  filePath: string,
  rejectHardlinks: boolean,
): { path: string; fd: number } | null {
  const opened = openBoundaryFileSync({
    absolutePath: filePath,
    rootPath: rootReal,
    rootRealPath: rootReal,
    boundaryLabel: "control ui root",
    skipLexicalRootCheck: true,
    rejectHardlinks,
  });
  if (!opened.ok) {
    if (opened.reason === "io") {
      throw opened.error;
    }
    return null;
  }
  return { path: opened.path, fd: opened.fd };
}

function isSafeRelativePath(relPath: string) {
  if (!relPath) {
    return false;
  }
  const normalized = path.posix.normalize(relPath);
  if (path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return false;
  }
  if (normalized.startsWith("../") || normalized === "..") {
    return false;
  }
  if (normalized.includes("\0")) {
    return false;
  }
  return true;
}

export async function handleControlUiHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts?: ControlUiRequestOptions,
): Promise<boolean> {
  const urlRaw = req.url;
  if (!urlRaw) {
    return false;
  }
  const url = new URL(urlRaw, "http://localhost");
  const basePath = normalizeControlUiBasePath(opts?.basePath);
  const pathname = url.pathname;
  const route = classifyControlUiRequest({
    basePath,
    pathname,
    search: url.search,
    method: req.method,
  });
  if (route.kind === "not-control-ui") {
    return false;
  }
  if (route.kind === "not-found") {
    applyControlUiSecurityHeaders(res);
    respondControlUiNotFound(res);
    return true;
  }
  if (route.kind === "redirect") {
    applyControlUiSecurityHeaders(res);
    res.statusCode = 302;
    res.setHeader("Location", route.location);
    res.end();
    return true;
  }

  applyControlUiSecurityHeaders(res);

  const localDirect = isLocalDirectRequest(
    req,
    opts?.trustedProxies,
    opts?.allowRealIpFallback === true,
  );

  if (
    await handleControlUiPlatformAuthRequest(req, res, {
      basePath,
      trustedProxy: opts?.resolvedAuth?.trustedProxy,
      localDirect,
    })
  ) {
    return true;
  }

  if (
    await handleEnterpriseSeatAssetsHttpRequest(req, res, {
      basePath,
      trustedProxy: opts?.resolvedAuth?.trustedProxy,
      localDirect,
    })
  ) {
    return true;
  }

  if (
    await handleEnterpriseDataConnectorOAuthHttpRequest(req, res, {
      basePath,
    })
  ) {
    return true;
  }

  if (
    await handleEnterpriseOperationalIdentityHttpRequest(req, res, {
      basePath,
      trustedProxy: opts?.resolvedAuth?.trustedProxy,
      localDirect,
    })
  ) {
    return true;
  }

  if (
    await handleUserOperationalIdentityHttpRequest(req, res, {
      basePath,
      trustedProxy: opts?.resolvedAuth?.trustedProxy,
      localDirect,
    })
  ) {
    return true;
  }

  if (pathname === resolveControlUiBootstrapConfigPath(basePath)) {
    const config = opts?.config;
    const identity = config
      ? resolveAssistantIdentity({ cfg: config, agentId: opts?.agentId })
      : DEFAULT_ASSISTANT_IDENTITY;
    const avatarValue = resolveAssistantAvatarUrl({
      avatar: identity.avatar,
      agentId: identity.agentId,
      basePath,
    });
    const browserAuthMode = opts?.resolvedAuth
      ? resolveControlUiBrowserAuthMode(opts.resolvedAuth)
      : (config?.gateway?.auth?.mode ?? undefined);
    const authSession = await (async (): Promise<ControlUiTrustedProxySession | undefined> => {
      if (!opts?.resolvedAuth || browserAuthMode !== "trusted-proxy") {
        return undefined;
      }
      const authResult = await authorizeHttpGatewayConnect({
        auth: opts.resolvedAuth,
        connectAuth: null,
        req,
        trustedProxies: opts.trustedProxies,
        allowRealIpFallback: opts.allowRealIpFallback === true,
      });
      if (!authResult.ok || authResult.method !== "trusted-proxy" || !authResult.trustedProxy) {
        return undefined;
      }
      return authResult.trustedProxy;
    })();
    const platformAuth = await (async (): Promise<ControlUiPlatformAuthState | undefined> => {
      return resolveControlUiPlatformAuthState({
        req,
        trustedProxy: opts?.resolvedAuth?.trustedProxy,
        localDirect,
      });
    })();
    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.end();
      return true;
    }
    const dataMode = resolveDataMode(config ?? undefined);
    const dataSpaceDisplayRoot =
      dataMode === "managed" ? undefined : shortenHomePath(resolveDataRoot(config ?? undefined));
    sendJson(res, 200, {
      basePath,
      assistantName: identity.name,
      assistantAvatar: avatarValue ?? identity.avatar,
      assistantAgentId: identity.agentId,
      serverVersion: resolveRuntimeServiceVersion(process.env),
      authMode: browserAuthMode ?? opts?.resolvedAuth?.mode ?? config?.gateway?.auth?.mode,
      authSession,
      platformAuth,
      platformModels: {
        mode: resolvePlatformModelsConfig(config ?? {}).mode,
      },
      workspaceHost: {
        platform: process.platform,
        homedir: os.homedir(),
        supportsNativeDirectoryChooser: process.platform === "darwin",
      },
      dataSpace: {
        mode: dataMode,
        ...(dataSpaceDisplayRoot ? { displayRoot: dataSpaceDisplayRoot } : {}),
      },
    } satisfies ControlUiBootstrapConfig);
    return true;
  }

  const rootState = opts?.root;
  if (rootState?.kind === "invalid") {
    respondControlUiAssetsUnavailable(res, { configuredRootPath: rootState.path });
    return true;
  }

  const root =
    rootState?.kind === "resolved" || rootState?.kind === "bundled"
      ? rootState.path
      : resolveControlUiRootSync({
          moduleUrl: import.meta.url,
          argv1: process.argv[1],
          cwd: process.cwd(),
        });
  if (!root) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const rootReal = (() => {
    try {
      return fs.realpathSync(root);
    } catch (error) {
      if (isExpectedSafePathError(error)) {
        return null;
      }
      throw error;
    }
  })();
  if (!rootReal) {
    respondControlUiAssetsUnavailable(res);
    return true;
  }

  const uiPath =
    basePath && pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : pathname;
  if (
    LEGACY_CONTROL_UI_RESERVED_PREFIXES.some(
      (prefix) => uiPath === prefix || uiPath.startsWith(prefix),
    )
  ) {
    respondControlUiNotFound(res);
    return true;
  }
  const rel = resolveControlUiRelativePath(uiPath);
  const requested = rel && !rel.endsWith("/") ? rel : `${rel}index.html`;
  const fileRel = requested || "index.html";
  if (!isSafeRelativePath(fileRel)) {
    respondControlUiNotFound(res);
    return true;
  }
  if (isRetiredControlUiAsset(fileRel)) {
    respondPlainText(res, 410, "Gone");
    return true;
  }

  const filePath = path.resolve(root, fileRel);
  if (!isWithinDir(root, filePath)) {
    respondControlUiNotFound(res);
    return true;
  }

  const isBundledRoot =
    rootState?.kind === "bundled" ||
    (rootState === undefined &&
      isPackageProvenControlUiRootSync(root, {
        moduleUrl: import.meta.url,
        argv1: process.argv[1],
        cwd: process.cwd(),
      }));
  const rejectHardlinks = !isBundledRoot;
  const safeFile = resolveSafeControlUiFile(rootReal, filePath, rejectHardlinks);
  if (safeFile) {
    try {
      if (respondHeadForFile(req, res, safeFile.path)) {
        return true;
      }
      if (path.basename(safeFile.path) === "index.html") {
        serveResolvedIndexHtml(res, fs.readFileSync(safeFile.fd, "utf8"));
        return true;
      }
      serveResolvedFile(
        res,
        safeFile.path,
        fs.readFileSync(safeFile.fd),
        req.headers?.["accept-encoding"],
      );
      return true;
    } finally {
      fs.closeSync(safeFile.fd);
    }
  }

  // If the requested path looks like a static asset (known extension), return
  // 404 rather than falling through to the SPA index.html fallback.  We check
  // against the same set of extensions that contentTypeForExt() recognises so
  // that dotted SPA routes (e.g. /user/jane.doe, /v2.0) still get the
  // client-side router fallback.
  if (STATIC_ASSET_EXTENSIONS.has(path.extname(fileRel).toLowerCase())) {
    respondControlUiNotFound(res);
    return true;
  }

  // SPA fallback (client-side router): serve index.html for unknown paths.
  const indexPath = path.join(root, "index.html");
  const safeIndex = resolveSafeControlUiFile(rootReal, indexPath, rejectHardlinks);
  if (safeIndex) {
    try {
      if (respondHeadForFile(req, res, safeIndex.path)) {
        return true;
      }
      serveResolvedIndexHtml(res, fs.readFileSync(safeIndex.fd, "utf8"));
      return true;
    } finally {
      fs.closeSync(safeIndex.fd);
    }
  }

  respondControlUiNotFound(res);
  return true;
}
