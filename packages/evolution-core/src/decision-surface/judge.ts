import type { AuthorityGrantView } from "../contracts.js";
import { evolutionTargetKey } from "../types.js";
import { resolveEvolutionDecisionAuthority } from "./authority.js";
/**
 * Admissibility judge. `accepted` means the command may be handed to the
 * existing control plane later. This function does not execute it.
 * Claim grade: code-present. Not runtime-enabled. Not production-proven.
 */
import {
  classifyEvolutionDecisionActionToken,
  mapEvolutionDecisionCommand,
} from "./command-map.js";
import type { EvolutionDecisionControlPlaneMapping } from "./command-map.js";
import {
  EVOLUTION_DECISION_SURFACE_WRITES,
  evolutionDecisionActionRequiresVersion,
  readEvolutionDecisionCommand,
  type EvolutionDecisionCommand,
  type EvolutionDecisionItem,
  type EvolutionDecisionPrincipal,
  type EvolutionDecisionReceipt,
  type EvolutionDecisionAuthorityFacts,
} from "./dto.js";
import {
  classifyEvolutionDecisionIdempotency,
  evolutionDecisionReplayBindingMatches,
} from "./idempotency.js";
import type { EvolutionDecisionCommandRecord } from "./idempotency.js";
import { freshEvolutionDecisionExpired } from "./idempotency.js";
import { routeEvolutionDecisionSurface, type EvolutionDecisionRouteInput } from "./router.js";

export type EvolutionDecisionJudgement = {
  receipt: EvolutionDecisionReceipt;
  writes: typeof EVOLUTION_DECISION_SURFACE_WRITES;
  executed: false;
  effectProof: false;
  code: string;
  controlPlaneAction?: EvolutionDecisionControlPlaneMapping;
};

function receiptFor(input: {
  commandId: string;
  decisionId: string;
  action: string;
  outcome: EvolutionDecisionReceipt["outcome"];
  code: string;
  controlPlaneRef?: string;
  auditReceiptRef?: string;
}): EvolutionDecisionReceipt {
  return {
    commandId: input.commandId,
    decisionId: input.decisionId,
    action: input.action,
    outcome: input.outcome,
    ...(input.controlPlaneRef ? { controlPlaneRef: input.controlPlaneRef } : {}),
    auditReceiptRef: input.auditReceiptRef ?? `decision-refusal:${input.commandId}:${input.code}`,
  };
}

function judgement(
  receipt: EvolutionDecisionReceipt,
  code: string,
  controlPlaneAction?: EvolutionDecisionControlPlaneMapping,
): EvolutionDecisionJudgement {
  return {
    receipt,
    writes: EVOLUTION_DECISION_SURFACE_WRITES,
    executed: false,
    effectProof: false,
    code,
    ...(controlPlaneAction ? { controlPlaneAction } : {}),
  };
}

export function judgeEvolutionDecisionCommand(input: {
  command?: EvolutionDecisionCommand;
  payload?: Record<string, unknown>;
  item: EvolutionDecisionItem;
  principal: EvolutionDecisionPrincipal;
  grant: AuthorityGrantView | { status: "missing" };
  facts: EvolutionDecisionAuthorityFacts;
  routeInput: EvolutionDecisionRouteInput;
  now: string;
  prior: readonly EvolutionDecisionCommandRecord[];
}): EvolutionDecisionJudgement {
  let command = input.command;
  if (input.payload) {
    const parsed = readEvolutionDecisionCommand(input.payload);
    if (!parsed.ok) {
      const token = parsed.actionToken
        ? classifyEvolutionDecisionActionToken(parsed.actionToken)
        : null;
      const code = token && !token.ok ? token.code : parsed.code;
      return judgement(
        receiptFor({
          commandId: typeof input.payload.commandId === "string" ? input.payload.commandId : "",
          decisionId:
            typeof input.payload.decisionId === "string"
              ? input.payload.decisionId
              : input.item.decisionId,
          action: typeof input.payload.action === "string" ? input.payload.action : "",
          outcome: "rejected",
          code,
        }),
        code,
      );
    }
    if (
      command &&
      (command.commandId !== parsed.command.commandId ||
        command.decisionId !== parsed.command.decisionId ||
        command.action !== parsed.command.action ||
        command.expectedVersion !== parsed.command.expectedVersion)
    ) {
      return judgement(
        receiptFor({
          commandId: parsed.command.commandId,
          decisionId: parsed.command.decisionId,
          action: parsed.command.action,
          outcome: "rejected",
          code: "invalid_command",
        }),
        "invalid_command",
      );
    }
    command = parsed.command;
  }
  if (!command) {
    return judgement(
      receiptFor({
        commandId: "",
        decisionId: input.item.decisionId,
        action: "",
        outcome: "rejected",
        code: "invalid_command",
      }),
      "invalid_command",
    );
  }

  const mapped = mapEvolutionDecisionCommand(command.action);
  if (!mapped.ok) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: mapped.code,
      }),
      mapped.code,
    );
  }
  if (
    evolutionDecisionActionRequiresVersion(command.action) &&
    command.expectedVersion.trim().length === 0
  ) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: "version_required",
      }),
      "version_required",
    );
  }
  const idempotency = classifyEvolutionDecisionIdempotency({ command, prior: input.prior });
  if (idempotency.kind === "replay") {
    // A replay does not re-run authority, so it must still sit on the same
    // route: the route has to bind to the item, and to the recorded route.
    const replayRoute = routeEvolutionDecisionSurface(input.routeInput);
    const replayRouteBound =
      replayRoute.ok &&
      evolutionTargetKey(input.routeInput.target) === evolutionTargetKey(input.item.target) &&
      input.routeInput.surfaceId === input.item.surfaceId &&
      replayRoute.requiredAuthority === input.item.requiredAuthority;
    if (
      !replayRouteBound ||
      !evolutionDecisionReplayBindingMatches(idempotency.record, {
        item: input.item,
        principal: input.principal,
        route: replayRoute,
      })
    ) {
      return judgement(
        receiptFor({
          commandId: command.commandId,
          decisionId: command.decisionId,
          action: command.action,
          outcome: "rejected",
          code: "replay_binding_mismatch",
        }),
        "replay_binding_mismatch",
      );
    }
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "idempotent_replay",
        code: "idempotent_replay",
        controlPlaneRef: idempotency.record.controlPlaneRef,
        auditReceiptRef: idempotency.record.auditReceiptRef,
      }),
      "idempotent_replay",
      mapped.mapping,
    );
  }
  if (idempotency.kind === "rebind") {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: "command_rebind",
      }),
      "command_rebind",
    );
  }

  if (freshEvolutionDecisionExpired({ item: input.item, now: input.now })) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: "expired",
      }),
      "expired",
    );
  }
  if (input.item.status !== "pending") {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "blocked",
        code: "not_pending",
      }),
      "not_pending",
    );
  }

  if (
    evolutionDecisionActionRequiresVersion(command.action) &&
    command.expectedVersion !== input.item.decisionVersion
  ) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: "version_mismatch",
      }),
      "version_mismatch",
    );
  }

  if (input.item.decisionVersion.trim().length === 0) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "rejected",
        code: "decision_version_required",
      }),
      "decision_version_required",
    );
  }

  const route = routeEvolutionDecisionSurface(input.routeInput);
  const authority = resolveEvolutionDecisionAuthority({
    item: input.item,
    command,
    principal: input.principal,
    grant: input.grant,
    facts: input.facts,
    route,
    routeInput: input.routeInput,
  });
  if (!authority.ok) {
    return judgement(
      receiptFor({
        commandId: command.commandId,
        decisionId: command.decisionId,
        action: command.action,
        outcome: "blocked",
        code: authority.code,
      }),
      authority.code,
    );
  }

  return judgement(
    receiptFor({
      commandId: command.commandId,
      decisionId: command.decisionId,
      action: command.action,
      outcome: "accepted",
      code: "admissible",
      auditReceiptRef: `decision-plan:${command.commandId}`,
    }),
    "admissible",
    mapped.mapping,
  );
}
