import { afterEach, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn(() => []));
vi.mock("./knowledge-base-store.js", () => ({
  listKnowledgeBases: list,
  getKnowledgeBase: vi.fn(),
}));
import {
  setRetrievalSummaryGenerationAuthority,
  tickConfiguredRetrievalSummaries,
} from "./retrieval-summary-runtime.js";
afterEach(() => {
  setRetrievalSummaryGenerationAuthority(undefined);
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("an environment opt-in alone cannot enumerate tenant documents or call a provider", async () => {
  vi.stubEnv("OPENBOT_KNOWLEDGE_RETRIEVAL_SUMMARIES", "1");
  await tickConfiguredRetrievalSummaries();
  expect(list).not.toHaveBeenCalled();
});
it("a generation authority cannot activate the worker without explicit opt-in", async () => {
  vi.stubEnv("OPENBOT_KNOWLEDGE_RETRIEVAL_SUMMARIES", "0");
  const authorize = vi.fn();
  setRetrievalSummaryGenerationAuthority({ authorize });
  await tickConfiguredRetrievalSummaries();
  expect(authorize).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
});
