/**
 * Gateway RPC handlers for passive connectors (git / cloudDrive / mailAttachment).
 * Runtime lives in sources/passive-connector-*; this file only wires auth + respond.
 */
import {
  ownershipProofFromLocalUser,
  ownershipProofFromTenantUser,
} from "../data-governance/ownership-proof.js";
import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { findPassiveConnectorBinding } from "../knowledge/sources/passive-connector-binding-store.js";
import { listPassiveConnectorProviders } from "../knowledge/sources/passive-connector-providers.js";
import {
  bindPassiveConnector,
  commitPassiveConnectorSync,
  listPassiveConnectorStatus,
  planPassiveConnectorSync,
  unbindPassiveConnector,
} from "../knowledge/sources/passive-connector-runtime.js";
import {
  isPassiveConnectorKind,
  type PassiveConnectorSyncCandidate,
  type PassiveConnectorSyncCommitFile,
} from "../knowledge/sources/passive-connector-types.js";
import {
  listKnowledgeSourceBindings,
  unbindKnowledgeSource,
} from "../knowledge/sources/source-binding-store.js";
import { deleteSourceDocumentLinksForSource } from "../knowledge/sources/source-document-link-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isRecord, stringValue } from "./request-params.js";
import type { GatewayRequestHandlers } from "./types.js";

function stringParam(value: unknown): string | undefined {
  return stringValue(value) ?? undefined;
}

function clientUserEmail(client: { user?: string | null } | null | undefined): string | null {
  const raw = typeof client?.user === "string" ? client.user.trim() : "";
  return raw || null;
}

function resolveConnectorGovernanceOwnershipProof(context: {
  userId: string | null;
  tenantId: string | null;
}) {
  const userId = context.userId?.trim();
  if (!userId) {
    return undefined;
  }
  const tenantId = context.tenantId?.trim() || null;
  return tenantId
    ? ownershipProofFromTenantUser({ tenantId, userId })
    : ownershipProofFromLocalUser({ userId });
}

type AuthKb = (
  knowledgeBaseId: string,
  context: Awaited<ReturnType<typeof resolveKnowledgeSourceContext>>,
  clientUser: string | null,
  permission: "read" | "write" | "admin",
) => import("../knowledge/knowledge-base-store.js").KnowledgeBase | null;

export function createKnowledgeConnectorHandlers(deps: {
  authorizedKnowledgeBase: AuthKb;
}): GatewayRequestHandlers {
  const { authorizedKnowledgeBase } = deps;

  return {
    "knowledge.connector.providers": async ({ respond }) => {
      respond(true, { providers: listPassiveConnectorProviders() });
    },

    "knowledge.connector.bind": async ({ params, respond, client }) => {
      const context = await resolveKnowledgeSourceContext(client);
      const clientUser = clientUserEmail(client);
      if (!context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required to bind connector"),
        );
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const kindRaw = stringParam(record.kind);
      if (!kindRaw || !isPassiveConnectorKind(kindRaw) || kindRaw === "localFolder") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "kind must be gitRepo | cloudDrive | mailAttachment",
          ),
        );
        return;
      }
      const knowledgeBaseId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
      if (!knowledgeBaseId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "knowledgeBaseId required"),
        );
        return;
      }
      const knowledgeBase = authorizedKnowledgeBase(knowledgeBaseId, context, clientUser, "write");
      if (!knowledgeBase) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to bind connector"),
        );
        return;
      }
      const label = stringParam(record.label) ?? "";
      const locator = stringParam(record.locator) ?? "";
      if (!locator) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "locator required"));
        return;
      }
      try {
        const result = bindPassiveConnector({
          request: {
            kind: kindRaw,
            knowledgeBaseId,
            label: label || locator,
            locator,
            deviceId: stringParam(record.deviceId),
            deletePolicy: stringParam(record.deletePolicy) === "sync" ? "sync" : "snapshot",
            config: isRecord(record.config)
              ? Object.fromEntries(
                  Object.entries(record.config).flatMap(([key, value]) =>
                    typeof value === "string" ? [[key, value] as const] : [],
                  ),
                )
              : undefined,
          },
          ownerId: context.userId,
          knowledgeBase,
        });
        respond(true, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "connector bind failed";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      }
    },

    "knowledge.connector.unbind": async ({ params, respond, client }) => {
      const context = await resolveKnowledgeSourceContext(client);
      const clientUser = clientUserEmail(client);
      if (!context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required to unbind connector"),
        );
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const bindingId = stringParam(record.bindingId);
      const sourceDescriptorId = stringParam(record.sourceDescriptorId);
      const binding = findPassiveConnectorBinding({ bindingId, sourceDescriptorId });
      const purgeProjected = record.purgeProjected === true;

      if (binding) {
        const knowledgeBase = authorizedKnowledgeBase(
          binding.knowledgeBaseId,
          context,
          clientUser,
          "write",
        );
        if (!knowledgeBase) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to unbind this connector"),
          );
          return;
        }
        try {
          const result = await unbindPassiveConnector({
            binding,
            knowledgeBase,
            ownerId: context.userId,
            purgeProjected,
          });
          respond(true, result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "connector unbind failed";
          respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        }
        return;
      }

      // Orphan SourceDescriptor (layer-2 binding already gone) — still remove the list row.
      if (!sourceDescriptorId) {
        respond(true, { ok: false, purged: 0 });
        return;
      }
      const descriptor = listKnowledgeSourceBindings().find(
        (item) => item.id === sourceDescriptorId,
      );
      if (!descriptor || descriptor.kind === "localFolder") {
        respond(true, { ok: false, purged: 0 });
        return;
      }
      const ownsBinding = descriptor.ownerId === context.userId;
      const canWriteKb = descriptor.knowledgeBaseId
        ? Boolean(authorizedKnowledgeBase(descriptor.knowledgeBaseId, context, clientUser, "write"))
        : false;
      if (!ownsBinding && !canWriteKb) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized to unbind this connector"),
        );
        return;
      }
      deleteSourceDocumentLinksForSource(sourceDescriptorId);
      respond(true, { ok: unbindKnowledgeSource(sourceDescriptorId), purged: 0 });
    },

    "knowledge.connector.status": async ({ params, respond, client }) => {
      const context = await resolveKnowledgeSourceContext(client);
      const clientUser = clientUserEmail(client);
      if (!context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required for connector status"),
        );
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const knowledgeBaseId = stringParam(record.knowledgeBaseId) ?? stringParam(record.kbId);
      const kindRaw = stringParam(record.kind);
      const kind =
        kindRaw && isPassiveConnectorKind(kindRaw) && kindRaw !== "localFolder"
          ? kindRaw
          : undefined;
      const items = listPassiveConnectorStatus({
        knowledgeBaseId,
        kind,
        bindingId: stringParam(record.bindingId),
        sourceDescriptorId: stringParam(record.sourceDescriptorId),
      }).filter((item) =>
        authorizedKnowledgeBase(item.knowledgeBaseId, context, clientUser, "read"),
      );
      respond(true, { items });
    },

    "knowledge.connector.sync.plan": async ({ params, respond, client }) => {
      const context = await resolveKnowledgeSourceContext(client);
      const clientUser = clientUserEmail(client);
      if (!context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required for connector sync plan"),
        );
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const binding = findPassiveConnectorBinding({
        bindingId: stringParam(record.bindingId),
        sourceDescriptorId: stringParam(record.sourceDescriptorId),
      });
      if (!binding) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "connector binding not found"),
        );
        return;
      }
      if (!authorizedKnowledgeBase(binding.knowledgeBaseId, context, clientUser, "write")) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized for connector sync"),
        );
        return;
      }
      try {
        const candidatesRaw = Array.isArray(record.candidates) ? record.candidates : [];
        const candidates: PassiveConnectorSyncCandidate[] = candidatesRaw.flatMap((row, index) => {
          if (!row || typeof row !== "object") {
            return [];
          }
          const relativePath = stringParam((row as { relativePath?: unknown }).relativePath);
          if (!relativePath) {
            throw new Error(`relativePath required for sync candidate at index ${index}`);
          }
          return [
            {
              relativePath,
              rawHash: stringParam((row as { rawHash?: unknown }).rawHash),
              sizeBytes:
                typeof (row as { sizeBytes?: unknown }).sizeBytes === "number"
                  ? (row as { sizeBytes: number }).sizeBytes
                  : undefined,
              mtimeMs:
                typeof (row as { mtimeMs?: unknown }).mtimeMs === "number"
                  ? (row as { mtimeMs: number }).mtimeMs
                  : undefined,
            },
          ];
        });
        respond(true, planPassiveConnectorSync({ binding, candidates }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "connector sync plan failed";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      }
    },

    "knowledge.connector.sync.commit": async ({ params, respond, client }) => {
      const context = await resolveKnowledgeSourceContext(client);
      const clientUser = clientUserEmail(client);
      if (!context.userId) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "user context required for connector sync commit"),
        );
        return;
      }
      const record = params && typeof params === "object" ? params : {};
      const binding = findPassiveConnectorBinding({
        bindingId: stringParam(record.bindingId),
        sourceDescriptorId: stringParam(record.sourceDescriptorId),
      });
      if (!binding) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "connector binding not found"),
        );
        return;
      }
      const knowledgeBase = authorizedKnowledgeBase(
        binding.knowledgeBaseId,
        context,
        clientUser,
        "write",
      );
      if (!knowledgeBase) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "not authorized for connector sync"),
        );
        return;
      }
      const filesRaw = Array.isArray(record.files) ? record.files : [];
      const files: PassiveConnectorSyncCommitFile[] = filesRaw.flatMap((row, index) => {
        if (!row || typeof row !== "object") {
          return [];
        }
        const relativePath = stringParam((row as { relativePath?: unknown }).relativePath);
        if (!relativePath) {
          throw new Error(`relativePath required for sync commit file at index ${index}`);
        }
        return [
          {
            relativePath,
            fileName: stringParam((row as { fileName?: unknown }).fileName),
            mimeType: stringParam((row as { mimeType?: unknown }).mimeType),
            contentBase64: stringParam((row as { contentBase64?: unknown }).contentBase64),
            textContent: stringParam((row as { textContent?: unknown }).textContent),
            rawHash: stringParam((row as { rawHash?: unknown }).rawHash),
          },
        ];
      });
      try {
        const result = await commitPassiveConnectorSync({
          binding,
          knowledgeBase,
          ownerId: context.userId,
          files,
          client,
          governanceOwnershipProof: resolveConnectorGovernanceOwnershipProof(context),
        });
        respond(true, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "connector sync commit failed";
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
      }
    },
  };
}
