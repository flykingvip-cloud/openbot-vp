/**
 * In-process Diagnosis Journal.
 * Write failure must not be silent. Journal is not a runtime fact store.
 */
export type JournalKind = "plan" | "collect" | "stop" | "complete" | "error";

export type JournalRecord = {
  seq: number;
  runId: string;
  kind: JournalKind;
  code: string;
  detail?: string;
};

export class DiagnosisJournalWriteError extends Error {
  constructor(message = "Diagnosis Journal write failed") {
    super(message);
    this.name = "DiagnosisJournalWriteError";
  }
}

export class DiagnosisJournal {
  private readonly records: JournalRecord[] = [];
  private seq = 0;
  private failNext = false;

  failNextAppend(): void {
    this.failNext = true;
  }

  append(input: Omit<JournalRecord, "seq">): JournalRecord {
    if (this.failNext) {
      this.failNext = false;
      throw new DiagnosisJournalWriteError();
    }
    this.seq += 1;
    const record: JournalRecord = { seq: this.seq, ...input };
    this.records.push(record);
    return record;
  }

  list(): readonly JournalRecord[] {
    return this.records;
  }

  countByKind(kind: JournalKind): number {
    return this.records.filter((record) => record.kind === kind).length;
  }
}
