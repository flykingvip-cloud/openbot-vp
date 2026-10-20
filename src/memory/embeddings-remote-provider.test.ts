import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRemoteEmbeddingVectors } from "./embeddings-remote-fetch.js";
import { createRemoteEmbeddingProvider } from "./embeddings-remote-provider.js";

vi.mock("./embeddings-remote-fetch.js", () => ({
  fetchRemoteEmbeddingVectors: vi.fn(),
}));

describe("createRemoteEmbeddingProvider", () => {
  const fetchMock = vi.mocked(fetchRemoteEmbeddingVectors);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pages embedBatch so a 12-chunk document never sends more than 10 inputs", async () => {
    fetchMock.mockImplementation(async (params) => {
      const body = params.body as { input: string[] };
      expect(body.input.length).toBeLessThanOrEqual(10);
      return body.input.map((_, index) => [index]);
    });

    const { embedBatch } = createRemoteEmbeddingProvider({
      id: "openai",
      errorPrefix: "openai embeddings failed",
      client: {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        headers: {},
        model: "text-embedding-v4",
      },
    });

    const texts = Array.from({ length: 12 }, (_, i) => `pdf-chunk-${i}`);
    const vectors = await embedBatch(texts);
    expect(vectors).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = fetchMock.mock.calls[0]?.[0]?.body as { input: string[] };
    const secondBody = fetchMock.mock.calls[1]?.[0]?.body as { input: string[] };
    expect(firstBody.input).toHaveLength(10);
    expect(secondBody.input).toHaveLength(2);
  });
});
