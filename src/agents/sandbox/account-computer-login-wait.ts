/**
 * In-process waiters for login-method choice and save consent.
 * Payloads are method names and yes/no. Never credentials.
 */

const DEFAULT_CHOICE_TIMEOUT_MS = 180_000;
const DEFAULT_SAVE_TIMEOUT_MS = 120_000;
const RECENT_GRACE_MS = 15_000;

type ChoiceWaiter = {
  resolve: (method: "password" | "qr" | "timeout") => void;
  timer: ReturnType<typeof setTimeout>;
};

type SaveWaiter = {
  resolve: (decision: "save" | "decline" | "blocked" | "timeout") => void;
  timer: ReturnType<typeof setTimeout>;
};

export type LoginChoiceOffer = {
  choiceId: string;
  tenantId: string;
  userId: string;
  sessionKey: string;
  host: string;
  methods: Array<"password" | "qr">;
};

export type LoginSaveOffer = {
  saveId: string;
  tenantId: string;
  userId: string;
  sessionKey: string;
  host: string;
};

const CHOICE_WAITERS = new Map<string, Set<ChoiceWaiter>>();
const SAVE_WAITERS = new Map<string, Set<SaveWaiter>>();
const RECENT_CHOICE = new Map<string, { method: "password" | "qr"; at: number }>();
const RECENT_SAVE = new Map<string, { decision: "save" | "decline" | "blocked"; at: number }>();
const CHOICE_OFFERS = new Map<string, LoginChoiceOffer>();
const SAVE_OFFERS = new Map<string, LoginSaveOffer>();

export function resetAccountComputerLoginWaitForTests() {
  for (const set of CHOICE_WAITERS.values()) {
    for (const waiter of set) {
      clearTimeout(waiter.timer);
    }
  }
  for (const set of SAVE_WAITERS.values()) {
    for (const waiter of set) {
      clearTimeout(waiter.timer);
    }
  }
  CHOICE_WAITERS.clear();
  SAVE_WAITERS.clear();
  RECENT_CHOICE.clear();
  RECENT_SAVE.clear();
  CHOICE_OFFERS.clear();
  SAVE_OFFERS.clear();
}

export function registerLoginChoiceOffer(offer: LoginChoiceOffer) {
  CHOICE_OFFERS.set(offer.choiceId, offer);
}

export function getLoginChoiceOffer(choiceId: string): LoginChoiceOffer | null {
  return CHOICE_OFFERS.get(choiceId.trim()) ?? null;
}

export function registerLoginSaveOffer(offer: LoginSaveOffer) {
  SAVE_OFFERS.set(offer.saveId, offer);
}

export function getLoginSaveOffer(saveId: string): LoginSaveOffer | null {
  return SAVE_OFFERS.get(saveId.trim()) ?? null;
}

export function waitForLoginChoice(params: {
  choiceId: string;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<"password" | "qr" | "timeout"> {
  const choiceId = params.choiceId.trim();
  const now = params.nowMs ?? Date.now();
  const recent = RECENT_CHOICE.get(choiceId);
  if (recent && recent.at + RECENT_GRACE_MS > now) {
    return Promise.resolve(recent.method);
  }
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0
      ? params.timeoutMs
      : DEFAULT_CHOICE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const waiter: ChoiceWaiter = {
      resolve,
      timer: setTimeout(() => {
        const set = CHOICE_WAITERS.get(choiceId);
        set?.delete(waiter);
        resolve("timeout");
      }, timeoutMs),
    };
    const set = CHOICE_WAITERS.get(choiceId) ?? new Set();
    set.add(waiter);
    CHOICE_WAITERS.set(choiceId, set);
  });
}

export function notifyLoginChoice(choiceId: string, method: "password" | "qr", nowMs = Date.now()) {
  const id = choiceId.trim();
  RECENT_CHOICE.set(id, { method, at: nowMs });
  const set = CHOICE_WAITERS.get(id);
  if (!set || set.size === 0) {
    return;
  }
  CHOICE_WAITERS.delete(id);
  for (const waiter of set) {
    clearTimeout(waiter.timer);
    waiter.resolve(method);
  }
}

export function waitForSaveDecision(params: {
  saveId: string;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<"save" | "decline" | "blocked" | "timeout"> {
  const saveId = params.saveId.trim();
  const now = params.nowMs ?? Date.now();
  const recent = RECENT_SAVE.get(saveId);
  if (recent && recent.at + RECENT_GRACE_MS > now) {
    return Promise.resolve(recent.decision);
  }
  const timeoutMs =
    typeof params.timeoutMs === "number" && params.timeoutMs > 0
      ? params.timeoutMs
      : DEFAULT_SAVE_TIMEOUT_MS;
  return new Promise((resolve) => {
    const waiter: SaveWaiter = {
      resolve,
      timer: setTimeout(() => {
        const set = SAVE_WAITERS.get(saveId);
        set?.delete(waiter);
        resolve("timeout");
      }, timeoutMs),
    };
    const set = SAVE_WAITERS.get(saveId) ?? new Set();
    set.add(waiter);
    SAVE_WAITERS.set(saveId, set);
  });
}

export function notifySaveDecision(
  saveId: string,
  decision: "save" | "decline" | "blocked",
  nowMs = Date.now(),
) {
  const id = saveId.trim();
  RECENT_SAVE.set(id, { decision, at: nowMs });
  const set = SAVE_WAITERS.get(id);
  if (!set || set.size === 0) {
    return;
  }
  SAVE_WAITERS.delete(id);
  for (const waiter of set) {
    clearTimeout(waiter.timer);
    waiter.resolve(decision);
  }
}
