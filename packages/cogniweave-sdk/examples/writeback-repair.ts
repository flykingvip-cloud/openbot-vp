import type { DistillationResult } from "../src/index.js";
import {
  InMemoryCogniWeaveEngine,
  InMemoryGraphStore,
  InMemoryMetadataStore,
  InMemoryVectorStore,
} from "../src/index.js";

class FailingOnceGraphStore extends InMemoryGraphStore {
  private failed = false;

  override async syncFromDistillation(result: DistillationResult): Promise<{
    nodeCount: number;
    edgeCount: number;
  }> {
    if (!this.failed) {
      this.failed = true;
      throw new Error("simulated graph sync failure");
    }
    return await super.syncFromDistillation(result);
  }
}

async function main(): Promise<void> {
  const metadataStore = new InMemoryMetadataStore();
  const graphStore = new FailingOnceGraphStore();
  const vectorStore = new InMemoryVectorStore();

  const engine = new InMemoryCogniWeaveEngine(
    {
      environment: "local",
      metadataBackend: "memory",
      graphBackend: "memory",
      evidenceBackend: "memory",
      vectorBackend: "memory",
    },
    { metadataStore, graphStore, vectorStore },
  );

  const scope = {
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentId: "agent_main",
    visibility: "private" as const,
  };

  const result = await engine.writeBack({
    rawInput: "Throughput is dropping and the external API is slow. Should we add sync retries?",
    scope,
    sourceType: "chat",
    sourceSessionId: "sess_partial",
  });

  console.log("Initial status:", result.status);
  console.log("Canonical status:", result.canonicalStatus);
  console.log("Derived status:", result.derivedStatus);

  const journalBefore = await engine.getWriteJournal(result.journalId, scope);
  console.log("Journal before repair:", journalBefore.status);

  const repair = await engine.repairIndexes({ journalId: result.journalId });
  console.log("Repair status:", repair.status);

  const journalAfter = await engine.getWriteJournal(result.journalId, scope);
  console.log("Journal after repair:", journalAfter.status);
}

void main();
