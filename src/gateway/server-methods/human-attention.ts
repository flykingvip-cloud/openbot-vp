/**
 * Human-attention intake RPCs (watchdog / heartbeat human takeover).
 * Conversation cards call act; workbench pending-tasks lists open todos.
 */
import { loadConfig } from "../../config/config.js";
import { actHumanAttentionCard } from "../collaboration-dispatch/human-attention-actions.js";
import { buildHumanAttentionAuthority } from "../collaboration-dispatch/human-attention-business.js";
import {
  buildHumanAttentionCard,
  type HumanAttentionOptionId,
} from "../collaboration-dispatch/human-attention-card.js";
import {
  getHumanAttentionTodo,
  listHumanAttentionTodos,
} from "../collaboration-dispatch/human-attention-inbox.js";
import { resolveDeliveryAclActor } from "../collaboration-learning/delivery-actor-binding.js";
import { resolveEmployeeWorkbenchActor } from "../employee-workbench-scope.js";
import {
  ErrorCodes,
  errorShape,
  validateCollaborationTaskActHumanAttentionParams,
  validateCollaborationTaskListHumanAttentionParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

export const humanAttentionHandlers: GatewayRequestHandlers = {
  "collaboration.task.listHumanAttention": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskListHumanAttentionParams,
        "collaboration.task.listHumanAttention",
        respond,
      )
    ) {
      return;
    }
    try {
      const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
      let actorId = "";
      if (groupId) {
        actorId = (await resolveDeliveryAclActor(client, groupId))?.trim() ?? "";
      }
      if (!actorId) {
        const workbench = await resolveEmployeeWorkbenchActor(client);
        actorId = workbench?.userId?.trim() ?? workbench?.userEmail?.trim() ?? "";
      }
      if (!actorId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "authenticated actor required"),
        );
        return;
      }
      const todos = listHumanAttentionTodos({
        actorId,
        groupIds: groupId ? [groupId] : undefined,
        includeResolved: params.includeResolved === true,
        limit: typeof params.limit === "number" ? params.limit : 50,
      });
      const cards = todos
        .map((todo) =>
          buildHumanAttentionCard({
            todoId: todo.id,
            groupId: todo.groupId,
            taskId: todo.taskId,
            boardItemId: todo.itemId,
            fingerprint: todo.fingerprint,
            version: todo.version,
            failureKind: todo.failureKind,
            reason: todo.reason,
            ownerIds: todo.ownerIds,
            recoveryHint: todo.recoveryHint,
            taskTitle: todo.taskTitle,
            boardStatus: todo.boardStatus,
            status: todo.status,
            resolution: todo.resolution,
          }),
        )
        .filter(Boolean);
      respond(true, { todos, cards }, undefined);
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

  "collaboration.task.actHumanAttention": async ({ params, respond, client }) => {
    if (
      !assertValidParams(
        params,
        validateCollaborationTaskActHumanAttentionParams,
        "collaboration.task.actHumanAttention",
        respond,
      )
    ) {
      return;
    }
    try {
      const todo = getHumanAttentionTodo(params.todoId);
      if (!todo) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "todo not found"));
        return;
      }
      let actorId = (await resolveDeliveryAclActor(client, todo.groupId))?.trim() ?? "";
      if (!actorId) {
        const workbench = await resolveEmployeeWorkbenchActor(client);
        actorId = workbench?.userId?.trim() ?? workbench?.userEmail?.trim() ?? "";
      }
      if (!actorId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "authenticated actor required"),
        );
        return;
      }
      const cfg = loadConfig();
      const { authority } = buildHumanAttentionAuthority({
        groupId: todo.groupId,
        taskId: todo.taskId,
        cfg,
      });
      const result = await actHumanAttentionCard({
        todoId: params.todoId,
        action: params.action as HumanAttentionOptionId,
        actorId,
        expectedVersion: params.expectedVersion,
        expectedFingerprint: params.expectedFingerprint,
        transferOwnerId: params.transferOwnerId,
        note: params.note,
        cfg,
        authority,
      });
      if (!result.ok) {
        respond(
          false,
          { reason: result.reason, todo: result.todo },
          errorShape(ErrorCodes.INVALID_REQUEST, result.message ?? result.reason),
        );
        return;
      }
      const card = buildHumanAttentionCard({
        todoId: result.todo.id,
        groupId: result.todo.groupId,
        taskId: result.todo.taskId,
        boardItemId: result.todo.itemId,
        fingerprint: result.todo.fingerprint,
        version: result.todo.version,
        failureKind: result.todo.failureKind,
        reason: result.todo.reason,
        ownerIds: result.todo.ownerIds,
        recoveryHint: result.todo.recoveryHint,
        taskTitle: result.todo.taskTitle,
        boardStatus: result.todo.boardStatus,
        status: result.todo.status,
        resolution: result.todo.resolution,
      });
      respond(
        true,
        {
          todo: result.todo,
          card,
          evidence: result.evidence,
          heartbeatCleared: result.heartbeatCleared,
        },
        undefined,
      );
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
};
