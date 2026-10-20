/**
 * server-methods/delivery-lane.ts — gateway API for DeliveryLane (Tip A).
 *
 * Methods:
 *  - lane.attach
 *  - lane.focus
 *  - lane.setMode (Tip B)
 *  - lane.seal
 *  - lane.requestMergeReady
 *  - lane.requestMerge (Tip C — dual-seal MergePort)
 *  - lane.sealFromHandoff (Tip D — cross-bot handoff→seal)
 *  - lane.helper.attach / lane.helper.detach (Tip E)
 *  - lane.event.apply / lane.event.observeShadow (Tip F)
 *  - lane.get
 *  - lane.template.list
 *  - lane.status
 *
 * Feature flag default OFF → UNAVAILABLE (zero behavior change when unset).
 * Tip C: merge only via lane.requestMerge after dual-seal (not raw gh via agent).
 */

import {
  applyLaneEvent,
  attachLane,
  DeliveryLaneError,
  focusLane,
  getLaneOrThrow,
  isDeliveryLaneEnabled,
  isLaneEventKind,
  listDeliveryLaneTemplates,
  observeLaneEventShadow,
  requestMerge,
  requestMergeReady,
  attachLaneHelper,
  detachLaneHelper,
  sealLane,
  sealLaneFromHandoff,
  setLaneMode,
  type HandoffSealSnapshot,
  type LaneSealKind,
  type LaneSealVerdict,
  type MergePortMethod,
} from "../delivery-lane/index.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const SEAL_KINDS: ReadonlySet<string> = new Set(["implement", "review", "accept"]);
const SEAL_VERDICTS: ReadonlySet<string> = new Set([
  "PASS",
  "FAIL",
  "BLOCKED",
  "REVIEW_PASS",
  "REVIEW_CHANGES_REQUESTED",
]);

function requireDeliveryLaneEnabled(respond: RespondFn): boolean {
  if (!isDeliveryLaneEnabled()) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "delivery-lane is not enabled"));
    return false;
  }
  return true;
}

function requireString(
  params: Record<string, unknown>,
  key: string,
  respond: RespondFn,
): string | null {
  const raw = params[key];
  const value = typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
  const trimmed = value.trim();
  if (!trimmed) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `missing ${key}`));
    return null;
  }
  return trimmed;
}

function requireOptionalString(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key];
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof raw === "number") {
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : undefined;
  }
  return undefined;
}

function mapDeliveryLaneError(err: unknown, respond: RespondFn): void {
  if (err instanceof DeliveryLaneError) {
    const code =
      err.code === "NOT_FOUND" || err.code === "REFUSED" || err.code === "INVALID_REQUEST"
        ? ErrorCodes.INVALID_REQUEST
        : err.code === "UNAVAILABLE"
          ? ErrorCodes.UNAVAILABLE
          : ErrorCodes.INVALID_REQUEST;
    respond(false, undefined, errorShape(code, err.message));
    return;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, err instanceof Error ? err.message : String(err)),
  );
}

export const deliveryLaneHandlers: GatewayRequestHandlers = {
  "lane.status": ({ respond }) => {
    respond(true, { enabled: isDeliveryLaneEnabled() }, undefined);
  },

  "lane.template.list": ({ respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    respond(true, { templates: listDeliveryLaneTemplates() }, undefined);
  },

  "lane.attach": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const templateId = requireString(params, "templateId", respond);
    if (!templateId) {
      return;
    }
    try {
      const result = await attachLane({
        templateId,
        taskId: requireOptionalString(params, "taskId"),
        agentId: requireOptionalString(params, "agentId"),
        tipSha: requireOptionalString(params, "tipSha"),
        headSha: requireOptionalString(params, "headSha"),
        prNumber: typeof params.prNumber === "number" ? params.prNumber : undefined,
        path1CrossBotEnabled:
          typeof params.path1CrossBotEnabled === "boolean"
            ? params.path1CrossBotEnabled
            : undefined,
        laneId: requireOptionalString(params, "laneId"),
      });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.focus": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    try {
      const result = await focusLane({ laneId });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.setMode": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const modeRaw = requireString(params, "mode", respond);
    if (!modeRaw) {
      return;
    }
    if (modeRaw !== "implement" && modeRaw !== "review" && modeRaw !== "accept") {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid mode: ${modeRaw} (Tip B allows implement|review|accept; merge via requestMergeReady)`,
        ),
      );
      return;
    }
    try {
      const result = await setLaneMode({ laneId, mode: modeRaw });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.seal": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const kindRaw = requireString(params, "kind", respond);
    if (!kindRaw) {
      return;
    }
    if (!SEAL_KINDS.has(kindRaw)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid kind: ${kindRaw}`));
      return;
    }
    const verdictRaw = requireString(params, "verdict", respond);
    if (!verdictRaw) {
      return;
    }
    if (!SEAL_VERDICTS.has(verdictRaw)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid verdict: ${verdictRaw}`),
      );
      return;
    }
    const tipSha = requireString(params, "tipSha", respond);
    if (!tipSha) {
      return;
    }
    const issuerRaw = params.issuer;
    if (!issuerRaw || typeof issuerRaw !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing issuer"));
      return;
    }
    const issuerObj = issuerRaw as Record<string, unknown>;
    const agentId = typeof issuerObj.agentId === "string" ? issuerObj.agentId.trim() : "";
    if (!agentId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing issuer.agentId"));
      return;
    }
    try {
      const result = await sealLane({
        laneId,
        kind: kindRaw as LaneSealKind,
        verdict: verdictRaw as LaneSealVerdict,
        tipSha,
        issuer: {
          agentId,
          botId: typeof issuerObj.botId === "string" ? issuerObj.botId : undefined,
          mode:
            issuerObj.mode === "implement" ||
            issuerObj.mode === "review" ||
            issuerObj.mode === "accept" ||
            issuerObj.mode === "merge"
              ? issuerObj.mode
              : undefined,
          kind:
            issuerObj.kind === "helper" ||
            issuerObj.kind === "personal_subagent" ||
            issuerObj.kind === "external" ||
            issuerObj.kind === "agent"
              ? issuerObj.kind
              : undefined,
        },
        evidence:
          params.evidence && typeof params.evidence === "object"
            ? (params.evidence as {
                kind: string;
                refs?: Array<{ type: string; value: string }>;
                hashes?: Record<string, string>;
                notes?: string;
              })
            : undefined,
        ownerCosignUserId: requireOptionalString(params, "ownerCosignUserId"),
        headSha: requireOptionalString(params, "headSha"),
      });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.sealFromHandoff": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const tipSha = requireString(params, "tipSha", respond);
    if (!tipSha) {
      return;
    }
    const handoffRaw = params.handoff;
    if (!handoffRaw || typeof handoffRaw !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "missing handoff"));
      return;
    }
    const h = handoffRaw as Record<string, unknown>;
    const handoffId = typeof h.handoffId === "string" ? h.handoffId.trim() : "";
    const kind = typeof h.kind === "string" ? h.kind.trim() : "";
    const status = typeof h.status === "string" ? h.status.trim() : "";
    const fromAgentId = typeof h.fromAgentId === "string" ? h.fromAgentId.trim() : "";
    const toAgentId = typeof h.toAgentId === "string" ? h.toAgentId.trim() : "";
    if (!handoffId || !kind || !status || !fromAgentId || !toAgentId) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "handoff requires handoffId, kind, status, fromAgentId, toAgentId",
        ),
      );
      return;
    }
    const handoff: HandoffSealSnapshot = {
      handoffId,
      kind: kind as HandoffSealSnapshot["kind"],
      status: status as HandoffSealSnapshot["status"],
      fromAgentId,
      toAgentId,
      ...(typeof h.toRole === "string"
        ? { toRole: h.toRole as HandoffSealSnapshot["toRole"] }
        : {}),
      ...(typeof h.fromRole === "string"
        ? { fromRole: h.fromRole as HandoffSealSnapshot["fromRole"] }
        : {}),
      ...(Array.isArray(h.acceptanceCriteria)
        ? { acceptanceCriteria: h.acceptanceCriteria.map(String) }
        : {}),
      ...(Array.isArray(h.completedArtifacts)
        ? { completedArtifacts: h.completedArtifacts.map(String) }
        : {}),
    };
    try {
      const result = await sealLaneFromHandoff({
        laneId,
        tipSha,
        handoff,
        headSha: requireOptionalString(params, "headSha"),
        verdict:
          typeof params.verdict === "string" && SEAL_VERDICTS.has(params.verdict)
            ? (params.verdict as LaneSealVerdict)
            : undefined,
      });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.requestMergeReady": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    try {
      const result = await requestMergeReady({ laneId });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.requestMerge": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const methodRaw = requireOptionalString(params, "method");
    let method: MergePortMethod | undefined;
    if (methodRaw) {
      if (methodRaw !== "squash" && methodRaw !== "merge" && methodRaw !== "rebase") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `invalid method: ${methodRaw}`),
        );
        return;
      }
      method = methodRaw;
    }
    try {
      const result = await requestMerge({
        laneId,
        method,
        observedHeadSha: requireOptionalString(params, "observedHeadSha"),
        cwd: requireOptionalString(params, "cwd"),
      });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.helper.attach": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    const kindRaw = requireOptionalString(params, "kind");
    const kind =
      kindRaw === "helper" || kindRaw === "personal_subagent" || kindRaw === "external"
        ? kindRaw
        : undefined;
    try {
      const result = await attachLaneHelper({ laneId, agentId, kind });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.helper.detach": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const agentId = requireString(params, "agentId", respond);
    if (!agentId) {
      return;
    }
    try {
      const result = await detachLaneHelper({ laneId, agentId });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.event.apply": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const kindRaw = requireString(params, "kind", respond);
    if (!kindRaw) {
      return;
    }
    if (!isLaneEventKind(kindRaw)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid event kind: ${kindRaw}`),
      );
      return;
    }
    const sourceRaw = requireOptionalString(params, "source");
    const source =
      sourceRaw === "webhook" || sourceRaw === "test" || sourceRaw === "internal"
        ? sourceRaw
        : "internal";
    const prNumberRaw = params.prNumber;
    const prNumber =
      typeof prNumberRaw === "number" && Number.isFinite(prNumberRaw)
        ? prNumberRaw
        : typeof prNumberRaw === "string" &&
            prNumberRaw.trim() &&
            Number.isFinite(Number(prNumberRaw))
          ? Number(prNumberRaw)
          : undefined;
    try {
      const result = await applyLaneEvent({
        event: {
          kind: kindRaw,
          laneId,
          tipSha: requireOptionalString(params, "tipSha"),
          headSha: requireOptionalString(params, "headSha"),
          prNumber,
          source,
        },
      });
      respond(true, result, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.event.observeShadow": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    const kindRaw = requireString(params, "kind", respond);
    if (!kindRaw) {
      return;
    }
    if (!isLaneEventKind(kindRaw)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid event kind: ${kindRaw}`),
      );
      return;
    }
    try {
      const shadow = observeLaneEventShadow({ kind: kindRaw, laneId });
      respond(true, { shadow }, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },

  "lane.get": async ({ params, respond }) => {
    if (!requireDeliveryLaneEnabled(respond)) {
      return;
    }
    const laneId = requireString(params, "laneId", respond);
    if (!laneId) {
      return;
    }
    try {
      const lane = await getLaneOrThrow(laneId);
      respond(true, { lane }, undefined);
    } catch (err) {
      mapDeliveryLaneError(err, respond);
    }
  },
};
