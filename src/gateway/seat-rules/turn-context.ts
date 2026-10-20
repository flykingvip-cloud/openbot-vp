/**
 * 席位规则 / exec 偏好在回合中的解析：缺 tenantId 不注入；仅绑定机器人可注入。
 * 席位规则是 guidance only，不进入 Fabric decide。
 */
import type { OpenBotConfig } from "../../config/config.js";
import {
  loadExecApprovals,
  maxAsk,
  minSecurity,
  normalizeExecAsk,
  normalizeExecHost,
  normalizeExecSecurity,
  type ExecAsk,
  type ExecHost,
  type ExecSecurity,
} from "../../infra/exec-approvals.js";
import {
  buildEmployeeAccessSnapshot,
  resolveSeatGrantedAgentAssetIds,
  type EnterpriseSeatAssetsStore,
} from "../enterprise-seat-assets-store.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { resolveOperatorComputerNode } from "../supervisor/operator-computer-binding.js";
import { projectSeatRulesForAgent } from "./injection.js";
import { compileSeatPolicyPriority, type SeatPolicyClamp } from "./priority-compiler.js";
import {
  readSeatRules,
  type SeatAiRule,
  type SeatExecPreference,
  type SeatRulesRecord,
} from "./store.js";

export type EnterpriseExecCeiling = {
  ask: ExecAsk;
  security: ExecSecurity;
  host: ExecHost;
};

const ASK_ORDER: readonly ExecAsk[] = ["off", "on-miss", "always"];
const SECURITY_ORDER: readonly ExecSecurity[] = ["deny", "allowlist", "full"];

export function resolveEnterpriseExecCeiling(cfg?: OpenBotConfig): EnterpriseExecCeiling {
  const approvals = loadExecApprovals();
  const ask =
    normalizeExecAsk(cfg?.tools?.exec?.ask) ??
    normalizeExecAsk(approvals.defaults?.ask) ??
    "on-miss";
  const security =
    normalizeExecSecurity(cfg?.tools?.exec?.security) ??
    normalizeExecSecurity(approvals.defaults?.security) ??
    "deny";
  // host 只来自 tools.exec。exec approvals defaults 只有 ask/security，没有 host。
  const host = normalizeExecHost(cfg?.tools?.exec?.host) ?? "sandbox";
  return { ask, security, host };
}

/** 员工可选 ask：只能朝 always（不低于企业天花板）。 */
export function allowedAskOptionsWithinCeiling(ceiling: ExecAsk): ExecAsk[] {
  const idx = ASK_ORDER.indexOf(ceiling);
  return ASK_ORDER.slice(idx < 0 ? 0 : idx);
}

/** 员工可选 security：只能朝 deny（不宽于企业天花板）。 */
export function allowedSecurityOptionsWithinCeiling(ceiling: ExecSecurity): ExecSecurity[] {
  const idx = SECURITY_ORDER.indexOf(ceiling);
  return SECURITY_ORDER.slice(0, (idx < 0 ? SECURITY_ORDER.length - 1 : idx) + 1);
}

/** 保存前钳制到天花板；host 等非全序字段丢弃。 */
export function clampSeatExecPreferenceToCeiling(
  preference: SeatExecPreference | null | undefined,
  ceiling: EnterpriseExecCeiling,
): SeatExecPreference {
  const next: SeatExecPreference = {};
  if (preference?.ask) {
    next.ask = maxAsk(ceiling.ask, preference.ask);
  }
  if (preference?.security) {
    next.security = minSecurity(ceiling.security, preference.security);
  }
  return next;
}

export type SeatTurnContext = {
  tenantId: string;
  seatId: string;
  agentId: string;
  bound: boolean;
  record: SeatRulesRecord | null;
  clamps: SeatPolicyClamp[];
  guidanceText: string | null;
  execPreference: SeatExecPreference | undefined;
  /** Node on the active operator seat, after aligning a same-operator binding. */
  operatorComputerNodeId?: string;
  /** True when Always Allow was previously chosen for that seat↔node Desktop path. */
  operatorComputerAlwaysAllowDesktop?: boolean;
};

function boundAgentIdsForSeat(params: {
  store: EnterpriseSeatAssetsStore;
  tenantId: string;
  seatId: string;
}): string[] {
  const seat = params.store.seats[params.seatId];
  if (!seat || seat.tenantId !== params.tenantId) {
    return [];
  }
  return resolveSeatGrantedAgentAssetIds({
    store: params.store,
    tenantId: params.tenantId,
    seat,
  });
}

export function formatSeatRulesGuidancePrompt(rules: readonly SeatAiRule[]): string | null {
  const lines = rules.map((rule) => rule.text.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  return [
    "Seat-level AI rules (guidance only; never override enterprise hard policy, approvals, host, or credentials):",
    ...lines.map((line) => `- ${line}`),
  ].join("\n");
}

/**
 * 解析本回合席位上下文。缺 tenantId / seatId / 未绑定 agent → 不注入。
 */
export async function resolveSeatTurnContext(input: {
  cfg?: OpenBotConfig;
  tenantId?: string | null;
  employeeId?: string | null;
  /** Login email or other ids that identify the same operator as employeeId. */
  operatorUserIdAliases?: readonly string[];
  /** Currently connected openbot-node ids (prefer live computer over stale approvals). */
  preferredNodeIds?: readonly string[];
  agentId: string;
  /** 测试可注入席位资产 store，跳过磁盘加载。 */
  seatStore?: EnterpriseSeatAssetsStore;
  storePath?: string;
  /** Isolated node-seat binding files for tests. */
  computerBindingStorePath?: string;
  computerRequestStorePath?: string;
}): Promise<SeatTurnContext | null> {
  const tenantId = input.tenantId?.trim() ?? "";
  const agentId = input.agentId.trim();
  const employeeId = input.employeeId?.trim() ?? "";
  if (!tenantId || !agentId || !employeeId) {
    return null;
  }

  const seatStore = input.seatStore ?? (await loadSeatAssetsStoreForTenantId(tenantId));
  const access = buildEmployeeAccessSnapshot({
    store: seatStore,
    tenantId,
    employeeId,
  });
  const seatId = access.currentSeat?.seatId?.trim() ?? "";
  if (!seatId) {
    return null;
  }

  const boundIds = boundAgentIdsForSeat({ store: seatStore, tenantId, seatId });
  const projected = projectSeatRulesForAgent({
    agentId,
    boundAgentIds: boundIds,
    rules: [] as SeatAiRule[],
  });
  if (!projected.injected) {
    return {
      tenantId,
      seatId,
      agentId,
      bound: false,
      record: null,
      clamps: [],
      guidanceText: null,
      execPreference: undefined,
    };
  }

  let record: SeatRulesRecord | null = null;
  try {
    record = await readSeatRules(tenantId, seatId, {
      cfg: input.cfg,
      storePath: input.storePath,
    });
  } catch {
    return null;
  }

  const ceiling = resolveEnterpriseExecCeiling(input.cfg);
  const rules = record?.rules ?? [];
  const compiled = compileSeatPolicyPriority({
    enterpriseHard: {
      security: ceiling.security,
      ask: ceiling.ask,
      host: ceiling.host,
      credentialPolicy: "enterprise_shared",
      executionPlacement: ceiling.host === "node" ? "node_agent" : "gateway",
    },
    seatPrefs: {
      guidance: rules.map((rule) => ({ id: rule.id, text: rule.text })),
      controls: record?.execPreference
        ? {
            ...(record.execPreference.ask ? { ask: record.execPreference.ask } : {}),
            ...(record.execPreference.security ? { security: record.execPreference.security } : {}),
          }
        : undefined,
    },
  });
  const survivingIds = new Set(compiled.guidance.map((line) => line.id));
  const survivingRules = rules.filter((rule) => survivingIds.has(rule.id));
  const guidanceText = formatSeatRulesGuidancePrompt(survivingRules);
  const execPreference = record?.execPreference
    ? clampSeatExecPreferenceToCeiling(record.execPreference, ceiling)
    : undefined;

  const occupiedSeatIds = Object.values(seatStore.bindings)
    .filter((entry) => entry.tenantId === tenantId && entry.bindingStatus === "active")
    .map((entry) => entry.seatId);
  let operatorComputerNodeId: string | undefined;
  let operatorComputerAlwaysAllowDesktop: boolean | undefined;
  try {
    const computer = await resolveOperatorComputerNode({
      tenantId,
      activeSeatId: seatId,
      operatorUserId: employeeId,
      operatorUserIdAliases: input.operatorUserIdAliases,
      preferredNodeIds: input.preferredNodeIds,
      agentId,
      operatorAgentIds: boundIds,
      occupiedSeatIds,
      bindingStorePath: input.computerBindingStorePath,
      requestStorePath: input.computerRequestStorePath,
    });
    operatorComputerNodeId = computer?.nodeId;
    if (computer?.alwaysAllowDesktop) {
      operatorComputerAlwaysAllowDesktop = true;
    }
  } catch {
    operatorComputerNodeId = undefined;
    operatorComputerAlwaysAllowDesktop = undefined;
  }

  return {
    tenantId,
    seatId,
    agentId,
    bound: true,
    record,
    clamps: compiled.clamps,
    guidanceText,
    execPreference: Object.keys(execPreference ?? {}).length > 0 ? execPreference : undefined,
    ...(operatorComputerNodeId ? { operatorComputerNodeId } : {}),
    ...(operatorComputerAlwaysAllowDesktop ? { operatorComputerAlwaysAllowDesktop: true } : {}),
  };
}
