import { describe, expect, it, vi } from "vitest";
import { parseLatestCutoverSha, resolveLiveSha, type LiveShaReaders } from "./resolve-live-sha.js";

const endpointSha = "1".repeat(40);
const containerSha = "2".repeat(40);
const recordSha = "3".repeat(40);

function readers(overrides: Partial<LiveShaReaders> = {}): LiveShaReaders {
  return {
    endpoint: vi.fn(async () => null),
    container: vi.fn(async () => null),
    stoppedContainer: vi.fn(async () => null),
    releaseRecord: vi.fn(async () => null),
    ledger: vi.fn(async () => null),
    ...overrides,
  };
}

function record(sha: string): string {
  return `# Release record

## Latest cutover (fixture)

| Field | Value |
| --- | --- |
| Source revision | \`${sha}\` |

---
`;
}

describe("resolveLiveSha", () => {
  it("uses an explicit injected SHA for offline verification", async () => {
    const io = readers({ releaseRecord: vi.fn(async () => record(endpointSha)) });

    const result = await resolveLiveSha({ injectedSha: endpointSha, readers: io });

    expect(result).toMatchObject({ sha: endpointSha, source: "injected" });
    expect(io.endpoint).not.toHaveBeenCalled();
  });

  it("prefers an artifact endpoint over the container", async () => {
    const io = readers({
      endpoint: vi.fn(async () => JSON.stringify({ "build-info": { commit: endpointSha } })),
      container: vi.fn(async () => JSON.stringify({ commit: containerSha })),
    });

    const result = await resolveLiveSha({ readers: io });

    expect(result).toMatchObject({ sha: endpointSha, source: "endpoint" });
    expect(io.container).not.toHaveBeenCalled();
  });

  it("falls back to a running container build-info file", async () => {
    const io = readers({ container: vi.fn(async () => JSON.stringify({ commit: containerSha })) });

    const result = await resolveLiveSha({ readers: io });

    expect(result).toMatchObject({ sha: containerSha, source: "container" });
    expect(io.stoppedContainer).not.toHaveBeenCalled();
  });

  it("falls back to copying build-info from a stopped container", async () => {
    const io = readers({
      stoppedContainer: vi.fn(async () => JSON.stringify({ commit: containerSha })),
    });

    await expect(resolveLiveSha({ readers: io })).resolves.toMatchObject({
      sha: containerSha,
      source: "container-copy",
    });
  });

  it("warns when the running artifact disagrees with the release record", async () => {
    const io = readers({
      endpoint: vi.fn(async () => JSON.stringify({ commit: endpointSha })),
      releaseRecord: vi.fn(async () => record(recordSha)),
    });

    const result = await resolveLiveSha({ readers: io });

    expect(result.sha).toBe(endpointSha);
    expect(result.warnings).toEqual([
      `running artifact LIVE ${endpointSha} differs from release record ${recordSha}`,
    ]);
  });

  it("returns null when no artifact reports a commit", async () => {
    await expect(resolveLiveSha({ readers: readers() })).resolves.toMatchObject({
      sha: null,
      source: "none",
    });
  });

  it("ignores non-git overlay commit labels and entrySha256 digests", async () => {
    const overlay = JSON.stringify({
      commit: "homepage-mac-download-255",
      entrySha256: `${containerSha}${"a".repeat(24)}`,
      entry: "index-Duazyt22.js",
    });
    const io = readers({ container: vi.fn(async () => overlay) });

    await expect(resolveLiveSha({ readers: io })).resolves.toMatchObject({
      sha: null,
      source: "none",
    });
  });

  it("does not harvest digests from JSON that omits commit", async () => {
    const overlay = JSON.stringify({
      entrySha256: `${endpointSha}${"b".repeat(24)}`,
    });
    const io = readers({ container: vi.fn(async () => overlay) });

    await expect(resolveLiveSha({ readers: io })).resolves.toMatchObject({
      sha: null,
      source: "none",
    });
  });

  it("parses only the Latest cutover source revision", () => {
    expect(
      parseLatestCutoverSha(
        `${record(recordSha)}\n## Prior cutover\n| Source revision | \`${endpointSha}\` |`,
      ),
    ).toBe(recordSha);
  });
});
