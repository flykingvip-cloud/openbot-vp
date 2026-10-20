import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findAgentEntryIndex, listAgentEntries } from "../../commands/agents.config.js";
import { loadConfig } from "../../config/config.js";
import { isManagedDataMode } from "../../config/data-space.js";
import { execFileUtf8 } from "../../daemon/exec-file.js";
import { resolveUserPath } from "../../utils.js";
import { getCloudProviderAdapter } from "../../workspaces/cloud.js";
import {
  createWorkspaceRecord,
  ensureWorkspaceRuntimeDir,
  getWorkspaceById,
  saveWorkspaceCredential,
  bindRobotWorkspace,
} from "../../workspaces/store.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateRobotsBindWorkspaceParams,
  validateWorkspaceCloudBrowseParams,
  validateWorkspaceCloudGenerateConfigParams,
  validateWorkspaceCloudTestConnectionParams,
  validateWorkspaceLocalBrowseParams,
  validateWorkspaceLocalChooseParams,
  validateWorkspaceLocalValidateParams,
  validateWorkspacesCreateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

/**
 * SaaS/managed gateways must never expose the host filesystem to the workspace UI
 * (product spec §9, acceptance P1-BEH-05). When `data.mode === "managed"`, hard-reject
 * local directory RPCs with a LOCAL_ONLY error. These methods remain available on a
 * local gateway for CLI/doctor use.
 *
 * Returns true when the request was rejected (caller must return immediately).
 */
function rejectLocalWorkspaceRpcWhenManaged(method: string, respond: RespondFn): boolean {
  if (!isManagedDataMode(loadConfig())) {
    return false;
  }
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.LOCAL_ONLY,
      `${method} is unavailable on managed (SaaS) OpenBot; your data is hosted by the platform.`,
    ),
  );
  return true;
}

async function listBrowsableDirectories(currentPath: string) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .toSorted((left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    )
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
    }));
}

async function validateLocalWorkspace(rawPath: string) {
  const resolvedPath = resolveUserPath(rawPath);
  try {
    const stat = await fs.stat(resolvedPath);
    const isDirectory = stat.isDirectory();
    const [readable, writable] = await Promise.all([
      fs
        .access(resolvedPath, fsConstants.R_OK)
        .then(() => true)
        .catch(() => false),
      fs
        .access(resolvedPath, fsConstants.W_OK)
        .then(() => true)
        .catch(() => false),
    ]);
    return {
      ok: isDirectory && readable && writable,
      resolvedPath,
      isDirectory,
      readable,
      writable,
      ...(isDirectory
        ? {}
        : {
            errorCode: "NOT_DIRECTORY",
            message: "该路径不是目录。",
          }),
      ...(!readable
        ? {
            errorCode: "READ_DENIED",
            message: "当前目录不可读。",
          }
        : {}),
      ...(!writable
        ? {
            errorCode: "WRITE_DENIED",
            message: "当前目录不可写。",
          }
        : {}),
    };
  } catch (error) {
    return {
      ok: false,
      resolvedPath,
      isDirectory: false,
      readable: false,
      writable: false,
      errorCode: "NOT_FOUND",
      message: error instanceof Error ? error.message : "路径不存在。",
    };
  }
}

async function ensureLocalWorkspace(rawPath: string) {
  const initial = await validateLocalWorkspace(rawPath);
  if (initial.ok || initial.errorCode !== "NOT_FOUND") {
    return initial;
  }
  const resolvedPath = resolveUserPath(rawPath);
  let ancestorPath = path.dirname(resolvedPath);
  while (ancestorPath && ancestorPath !== path.dirname(ancestorPath)) {
    const ancestorValidation = await validateLocalWorkspace(ancestorPath);
    if (ancestorValidation.ok) {
      await fs.mkdir(resolvedPath, { recursive: true });
      return validateLocalWorkspace(resolvedPath);
    }
    if (ancestorValidation.errorCode !== "NOT_FOUND") {
      return initial;
    }
    ancestorPath = path.dirname(ancestorPath);
  }
  const rootValidation = await validateLocalWorkspace(ancestorPath);
  if (!rootValidation.ok) {
    return initial;
  }
  await fs.mkdir(resolvedPath, { recursive: true });
  return validateLocalWorkspace(resolvedPath);
}

async function resolveDirectoryChooserStartPath(rawPath: string | undefined) {
  if (!rawPath?.trim()) {
    return os.homedir();
  }
  let candidatePath = resolveUserPath(rawPath);
  while (candidatePath && candidatePath !== path.dirname(candidatePath)) {
    try {
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        return candidatePath;
      }
    } catch {
      // Keep walking upward until we find an existing directory.
    }
    candidatePath = path.dirname(candidatePath);
  }
  return os.homedir();
}

async function chooseLocalDirectory(params: { path?: string; title?: string }) {
  if (process.platform !== "darwin") {
    return {
      cancelled: true,
      message: "当前平台暂不支持系统目录选择器，请使用目录浏览或手动配置路径。",
    };
  }
  const initialPath = await resolveDirectoryChooserStartPath(params.path);
  const title = (params.title?.trim() || "选择工作区目录").replace(/"/g, '\\"');
  const script = `
set promptText to "${title}"
set defaultLocation to POSIX file "${initialPath.replace(/"/g, '\\"')}"
try
  set chosenFolder to choose folder with prompt promptText default location defaultLocation
  POSIX path of chosenFolder
on error number -128
  ""
end try
`;
  const result = await execFileUtf8("/usr/bin/osascript", ["-e", script], {
    timeout: 120_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || "无法打开系统目录选择器。");
  }
  const selectedPath = result.stdout.trim().replace(/\/$/, "");
  if (!selectedPath) {
    return { cancelled: true };
  }
  return { cancelled: false, path: selectedPath };
}

export const workspaceHandlers: GatewayRequestHandlers = {
  "workspaces.local.validate": async ({ params, respond }) => {
    if (rejectLocalWorkspaceRpcWhenManaged("workspaces.local.validate", respond)) {
      return;
    }
    if (!validateWorkspaceLocalValidateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.local.validate params: ${formatValidationErrors(
            validateWorkspaceLocalValidateParams.errors,
          )}`,
        ),
      );
      return;
    }
    const payload = await validateLocalWorkspace(String(params.path ?? ""));
    respond(true, payload, undefined);
  },
  "workspaces.local.browse": async ({ params, respond }) => {
    if (rejectLocalWorkspaceRpcWhenManaged("workspaces.local.browse", respond)) {
      return;
    }
    if (!validateWorkspaceLocalBrowseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.local.browse params: ${formatValidationErrors(
            validateWorkspaceLocalBrowseParams.errors,
          )}`,
        ),
      );
      return;
    }
    const requestedPath =
      typeof params.path === "string" && params.path.trim()
        ? resolveUserPath(params.path.trim())
        : resolveUserPath("~");
    const currentPath = await fs.realpath(requestedPath).catch(() => path.resolve(requestedPath));
    try {
      const stat = await fs.stat(currentPath);
      if (!stat.isDirectory()) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "当前路径不是目录。"));
        return;
      }
      const entries = await listBrowsableDirectories(currentPath);
      const parentPath = path.dirname(currentPath);
      respond(
        true,
        {
          currentPath,
          ...(parentPath !== currentPath ? { parentPath } : {}),
          entries,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "目录不可访问。",
        ),
      );
    }
  },
  "workspaces.local.choose": async ({ params, respond }) => {
    if (rejectLocalWorkspaceRpcWhenManaged("workspaces.local.choose", respond)) {
      return;
    }
    if (!validateWorkspaceLocalChooseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.local.choose params: ${formatValidationErrors(
            validateWorkspaceLocalChooseParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      respond(true, await chooseLocalDirectory(params), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "无法打开系统目录选择器。",
        ),
      );
    }
  },
  "workspaces.cloud.generate-config": async ({ params, respond }) => {
    if (!validateWorkspaceCloudGenerateConfigParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.cloud.generate-config params: ${formatValidationErrors(
            validateWorkspaceCloudGenerateConfigParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const adapter = getCloudProviderAdapter(params.provider);
      respond(true, adapter.generateConfig(params), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "云配置生成失败。",
        ),
      );
    }
  },
  "workspaces.cloud.test-connection": async ({ params, respond }) => {
    if (!validateWorkspaceCloudTestConnectionParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.cloud.test-connection params: ${formatValidationErrors(
            validateWorkspaceCloudTestConnectionParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const adapter = getCloudProviderAdapter(params.provider);
      respond(true, await adapter.testConnection(params), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "无法连接云服务。",
        ),
      );
    }
  },
  "workspaces.cloud.browse": async ({ params, respond }) => {
    if (!validateWorkspaceCloudBrowseParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.cloud.browse params: ${formatValidationErrors(
            validateWorkspaceCloudBrowseParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const adapter = getCloudProviderAdapter(params.provider);
      respond(true, await adapter.browse(params), undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "无法浏览云端空间。",
        ),
      );
    }
  },
  "workspaces.create": async ({ params, respond }) => {
    if (!validateWorkspacesCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid workspaces.create params: ${formatValidationErrors(validateWorkspacesCreateParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const name = String(params.name ?? "").trim();
      if (params.kind === "local") {
        // SaaS/managed: never accept client host paths. Allocate a platform runtime
        // directory under the gateway state dir (same root as cloud workspaces).
        if (isManagedDataMode(loadConfig())) {
          const runtimePath = await ensureWorkspaceRuntimeDir(`managed-${Date.now()}`);
          const workspace = await createWorkspaceRecord({
            name,
            kind: "local",
            status: "ready",
            runtimePath,
            local: {
              path: runtimePath,
              resolvedPath: runtimePath,
              readable: true,
              writable: true,
            },
            lastError: null,
          });
          respond(
            true,
            { ok: true, workspaceId: workspace.id, runtimePath: workspace.runtimePath, workspace },
            undefined,
          );
          return;
        }
        const validation = await ensureLocalWorkspace(String(params.local?.path ?? ""));
        if (!validation.ok) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, validation.message ?? "本地空间不可用。"),
          );
          return;
        }
        const workspace = await createWorkspaceRecord({
          name,
          kind: "local",
          status: "ready",
          runtimePath: validation.resolvedPath,
          local: {
            path: String(params.local?.path ?? ""),
            resolvedPath: validation.resolvedPath,
            readable: validation.readable,
            writable: validation.writable,
          },
          lastError: null,
        });
        respond(
          true,
          { ok: true, workspaceId: workspace.id, runtimePath: workspace.runtimePath, workspace },
          undefined,
        );
        return;
      }

      const cloudParams = params.cloud;
      const credentials = params.credentials;
      if (!cloudParams || !credentials) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "云端空间缺少配置或凭据。"),
        );
        return;
      }
      const adapter = getCloudProviderAdapter(cloudParams.provider);
      const config = adapter.generateConfig({
        ...cloudParams,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      });
      await adapter.testConnection({
        ...cloudParams,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      });
      const credentialRef = await saveWorkspaceCredential({
        provider: cloudParams.provider,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
      });
      const runtimePath = await ensureWorkspaceRuntimeDir(`cloud-${Date.now()}`);
      const workspace = await createWorkspaceRecord({
        name,
        kind: "cloud",
        status: "ready",
        runtimePath,
        credentialRef,
        cloud: config,
        lastError: null,
      });
      respond(
        true,
        { ok: true, workspaceId: workspace.id, runtimePath: workspace.runtimePath, workspace },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          error instanceof Error ? error.message : "创建 Workspace 失败。",
        ),
      );
    }
  },
  "robots.bind-workspace": async ({ params, respond }) => {
    if (!validateRobotsBindWorkspaceParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid robots.bind-workspace params: ${formatValidationErrors(
            validateRobotsBindWorkspaceParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentId = String(params.agentId ?? "").trim();
    if (findAgentEntryIndex(listAgentEntries(cfg), agentId) < 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown agent id"));
      return;
    }
    const workspaceId = String(params.workspaceId ?? "").trim();
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "unknown workspace id"));
      return;
    }
    await bindRobotWorkspace(agentId, workspaceId);
    respond(true, { ok: true, agentId, workspaceId }, undefined);
  },
};
