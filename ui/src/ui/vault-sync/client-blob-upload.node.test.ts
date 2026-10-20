import { describe, expect, it } from "vitest";
import { iterCiphertextChunkRanges, VAULT_SYNC_DEFAULT_CHUNK_SIZE } from "./client-blob-upload.ts";

describe("iterCiphertextChunkRanges", () => {
  it("covers the full ciphertext without gaps", () => {
    const totalSizeBytes = VAULT_SYNC_DEFAULT_CHUNK_SIZE + 1024;
    const chunkSize = VAULT_SYNC_DEFAULT_CHUNK_SIZE;
    const chunkCount = 2;
    const ranges = iterCiphertextChunkRanges({ totalSizeBytes, chunkSize, chunkCount });
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ chunkIndex: 0, start: 0, end: chunkSize });
    expect(ranges[1]).toEqual({ chunkIndex: 1, start: chunkSize, end: totalSizeBytes });
  });
});
