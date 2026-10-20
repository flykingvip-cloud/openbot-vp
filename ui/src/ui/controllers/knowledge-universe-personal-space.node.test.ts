import { describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import { ensurePersonalKnowledgeBase } from "./knowledge-universe-personal-space.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

function knowledgeBase(
  id: string,
  visibility: KnowledgeBaseSummary["visibility"],
): KnowledgeBaseSummary {
  return {
    id,
    title: id,
    description: "",
    documentCount: 0,
    visibility,
    updatedAtMs: 1_720_000_000_000,
  };
}

function stateWithRequest(request: ReturnType<typeof vi.fn>): AppPortState {
  return {
    client: { request },
    requestUpdate: vi.fn(),
  } as unknown as AppPortState;
}

describe("ensurePersonalKnowledgeBase", () => {
  it("selects an existing private space even when a team space is selected", async () => {
    const request = vi.fn();
    const state = stateWithRequest(request);
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [knowledgeBase("team", "team"), knowledgeBase("private", "private")];
    runtime.selectedKnowledgeBaseId = "team";

    await expect(ensurePersonalKnowledgeBase(state)).resolves.toBe("private");
    expect(runtime.selectedKnowledgeBaseId).toBe("private");
    expect(state.knowledgeUniverseSelectedKnowledgeBaseId).toBe("private");
    expect(request).not.toHaveBeenCalled();
  });

  it("re-lists before creation and reuses a private space discovered on the gateway", async () => {
    const remotePrivate = knowledgeBase("remote-private", "private");
    const request = vi.fn(async (method: string) => {
      if (method === "knowledge.base.list") {
        return { knowledgeBases: [knowledgeBase("team", "team"), remotePrivate] };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const state = stateWithRequest(request);
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [knowledgeBase("team", "team")];
    runtime.selectedKnowledgeBaseId = "team";

    await expect(ensurePersonalKnowledgeBase(state)).resolves.toBe("remote-private");
    expect(runtime.selectedKnowledgeBaseId).toBe("remote-private");
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("knowledge.base.list");
  });

  it("single-flights concurrent default private-space creation", async () => {
    const created = {
      ...knowledgeBase("created-private", "private"),
      ownerId: "owner",
      documentIds: [],
    };
    let releaseList: (() => void) | undefined;
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "knowledge.base.list") {
        await listGate;
        return { knowledgeBases: [knowledgeBase("team", "team")] };
      }
      if (method === "knowledge.base.create") {
        expect(params).toMatchObject({ visibility: "private" });
        return { knowledgeBase: created };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const state = stateWithRequest(request);
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [knowledgeBase("team", "team")];
    runtime.selectedKnowledgeBaseId = "team";

    const first = ensurePersonalKnowledgeBase(state);
    const second = ensurePersonalKnowledgeBase(state);
    releaseList?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "created-private",
      "created-private",
    ]);
    expect(request.mock.calls.filter(([method]) => method === "knowledge.base.list")).toHaveLength(
      1,
    );
    expect(
      request.mock.calls.filter(([method]) => method === "knowledge.base.create"),
    ).toHaveLength(1);
    expect(runtime.selectedKnowledgeBaseId).toBe("created-private");
    expect(runtime.knowledgeBases.filter((kb) => kb.visibility === "private")).toHaveLength(1);
  });

  it("single-flights default creation across independent app states", async () => {
    const team = knowledgeBase("team", "team");
    const created = {
      ...knowledgeBase("shared-private", "private"),
      ownerId: "owner",
      documentIds: [],
    };
    let remoteKnowledgeBases: KnowledgeBaseSummary[] = [team];
    const request = vi.fn(async (method: string) => {
      if (method === "knowledge.base.list") {
        return { knowledgeBases: [...remoteKnowledgeBases] };
      }
      if (method === "knowledge.base.create") {
        remoteKnowledgeBases = [...remoteKnowledgeBases, created];
        return { knowledgeBase: created };
      }
      throw new Error(`Unexpected method: ${method}`);
    });
    const firstState = stateWithRequest(request);
    const secondState = stateWithRequest(request);
    for (const state of [firstState, secondState]) {
      const runtime = getKnowledgeUniverseRuntime(state);
      runtime.knowledgeBases = [team];
      runtime.selectedKnowledgeBaseId = "team";
    }

    await expect(
      Promise.all([
        ensurePersonalKnowledgeBase(firstState),
        ensurePersonalKnowledgeBase(secondState),
      ]),
    ).resolves.toEqual(["shared-private", "shared-private"]);
    expect(request.mock.calls.filter(([method]) => method === "knowledge.base.list")).toHaveLength(
      2,
    );
    expect(
      request.mock.calls.filter(([method]) => method === "knowledge.base.create"),
    ).toHaveLength(1);
  });

  it("clears the single-flight after failure so a retry can succeed", async () => {
    let listAttempts = 0;
    const remotePrivate = knowledgeBase("retry-private", "private");
    const request = vi.fn(async (method: string) => {
      if (method !== "knowledge.base.list") {
        throw new Error(`Unexpected method: ${method}`);
      }
      listAttempts += 1;
      if (listAttempts === 1) {
        throw new Error("temporary failure");
      }
      return { knowledgeBases: [remotePrivate] };
    });
    const state = stateWithRequest(request);

    await expect(ensurePersonalKnowledgeBase(state)).rejects.toThrow("temporary failure");
    await expect(ensurePersonalKnowledgeBase(state)).resolves.toBe("retry-private");
    expect(listAttempts).toBe(2);
  });
});
