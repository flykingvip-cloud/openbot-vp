# Transcript entry fix: attachment early-persist re-root (2026-10-06)

## Incident

Gateway early-persist (`appendRawTranscriptMessage` in
`src/gateway/server-methods/chat.ts`, attachment and group paths) wrote bare
`{ message }` JSONL lines without `type` / `id` / `parentId`. On reload,
pi-coding-agent `SessionManager` set `leafId` to `undefined`; the next append
(for example `model_change`) omitted `parentId` and re-rooted the session tree,
so model context collapsed to near-empty history.

## Fix (this PR)

1. **Write path.** `appendRawTranscriptMessage` now calls
   `appendTranscriptMessageEntry` (`src/agents/session-transcript-entry.ts`).
   Each line is `{ type: "message", id, parentId, timestamp, message }`.
   - `parentId` comes from a bounded tail scan (64 KiB window, grown only when
     the last entry is larger). It does not read the whole file on every append.
   - The entry `id` is always a fresh UUID. `message.id` stays inside `message`
     and is never reused as the entry id, because a duplicate id could create a
     parent cycle.
2. **Legacy heal.** Existing transcripts with bare lines are healed by the
   existing `repairSessionFileIfNeeded` (`src/agents/session-file-repair.ts`):
   - It runs only from the embedded attempt/compaction paths, **under the
     session write lock**. It is not hooked into every `openSessionManager`.
   - It writes a full backup (`<file>.bak-<pid>-<ts>`), then a temp file, then
     does an atomic `rename`.
   - It skips the rename if the file's size or mtime changed while it worked,
     for example because of an unlocked gateway append. It retries on the next
     run.
   - It logs a warning with the number of converted bare lines and relinked
     parents. It is idempotent: a clean file is not rewritten.
   - Explicit `parentId: null` roots are left alone. Only entries whose
     `parentId` key is missing (written after a bare line) are relinked.

## Known limits

- If a new typed entry was appended while a bare line was the last line, the
  new entry chains to the last well-formed entry. After the heal, the converted
  bare message sits on a sibling branch. That is one lost message instead of a
  full re-root.
- Offline repair of a specific live host transcript is an Owner ops action and
  is not part of this PR.

## Out of scope

The honest empty-reply / evolution-gap work is split into a follow-up PR.

## Tests

- `src/agents/session-transcript-entry.test.ts`
- `src/agents/session-file-repair.test.ts`
- `src/agents/pi-embedded-runner/session-manager-init.group-public.test.ts`
