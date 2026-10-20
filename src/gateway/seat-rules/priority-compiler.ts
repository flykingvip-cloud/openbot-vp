/**
 * 席位策略优先级编译器。
 *
 * EffectivePolicy = 更高层 ∩ 更低层。下层只能收紧 security / ask。
 * host、凭证策略、执行落点没有员工侧全序，请求改写则钳制并留下 clamp。
 * 软文本只作为指导，不进入 Fabric decide 的允许条件。
 *
 * 层次（高 → 低）：
 * enterprise-hard → enterprise-soft → job-role → bot-instructions → seat-prefs → session-temp
 */
import type { CredentialPolicy, ExecutionPlacement } from "../../fabric/worker/types.js";
import {
  type ExecAsk,
  type ExecHost,
  type ExecSecurity,
  maxAsk,
  minSecurity,
} from "../../infra/exec-approvals.js";
import { guidanceLinesConflict, inspectSeatRuleText } from "./content-guard.js";

export const SEAT_POLICY_LAYERS = [
  "enterprise-hard",
  "enterprise-soft",
  "job-role",
  "bot-instructions",
  "seat-prefs",
  "session-temp",
] as const;

export type SeatPolicyLayer = (typeof SEAT_POLICY_LAYERS)[number];

export type SeatPolicyClamp = {
  field: string;
  requested: unknown;
  effective: unknown;
  reason: string;
  source: SeatPolicyLayer;
  constrainedBy?: string;
  ruleId?: string;
};

export type SeatPolicyGuidanceLine = {
  id: string;
  text: string;
};

export type SeatPolicyControls = {
  security?: ExecSecurity;
  ask?: ExecAsk;
  host?: ExecHost;
  credentialPolicy?: CredentialPolicy;
  executionPlacement?: ExecutionPlacement;
};

export type SeatPolicyLayerInput = {
  controls?: SeatPolicyControls;
  guidance?: readonly { id?: string; text: string }[];
};

export type EnterpriseHardCeiling = {
  security: ExecSecurity;
  ask: ExecAsk;
  host: ExecHost;
  credentialPolicy: CredentialPolicy;
  executionPlacement: ExecutionPlacement;
};

export type CompileSeatPolicyPriorityInput = {
  enterpriseHard: EnterpriseHardCeiling;
  enterpriseSoft?: SeatPolicyLayerInput;
  jobRole?: SeatPolicyLayerInput;
  botInstructions?: SeatPolicyLayerInput;
  seatPrefs?: SeatPolicyLayerInput;
  sessionTemp?: SeatPolicyLayerInput;
};

export type CompiledSeatPolicyPriority = {
  security: ExecSecurity;
  ask: ExecAsk;
  host: ExecHost;
  credentialPolicy: CredentialPolicy;
  executionPlacement: ExecutionPlacement;
  /** 过滤后的指导语。不是 Fabric allow 条件。 */
  guidance: SeatPolicyGuidanceLine[];
  clamps: SeatPolicyClamp[];
};

const CONTROL_FIELDS = [
  "security",
  "ask",
  "host",
  "credentialPolicy",
  "executionPlacement",
] as const;

const TIGHTEN_LAYERS = new Set<SeatPolicyLayer>(["job-role", "seat-prefs", "session-temp"]);

type EffectiveControls = EnterpriseHardCeiling;

function pushClamp(clamps: SeatPolicyClamp[], clamp: SeatPolicyClamp) {
  clamps.push(clamp);
}

function numberedGuidance(
  layer: SeatPolicyLayer,
  lines: readonly { id?: string; text: string }[] | undefined,
): SeatPolicyGuidanceLine[] {
  const result: SeatPolicyGuidanceLine[] = [];
  for (const [index, line] of (lines ?? []).entries()) {
    const text = line.text.trim();
    if (!text) {
      continue;
    }
    const id = line.id?.trim() || `${layer}:${index}`;
    result.push({ id, text });
  }
  return result;
}

function applyControls(
  layer: SeatPolicyLayer,
  controls: SeatPolicyControls | undefined,
  effective: EffectiveControls,
  clamps: SeatPolicyClamp[],
) {
  if (!controls) {
    return;
  }
  if (!TIGHTEN_LAYERS.has(layer)) {
    for (const field of CONTROL_FIELDS) {
      if (controls[field] !== undefined) {
        pushClamp(clamps, {
          field,
          requested: controls[field],
          effective: effective[field],
          reason: "guidance_layer_cannot_authorize",
          source: layer,
          constrainedBy: "enterprise-hard",
        });
      }
    }
    return;
  }

  if (controls.security) {
    const next = minSecurity(effective.security, controls.security);
    if (next !== controls.security) {
      pushClamp(clamps, {
        field: "security",
        requested: controls.security,
        effective: next,
        reason: "relaxation_clamped_to_ceiling",
        source: layer,
        constrainedBy: "minSecurity",
      });
    }
    effective.security = next;
  }

  if (controls.ask) {
    const next = maxAsk(effective.ask, controls.ask);
    if (next !== controls.ask) {
      pushClamp(clamps, {
        field: "ask",
        requested: controls.ask,
        effective: next,
        reason: "relaxation_clamped_to_ceiling",
        source: layer,
        constrainedBy: "maxAsk",
      });
    }
    effective.ask = next;
  }

  for (const field of ["host", "credentialPolicy", "executionPlacement"] as const) {
    const requested = controls[field];
    if (requested === undefined || requested === effective[field]) {
      continue;
    }
    pushClamp(clamps, {
      field,
      requested,
      effective: effective[field],
      reason: "no_total_order_keep_enterprise_value",
      source: layer,
      constrainedBy: "enterprise-hard",
    });
  }
}

function hardGuidanceReason(text: string): string | null {
  const reason = inspectSeatRuleText(text);
  if (!reason) {
    return null;
  }
  if (reason === "secret") {
    return "forbidden_secret";
  }
  if (reason === "cross_scope") {
    return "forbidden_cross_scope";
  }
  return "conflicts_with_enterprise_hard";
}

function compileGuidance(
  layers: readonly { layer: SeatPolicyLayer; lines: SeatPolicyGuidanceLine[] }[],
  clamps: SeatPolicyClamp[],
): SeatPolicyGuidanceLine[] {
  const accepted: SeatPolicyGuidanceLine[] = [];
  for (const entry of layers) {
    const survivors: SeatPolicyGuidanceLine[] = [];
    for (const line of entry.lines) {
      const hardReason = hardGuidanceReason(line.text);
      if (hardReason) {
        pushClamp(clamps, {
          field: "guidance",
          requested: line.text,
          effective: null,
          reason: hardReason,
          source: entry.layer,
          constrainedBy: "enterprise-hard",
          ruleId: line.id,
        });
        continue;
      }
      survivors.push(line);
    }

    const dropped = new Set<string>();
    for (let left = 0; left < survivors.length; left += 1) {
      for (let right = left + 1; right < survivors.length; right += 1) {
        const a = survivors[left];
        const b = survivors[right];
        if (!a || !b || !guidanceLinesConflict(a.text, b.text)) {
          continue;
        }
        dropped.add(a.id);
        dropped.add(b.id);
      }
    }
    for (const line of survivors) {
      if (!dropped.has(line.id)) {
        continue;
      }
      pushClamp(clamps, {
        field: "guidance",
        requested: line.text,
        effective: null,
        reason: "same_layer_guidance_conflict",
        source: entry.layer,
        ruleId: line.id,
      });
    }

    for (const line of survivors) {
      if (dropped.has(line.id)) {
        continue;
      }
      const higher = accepted.find((kept) => guidanceLinesConflict(kept.text, line.text));
      if (higher) {
        pushClamp(clamps, {
          field: "guidance",
          requested: line.text,
          effective: null,
          reason: "conflicts_with_higher_guidance",
          source: entry.layer,
          constrainedBy: higher.id,
          ruleId: line.id,
        });
        continue;
      }
      accepted.push(line);
    }
  }
  return accepted;
}

export function compileSeatPolicyPriority(
  input: CompileSeatPolicyPriorityInput,
): CompiledSeatPolicyPriority {
  const effective: EffectiveControls = { ...input.enterpriseHard };
  const clamps: SeatPolicyClamp[] = [];
  const ordered: readonly { layer: SeatPolicyLayer; input?: SeatPolicyLayerInput }[] = [
    { layer: "enterprise-soft", input: input.enterpriseSoft },
    { layer: "job-role", input: input.jobRole },
    { layer: "bot-instructions", input: input.botInstructions },
    { layer: "seat-prefs", input: input.seatPrefs },
    { layer: "session-temp", input: input.sessionTemp },
  ];

  for (const entry of ordered) {
    applyControls(entry.layer, entry.input?.controls, effective, clamps);
  }

  const guidance = compileGuidance(
    ordered.map((entry) => ({
      layer: entry.layer,
      lines: numberedGuidance(entry.layer, entry.input?.guidance),
    })),
    clamps,
  );

  return {
    ...effective,
    guidance,
    clamps,
  };
}
