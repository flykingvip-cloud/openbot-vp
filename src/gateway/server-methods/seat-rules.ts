import { loadConfig } from "../../config/config.js";
import { AdapterRegistry } from "../../fabric/adapter-registry.js";
import { buildExecPolicyInputs, createProbeDecideFor } from "../../fabric/probes.js";
import { createFabricService } from "../../fabric/service.js";
import {
  normalizeExecAsk,
  normalizeExecSecurity,
  resolveExecApprovalsReadonly,
  type ExecAsk,
  type ExecSecurity,
} from "../../infra/exec-approvals.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { buildSeatDrillSampleRequest, runSeatPolicyDrillViaFabric } from "../seat-rules/drill.js";
import {
  SEAT_RULE_MAX_CHARS,
  SEAT_RULES_MAX_COUNT,
  SEAT_RULES_MAX_TOTAL_CHARS,
} from "../seat-rules/limits.js";
import {
  readSeatRules,
  saveSeatRules,
  SeatRulesRejectedError,
  SeatRulesScopeError,
} from "../seat-rules/store.js";
import {
  allowedAskOptionsWithinCeiling,
  allowedSecurityOptionsWithinCeiling,
  clampSeatExecPreferenceToCeiling,
  resolveEnterpriseExecCeiling,
} from "../seat-rules/turn-context.js";
import type { GatewayRequestHandlers } from "./types.js";

function respondSeatRulesError(
  respond: Parameters<GatewayRequestHandlers[string]>[0]["respond"],
  err: unknown,
): boolean {
  if (err instanceof SeatRulesScopeError) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
    return true;
  }
  if (err instanceof SeatRulesRejectedError) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, err.message, {
        details: { rejections: err.rejections },
      }),
    );
    return true;
  }
  return false;
}

export const seatRulesHandlers: GatewayRequestHandlers = {
  "seat-rules.get": async ({ respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() ?? "";
    const seatId = actor?.currentSeatId?.trim() ?? "";
    if (!actor || !tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise seat required"),
      );
      return;
    }
    const cfg = loadConfig();
    let record = null;
    try {
      record = await readSeatRules(tenantId, seatId, { cfg });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }
    respond(true, {
      tenantId,
      seatId,
      rules: record?.rules ?? [],
      updatedAt: record?.updatedAt ?? null,
      limits: {
        maxChars: SEAT_RULE_MAX_CHARS,
        maxTotalChars: SEAT_RULES_MAX_TOTAL_CHARS,
        maxCount: SEAT_RULES_MAX_COUNT,
      },
    });
  },

  "seat-rules.set": async ({ respond, client, params }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() ?? "";
    const seatId = actor?.currentSeatId?.trim() ?? "";
    if (!actor || !tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise seat required"),
      );
      return;
    }

    const rawRules = params?.rules;
    if (!Array.isArray(rawRules)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "rules array required"));
      return;
    }
    const rules: { id?: string; text: string }[] = [];
    for (const [index, entry] of rawRules.entries()) {
      if (!entry || typeof entry !== "object") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `rules[${index}] must be an object`),
        );
        return;
      }
      const text =
        typeof (entry as { text?: unknown }).text === "string"
          ? (entry as { text: string }).text
          : null;
      if (text === null) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `rules[${index}].text must be a string`),
        );
        return;
      }
      const idRaw = (entry as { id?: unknown }).id;
      const id = typeof idRaw === "string" ? idRaw : undefined;
      rules.push(id !== undefined ? { id, text } : { text });
    }

    const cfg = loadConfig();
    let existing = null;
    try {
      existing = await readSeatRules(tenantId, seatId, { cfg });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }

    try {
      const saved = await saveSeatRules(
        {
          tenantId,
          seatId,
          rules,
          execPreference: existing?.execPreference
            ? {
                ...(existing.execPreference.ask ? { ask: existing.execPreference.ask } : {}),
                ...(existing.execPreference.security
                  ? { security: existing.execPreference.security }
                  : {}),
              }
            : undefined,
        },
        { cfg },
      );
      respond(true, {
        tenantId,
        seatId,
        rules: saved.rules,
        updatedAt: saved.updatedAt,
        limits: {
          maxChars: SEAT_RULE_MAX_CHARS,
          maxTotalChars: SEAT_RULES_MAX_TOTAL_CHARS,
          maxCount: SEAT_RULES_MAX_COUNT,
        },
      });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }
  },

  "seat-rules.get-exec-preference": async ({ respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() ?? "";
    const seatId = actor?.currentSeatId?.trim() ?? "";
    if (!actor || !tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise seat required"),
      );
      return;
    }
    const cfg = loadConfig();
    const ceiling = resolveEnterpriseExecCeiling(cfg);
    let record = null;
    try {
      record = await readSeatRules(tenantId, seatId, { cfg });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }
    const preference = clampSeatExecPreferenceToCeiling(record?.execPreference, ceiling);
    respond(true, {
      tenantId,
      seatId,
      ceiling: {
        ask: ceiling.ask,
        security: ceiling.security,
        // host is enterprise-only; returned for display, not editable
        host: ceiling.host,
      },
      preference: {
        ask: preference.ask ?? null,
        security: preference.security ?? null,
      },
      effective: {
        ask: preference.ask ?? ceiling.ask,
        security: preference.security ?? ceiling.security,
      },
      allowed: {
        ask: allowedAskOptionsWithinCeiling(ceiling.ask),
        security: allowedSecurityOptionsWithinCeiling(ceiling.security),
      },
    });
  },

  "seat-rules.set-exec-preference": async ({ respond, client, params }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() ?? "";
    const seatId = actor?.currentSeatId?.trim() ?? "";
    if (!actor || !tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise seat required"),
      );
      return;
    }

    const rawAsk =
      typeof params?.ask === "string" ? params.ask : params?.ask === null ? null : undefined;
    const rawSecurity =
      typeof params?.security === "string"
        ? params.security
        : params?.security === null
          ? null
          : undefined;
    if (rawAsk === undefined && rawSecurity === undefined) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "ask and/or security required"),
      );
      return;
    }
    if (params?.host !== undefined && params?.host !== null) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "seat cannot set host"));
      return;
    }
    if (params?.credentialPolicy !== undefined && params?.credentialPolicy !== null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "seat cannot set credentialPolicy"),
      );
      return;
    }
    if (params?.executionPlacement !== undefined && params?.executionPlacement !== null) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "seat cannot set executionPlacement"),
      );
      return;
    }

    const cfg = loadConfig();
    const ceiling = resolveEnterpriseExecCeiling(cfg);
    let existing = null;
    try {
      existing = await readSeatRules(tenantId, seatId, { cfg });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }

    const nextAsk: ExecAsk | undefined =
      rawAsk === null
        ? undefined
        : rawAsk === undefined
          ? existing?.execPreference?.ask
          : (normalizeExecAsk(rawAsk) ?? undefined);
    const nextSecurity: ExecSecurity | undefined =
      rawSecurity === null
        ? undefined
        : rawSecurity === undefined
          ? existing?.execPreference?.security
          : (normalizeExecSecurity(rawSecurity) ?? undefined);

    if (rawAsk !== undefined && rawAsk !== null && !nextAsk) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid ask"));
      return;
    }
    if (rawSecurity !== undefined && rawSecurity !== null && !nextSecurity) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid security"));
      return;
    }

    const clamped = clampSeatExecPreferenceToCeiling(
      {
        ...(nextAsk ? { ask: nextAsk } : {}),
        ...(nextSecurity ? { security: nextSecurity } : {}),
      },
      ceiling,
    );

    // Reject attempts to store a value looser than ceiling (client should only send allowed options).
    if (nextAsk && clamped.ask && nextAsk !== clamped.ask) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "ask cannot be looser than enterprise ceiling"),
      );
      return;
    }
    if (nextSecurity && clamped.security && nextSecurity !== clamped.security) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "security cannot be looser than enterprise ceiling"),
      );
      return;
    }

    try {
      const saved = await saveSeatRules(
        {
          tenantId,
          seatId,
          rules: existing?.rules ?? [],
          execPreference: {
            ...(clamped.ask ? { ask: clamped.ask } : {}),
            ...(clamped.security ? { security: clamped.security } : {}),
          },
        },
        { cfg },
      );
      respond(true, {
        tenantId,
        seatId,
        preference: {
          ask: saved.execPreference?.ask ?? null,
          security: saved.execPreference?.security ?? null,
        },
        effective: {
          ask: saved.execPreference?.ask ?? ceiling.ask,
          security: saved.execPreference?.security ?? ceiling.security,
        },
        ceiling: {
          ask: ceiling.ask,
          security: ceiling.security,
          host: ceiling.host,
        },
      });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }
  },

  /**
   * 席位策略演练（闸门 6）：只走 Fabric policy check，不执行、不写审批/允许列表、
   * 不构成下次预授权；不新增 ExecAsk；不把 ask 改成 off。
   */
  "seat-rules.drill": async ({ respond, client, params }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    const tenantId = actor?.tenantId?.trim() ?? "";
    const seatId = actor?.currentSeatId?.trim() ?? "";
    if (!actor || !tenantId || !seatId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "active enterprise seat required"),
      );
      return;
    }

    // 拒绝试图把演练结果写成预授权 / 允许列表的参数。
    if (params?.applyAsPreAuthorization === true || params?.writeAllowlist === true) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "seat_drill_cannot_preauthorize: drill results must not authorize real execution",
        ),
      );
      return;
    }

    const cfg = loadConfig();
    const ceiling = resolveEnterpriseExecCeiling(cfg);
    let record = null;
    try {
      record = await readSeatRules(tenantId, seatId, { cfg });
    } catch (err) {
      if (respondSeatRulesError(respond, err)) {
        return;
      }
      throw err;
    }
    const preference = clampSeatExecPreferenceToCeiling(record?.execPreference, ceiling);
    const effectiveAsk: ExecAsk = preference.ask ?? ceiling.ask;
    const effectiveSecurity: ExecSecurity = preference.security ?? ceiling.security;

    const command =
      typeof params?.command === "string" && params.command.trim()
        ? params.command.trim().slice(0, 200)
        : "echo seat-policy-drill";
    const request = buildSeatDrillSampleRequest({ tenantId, command });

    // 席位有效 ask/security 覆盖探测；允许列表仍读企业现有配置（演练不改写）。
    // WP-04: seat drill is decide-only — never ensure/save approvals file.
    const resolveApprovals = (agentId?: string) => {
      const resolved = resolveExecApprovalsReadonly(agentId);
      return {
        ask: effectiveAsk,
        security: effectiveSecurity,
        allowlist: resolved.allowlist,
      };
    };

    // executeNode 故意失败关闭：演练路径绝不能执行。
    const fabric = createFabricService({
      registry: new AdapterRegistry(),
      pipeline: {
        decideFor: createProbeDecideFor({ resolveApprovals }),
        executeNode: async () => {
          throw new Error("seat_drill_must_not_execute");
        },
      },
    });

    // 用同一探测算 analysis/allowlist，供「若真执行是否要审批」。
    const probeInputs = buildExecPolicyInputs(command, {}, { resolveApprovals });

    const drill = runSeatPolicyDrillViaFabric({
      fabric,
      request,
      effectiveAsk,
      effectiveSecurity,
      analysisOk: probeInputs.allowlist?.analysisOk ?? true,
      allowlistSatisfied: probeInputs.allowlist?.satisfied ?? false,
    });

    respond(true, {
      tenantId,
      seatId,
      command,
      ceiling: { ask: ceiling.ask, security: ceiling.security, host: ceiling.host },
      effective: { ask: effectiveAsk, security: effectiveSecurity },
      outcome: drill.outcome,
      decision: drill.decision,
      reason: drill.reason ?? null,
      matchedRules: drill.matchedRules,
      relaxation: drill.relaxation,
      wouldRequireApprovalIfExecuted: drill.wouldRequireApprovalIfExecuted,
      preAuthorization: false,
      persisted: false,
      note: "演练只裁决、不执行、不写允许列表；结果不能作为下次真执行预授权。",
    });
  },
};
