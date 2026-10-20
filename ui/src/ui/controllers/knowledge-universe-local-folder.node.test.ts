import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPortState } from "../app-port-state.ts";
import type {
  LocalFolderBindRequest,
  LocalFolderSyncCommitRequest,
  LocalFolderSyncCommitResponse,
  LocalFolderSyncPlanRequest,
  LocalFolderSyncPlanResponse,
} from "../capability/knowledge-universe/endpoints.ts";
import type { KnowledgeUniverseGateway } from "../capability/knowledge-universe/gateway-client.ts";
import {
  getManagedPushDirectoryId,
  ManagedPushReadError,
  pickManagedPushDirectory,
  rememberManagedPushDirectory,
  resolveManagedPushFolderDisplayPath,
  syncManagedPushDirectory,
} from "./knowledge-universe-local-folder-upload.ts";
import {
  bindKnowledgeUniverseLocalFolder,
  formatLocalFolderImportOutcome,
  formatLocalFolderImportProgressLabel,
  localizeLocalFolderBindingError,
  localizeLocalFolderError,
  pickKnowledgeUniverseLocalFolderPath,
} from "./knowledge-universe-local-folder.ts";
import { getKnowledgeUniverseRuntime } from "./knowledge-universe.ts";

vi.mock("../device-identity.ts", () => ({
  loadOrCreateDeviceIdentity: async () => ({ deviceId: "device-1" }),
  signDevicePayload: async () => "signed-device-payload",
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryFile(name: string, text: string, type = "text/plain"): FileSystemFileHandle {
  const bytes = new TextEncoder().encode(text);
  const file = {
    name,
    size: bytes.byteLength,
    type,
    lastModified: 1_720_000_000_000,
    arrayBuffer: async () => bytes.slice().buffer,
  } as File;
  return {
    kind: "file",
    name,
    getFile: async () => file,
  } as FileSystemFileHandle;
}

function memoryDirectory(name: string, entries: FileSystemHandle[]): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() {
      yield* entries;
    },
  } as FileSystemDirectoryHandle;
}

function syncResponse(): LocalFolderSyncCommitResponse {
  return {
    bindingId: "binding-1",
    sourceDescriptorId: "source-1",
    ingested: 0,
    skipped: 0,
    tombstoned: 0,
    snapshotted: 0,
    errors: [],
  };
}

function syncPlan(patch: Partial<LocalFolderSyncPlanResponse> = {}): LocalFolderSyncPlanResponse {
  return {
    bindingId: "binding-1",
    sourceDescriptorId: "source-1",
    needUpload: [],
    unchanged: [],
    missingOnDevice: [],
    planId: "lfp:plan-1",
    generation: 7,
    deviceId: "device-1",
    expiresAtMs: 1_900_000_000_000,
    ...patch,
  };
}

function gatewayWith(params: {
  plan: (request: LocalFolderSyncPlanRequest) => Promise<LocalFolderSyncPlanResponse>;
  commit: (request: LocalFolderSyncCommitRequest) => Promise<LocalFolderSyncCommitResponse>;
}): KnowledgeUniverseGateway {
  return {
    localFolderSyncPlan: params.plan,
    localFolderSyncCommit: params.commit,
  } as KnowledgeUniverseGateway;
}

describe("resolveManagedPushFolderDisplayPath", () => {
  it("prefers a native handle path and otherwise shows only the folder name", () => {
    expect(
      resolveManagedPushFolderDisplayPath(
        memoryDirectory("UPBEYOND", []) as FileSystemDirectoryHandle & { path?: string },
      ),
    ).toBe("UPBEYOND");
    const withPath = memoryDirectory("UPBEYOND", []) as FileSystemDirectoryHandle & {
      path?: string;
    };
    withPath.path = "/Users/daniel/Documents/UPBEYOND";
    expect(resolveManagedPushFolderDisplayPath(withPath)).toBe("/Users/daniel/Documents/UPBEYOND");
  });
});

describe("managed local-folder upload", () => {
  it("plans the complete inventory, uploads with one lease, then finalizes server deletes", async () => {
    const directory = memoryDirectory("Knowledge", [
      memoryDirectory("docs", [memoryFile("readme.md", "hello")]),
      memoryFile("unchanged.txt", "same"),
      memoryFile("photo.png", "not-an-image", "image/png"),
      memoryFile("data.json", '{"ignored":true}', "application/json"),
      memoryFile("archive.zip", "not-an-archive", "application/zip"),
      memoryFile("legacy.doc", "legacy", "application/msword"),
      memoryDirectory(".git", [memoryFile("config", "private metadata")]),
      memoryDirectory("node_modules", [memoryFile("dependency.js", "generated")]),
      memoryDirectory("dist", [memoryFile("bundle.js", "generated")]),
      memoryFile(".DS_Store", "finder metadata"),
      memoryFile("empty.txt", ""),
    ]);
    const plan = vi.fn(async (_request: LocalFolderSyncPlanRequest) =>
      syncPlan({
        needUpload: [{ relativePath: "readme.md", reason: "missing", docId: "doc-readme" }],
        unchanged: ["unchanged.txt"],
        missingOnDevice: ["removed.txt"],
      }),
    );
    const commitRequests: LocalFolderSyncCommitRequest[] = [];
    const commit = vi.fn(async (request: LocalFolderSyncCommitRequest) => {
      commitRequests.push(request);
      return syncResponse();
    });

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });

    expect(plan).toHaveBeenCalledOnce();
    const planRequest = plan.mock.calls[0][0];
    expect(planRequest.candidates.map((candidate) => candidate.relativePath).toSorted()).toEqual([
      "readme.md",
      "unchanged.txt",
    ]);
    expect(planRequest.candidates.every((candidate) => candidate.rawHash?.length === 64)).toBe(
      true,
    );
    expect(commitRequests).toHaveLength(2);
    expect(commitRequests[0]).toMatchObject({
      bindingId: "binding-1",
      deviceId: "device-1",
      planId: "lfp:plan-1",
      generation: 7,
      phase: "upload",
    });
    expect(commitRequests[0].files).toHaveLength(1);
    expect(commitRequests[0].files[0]).toMatchObject({
      relativePath: "readme.md",
      fileName: "readme.md",
      mimeType: "text/plain",
    });
    expect(commitRequests[0].files[0].contentBase64).toBe(btoa("hello"));
    expect(commitRequests[1]).toEqual({
      bindingId: "binding-1",
      deviceId: "device-1",
      planId: "lfp:plan-1",
      generation: 7,
      phase: "finalize",
      files: [],
    });
    expect(result).toEqual({
      candidateCount: 2,
      uploadedCount: 1,
      deletedCount: 1,
      commitCount: 2,
      documents: [],
      readyCount: 0,
      allReady: true,
      skipped: [{ relativePath: "empty.txt", fileName: "empty.txt", reason: "empty" }],
    });
  });

  it("uploads only flattened files and skips extensionless folder shells", async () => {
    const directory = memoryDirectory("OpenBot", [
      memoryDirectory("图书室", [memoryFile("手册.md", "# 手册")]),
      memoryFile("UPBEYOND", "folder shell", "text/plain"),
      memoryFile("notes.txt", "keep"),
    ]);
    const plan = vi.fn(async (_request: LocalFolderSyncPlanRequest) =>
      syncPlan({
        needUpload: [
          { relativePath: "手册.md", reason: "missing", docId: "doc-book" },
          { relativePath: "notes.txt", reason: "missing", docId: "doc-notes" },
        ],
      }),
    );
    const commit = vi.fn(async () => syncResponse());

    await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });

    expect(plan.mock.calls[0][0].candidates.map((item) => item.relativePath).toSorted()).toEqual([
      "notes.txt",
      "手册.md",
    ]);
  });

  it("commits each upload file separately and reports scan/upload/finalize progress", async () => {
    const directory = memoryDirectory("Knowledge", [
      memoryFile("one.md", "first"),
      memoryFile("two.md", "second"),
    ]);
    const plan = vi.fn(async () =>
      syncPlan({
        needUpload: [
          { relativePath: "one.md", reason: "missing", docId: "doc-one" },
          { relativePath: "two.md", reason: "missing", docId: "doc-two" },
        ],
      }),
    );
    const commitRequests: LocalFolderSyncCommitRequest[] = [];
    const commit = vi.fn(async (request: LocalFolderSyncCommitRequest) => {
      commitRequests.push(request);
      return syncResponse();
    });
    const progress: Array<{ phase: string; current: number; total: number; fileName?: string }> =
      [];

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
      onProgress: (event) => progress.push(event),
    });

    expect(commitRequests.filter((request) => request.phase === "upload")).toHaveLength(2);
    expect(commitRequests.map((request) => request.files.map((file) => file.relativePath))).toEqual(
      [["one.md"], ["two.md"], []],
    );
    expect(progress[0]).toEqual({ phase: "scan", current: 0, total: 0, scanStage: "listing" });
    expect(progress).toContainEqual({
      phase: "scan",
      current: 1,
      total: 0,
      fileName: "one.md",
      scanStage: "listing",
    });
    expect(progress).toContainEqual({
      phase: "scan",
      current: 2,
      total: 0,
      fileName: "two.md",
      scanStage: "listing",
    });
    expect(progress).toContainEqual({
      phase: "scan",
      current: 1,
      total: 2,
      fileName: "one.md",
      scanStage: "hashing",
    });
    expect(progress).toContainEqual({
      phase: "scan",
      current: 2,
      total: 2,
      fileName: "two.md",
      scanStage: "hashing",
    });
    expect(progress).toContainEqual({
      phase: "upload",
      current: 1,
      total: 2,
      fileName: "one.md",
    });
    expect(progress).toContainEqual({
      phase: "upload",
      current: 2,
      total: 2,
      fileName: "two.md",
    });
    expect(progress.at(-1)).toEqual({ phase: "finalize", current: 2, total: 2 });
    expect(result.commitCount).toBe(3);
  });

  it("keeps files that landed when search vectors are deferred", async () => {
    const directory = memoryDirectory("Knowledge", [memoryFile("brief.pdf", "deck")]);
    const plan = vi.fn(async () =>
      syncPlan({
        needUpload: [{ relativePath: "brief.pdf", reason: "missing", docId: "doc-brief" }],
      }),
    );
    const commit = vi.fn(async (request: LocalFolderSyncCommitRequest) => {
      if (request.phase === "upload") {
        return {
          ...syncResponse(),
          ingested: 1,
          errors: ["brief.pdf: no such module: vec0"],
          documents: [
            {
              relativePath: "brief.pdf",
              docId: "doc-brief",
              originalStored: true,
              chunkCount: 2,
              vectorCount: 0,
              ready: false,
            },
          ],
        };
      }
      return syncResponse();
    });

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });

    expect(result.uploadedCount).toBe(1);
    expect(result.documents).toHaveLength(1);
    expect(result.skipped).toEqual([
      { relativePath: "brief.pdf", fileName: "brief.pdf", reason: "index_deferred" },
    ]);
    expect(commit.mock.calls.some((call) => call[0].phase === "finalize")).toBe(true);
  });

  it("skips an unreadable unsupported file instead of aborting the folder", async () => {
    const lockedPng = {
      kind: "file",
      name: "locked.png",
      getFile: async () => {
        throw new DOMException(
          "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
          "NotReadableError",
        );
      },
    } as unknown as FileSystemFileHandle;
    const directory = memoryDirectory("UPBEYOND", [memoryFile("ok.md", "readable"), lockedPng]);
    const plan = vi.fn(async (_request: LocalFolderSyncPlanRequest) => syncPlan());
    const commit = vi.fn(async () => syncResponse());

    await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });

    const planRequest = plan.mock.calls[0][0];
    expect(planRequest.candidates.map((item) => item.relativePath)).toEqual(["ok.md"]);
  });

  it("uploads readable files and reports unreadable documents after the folder finishes", async () => {
    const lockedMd = {
      kind: "file",
      name: "notes.md",
      getFile: async () => {
        throw new DOMException(
          "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
          "NotReadableError",
        );
      },
    } as unknown as FileSystemFileHandle;
    const directory = memoryDirectory("UPBEYOND", [memoryFile("ok.md", "readable"), lockedMd]);
    const plan = vi.fn(async (request: LocalFolderSyncPlanRequest) =>
      syncPlan({
        needUpload: request.candidates.map((item) => ({
          relativePath: item.relativePath,
          reason: "missing" as const,
          docId: `doc-${item.relativePath}`,
        })),
      }),
    );

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({
        plan,
        commit: async () => syncResponse(),
      }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });

    expect(plan.mock.calls[0][0].candidates.map((item) => item.relativePath)).toEqual(["ok.md"]);
    expect(plan.mock.calls[0][0].retainRelativePaths).toEqual(["notes.md"]);
    expect(result.uploadedCount).toBe(1);
    expect(result.skipped).toEqual([
      { relativePath: "notes.md", fileName: "notes.md", reason: "unreadable" },
    ]);
  });

  it("surfaces index-and-vector readiness from each upload commit", async () => {
    const directory = memoryDirectory("Knowledge", [memoryFile("note.md", "body")]);
    const plan = vi.fn(async () =>
      syncPlan({
        needUpload: [{ relativePath: "note.md", reason: "missing", docId: "doc-note" }],
      }),
    );
    const progress: Array<{ phase: string; current: number; total: number }> = [];
    const commit = vi.fn(async (request: LocalFolderSyncCommitRequest) => {
      if (request.phase !== "upload") {
        return syncResponse();
      }
      return {
        ...syncResponse(),
        ingested: 1,
        documents: [
          {
            relativePath: "note.md",
            docId: "doc-note",
            originalStored: true,
            chunkCount: 2,
            vectorCount: 2,
            ready: true,
          },
        ],
      };
    });

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
      onProgress: (event) => progress.push(event),
    });

    expect(progress).toContainEqual({ phase: "index", current: 1, total: 1, readyCount: 1 });
    expect(result.allReady).toBe(true);
    expect(result.readyCount).toBe(1);
    expect(result.documents).toEqual([
      {
        relativePath: "note.md",
        docId: "doc-note",
        originalStored: true,
        chunkCount: 2,
        vectorCount: 2,
        ready: true,
      },
    ]);
  });

  it("reuses a session directory identity when the browser returns a new equivalent handle", async () => {
    const directoryHandle = () => {
      const handle = memoryDirectory("Reselected", []) as FileSystemDirectoryHandle & {
        testIdentity: string;
      };
      handle.testIdentity = "same-directory";
      handle.isSameEntry = async (other) =>
        (other as FileSystemDirectoryHandle & { testIdentity?: string }).testIdentity ===
        handle.testIdentity;
      return handle;
    };
    const firstHandle = directoryHandle();
    const secondHandle = directoryHandle();
    const picker = vi
      .fn<() => Promise<FileSystemDirectoryHandle>>()
      .mockResolvedValueOnce(firstHandle)
      .mockResolvedValueOnce(secondHandle);
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("window", { showDirectoryPicker: picker });
    const firstState = {} as AppPortState;
    const secondState = {} as AppPortState;

    await pickManagedPushDirectory(firstState);
    await pickManagedPushDirectory(secondState);

    expect(picker).toHaveBeenCalledTimes(2);
    expect(getManagedPushDirectoryId(firstState)).toMatch(/^directory:/);
    expect(getManagedPushDirectoryId(secondState)).toBe(getManagedPushDirectoryId(firstState));
  });

  it("fails before plan and commit when the directory inventory exceeds the cap", async () => {
    let reads = 0;
    const file = memoryFile("placeholder.txt", "");
    const directory = {
      kind: "directory",
      name: "TooMany",
      async *values() {
        for (let index = 0; index <= 2_000; index += 1) {
          yield {
            kind: "file",
            name: `file-${index}.txt`,
            getFile: async () => {
              reads += 1;
              return file.getFile();
            },
          } as FileSystemFileHandle;
        }
      },
    } as FileSystemDirectoryHandle;
    const plan = vi.fn(async (): Promise<LocalFolderSyncPlanResponse> => {
      throw new Error("plan must not run");
    });
    const commit = vi.fn(async (): Promise<LocalFolderSyncCommitResponse> => syncResponse());

    await expect(
      syncManagedPushDirectory({
        gateway: gatewayWith({ plan, commit }),
        bindingId: "binding-1",
        deviceId: "device-1",
        directory,
      }),
    ).rejects.toThrow("more than 2000 files");
    expect(reads).toBe(0);
    expect(plan).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects an unsafe or out-of-inventory upload plan before commit", async () => {
    const directory = memoryDirectory("Knowledge", [memoryFile("safe.txt", "safe")]);
    const plan = vi.fn(async () =>
      syncPlan({
        needUpload: [{ relativePath: "../escape.txt", reason: "missing", docId: "doc-1" }],
      }),
    );
    const commit = vi.fn(async (): Promise<LocalFolderSyncCommitResponse> => syncResponse());

    await expect(
      syncManagedPushDirectory({
        gateway: gatewayWith({ plan, commit }),
        bindingId: "binding-1",
        deviceId: "device-1",
        directory,
      }),
    ).rejects.toThrow("Unsafe local-folder path");
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a plan lease issued for another device", async () => {
    const directory = memoryDirectory("Knowledge", []);
    const plan = vi.fn(async () => syncPlan({ deviceId: "device-2" }));
    const commit = vi.fn(async (): Promise<LocalFolderSyncCommitResponse> => syncResponse());

    await expect(
      syncManagedPushDirectory({
        gateway: gatewayWith({ plan, commit }),
        bindingId: "binding-1",
        deviceId: "device-1",
        directory,
      }),
    ).rejects.toThrow(/different device identity/i);
    expect(commit).not.toHaveBeenCalled();
  });

  it("never finalizes after an upload commit fails", async () => {
    const directory = memoryDirectory("Knowledge", [memoryFile("note.txt", "note")]);
    const plan = vi.fn(async () =>
      syncPlan({
        needUpload: [{ relativePath: "note.txt", reason: "missing", docId: "doc-1" }],
        missingOnDevice: ["old.txt"],
      }),
    );
    const commit = vi.fn(
      async (request: LocalFolderSyncCommitRequest): Promise<LocalFolderSyncCommitResponse> => ({
        ...syncResponse(),
        errors: request.phase === "upload" ? ["upload failed"] : [],
      }),
    );

    const result = await syncManagedPushDirectory({
      gateway: gatewayWith({ plan, commit }),
      bindingId: "binding-1",
      deviceId: "device-1",
      directory,
    });
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].phase).toBe("upload");
    expect(result.uploadedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
    expect(result.skipped).toEqual([
      { relativePath: "note.txt", fileName: "note.txt", reason: "upload_failed" },
    ]);
  });
});

describe("formatLocalFolderImportProgressLabel", () => {
  it("shows discovered and hashed file counts during scan", () => {
    expect(
      formatLocalFolderImportProgressLabel({
        phase: "scan",
        current: 0,
        total: 0,
        scanStage: "listing",
      }),
    ).toBe("Reading folder…");
    expect(
      formatLocalFolderImportProgressLabel({
        phase: "scan",
        current: 12,
        total: 0,
        fileName: "notes.md",
        scanStage: "listing",
      }),
    ).toBe("Finding files… 12 found");
    expect(
      formatLocalFolderImportProgressLabel({
        phase: "scan",
        current: 3,
        total: 8,
        fileName: "notes.md",
        scanStage: "hashing",
      }),
    ).toBe("Reading and checking 3/8: notes.md");
  });
});

describe("formatLocalFolderImportOutcome", () => {
  it("explains successful uploads and the files that could not be uploaded", () => {
    const outcome = formatLocalFolderImportOutcome(
      {
        candidateCount: 1,
        uploadedCount: 1,
        deletedCount: 0,
        commitCount: 2,
        documents: [],
        readyCount: 0,
        allReady: true,
        skipped: [
          { relativePath: "notes.md", fileName: "notes.md", reason: "unreadable" },
          { relativePath: "huge.pdf", fileName: "huge.pdf", reason: "too_large" },
        ],
      },
      "UPBEYOND",
    );
    expect(outcome.kind).toBe("notice");
    expect(outcome.text).toContain("saved 1");
    expect(outcome.text).toContain("did not succeed");
    expect(outcome.text).toContain("notes.md");
    expect(outcome.text).toContain("huge.pdf");
    expect(outcome.text).toContain("8 MB");
  });

  it("does not treat deferred search enhancement as a whole-batch failure", () => {
    const outcome = formatLocalFolderImportOutcome(
      {
        candidateCount: 2,
        uploadedCount: 2,
        deletedCount: 0,
        commitCount: 2,
        documents: [
          {
            relativePath: "a.pdf",
            docId: "doc-a",
            originalStored: true,
            chunkCount: 3,
            vectorCount: 0,
            ready: false,
          },
          {
            relativePath: "b.pdf",
            docId: "doc-b",
            originalStored: true,
            chunkCount: 2,
            vectorCount: 0,
            ready: false,
          },
        ],
        readyCount: 0,
        allReady: false,
        skipped: [],
      },
      "日常成果",
    );
    expect(outcome.kind).toBe("notice");
    expect(outcome.text).toContain("saved 2");
    expect(outcome.text).toMatch(/preview/i);
    expect(outcome.text).not.toMatch(/did not succeed/i);
  });
});

describe("localizeLocalFolderError", () => {
  it("does not leak the browser permission English to the import page", () => {
    expect(
      localizeLocalFolderError(new ManagedPushReadError("file-unreadable", "docs/notes.md")),
    ).toContain("docs/notes.md");
    expect(
      localizeLocalFolderError(
        new DOMException(
          "The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.",
          "NotReadableError",
        ),
      ),
    ).toContain("Choose");
    expect(localizeLocalFolderError(new Error("no such module: vec0"))).toMatch(/preview/i);
    expect(localizeLocalFolderBindingError("no such module: vec0")).toMatch(/preview/i);
  });
});

describe("bindKnowledgeUniverseLocalFolder", () => {
  it("preserves an explicit shared-space target and binds an opaque directory id", async () => {
    let bindRequest: LocalFolderBindRequest | undefined;
    const requests: Array<{ method: string; params: unknown }> = [];
    const request = vi.fn(async (method: string, params?: unknown) => {
      requests.push({ method, params });
      switch (method) {
        case "knowledge.local-folder.bind":
          bindRequest = params as LocalFolderBindRequest;
          return {
            bindingId: "binding-1",
            sourceDescriptorId: "source-1",
            knowledgeBaseId: "team-1",
            rootLabel: "Notes",
          };
        case "knowledge.local-folder.sync.plan":
          return syncPlan();
        case "knowledge.local-folder.sync.commit":
          return syncResponse();
        case "knowledge.base.sources.list":
          return { knowledgeBaseId: "team-1", sources: [] };
        case "knowledge.local-folder.status":
          return { items: [] };
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const state = {
      client: { request },
      connected: true,
      requestUpdate: vi.fn(),
    } as unknown as AppPortState;
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [
      {
        id: "team-1",
        title: "Team",
        description: "",
        documentCount: 0,
        visibility: "team",
        updatedAtMs: 1_720_000_000_000,
      },
    ];
    runtime.selectedKnowledgeBaseId = "team-1";
    runtime.libraryWorkspaceLocalFolderMode = "local_index";
    runtime.libraryWorkspaceLocalFolderWatcherEnabled = true;
    runtime.libraryWorkspaceLocalFolderPath = "/Users/example/team-notes";
    runtime.libraryWorkspaceLocalFolderLabel = "Notes";
    rememberManagedPushDirectory(state, memoryDirectory("team-notes", []), "directory-team-1");

    await bindKnowledgeUniverseLocalFolder(state);

    expect(bindRequest).toEqual({
      knowledgeBaseId: "team-1",
      rootLabel: "Notes",
      directoryId: "directory-team-1",
      mode: "managed_push",
      deletePolicy: "snapshot",
      watcherEnabled: false,
      deviceId: "device-1",
    });
    expect(bindRequest).not.toHaveProperty("rootPath");
    expect(
      requests.find((entry) => entry.method === "knowledge.local-folder.sync.plan")?.params,
    ).toEqual({
      bindingId: "binding-1",
      deviceId: "device-1",
      candidates: [],
      retainRelativePaths: [],
    });
    expect(
      requests.find((entry) => entry.method === "knowledge.local-folder.sync.commit")?.params,
    ).toEqual({
      bindingId: "binding-1",
      deviceId: "device-1",
      planId: "lfp:plan-1",
      generation: 7,
      phase: "finalize",
      files: [],
    });
    expect(runtime.libraryWorkspaceLocalFolderMode).toBe("managed_push");
    expect(runtime.libraryWorkspaceLocalFolderWatcherEnabled).toBe(false);
    expect(runtime.libraryWorkspaceLocalFolderPath).toBe("");
    expect(runtime.libraryWorkspaceImportOpen).toBe(false);
    expect(runtime.personalActionNotice).toContain("No new files needed");
  });

  it("tells the user when index and vectors are ready for robot full-text read", async () => {
    const request = vi.fn(async (method: string) => {
      switch (method) {
        case "knowledge.local-folder.bind":
          return {
            bindingId: "binding-1",
            sourceDescriptorId: "source-1",
            knowledgeBaseId: "team-1",
            rootLabel: "Notes",
          };
        case "knowledge.local-folder.sync.plan":
          return syncPlan({
            needUpload: [{ relativePath: "note.md", reason: "missing", docId: "doc-note" }],
          });
        case "knowledge.local-folder.sync.commit":
          return {
            ...syncResponse(),
            ingested: 1,
            documents: [
              {
                relativePath: "note.md",
                docId: "doc-note",
                originalStored: true,
                chunkCount: 2,
                vectorCount: 2,
                ready: true,
              },
            ],
          };
        case "knowledge.base.sources.list":
          return { knowledgeBaseId: "team-1", sources: [] };
        case "knowledge.local-folder.status":
          return { items: [] };
        default:
          throw new Error(`Unexpected method: ${method}`);
      }
    });
    const state = {
      client: { request },
      connected: true,
      requestUpdate: vi.fn(),
    } as unknown as AppPortState;
    const runtime = getKnowledgeUniverseRuntime(state);
    runtime.knowledgeBases = [
      {
        id: "team-1",
        title: "Team",
        description: "",
        documentCount: 0,
        visibility: "team",
        updatedAtMs: 1_720_000_000_000,
      },
    ];
    runtime.selectedKnowledgeBaseId = "team-1";
    rememberManagedPushDirectory(
      state,
      memoryDirectory("Notes", [memoryFile("note.md", "body")]),
      "directory-team-1",
    );

    await bindKnowledgeUniverseLocalFolder(state);

    expect(runtime.personalActionError).toBeNull();
    expect(runtime.personalActionNotice).toContain("index and vectors are ready");
  });

  it("writes the native folder path when the handle exposes one", async () => {
    const directory = memoryDirectory("UPBEYOND", []) as FileSystemDirectoryHandle & {
      path?: string;
    };
    directory.path = "/Users/daniel/Documents/UPBEYOND";
    vi.stubGlobal("window", {
      showDirectoryPicker: async () => directory,
    });
    const state = { requestUpdate: vi.fn() } as unknown as AppPortState;

    await pickKnowledgeUniverseLocalFolderPath(state);

    expect(getKnowledgeUniverseRuntime(state).libraryWorkspaceLocalFolderPath).toBe(
      "/Users/daniel/Documents/UPBEYOND",
    );
  });

  it("stops before bind when the browser denies folder read permission", async () => {
    const request = vi.fn(async () => {
      throw new Error("bind must not run");
    });
    const directory = memoryDirectory("UPBEYOND", []) as FileSystemDirectoryHandle & {
      queryPermission?: () => Promise<PermissionState>;
      requestPermission?: () => Promise<PermissionState>;
    };
    directory.queryPermission = async () => "prompt";
    directory.requestPermission = async () => "denied";
    const state = {
      client: { request },
      connected: true,
      requestUpdate: vi.fn(),
    } as unknown as AppPortState;
    rememberManagedPushDirectory(state, directory, "directory-team-1");

    await bindKnowledgeUniverseLocalFolder(state);

    expect(request).not.toHaveBeenCalled();
    expect(getKnowledgeUniverseRuntime(state).personalActionError).toContain("Choose");
  });
});
