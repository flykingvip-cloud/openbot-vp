/**
 * One controllable draft-note site for the write extension review.
 * In memory only. No external origin, no personal credential, no publish.
 */

import { createHash } from "node:crypto";
import { TrustedOperationFault } from "./operations.js";
import { draftNoteContentDigest, type SarWriteEffect } from "./write-effect.js";

export type DraftNoteFault = { kind: "RESULT_UNKNOWN" | "TIMEOUT"; landed: boolean };

export type DraftNote = {
  noteId: string;
  title: string;
  body: string;
  revision: number;
  contentDigest: string;
};

export type DraftReceipt = {
  bindingId: string;
  idempotencyKey: string;
  effect: SarWriteEffect;
  noteId: string;
  title: string;
  body: string;
  revision: number;
  payloadDigest: string;
  contentDigest: string;
};

export type DraftApplyInput = {
  bindingId: string;
  effect: SarWriteEffect;
  idempotencyKey: string;
  noteId: string | null;
  title: string;
  body: string;
  payloadDigest: string;
};

function noteKey(bindingId: string, noteId: string): string {
  return `${bindingId}\n${noteId}`;
}

function receiptKey(bindingId: string, idempotencyKey: string): string {
  return `${bindingId}\n${idempotencyKey}`;
}

export function fixtureNoteId(bindingId: string, idempotencyKey: string): string {
  const digest = createHash("sha256").update(`${bindingId}\n${idempotencyKey}`).digest("hex");
  return `note_${digest.slice(0, 12)}`;
}

/**
 * Create and update share this site. Each apply is one write dispatch.
 * Recheck reads receipts and does not increment the dispatch count.
 */
export class ControllableDraftNoteSite {
  applyCount = 0;
  maxConcurrent = 0;
  private applying = 0;
  private hold: Promise<void> | null = null;
  private readonly applyingWaiters: Array<() => void> = [];
  private fault: DraftNoteFault | null = null;
  private readonly notes = new Map<string, DraftNote>();
  private readonly receipts = new Map<string, DraftReceipt>();

  reset(): void {
    this.applyCount = 0;
    this.maxConcurrent = 0;
    this.applying = 0;
    this.hold = null;
    this.applyingWaiters.length = 0;
    this.fault = null;
    this.notes.clear();
    this.receipts.clear();
  }

  holdNextApply(gate: Promise<void>): void {
    this.hold = gate;
  }

  waitUntilApplying(): Promise<void> {
    if (this.applying > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.applyingWaiters.push(resolve);
    });
  }

  failNext(fault: DraftNoteFault | null): void {
    this.fault = fault;
  }

  currentFault(): DraftNoteFault | null {
    return this.fault ? { ...this.fault } : null;
  }

  observe(bindingId: string, idempotencyKey: string): DraftReceipt | null {
    const found = this.receipts.get(receiptKey(bindingId, idempotencyKey));
    return found ? { ...found } : null;
  }

  readNote(bindingId: string, noteId: string): DraftNote | null {
    const found = this.notes.get(noteKey(bindingId, noteId));
    return found ? { ...found } : null;
  }

  async applyDraft(input: DraftApplyInput): Promise<{ note: DraftNote; receipt: DraftReceipt }> {
    this.applyCount += 1;
    this.applying += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.applying);
    const waiters = this.applyingWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
    const hold = this.hold;
    this.hold = null;
    try {
      if (hold) {
        await hold;
      }
      const fault = this.fault;
      this.fault = null;
      if (fault) {
        if (fault.landed) {
          this.commit(input);
        }
        throw new TrustedOperationFault(fault.kind === "TIMEOUT" ? "TIMEOUT" : "RESULT_UNKNOWN");
      }
      return this.commit(input);
    } finally {
      this.applying -= 1;
    }
  }

  private commit(input: DraftApplyInput): { note: DraftNote; receipt: DraftReceipt } {
    const existingReceipt = this.receipts.get(receiptKey(input.bindingId, input.idempotencyKey));
    if (existingReceipt) {
      if (existingReceipt.payloadDigest !== input.payloadDigest) {
        throw new TrustedOperationFault("IDEMPOTENCY_CONFLICT");
      }
      const note = this.notes.get(noteKey(input.bindingId, existingReceipt.noteId));
      if (!note) {
        throw new TrustedOperationFault("RESULT_UNKNOWN");
      }
      return { note: { ...note }, receipt: { ...existingReceipt } };
    }
    if (input.effect === "create") {
      const noteId = fixtureNoteId(input.bindingId, input.idempotencyKey);
      const note = this.storeNote(input.bindingId, {
        noteId,
        title: input.title,
        body: input.body,
        revision: 1,
      });
      const receipt = this.storeReceipt(input, note);
      return { note, receipt };
    }
    const noteId = input.noteId ?? "";
    const current = this.notes.get(noteKey(input.bindingId, noteId));
    if (!current) {
      throw new TrustedOperationFault("NOTE_NOT_FOUND");
    }
    const note = this.storeNote(input.bindingId, {
      noteId,
      title: input.title,
      body: input.body,
      revision: current.revision + 1,
    });
    const receipt = this.storeReceipt(input, note);
    return { note, receipt };
  }

  private storeNote(
    bindingId: string,
    input: { noteId: string; title: string; body: string; revision: number },
  ): DraftNote {
    const note: DraftNote = {
      ...input,
      contentDigest: draftNoteContentDigest(input),
    };
    this.notes.set(noteKey(bindingId, note.noteId), note);
    return { ...note };
  }

  private storeReceipt(input: DraftApplyInput, note: DraftNote): DraftReceipt {
    const receipt: DraftReceipt = {
      bindingId: input.bindingId,
      idempotencyKey: input.idempotencyKey,
      effect: input.effect,
      noteId: note.noteId,
      title: note.title,
      body: note.body,
      revision: note.revision,
      payloadDigest: input.payloadDigest,
      contentDigest: note.contentDigest,
    };
    this.receipts.set(receiptKey(input.bindingId, input.idempotencyKey), receipt);
    return { ...receipt };
  }
}
