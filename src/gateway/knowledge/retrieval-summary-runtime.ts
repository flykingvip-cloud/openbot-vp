import fs from "node:fs";
import type { AgentKnowledgeLlmCaller } from "./agent-knowledge-generator.js";
import {
  createGovernanceResourceBudget,
  applyGovernanceResourceUsage,
} from "./governance/runtime/job-resource-budget.js";
import { incrementGovernanceLlmUsageLocal } from "./governance/usage/governance-llm-usage-store.js";
import { openKnowledgeIndex, resolveKnowledgeIndexDbPath } from "./kb-index.js";
import { getKnowledgeBase, listKnowledgeBases } from "./knowledge-base-store.js";
import { generateHierarchicalSummary } from "./retrieval-summary-hierarchy.js";
import { queueRetrievalSummary, ensureRetrievalSummarySchema } from "./retrieval-summary-store.js";
import { tickRetrievalSummaries } from "./retrieval-summary-worker.js";

export type RetrievalSummaryGenerationAuthority = {
  /** Must resolve tenant model entitlement, provider transmission authorization and billing budget. */
  authorize: (input: {
    kbId: string;
    tenantId: string | null;
    ownerId: string;
    docId: string;
  }) => Promise<
    | {
        llm: AgentKnowledgeLlmCaller;
        charge: (usage: { inputTokens: number; outputTokens: number }) => Promise<void>;
      }
    | undefined
  >;
};
let generationAuthority: RetrievalSummaryGenerationAuthority | undefined;
/** Composition-root only: an environment variable never substitutes for tenant authorization. */
export function setRetrievalSummaryGenerationAuthority(
  authority: RetrievalSummaryGenerationAuthority | undefined,
): void {
  generationAuthority = authority;
}

/** Disabled by default. Explicit operator opt-in; at most two bounded calls per tick. */
export async function tickConfiguredRetrievalSummaries() {
  if (process.env.OPENBOT_KNOWLEDGE_RETRIEVAL_SUMMARIES !== "1") {
    return;
  }
  const authority = generationAuthority;
  if (!authority) {
    return;
  }
  const budget = createGovernanceResourceBudget({
    maxJobsPerRound: 2,
    maxLlmCallsPerRound: 2,
    maxEmbeddingCallsPerRound: 0,
    maxSimilarityQueriesPerRound: 0,
  });
  for (const base of listKnowledgeBases()) {
    if (budget.llmCallsRemaining <= 0) {
      break;
    }
    const dbPath = resolveKnowledgeIndexDbPath({ ownerId: base.ownerId, tenantId: base.tenantId });
    if (!fs.existsSync(dbPath)) {
      continue;
    }
    const index = await openKnowledgeIndex({ dbPath, vectorEnabled: false });
    try {
      ensureRetrievalSummarySchema(index.db);
      // Bounded legacy backfill, only for still-owned KB documents and current revisions.
      const missing = index.db
        .prepare(
          "SELECT d.doc_id,v.version_id,v.semantic_hash FROM documents d JOIN document_versions v ON v.version_id=d.current_version_id LEFT JOIN retrieval_summaries r ON r.doc_id=d.doc_id WHERE d.kb_id=? AND r.doc_id IS NULL ORDER BY d.doc_id LIMIT 100",
        )
        .all(base.id);
      for (const row of missing) {
        if (base.documentIds.includes(String(row.doc_id))) {
          queueRetrievalSummary(index.db, {
            docId: String(row.doc_id),
            kbId: base.id,
            versionId: String(row.version_id),
            contentHash: String(row.semantic_hash),
          });
        }
      }
      await tickRetrievalSummaries({
        db: index.db,
        allowedKbIds: new Set([base.id]),
        limit: 2,
        acquireBudget: async () => {
          if (budget.llmCallsRemaining <= 0) {
            return false;
          }
          return true;
        },
        readAuthorizedSource: async (docId) => {
          const current = getKnowledgeBase(base.id);
          if (
            !current ||
            current.ownerId !== base.ownerId ||
            current.tenantId !== base.tenantId ||
            !current.documentIds.includes(docId)
          ) {
            return undefined;
          }
          const source = index.db
            .prepare(
              "SELECT v.version_id,v.semantic_hash FROM documents d JOIN document_versions v ON v.version_id=d.current_version_id WHERE d.doc_id=? AND d.kb_id=?",
            )
            .get(docId, base.id);
          if (!source) {
            return undefined;
          }
          const rows = index.db
            .prepare(
              "SELECT c.text FROM chunks c JOIN chunk_meta m ON m.chunk_id=c.id WHERE m.doc_id=? AND m.kb_id=? AND m.version_id=? ORDER BY m.start_line LIMIT 200",
            )
            .all(docId, base.id, String(source.version_id));
          const body = rows.map((row) => String(row.text)).join("\n");
          // Never summarize only the front of a long source as if complete.
          if (body.length > 192000 || rows.length >= 200) {
            return undefined;
          }
          return {
            versionId: String(source.version_id),
            contentHash: String(source.semantic_hash),
            body,
          };
        },
        generate: async (source) => {
          const documentType = /^#.*(?:会议|纪要|meeting)/imu.test(source.body)
            ? ("meeting" as const)
            : /^#.*(?:制度|流程|SOP)/imu.test(source.body)
              ? ("sop" as const)
              : /^#.*(?:报告|研究|report)/imu.test(source.body)
                ? ("report" as const)
                : ("other" as const);
          const fields = await generateHierarchicalSummary({
            db: index.db,
            docId: source.documentId,
            versionId: source.versionId,
            contentHash: source.contentHash,
            body: source.body,
            documentType,
            call: async (prompt) => {
              if (budget.llmCallsRemaining <= 0) {
                return undefined;
              }
              const grant = await authority.authorize({
                kbId: base.id,
                tenantId: base.tenantId,
                ownerId: base.ownerId,
                docId: source.documentId,
              });
              if (!grant) {
                throw Error("generation_not_authorized");
              }
              applyGovernanceResourceUsage(budget, {
                llmCalls: 1,
                embeddingCalls: 0,
                similarityQueries: 0,
              });
              const response = await grant.llm({ maxTokens: 1200, prompt });
              if (!response) {
                throw Error("model_unavailable");
              }
              await grant.charge({
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
              });
              incrementGovernanceLlmUsageLocal({
                db: index.db,
                kbId: base.id,
                inputTokens: response.inputTokens,
                outputTokens: response.outputTokens,
                now: Date.now(),
              });
              return response.text;
            },
          });
          return {
            schemaVersion: 1,
            state: "ready",
            documentType,
            sourceVersionId: source.versionId,
            sourceContentHash: source.contentHash,
            templateVersion: "1",
            generatedAt: Date.now(),
            fields,
          };
        },
      });
    } finally {
      index.close();
    }
  }
}
