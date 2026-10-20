// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetKnowledgeRetrievalServiceForTests } from "../../retrieval/retrieval-service.js";
import { resetDeliverableRetrievalSourceRegistrationForTests } from "../../retrieval/sources/deliverable-source.js";
import { resetKnowledgeRetrievalSourceRegistrationForTests } from "../../retrieval/sources/knowledge-source.js";
import type { KnowledgeSourceContext } from "./sources/types.js";
import { searchWorkspace } from "./workspace-search.js";

const { tmpDir } = vi.hoisted(() => {
  const dir = `/tmp/openbot-ws-step9b-${Math.random().toString(36).slice(2)}`;
  return { tmpDir: dir };
});

const contextState = vi.hoisted(() => ({
  current: {
    userId: "user-a",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
  } satisfies KnowledgeSourceContext,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

vi.mock("./context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => contextState.current),
}));

const { knowledgeHandlers } = await import("../server-methods/knowledge.js");

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
};

async function invoke(method: string, params: Record<string, unknown> = {}): Promise<InvokeResult> {
  const handler = knowledgeHandlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "test@example.com" },
    isWebchatConnect: () => false,
    respond: (ok, payload) => {
      response = { ok, payload: payload as Record<string, unknown> | undefined };
    },
    context: {} as never,
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("workspace search step9b integration", () => {
  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, "knowledge"), { recursive: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    resetKnowledgeRetrievalServiceForTests();
    resetKnowledgeRetrievalSourceRegistrationForTests();
    resetDeliverableRetrievalSourceRegistrationForTests();
  });

  it("recalls attached deliverable body via workspace search after ingest", async () => {
    const collected = await invoke("knowledge.personal.collect", {
      title: "Indexed Deliverable",
      summary: "Unique workspace recall marker zeta-9b-body",
    });
    expect(collected.ok).toBe(true);
    const skillId = collected.payload?.skillId as string;

    const created = await invoke("knowledge.base.create", { title: "Deliverable Archive KB" });
    const kbId = (created.payload?.knowledgeBase as { id?: string })?.id;
    expect(kbId).toBeTruthy();

    const attached = await invoke("knowledge.deliverables.attach", {
      knowledgeBaseId: kbId,
      deliverableId: `skill:${skillId}`,
    });
    expect(attached.ok).toBe(true);
    const ingest = attached.payload?.ingest as { skipped?: boolean; chunkCount?: number };
    expect(ingest?.skipped).not.toBe(true);

    const result = await searchWorkspace(
      { connect: {} as never, user: "test@example.com" },
      { query: "zeta-9b-body", limitPerGroup: 5 },
    );
    const deliverables = result.groups.find((group) => group.group === "deliverables")?.hits ?? [];
    expect(deliverables.some((hit) => hit.deliverableId === `skill:${skillId}`)).toBe(true);
  });
});
