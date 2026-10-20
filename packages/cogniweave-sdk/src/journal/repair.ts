import type { WriteJournal } from "../models.js";
import type { GraphStore, MetadataStore, VectorStore } from "../storage/types.js";

export async function rebuildFromTruth(params: {
  metadataStore: MetadataStore;
  graphStore: GraphStore;
  vectorStore: VectorStore;
  journal: WriteJournal;
}): Promise<{
  graph: { nodeCount: number; edgeCount: number };
  vector: { documentCount: number };
}> {
  const bundle = await params.metadataStore.getBundleForJournal(params.journal);
  const graph = await params.graphStore.rebuildFromBundle(bundle);
  const vector = await params.vectorStore.rebuildFromBundle(bundle);
  return { graph, vector };
}

export async function repairDerivedIndexes(params: {
  metadataStore: MetadataStore;
  graphStore: GraphStore;
  vectorStore: VectorStore;
  journal: WriteJournal;
}): Promise<{
  repaired: true;
  graph: { nodeCount: number; edgeCount: number };
  vector: { documentCount: number };
}> {
  const result = await rebuildFromTruth(params);
  await params.metadataStore.updateJournal(params.journal.id, {
    status: "COMPLETED",
    phase: "COMPLETED",
    lastError: undefined,
    updatedAt: new Date().toISOString(),
  });
  return { repaired: true, ...result };
}
