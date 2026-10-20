import fs from "node:fs";
import path from "node:path";
import type { WorkspaceCutoverOperation } from "./types.js";

export type WorkspaceCutoverStore = {
  get(operationId: string): WorkspaceCutoverOperation | null;
  save(operation: WorkspaceCutoverOperation): void;
  listByResource(resourceId: string): WorkspaceCutoverOperation[];
};

export class InMemoryWorkspaceCutoverStore implements WorkspaceCutoverStore {
  private readonly ops = new Map<string, WorkspaceCutoverOperation>();

  get(operationId: string): WorkspaceCutoverOperation | null {
    return this.ops.get(operationId) ?? null;
  }

  save(operation: WorkspaceCutoverOperation): void {
    this.ops.set(operation.operationId, operation);
  }

  listByResource(resourceId: string): WorkspaceCutoverOperation[] {
    return [...this.ops.values()].filter((op) => op.resourceId === resourceId);
  }
}

type CutoverStoreFile = {
  operations: Record<string, WorkspaceCutoverOperation>;
};

export class FileWorkspaceCutoverStore implements WorkspaceCutoverStore {
  constructor(private readonly filePath: string) {}

  private readFile(): CutoverStoreFile {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { operations: {} };
      }
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { operations: {} };
      }
      const record = parsed as CutoverStoreFile;
      return { operations: record.operations ?? {} };
    } catch {
      return { operations: {} };
    }
  }

  private writeFile(data: CutoverStoreFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  get(operationId: string): WorkspaceCutoverOperation | null {
    return this.readFile().operations[operationId] ?? null;
  }

  save(operation: WorkspaceCutoverOperation): void {
    const data = this.readFile();
    data.operations[operation.operationId] = operation;
    this.writeFile(data);
  }

  listByResource(resourceId: string): WorkspaceCutoverOperation[] {
    return Object.values(this.readFile().operations).filter((op) => op.resourceId === resourceId);
  }
}
