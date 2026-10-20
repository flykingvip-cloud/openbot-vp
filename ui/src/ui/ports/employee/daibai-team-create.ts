/**
 * Create the steward onboarding team through the existing employee agent stack:
 * workspaces.local.validate → workspaces.create → agents.create → robots.bind-workspace.
 * Does not open the single-agent creator wizard or switch the active session.
 */

import { adaptAppPortState } from "../../app-port-state.ts";
import type { AppViewState } from "../../app-view-state.ts";
import { AGENT_CREATE_SUPPORTS_TEMPLATE_ID } from "../../controllers/agent-growth.ts";
import { isPlatformAdminSessionKind } from "../platform/platform-auth-session.ts";
import { formatEmployeeAgentCreateError } from "./agent-create-error.ts";
import {
  countEmployeeWorkbenchNavAgents,
  EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT,
} from "./employee-workbench-nav-quota.ts";
import { reloadEmployeeWorkbenchAgents } from "./render-model-actions.ts";
import { resolveDaibaiCatalogTemplateId } from "./views/daibai-catalog-template-id.ts";
import type {
  DaibaiTeamCreatedMember,
  DaibaiTeamMemberDraft,
} from "./views/daibai-team-onboarding-model.ts";

const MANAGED_WORKSPACE_ROOT = "~/.openbot/workspace";

type AgentListEntry = {
  id: string;
  name?: string | null;
  identity?: { name?: string | null; emoji?: string | null } | null;
};

export type DaibaiTeamCreateResult = {
  created: DaibaiTeamCreatedMember[];
  error: string | null;
};

function trim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeKeySegment(value: string | null | undefined): string {
  return (trim(value) ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function hashAsciiSlug(rawName: string): string {
  let hash = 2166136261;
  for (let index = 0; index < rawName.length; index += 1) {
    hash ^= rawName.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `n${(hash >>> 0).toString(36).slice(0, 10)}`;
}

/** Same slug rules as the employee agent creator (ASCII, then readable, then hash). */
function deriveAgentSlug(rawName: string): string {
  const asciiSlug = normalizeKeySegment(rawName);
  if (asciiSlug) {
    return asciiSlug;
  }
  const readable = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return readable || hashAsciiSlug(rawName.trim().toLowerCase());
}

function joinWorkspacePath(root: string, ...segments: string[]): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  const normalizedSegments = segments
    .map((segment) => segment.trim().replace(/^[\\/]+|[\\/]+$/g, ""))
    .filter(Boolean);
  return [normalizedRoot, ...normalizedSegments].join(separator);
}

function resolveWorkspaceRoot(state: AppViewState): { managed: boolean; root: string } {
  const config =
    asRecord(state.configForm) ?? asRecord(asRecord(state.configSnapshot)?.config) ?? null;
  const dataMode = trim(asRecord(config?.data)?.mode);
  const managed = state.bootstrapDataSpace?.mode === "managed" || dataMode === "managed";
  if (managed) {
    return { managed: true, root: MANAGED_WORKSPACE_ROOT };
  }
  const defaults = asRecord(asRecord(config?.agents)?.defaults);
  return { managed: false, root: trim(defaults?.workspace) ?? "" };
}

function listAgents(state: AppViewState): AgentListEntry[] {
  return state.agentsList?.agents ?? [];
}

export async function createDaibaiTeamMembers(
  state: AppViewState,
  members: DaibaiTeamMemberDraft[],
): Promise<DaibaiTeamCreateResult> {
  if (members.length === 0) {
    return { created: [], error: "请先选择至少一位数字员工。" };
  }
  if (!state.client || !state.connected) {
    return { created: [], error: "当前未连接到网关，无法创建数字员工。" };
  }

  const platformSession = state.platformAuthState?.session ?? state.bootstrapAuthSession;
  const helloAuth = state.hello?.auth?.provider === "trusted-proxy" ? state.hello.auth : null;
  const employeeAccess = state.platformAuthState?.employeeAccess;
  const currentTenantId = trim(platformSession?.tenantId) ?? trim(helloAuth?.tenantId) ?? "";
  const currentSeatId = trim(employeeAccess?.currentSeat?.seatId) ?? "";
  const currentSeatTitle = trim(employeeAccess?.currentSeat?.title) ?? "";
  const currentUserLabel =
    trim(platformSession?.displayName) ??
    trim(helloAuth?.displayName) ??
    trim(employeeAccess?.employeeUserId) ??
    "";
  const loginUser = trim(platformSession?.user) ?? trim(helloAuth?.user) ?? "";
  const ownerScope = normalizeKeySegment(loginUser);
  const platformRole = state.platformAuthState?.platformRole;
  const bypassAgentCreateCap =
    isPlatformAdminSessionKind(state.platformAuthState?.sessionKind) ||
    platformRole === "admin" ||
    platformRole === "super-admin";

  if (currentTenantId && employeeAccess && !currentSeatId) {
    return {
      created: [],
      error: "当前账号尚未绑定企业岗位，请联系企业管理员分配岗位后再创建 AI 助手。",
    };
  }

  const existing = listAgents(state);
  let slots = EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT - countEmployeeWorkbenchNavAgents(existing);
  if (!bypassAgentCreateCap && slots <= 0) {
    return {
      created: [],
      error: `每位成员最多可创建 ${EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT} 个 AI 助手（不含大白管家）。`,
    };
  }

  const workspace = resolveWorkspaceRoot(state);
  if (!workspace.root) {
    return { created: [], error: "请先在个人设置中配置 OpenBot 工作空间根目录。" };
  }

  let resolvedRoot = workspace.root;
  if (!workspace.managed) {
    try {
      const validation = await state.client.request<{
        ok?: boolean;
        message?: string | null;
        resolvedPath?: string | null;
      } | null>("workspaces.local.validate", { path: workspace.root });
      if (!validation?.ok) {
        return {
          created: [],
          error:
            validation?.message ?? "OpenBot 工作空间根目录不可用，请先在个人设置中检查路径或权限。",
        };
      }
      resolvedRoot = trim(validation.resolvedPath) ?? workspace.root;
    } catch (error) {
      return { created: [], error: formatEmployeeAgentCreateError(error) };
    }
  }

  const knownNames = new Set(
    existing
      .flatMap((entry) => [trim(entry.name), trim(entry.identity?.name)])
      .filter((name): name is string => Boolean(name)),
  );
  const knownIds = new Set(existing.map((entry) => entry.id));
  const created: DaibaiTeamCreatedMember[] = [];
  let error: string | null = null;

  for (const member of members) {
    if (!bypassAgentCreateCap && slots <= 0) {
      error = `每位成员最多可创建 ${EMPLOYEE_WORKBENCH_AGENT_NAV_LIMIT} 个 AI 助手（不含大白管家）。`;
      break;
    }
    const name = member.name.trim();
    if (!name) {
      continue;
    }
    if (knownNames.has(name)) {
      error = `你已创建过同名机器人「${name}」，请直接复用或修改名称。`;
      continue;
    }
    const nameSlug = deriveAgentSlug(name);
    const agentId = ownerScope ? `agt-${ownerScope}-${nameSlug}` : nameSlug;
    if (knownIds.has(agentId)) {
      error = "该名称生成的机器人 ID 已被占用，请修改名称后重试。";
      continue;
    }
    try {
      const runtimePath = joinWorkspacePath(resolvedRoot, "agents", agentId);
      const createdWorkspace = await state.client.request<{
        workspaceId?: string | null;
        runtimePath?: string | null;
      } | null>("workspaces.create", {
        name: `${name} Workspace`,
        kind: "local",
        local: { path: runtimePath },
      });
      const boundPath = trim(createdWorkspace?.runtimePath) ?? runtimePath;
      const createdAgent = await state.client.request<{
        agentId?: string | null;
        name?: string | null;
      } | null>("agents.create", {
        name,
        agentId,
        workspace: boundPath,
        ...(member.emoji ? { emoji: member.emoji } : {}),
        ...(AGENT_CREATE_SUPPORTS_TEMPLATE_ID
          ? { templateId: resolveDaibaiCatalogTemplateId(member.catalogId) }
          : {}),
        ...(currentTenantId ? { tenantId: currentTenantId } : {}),
        ...(currentUserLabel ? { ownerUserLabel: currentUserLabel } : {}),
        ...(currentSeatId ? { ownerPositionId: currentSeatId } : {}),
        ...(currentSeatTitle ? { ownerPositionLabel: currentSeatTitle } : {}),
      });
      const createdAgentId = trim(createdAgent?.agentId) ?? agentId;
      const workspaceId = trim(createdWorkspace?.workspaceId);
      if (workspaceId) {
        await state.client.request("robots.bind-workspace", {
          agentId: createdAgentId,
          workspaceId,
        });
      }
      knownNames.add(name);
      knownIds.add(createdAgentId);
      created.push({
        catalogId: member.catalogId,
        agentId: createdAgentId,
        name: trim(createdAgent?.name) ?? name,
      });
      slots -= 1;
    } catch (caught) {
      error = formatEmployeeAgentCreateError(caught);
      break;
    }
  }

  if (created.length > 0) {
    try {
      await reloadEmployeeWorkbenchAgents(adaptAppPortState(state));
    } catch {
      // The gateway already created the agents; nav refresh is best-effort.
    }
    state.requestUpdate?.();
  }

  if (created.length === 0) {
    return { created, error: error ?? "当前无法创建数字员工。" };
  }
  return { created, error: created.length < members.length ? error : null };
}
