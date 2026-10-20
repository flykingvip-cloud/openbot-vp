/**
 * worker/registry.ts — Worker Adapter Registry (development-supervisor M0).
 *
 * Parallel to the tool `AdapterRegistry` (`src/fabric/adapter-registry.ts`): holds
 * `Worker` instances by id, validates on register, rejects duplicates, and returns
 * null on miss (no silent execution). The Supervisor resolves workers ONLY through
 * this registry, so adding a new worker class is a register call — no engine change.
 */

import type { Worker, WorkerControlCapability, WorkerTaskCapability } from "./types.js";

export class WorkerAdapterRegistry {
  private readonly byId = new Map<string, Worker>();

  constructor(workers: readonly Worker[] = []) {
    for (const w of workers) {
      this.register(w);
    }
  }

  /** Register a worker. Throws on invalid shape or duplicate id. */
  register(worker: Worker): Worker {
    const id = worker?.id?.trim();
    if (!id) {
      throw new Error("worker.id is required");
    }
    if (
      typeof worker.start !== "function" ||
      typeof worker.status !== "function" ||
      typeof worker.cancel !== "function" ||
      typeof worker.logs !== "function"
    ) {
      throw new Error(`worker "${id}" must implement start/status/cancel/logs`);
    }
    if (this.byId.has(id)) {
      throw new Error(`worker "${id}" is already registered`);
    }
    this.byId.set(id, worker);
    return worker;
  }

  /** Resolve a worker by id, or null when not registered (no silent fallback). */
  resolve(id: string): Worker | null {
    return this.byId.get(id?.trim()) ?? null;
  }

  /** List all registered worker ids. */
  ids(): string[] {
    return [...this.byId.keys()];
  }

  list(): Worker[] {
    return [...this.byId.values()];
  }

  /**
   * Find workers matching ALL requested capabilities on both axes (P1-2). Empty
   * filters match everything. This is the seam future Worker Selection builds on.
   */
  findByCapability(filter: {
    taskCapabilities?: readonly WorkerTaskCapability[];
    control?: readonly WorkerControlCapability[];
  }): Worker[] {
    const wantTask = filter.taskCapabilities ?? [];
    const wantControl = filter.control ?? [];
    return this.list().filter(
      (w) =>
        wantTask.every((c) => w.taskCapabilities.includes(c)) &&
        wantControl.every((c) => w.control.includes(c)),
    );
  }
}
