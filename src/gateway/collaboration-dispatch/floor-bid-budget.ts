/**
 * Per-group daily token ledger for Floor Runtime v2.1 §5.8 Shadow-B.
 * Missing file = 0 used. Corrupt file fails closed (treat the cap as spent).
 * A UTC date change resets the counter. Reservations are exclusive per file.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type FloorBidTokenLedger = {
  tryReserve(tokens: number): Promise<boolean>;
  /** Replace a reservation with the actual charge, never above the cap. */
  commit(reserved: number, actual: number): Promise<number>;
  release(reserved: number): Promise<void>;
  readUsed(): Promise<number>;
};

type LedgerState = { date: string; tokens: number };

const tails = new Map<string, Promise<void>>();
let memorySerial = 0;

function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function floorBidUtcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function freshState(nowMs: number): LedgerState {
  return { date: floorBidUtcDate(nowMs), tokens: 0 };
}

export function createMemoryFloorBidTokenLedger(params: {
  cap: number;
  nowMs: () => number;
}): FloorBidTokenLedger {
  const key = `mem:${++memorySerial}`;
  let state = freshState(params.nowMs());
  const current = (): LedgerState => {
    const today = floorBidUtcDate(params.nowMs());
    if (state.date !== today) {
      state = { date: today, tokens: 0 };
    }
    return state;
  };
  return {
    tryReserve(tokens) {
      return exclusive(key, async () => {
        const row = current();
        if (tokens <= 0) {
          return true;
        }
        if (row.tokens + tokens > params.cap) {
          return false;
        }
        row.tokens += tokens;
        return true;
      });
    },
    commit(reserved, actual) {
      return exclusive(key, async () => {
        const row = current();
        const base = Math.max(0, row.tokens - Math.max(0, reserved));
        const room = Math.max(0, params.cap - base);
        const applied = Math.min(Math.max(0, actual), room);
        row.tokens = base + applied;
        return applied;
      });
    },
    release(reserved) {
      return exclusive(key, async () => {
        const row = current();
        row.tokens = Math.max(0, row.tokens - Math.max(0, reserved));
      });
    },
    readUsed() {
      return exclusive(key, async () => current().tokens);
    },
  };
}

async function readFileState(filePath: string, cap: number, nowMs: number): Promise<LedgerState> {
  const today = floorBidUtcDate(nowMs);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { date: today, tokens: 0 };
    }
    return { date: today, tokens: cap };
  }
  try {
    const parsed = JSON.parse(raw) as { date?: unknown; tokens?: unknown };
    const date = typeof parsed.date === "string" ? parsed.date : today;
    const tokens =
      typeof parsed.tokens === "number" && Number.isFinite(parsed.tokens) && parsed.tokens >= 0
        ? Math.floor(parsed.tokens)
        : cap;
    if (date !== today) {
      return { date: today, tokens: 0 };
    }
    return { date, tokens };
  } catch {
    return { date: today, tokens: cap };
  }
}

async function writeFileState(filePath: string, state: LedgerState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state)}\n`, "utf8");
}

export function createFileFloorBidTokenLedger(params: {
  filePath: string;
  cap: number;
  nowMs: () => number;
}): FloorBidTokenLedger {
  const key = params.filePath;
  return {
    tryReserve(tokens) {
      return exclusive(key, async () => {
        const row = await readFileState(params.filePath, params.cap, params.nowMs());
        if (tokens <= 0) {
          return true;
        }
        if (row.tokens + tokens > params.cap) {
          return false;
        }
        row.tokens += tokens;
        await writeFileState(params.filePath, row);
        return true;
      });
    },
    commit(reserved, actual) {
      return exclusive(key, async () => {
        const row = await readFileState(params.filePath, params.cap, params.nowMs());
        const base = Math.max(0, row.tokens - Math.max(0, reserved));
        const room = Math.max(0, params.cap - base);
        const applied = Math.min(Math.max(0, actual), room);
        row.tokens = base + applied;
        await writeFileState(params.filePath, row);
        return applied;
      });
    },
    release(reserved) {
      return exclusive(key, async () => {
        const row = await readFileState(params.filePath, params.cap, params.nowMs());
        row.tokens = Math.max(0, row.tokens - Math.max(0, reserved));
        await writeFileState(params.filePath, row);
      });
    },
    readUsed() {
      return exclusive(key, async () => {
        const row = await readFileState(params.filePath, params.cap, params.nowMs());
        return row.tokens;
      });
    },
  };
}
