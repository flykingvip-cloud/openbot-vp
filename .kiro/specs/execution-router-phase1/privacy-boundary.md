# Privacy boundary

Shadow Router observations are digests and counts. They are not a
second prompt log.

## Allowed in production observations / shadow events

- 16-char hex digests: run, session, skill name, tool name, text,
  tags, provider, model
- counts, ranks, scores, reason codes
- flags (all false in this package)
- latency copies already allowed by Phase 0 observation

## Forbidden

- raw user text
- Skill bodies / `SKILL.md`
- Tool schema, arguments, results
- URLs, tokens, `sk-`, `Bearer `, cookies
- raw `sessionKey`
- official Skill names or Tool names in plain text
- prompt contents
- P2-C sample payloads copied into shadow events

Digest formula matches Phase 0.1:

`sha256(\`${kind}:${normalizedName}\`).digest("hex").slice(0,16)`

`kind` is `skill` \| `tool` \| `text` \| `tag` \| `run` \| `session`.

## Offline labels

Gold required-skill / required-tool lists are digest arrays stored
only in offline fixtures. They must not be attached to live
`chat.execution_observation` until a later, reviewed schema change.

## Scan

`scanForbiddenSubstrings` from the Phase 0.3 collector vocabulary
applies to every serialized envelope, shadow event, and report in
this package. Hit count must be 0.

## External writes

This design performs no external writes: no Skill install, no Tool
call, no session send, no network. Tests use in-memory fixtures.
