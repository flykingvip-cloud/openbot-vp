import { randomUUID } from "node:crypto";
import { completeSimple } from "@earendil-works/pi-ai/compat";
import { getApiKeyForModel, requireApiKey } from "../../agents/model-auth.js";
import { resolveModel } from "../../agents/pi-embedded-runner/model.js";
import { loadConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  tryAcquireEnterpriseAgentRun,
  releaseEnterpriseAgentRun,
} from "../billing/agent-run-governance.js";
import { recordCreditUsage } from "../billing/record-credit-usage.js";
import { enqueueUsageOutbox, markUsageOutboxDone } from "../billing/usage-outbox-store.js";
import { buildEmployeeAccessSnapshot } from "../enterprise-seat-assets-store.js";
import { loadSeatAssetsStoreForTenantId } from "../platform-auth/seat-store-loader.js";
import { getKnowledgeBase } from "./knowledge-base-store.js";
import type { RetrievalSummaryGenerationAuthority } from "./retrieval-summary-runtime.js";

/** Server-only tenant commercial admission. No global model fallback for private or unknown scopes. */
export function createRetrievalSummaryGenerationAuthority(): RetrievalSummaryGenerationAuthority {
  return {
    authorize: async (input) => {
      if (!input.tenantId) {
        return undefined;
      }
      const base = getKnowledgeBase(input.kbId);
      if (
        !base ||
        base.ownerId !== input.ownerId ||
        base.tenantId !== input.tenantId ||
        !base.documentIds.includes(input.docId)
      ) {
        return undefined;
      }
      const cfg = loadConfig();
      const seats = await loadSeatAssetsStoreForTenantId(input.tenantId, cfg);
      const access = buildEmployeeAccessSnapshot({
        store: seats,
        tenantId: input.tenantId,
        employeeId: input.ownerId,
      });
      if (!access.currentSeat || access.currentSeat.status !== "occupied") {
        return undefined;
      }
      const seat = seats.seats[access.currentSeat.seatId];
      const bindings = Object.values(seats.bindings).filter(
        (binding) =>
          binding.tenantId === input.tenantId &&
          binding.employeeId === input.ownerId &&
          binding.bindingStatus === "active",
      );
      if (
        !seat ||
        seat.tenantId !== input.tenantId ||
        seat.currentEmployeeId !== input.ownerId ||
        bindings.length !== 1 ||
        bindings[0]?.seatId !== seat.seatId
      ) {
        return undefined;
      }
      const runId = `knowledge-summary:${randomUUID()}`;
      const admitted = await tryAcquireEnterpriseAgentRun({
        runId,
        enterpriseId: input.tenantId,
        queueMaxWaitMs: 0,
        modelGateInput: {
          cfg,
          enterpriseIdHint: input.tenantId,
          gatewayClientSessionDomain: "employee",
          collaborationGroupOwnerEntitlement: {
            tenantId: input.tenantId,
            seatId: access.currentSeat.seatId,
            employeeId: input.ownerId,
          },
          taskText: "Summarize an authorized knowledge document into structured retrieval metadata",
        },
      });
      if (!admitted.acquired) {
        return undefined;
      }
      const gate = admitted.modelGate;
      const reference =
        gate?.preferredModelOrder?.find((id) => gate.allowlist?.includes(id)) ??
        gate?.allowlist?.[0];
      if (
        !reference ||
        !gate?.creditReporting ||
        admitted.enterpriseId !== input.tenantId ||
        gate.creditReporting.enterpriseId !== input.tenantId ||
        (gate.tenantId !== undefined && gate.tenantId !== input.tenantId)
      ) {
        await releaseEnterpriseAgentRun(runId);
        return undefined;
      }
      const slash = reference.indexOf("/");
      if (slash < 1) {
        await releaseEnterpriseAgentRun(runId);
        return undefined;
      }
      const provider = reference.slice(0, slash);
      const modelId = reference.slice(slash + 1);
      return {
        llm: async ({ prompt, maxTokens }) => {
          try {
            const resolved = await resolveModel(provider, modelId, undefined, cfg);
            if (!resolved.model) {
              return null;
            }
            const apiKey = requireApiKey(
              await getApiKeyForModel({ model: resolved.model, cfg }),
              provider,
            );
            const result = await completeSimple(
              resolved.model,
              { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
              {
                apiKey,
                maxTokens: maxTokens ?? 1200,
                signal: AbortSignal.timeout(20000),
                temperature: 0.2,
              },
            );
            const text = result.content
              .filter((block) => block.type === "text")
              .map((block) => (block.type === "text" ? block.text : ""))
              .join("\n");
            return { text, inputTokens: result.usage.input, outputTokens: result.usage.output };
          } catch (error) {
            // No usage is invented when transport fails before a provider receipt.
            createSubsystemLogger("knowledge/summary-commercial").warn(
              "summary model call failed before usage receipt",
              { runId, tenantId: input.tenantId, modelId: reference, usageStatus: "unknown" },
            );
            throw error;
          } finally {
            await releaseEnterpriseAgentRun(runId);
          }
        },
        charge: async (usage) => {
          const payload = {
            enterpriseId: input.tenantId!,
            taskId: runId,
            runId,
            modelId: reference,
            policyId: gate.creditReporting!.policyId,
            userId: input.ownerId,
            orgSeatId: access.currentSeat!.seatId,
            tokenUsage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
            authorizationDecisionId: admitted.authorizationDecisionId,
            subscriptionId: admitted.subscriptionId,
            subscriptionSnapshotId: admitted.subscriptionSnapshotId,
            planId: admitted.planId,
            planVersionId: admitted.planVersionId,
          };
          // Durable acceptance is the commit point for generated section progress.
          // Outbox failure propagates; immediate settlement failure must not discard
          // the accepted provider output and cause another paid generation.
          const receipt = await enqueueUsageOutbox(payload);
          try {
            await recordCreditUsage(payload);
            await markUsageOutboxDone(receipt.id);
          } catch {
            createSubsystemLogger("knowledge/summary-commercial").warn(
              "summary usage accepted; settlement remains pending",
              {
                runId,
                tenantId: input.tenantId,
                receiptId: receipt.id,
              },
            );
          }
        },
      };
    },
  };
}
