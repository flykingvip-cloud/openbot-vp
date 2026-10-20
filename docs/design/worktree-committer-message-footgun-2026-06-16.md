# Committer Message Footgun: printf %-truncation drops commit trailers (2026-06-16)

> Type: proposal / guidance. Surfaced during Loom Provisioning landing, where it
> caused a real attribution defect (a commit lost its `Task:`/`Agent:` trailers).
> Audience: all agents using `scripts/committer`; maintainer (for the optional
> tool change, which touches a shared guardrail).

## Problem

A commit landed with its mandatory `Task:` / `Agent:` trailers **missing**,
because the message was truncated mid-line at `git.ts 98`. Multi-agent governance
requires every commit to carry those trailers (the git author is shared, so
trailers are the only attribution). A silently truncated message is therefore an
attribution defect, not just cosmetics.

## Root cause (NOT a committer bug)

The truncation happened in the **caller's shell**, before the message ever
reached `scripts/committer`:

```sh
# BAD: printf interprets the "%/" inside "98%/86.6%" as a format directive
scripts/committer "$(printf '... Coverage: git.ts 98%/86.6% ...\n\nTask: x\nAgent: y')" file
#                                              ^^ printf: %/ invalid directive -> output stops here
```

`printf` treats `%` as the start of a conversion spec; `%/` is invalid, so
`printf` errors and emits only the text up to that point. The command
substitution then yields a truncated string, and everything after the `%`
(including the trailers) is gone.

`scripts/committer` is blameless: it receives `commit_message=$1` and runs
`git commit -m "$commit_message"`. It never reprocesses the message. The bug is
100% in building the message with `printf` when the text contains a literal `%`.

Common triggers: percentages (`98%/86.6%`), `%s`/`%d` in prose, URLs with `%`,
any `%` followed by `/` or a letter.

## Immediate guidance (no code change needed)

Never build a `scripts/committer` message with `printf` (or any %-interpreting
builder). Use one of these instead:

1. Single-quoted heredoc into a temp file, then pass the file via process
   substitution is not supported by committer (it takes a string arg), so prefer
   a here-string built without printf, or:
2. A literal single-quoted multi-line string (real newlines in the quotes):

   ```sh
   scripts/committer 'feat(x): title

   Body line with 98%/86.6% is fine in single quotes.

   Task: my-task
   Agent: my-agent' path/to/file
   ```

3. If you must compose dynamically, use `printf '%s'` with the message as an
   argument (so `%` in the data is never interpreted):

   ```sh
   msg=$(printf '%s' "$title"$'\n\n'"$body"$'\n\n'"Task: t"$'\n'"Agent: a")
   scripts/committer "$msg" path/to/file
   ```

For `git commit`/`gh` directly, the AGENTS.md heredoc rule (`-F - <<'EOF'`)
already applies; this note extends the same discipline to `scripts/committer`.

## Optional tool enhancement (maintainer-gated)

`scripts/committer` is a shared guardrail; do not change it without maintainer
approval. Proposed additive, backward-compatible change: accept the message from
a file or stdin, mirroring `git commit -F`:

```
scripts/committer -F <file> <path...>
scripts/committer -F -      <path...>   # read message from stdin (heredoc-friendly)
```

Sketch (additive; existing `"message" <path...>` contract unchanged):

```sh
if [ "${1:-}" = "-F" ]; then
  msg_src=$2; shift 2
  if [ "$msg_src" = "-" ]; then commit_message=$(cat); else commit_message=$(cat -- "$msg_src"); fi
else
  commit_message=$1; shift
fi
```

This lets callers do the safe thing trivially:

```sh
scripts/committer -F - path/to/file <<'EOF'
feat(x): title

Body with 98%/86.6% and $vars are all literal here.

Task: t
Agent: a
EOF
```

Acceptance for the tool change: keep the empty-message guard, the
"first arg looks like a file" guard (skip it in `-F` mode), and the lock-retry
behavior; add a test under `test/git-hooks-pre-commit.test.ts` neighborhood or
a new committer test.

## Recommended AGENTS.md note (maintainer to add)

Under "Commit & Pull Request Guidelines":

> When composing `scripts/committer` messages, never use `printf` with a literal
> `%` in the text (e.g. `98%/86.6%`): `printf` will error on `%/`/`%x` and
> truncate the message, silently dropping `Task:`/`Agent:` trailers. Use a
> single-quoted multi-line string, `printf '%s'` with the text as an argument,
> or (if added) `scripts/committer -F -` with a quoted heredoc.

## Scope

This doc is guidance + a proposal. No shared guardrail (`scripts/committer`,
`AGENTS.md`) was modified here; those changes require maintainer approval.
