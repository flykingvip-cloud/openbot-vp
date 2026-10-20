/**
 * supervisor-setup-readiness.ts — employee「环境准备」检查项聚合与表格行构建。
 */

import type { GatewayBrowserClient } from "../gateway.ts";
import { GatewayRequestError } from "../gateway.ts";
import {
  formatWorkerHealthSummary,
  formatSupervisorWorkerLabel,
  isLocalIdeSupervisorWorker,
  LOCAL_IDE_SUPERVISOR_WORKER_IDS,
  type SupervisorNodeSeatBinding,
  type SupervisorNodeBindingRequest,
  type SupervisorNodeSessionSummary,
  type SupervisorWorkerHealthRow,
} from "./supervisor-types.ts";

export const SUPERVISOR_SETUP_CHANGED = "supervisor-setup-changed";

export type SupervisorSetupCategory =
  | "运行环境"
  | "CLI"
  | "控制面"
  | "落点"
  | "本机 IDE"
  | "企业共享";

export type SupervisorSetupBandId = "control-plane" | "node" | "local-ide" | "enterprise-shared";

export type SupervisorSetupBand = {
  id: SupervisorSetupBandId;
  title: string;
  rows: SupervisorSetupReadinessRow[];
};

export type SupervisorHeaderReadiness =
  | {
      mode: "disabled";
      label: "监督子系统未启用";
      cta: { kind: "enable"; label: string };
      primaryGapId: "supervisor-enabled";
    }
  | {
      mode: "ready";
      label: "可监督";
      cta: { kind: "create"; label: string };
      primaryGapId: null;
    }
  | {
      mode: "draft-only";
      label: "可建草稿但会立刻升级";
      cta: { kind: "fix-gap"; label: string; gapId: string };
      primaryGapId: string;
    };

export type SupervisorSetupReadinessRow = {
  id: string;
  category: SupervisorSetupCategory;
  check: string;
  ready: boolean;
  status: string;
  detail: string;
};

export type SupervisorSetupReadinessSnapshot = {
  rows: SupervisorSetupReadinessRow[];
  loading: boolean;
  error: string | null;
};

import { SUPERVISOR_API_KEY_CLI_BACKENDS } from "./supervisor-api-key-backends.ts";

export function summarizeSetupReadiness(rows: SupervisorSetupReadinessRow[]): {
  ready: number;
  total: number;
  allReady: boolean;
} {
  const total = rows.length;
  const ready = rows.filter((row) => row.ready).length;
  return { ready, total, allReady: total > 0 && ready === total };
}

export function buildNodeEnvironmentRows(input: {
  supervisorAvailable: boolean;
  seatId: string;
  binding: SupervisorNodeSeatBinding | null;
  bindingRequests?: SupervisorNodeBindingRequest[];
  nodes: SupervisorNodeSessionSummary[];
  ideHealth: SupervisorWorkerHealthRow[];
}): SupervisorSetupReadinessRow[] {
  const rows: SupervisorSetupReadinessRow[] = [
    {
      id: "supervisor-enabled",
      category: "控制面",
      check: "监督子系统",
      ready: input.supervisorAvailable,
      status: input.supervisorAvailable ? "就绪" : "未启用",
      detail: input.supervisorAvailable
        ? "Gateway 已响应 supervisor API"
        : "请启用 gateway.supervisor 并重启 Gateway",
    },
  ];

  if (!input.seatId.trim()) {
    return rows;
  }

  const bound = Boolean(input.binding?.nodeId);
  const pendingRequest = input.bindingRequests?.find((request) => request.status === "pending");
  const boundNode = bound
    ? (input.nodes.find((node) => node.nodeId === input.binding?.nodeId) ?? null)
    : null;
  const boundOnline = Boolean(boundNode);
  const nodeReady = boundOnline && (boundNode?.supportsSupervisorWorker ?? false);

  rows.push(
    {
      id: "node-bound",
      category: "落点",
      check: "Node 绑定",
      ready: bound,
      status: bound ? "就绪" : pendingRequest ? "待确认" : "待处理",
      detail: bound
        ? `已绑定 ${input.binding?.nodeId ?? "—"}`
        : pendingRequest
          ? "已发送连接申请，等待企业管理员确认"
          : "见下方「本机 Node」发起连接申请",
    },
    {
      id: "node-online",
      category: "落点",
      check: "Node 在线",
      ready: nodeReady,
      status: nodeReady ? "就绪" : "待处理",
      detail: nodeReady
        ? "Node 已连接并支持监督 Worker"
        : bound
          ? "见下方「本机 Node」：确认 Mac 以 Node 模式在线"
          : "先完成 Node 绑定",
    },
  );

  return rows;
}

export function buildLocalIdeCliRows(
  workers: SupervisorWorkerHealthRow[],
): SupervisorSetupReadinessRow[] {
  const byId = new Map(workers.map((row) => [row.backendId, row]));
  return LOCAL_IDE_SUPERVISOR_WORKER_IDS.map((backendId) => {
    const health = byId.get(backendId);
    const ready = Boolean(health?.auth.authenticated);
    const status = ready ? "就绪" : health?.auth.installed ? "待登录" : "待探测";
    const detail = health
      ? formatWorkerHealthSummary(health)
      : "绑定 Node 并保持在线后可探测；Gateway 与本机同机时 grok-cli 可自动探测";
    return {
      id: `local-ide-${backendId}`,
      category: "本机 IDE",
      check: `${formatSupervisorWorkerLabel(backendId)}（本机登录）`,
      ready,
      status,
      detail,
    };
  });
}

export function buildApiKeyCliRows(
  workers: SupervisorWorkerHealthRow[],
  configuredBackendIds: Set<string>,
): SupervisorSetupReadinessRow[] {
  const byId = new Map(workers.map((row) => [row.backendId, row]));
  return SUPERVISOR_API_KEY_CLI_BACKENDS.map(({ backendId, defaultEnv, label }) => {
    const health = byId.get(backendId);
    const configured = configuredBackendIds.has(backendId);
    const ready = Boolean(health?.auth.authenticated) || configured;
    const status = health?.auth.authenticated ? "就绪" : configured ? "已配置" : "待配置";
    const detail = health
      ? formatWorkerHealthSummary(health)
      : configured
        ? "个人凭证已保存，待校验"
        : `在下方表单保存 ${defaultEnv}`;
    return {
      id: `api-key-${backendId}`,
      category: "企业共享",
      check: `${label} (${defaultEnv})`,
      ready,
      status,
      detail,
    };
  });
}

export async function loadSupervisorSetupReadiness(
  client: GatewayBrowserClient,
  opts: { tenantId: string; seatId?: string },
): Promise<SupervisorSetupReadinessRow[]> {
  const tenantId = opts.tenantId.trim();
  const seatId = opts.seatId?.trim() ?? "";
  if (!tenantId) {
    return [];
  }

  let supervisorAvailable = true;
  let nodes: SupervisorNodeSessionSummary[] = [];
  let binding: SupervisorNodeSeatBinding | null = null;
  let bindingRequests: SupervisorNodeBindingRequest[] = [];
  let workers: SupervisorWorkerHealthRow[] = [];
  let configuredBackendIds = new Set<string>();

  try {
    const credentialPromise = client.request<{ credentials: Array<{ backendId: string }> }>(
      "cliBackend.credential.scopedList",
      {},
    );

    const supervisorPromise = (async () => {
      try {
        const healthParams: Record<string, string> = { tenantId };
        if (seatId) {
          healthParams.seatId = seatId;
        }
        const [nodeResult, bindingResult, requestResult, healthResult] = await Promise.all([
          client.request<{ nodes: SupervisorNodeSessionSummary[] }>("supervisor.node.list", {}),
          seatId
            ? client.request<{ bindings: SupervisorNodeSeatBinding[] }>(
                "supervisor.node.bindings.list",
                { tenantId },
              )
            : Promise.resolve({ bindings: [] as SupervisorNodeSeatBinding[] }),
          seatId
            ? client.request<{ requests: SupervisorNodeBindingRequest[] }>(
                "supervisor.node.bindingRequest.list",
                { tenantId, seatId },
              )
            : Promise.resolve({ requests: [] as SupervisorNodeBindingRequest[] }),
          client.request<{ workers: SupervisorWorkerHealthRow[] }>(
            "supervisor.worker.health",
            healthParams,
          ),
        ]);
        nodes = nodeResult.nodes ?? [];
        binding = (bindingResult.bindings ?? []).find((entry) => entry.seatId === seatId) ?? null;
        bindingRequests = requestResult.requests ?? [];
        workers = healthResult.workers ?? [];
      } catch (err) {
        if (err instanceof GatewayRequestError && err.gatewayCode === "UNAVAILABLE") {
          supervisorAvailable = false;
          workers = [];
          nodes = [];
          binding = null;
          bindingRequests = [];
        } else {
          throw err;
        }
      }
    })();

    const [credentialResult] = await Promise.all([credentialPromise, supervisorPromise]);
    configuredBackendIds = new Set(
      (credentialResult.credentials ?? []).map((cred) => cred.backendId),
    );
  } catch {
    supervisorAvailable = false;
  }

  const envRows = buildNodeEnvironmentRows({
    supervisorAvailable,
    seatId,
    binding,
    bindingRequests,
    nodes,
    ideHealth: workers.filter((row) => isLocalIdeSupervisorWorker(row.backendId)),
  });
  const localIdeRows = buildLocalIdeCliRows(
    workers.filter((row) => isLocalIdeSupervisorWorker(row.backendId)),
  );
  const apiRows = buildApiKeyCliRows(workers, configuredBackendIds);
  return [...envRows, ...localIdeRows, ...apiRows];
}

export function groupSetupReadinessBands(
  rows: SupervisorSetupReadinessRow[],
): SupervisorSetupBand[] {
  const bands: SupervisorSetupBand[] = [
    { id: "control-plane", title: "控制面", rows: [] },
    { id: "node", title: "落点 · Node", rows: [] },
    { id: "local-ide", title: "本机 IDE Worker", rows: [] },
    { id: "enterprise-shared", title: "企业共享 Worker", rows: [] },
  ];
  const byId = new Map(bands.map((band) => [band.id, band]));
  for (const row of rows) {
    if (row.id === "supervisor-enabled") {
      byId.get("control-plane")!.rows.push(row);
    } else if (row.id === "node-bound" || row.id === "node-online") {
      byId.get("node")!.rows.push(row);
    } else if (row.id.startsWith("local-ide-")) {
      byId.get("local-ide")!.rows.push(row);
    } else if (row.id.startsWith("api-key-")) {
      byId.get("enterprise-shared")!.rows.push(row);
    } else if (row.category === "控制面") {
      byId.get("control-plane")!.rows.push(row);
    } else if (row.category === "落点") {
      byId.get("node")!.rows.push(row);
    } else if (row.category === "本机 IDE") {
      byId.get("local-ide")!.rows.push(row);
    } else {
      byId.get("enterprise-shared")!.rows.push(row);
    }
  }
  return bands.filter((band) => band.rows.length > 0);
}

/** Prefer the first actionable gap for CTA anchoring (Node before login before key). */
export function resolvePrimarySetupGap(
  rows: SupervisorSetupReadinessRow[],
): SupervisorSetupReadinessRow | null {
  const priority = [
    "supervisor-enabled",
    "node-bound",
    "node-online",
    ...rows.filter((row) => row.id.startsWith("local-ide-")).map((row) => row.id),
    ...rows.filter((row) => row.id.startsWith("api-key-")).map((row) => row.id),
  ];
  const pending = new Map(rows.filter((row) => !row.ready).map((row) => [row.id, row]));
  for (const id of priority) {
    const hit = pending.get(id);
    if (hit) {
      return hit;
    }
  }
  return rows.find((row) => !row.ready) ?? null;
}

/**
 * P0-4 / plan §4 A header readiness:
 * - disabled: gate off
 * - ready: **currently selected / default worker's** execution chain is green
 *   (not "any worker green" — Devin/Kiro green must not imply Cursor is runnable)
 * - draft-only: control plane on but that worker's chain is incomplete
 */
export function resolveSupervisorHeaderReadiness(
  rows: SupervisorSetupReadinessRow[],
  opts?: { selectedWorkerId?: string | null },
): SupervisorHeaderReadiness {
  const supervisor = rows.find((row) => row.id === "supervisor-enabled");
  if (supervisor && !supervisor.ready) {
    return {
      mode: "disabled",
      label: "监督子系统未启用",
      cta: { kind: "enable", label: "查看启用说明" },
      primaryGapId: "supervisor-enabled",
    };
  }

  const workerId = opts?.selectedWorkerId?.trim().toLowerCase() || null;
  const nodeBound = rows.find((row) => row.id === "node-bound");
  const nodeOnline = rows.find((row) => row.id === "node-online");

  const draftOnly = (gapId: string): SupervisorHeaderReadiness => {
    let ctaLabel = "去完成执行链";
    if (gapId === "node-bound" || gapId === "node-online") {
      ctaLabel = "去上线 Node";
    } else if (gapId.startsWith("local-ide-")) {
      ctaLabel = "去登录本机 IDE";
    } else if (gapId.startsWith("api-key-")) {
      ctaLabel = "去配置企业 Key";
    }
    return {
      mode: "draft-only",
      label: "可建草稿但会立刻升级",
      cta: { kind: "fix-gap", label: ctaLabel, gapId },
      primaryGapId: gapId,
    };
  };

  if (workerId) {
    const localRow = rows.find((row) => row.id === `local-ide-${workerId}`);
    const apiRow = rows.find((row) => row.id === `api-key-${workerId}`);

    if (localRow) {
      // Selected local_ide / node_agent worker: need Node + that worker's login.
      if (!nodeBound?.ready) {
        return draftOnly("node-bound");
      }
      if (!nodeOnline?.ready) {
        return draftOnly("node-online");
      }
      if (!localRow.ready) {
        return draftOnly(localRow.id);
      }
      return {
        mode: "ready",
        label: "可监督",
        cta: { kind: "create", label: "新建监督任务" },
        primaryGapId: null,
      };
    }

    if (apiRow) {
      // Selected gateway worker: only that worker's key (Node not required).
      if (!apiRow.ready) {
        return draftOnly(apiRow.id);
      }
      return {
        mode: "ready",
        label: "可监督",
        cta: { kind: "create", label: "新建监督任务" },
        primaryGapId: null,
      };
    }

    // Unknown worker id — fall through to primary gap rather than claiming ready.
    const gap = resolvePrimarySetupGap(rows);
    return draftOnly(gap?.id ?? "node-online");
  }

  // No selected/default worker yet: never claim 可监督 from an unrelated green worker.
  const gap = resolvePrimarySetupGap(rows);
  return draftOnly(gap?.id ?? "node-online");
}
