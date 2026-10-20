/**
 * P3/P4 gateway handlers. Compile/revise/confirm have zero Factory writes.
 * instantiate only installs already-resolved skill keys onto an existing agentId.
 */

import { randomUUID } from "node:crypto";
import { installSkillKeysOntoRobot } from "../gateway/capability-packs/install-pack-to-robot.js";
import { ErrorCodes, errorShape, formatValidationErrors } from "../gateway/protocol/index.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import { compileEmployeeDesignAsync, compileRevisionAsync } from "./compile.js";
import { projectDesignMapping } from "./confirmation-mapping.js";
import { buildAgentCreateRequest, buildCreationReceipt } from "./factory-adapter.js";
import { designSessionStore, type DesignSessionStore, type StoredDesign } from "./gateway-store.js";
import {
  validateDigitalEmployeeCompileParams,
  validateDigitalEmployeeInstantiateParams,
  validateDigitalEmployeeReviseParams,
  validateDigitalEmployeeSessionParams,
} from "./gateway-validate.js";
import {
  abortSession,
  acceptDraft,
  beginInstantiate,
  confirmDraft,
  finishInstantiate,
  markDraftReady,
} from "./session.js";
import type { CreationReceipt, SkillInstallReport } from "./types.js";
import { canShowConfirmationCard } from "./validate-draft.js";

export type DesignSnapshot = {
  session: StoredDesign["session"];
  intent: StoredDesign["intent"];
  draft: StoredDesign["draft"];
  mapping: ReturnType<typeof projectDesignMapping>;
  canConfirm: boolean;
  createRequest: ReturnType<typeof buildAgentCreateRequest> | null;
};

function actorUserId(
  client: { platformUserId?: string; user?: string } | null | undefined,
): string {
  return client?.platformUserId?.trim() || client?.user?.trim() || "anonymous";
}

function toSnapshot(entry: StoredDesign): DesignSnapshot {
  return {
    session: entry.session,
    intent: entry.intent,
    draft: entry.draft,
    mapping: projectDesignMapping(entry.intent, entry.draft),
    canConfirm: canShowConfirmationCard(entry.draft),
    createRequest:
      entry.session.status === "CONFIRMED"
        ? buildAgentCreateRequest(entry.session, entry.draft)
        : null,
  };
}

function readyIfAllowed(entry: StoredDesign): StoredDesign {
  if (entry.session.status === "DRAFT" && canShowConfirmationCard(entry.draft)) {
    return {
      ...entry,
      session: markDraftReady(entry.session, entry.draft),
    };
  }
  if (entry.session.status === "REVISING" && canShowConfirmationCard(entry.draft)) {
    return {
      ...entry,
      session: markDraftReady(entry.session, entry.draft),
    };
  }
  return entry;
}

export function createDigitalEmployeeHandlers(options?: {
  store?: DesignSessionStore;
  installSkills?: typeof installSkillKeysOntoRobot;
}): GatewayRequestHandlers {
  const store = options?.store ?? designSessionStore;
  const installSkills = options?.installSkills ?? installSkillKeysOntoRobot;

  return {
    "digitalEmployee.design.compile": async ({ params, respond, client }) => {
      if (!validateDigitalEmployeeCompileParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid digitalEmployee.design.compile params: ${formatValidationErrors(
              validateDigitalEmployeeCompileParams.errors,
            )}`,
          ),
        );
        return;
      }
      const compiled = await compileEmployeeDesignAsync({
        rawRequest: params.rawRequest,
        draftId: randomUUID(),
        source: params.source ?? "ai",
        llm: {},
      });
      const sessionId = params.sessionId?.trim() || `cs_${randomUUID()}`;
      let entry: StoredDesign = {
        session: {
          id: sessionId,
          draftId: compiled.draft.draftId,
          status: "DESIGNING",
          idempotencyKey: `idem-${sessionId}`,
          actorUserId: actorUserId(client),
        },
        intent: compiled.intent,
        draft: compiled.draft,
      };
      entry = { ...entry, session: acceptDraft(entry.session, compiled.draft) };
      entry = readyIfAllowed(entry);
      respond(true, toSnapshot(store.put(entry)));
    },

    "digitalEmployee.design.revise": async ({ params, respond }) => {
      if (!validateDigitalEmployeeReviseParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid digitalEmployee.design.revise params: ${formatValidationErrors(
              validateDigitalEmployeeReviseParams.errors,
            )}`,
          ),
        );
        return;
      }
      const current = store.get(params.sessionId);
      if (!current) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "design session not found"),
        );
        return;
      }
      try {
        const revised = await compileRevisionAsync({
          session: current.session,
          previousDraft: current.draft,
          previousIntent: current.intent,
          rawRevision: params.rawRevision,
          llm: {},
        });
        let entry: StoredDesign = {
          session: revised.session,
          intent: revised.intent,
          draft: revised.draft,
        };
        entry = readyIfAllowed(entry);
        respond(true, toSnapshot(store.put(entry)));
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    },

    "digitalEmployee.design.confirm": async ({ params, respond }) => {
      if (!validateDigitalEmployeeSessionParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid digitalEmployee.design.confirm params: ${formatValidationErrors(
              validateDigitalEmployeeSessionParams.errors,
            )}`,
          ),
        );
        return;
      }
      const current = store.get(params.sessionId);
      if (!current) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "design session not found"),
        );
        return;
      }
      try {
        const confirmed = { ...current, session: confirmDraft(current.session) };
        respond(true, toSnapshot(store.put(confirmed)));
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    },

    "digitalEmployee.design.abort": async ({ params, respond }) => {
      if (!validateDigitalEmployeeSessionParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid digitalEmployee.design.abort params: ${formatValidationErrors(
              validateDigitalEmployeeSessionParams.errors,
            )}`,
          ),
        );
        return;
      }
      const current = store.get(params.sessionId);
      if (!current) {
        respond(true, { aborted: true });
        return;
      }
      try {
        store.put({ ...current, session: abortSession(current.session) });
        respond(true, { aborted: true, sessionId: current.session.id });
      } catch (error) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    },

    "digitalEmployee.design.instantiate": async ({ params, respond }) => {
      if (!validateDigitalEmployeeInstantiateParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid digitalEmployee.design.instantiate params: ${formatValidationErrors(
              validateDigitalEmployeeInstantiateParams.errors,
            )}`,
          ),
        );
        return;
      }
      const current = store.get(params.sessionId);
      if (!current) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "design session not found"),
        );
        return;
      }
      if (current.session.status === "INSTANTIATED" || current.session.status === "PARTIAL") {
        const agentId =
          store.peekAgent(current.session.idempotencyKey) ??
          current.session.instantiatedAgentId ??
          params.agentId;
        const requested = current.draft.skillRecommendations
          .filter((entry) => entry.status === "resolved" && entry.skillKey)
          .map((entry) => entry.skillKey as string);
        const skillInstall: SkillInstallReport = {
          requested,
          succeeded: current.session.status === "INSTANTIATED" ? requested : [],
          failed:
            current.session.status === "PARTIAL"
              ? [{ skillKey: requested[0] ?? "unknown", reason: "partial previous install" }]
              : [],
        };
        respond(true, {
          session: current.session,
          receipt: buildCreationReceipt({
            session: current.session,
            draft: current.draft,
            agentId,
            skillInstall,
            confirmedAt: new Date().toISOString(),
          }),
          skillInstall,
          reusedExistingAgent: true,
        });
        return;
      }
      if (current.session.status !== "CONFIRMED" && current.session.status !== "INSTANTIATING") {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "factory is closed until CONFIRMED"),
        );
        return;
      }
      const agentId = store.rememberAgent(current.session.idempotencyKey, params.agentId);
      let session =
        current.session.status === "CONFIRMED"
          ? beginInstantiate(current.session)
          : current.session;
      const requested = [
        ...new Set(
          current.draft.skillRecommendations
            .filter((entry) => entry.status === "resolved" && entry.skillKey)
            .map((entry) => entry.skillKey as string),
        ),
      ];
      const installed = await installSkills({ agentId, skillKeys: requested });
      const skillInstall: SkillInstallReport = {
        requested,
        succeeded: installed.installed.map((item) => item.skillKey),
        failed: installed.failed.map((item) => ({
          skillKey: item.skillKey,
          reason: item.reason ?? "install failed",
        })),
      };
      session = finishInstantiate(session, {
        agentId,
        failedSkillCount: skillInstall.failed.length,
      });
      const stored = store.put({ ...current, session });
      const receipt: CreationReceipt = buildCreationReceipt({
        session: stored.session,
        draft: stored.draft,
        agentId,
        skillInstall,
        confirmedAt: new Date().toISOString(),
      });
      respond(true, {
        session: stored.session,
        receipt,
        skillInstall,
        reusedExistingAgent: agentId !== params.agentId,
      });
    },
  };
}

export const digitalEmployeeHandlers = createDigitalEmployeeHandlers();
