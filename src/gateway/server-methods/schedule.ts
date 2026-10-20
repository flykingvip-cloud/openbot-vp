import {
  buildManualScheduleEntry,
  cancelScheduleEntry,
  upsertScheduleEntry,
} from "../../organization/schedule-store.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { looseRecordOrEmpty as asRecord } from "../records.js";
import { broadcastWorkbenchSignalsInvalidate } from "../workbench/signals-invalidate.js";
import type { GatewayRequestHandlers } from "./types.js";

/**
 * Deterministic `ScheduleEntry` write RPCs (Phase A1). The shared backend behind
 * both the workbench manual add/cancel UI and the steward schedule tool: each
 * write is scoped to the resolved employee actor and `ownerUserId`/`tenantId` are
 * stamped server-side from that actor — never accepted from the client — so a
 * caller can only ever mutate their OWN schedule (the HYB cross-tenant lesson).
 *
 * Read-side projection stays in `workbench.schedule.list`; these only mutate.
 * Entry construction (kind coercion, owner stamping, sourceRef) is shared with
 * the steward tool via `buildManualScheduleEntry`.
 */

export const scheduleHandlers: GatewayRequestHandlers = {
  "schedule.entry.upsert": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const title = typeof record.title === "string" ? record.title.trim() : "";
    if (!title) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "title is required"));
      return;
    }
    const startAtMs = typeof record.startAtMs === "number" ? record.startAtMs : Number.NaN;
    if (!Number.isFinite(startAtMs) || startAtMs <= 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "startAtMs must be a positive epoch-ms timestamp"),
      );
      return;
    }
    let endAtMs: number | undefined;
    if (record.endAtMs !== undefined && record.endAtMs !== null) {
      if (
        typeof record.endAtMs !== "number" ||
        !Number.isFinite(record.endAtMs) ||
        record.endAtMs < startAtMs
      ) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "endAtMs must be a number >= startAtMs"),
        );
        return;
      }
      endAtMs = record.endAtMs;
    }
    const kind = typeof record.kind === "string" ? record.kind : undefined;
    const timezone = typeof record.timezone === "string" ? record.timezone : undefined;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    try {
      const entry = await upsertScheduleEntry(
        buildManualScheduleEntry({
          id,
          // Owner/tenant are stamped from the authenticated actor, never the client.
          ownerUserId: actor.userId,
          ...(actor.tenantId !== undefined ? { tenantId: actor.tenantId } : {}),
          title,
          startAtMs,
          ...(endAtMs !== undefined ? { endAtMs } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(kind !== undefined ? { kind } : {}),
        }),
      );
      broadcastWorkbenchSignalsInvalidate({
        reason: "schedule",
        userIds: [actor.userId],
      });
      respond(true, { entry });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to upsert schedule entry";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },

  "schedule.entry.cancel": async ({ params, respond, client }) => {
    const actor = await resolveEmployeeWorkbenchActor(client);
    if (!actor) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no workbench actor"));
      return;
    }
    const record = asRecord(params);
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "id is required"));
      return;
    }
    try {
      // Scoped to the actor's own file: cancelling another user's entry is
      // impossible because we only ever open `actor.userId`'s store.
      const entry = await cancelScheduleEntry({ userId: actor.userId, id });
      if (entry) {
        broadcastWorkbenchSignalsInvalidate({
          reason: "schedule",
          userIds: [actor.userId],
        });
      }
      respond(true, { cancelled: Boolean(entry), entry: entry ?? null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to cancel schedule entry";
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
    }
  },
};
