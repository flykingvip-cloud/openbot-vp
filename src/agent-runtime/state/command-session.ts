/** Existing command session merge and explicit-clear transaction. */
import { mergeSessionEntry, updateSessionStore, type SessionEntry } from "../../config/sessions.js";
export type PersistCommandSessionEntryParams = {
  sessionStore: Record<string, SessionEntry>;
  sessionKey: string;
  storePath: string;
  entry: SessionEntry;
};

type OverrideFieldClearedByDelete =
  | "providerOverride"
  | "modelOverride"
  | "authProfileOverride"
  | "authProfileOverrideSource"
  | "authProfileOverrideCompactionCount"
  | "fallbackNoticeSelectedModel"
  | "fallbackNoticeActiveModel"
  | "fallbackNoticeReason"
  | "claudeCliSessionId";

const OVERRIDE_FIELDS_CLEARED_BY_DELETE: OverrideFieldClearedByDelete[] = [
  "providerOverride",
  "modelOverride",
  "authProfileOverride",
  "authProfileOverrideSource",
  "authProfileOverrideCompactionCount",
  "fallbackNoticeSelectedModel",
  "fallbackNoticeActiveModel",
  "fallbackNoticeReason",
  "claudeCliSessionId",
];

export async function persistCommandSessionEntry(
  params: PersistCommandSessionEntryParams,
): Promise<void> {
  const savedCliSession = params.entry.cliSessionIds
    ? Object.values(params.entry.cliSessionIds)
    : [];
  // Isolation hook: a session save after the model returned must not drop usage.
  if (
    process.env.OPENBOT_TEST_CLI_PERSIST_THROW === "1" &&
    savedCliSession.includes("cli-session")
  ) {
    throw new Error("persist after retry");
  }
  const persisted = await updateSessionStore(params.storePath, (store) => {
    const merged = mergeSessionEntry(store[params.sessionKey], params.entry);
    // Preserve explicit `delete` clears done by session override helpers.
    for (const field of OVERRIDE_FIELDS_CLEARED_BY_DELETE) {
      if (!Object.hasOwn(params.entry, field)) {
        Reflect.deleteProperty(merged, field);
      }
    }
    store[params.sessionKey] = merged;
    return merged;
  });
  params.sessionStore[params.sessionKey] = persisted;
}
