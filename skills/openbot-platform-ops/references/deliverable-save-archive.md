# Deliverable save and archive

一面一源。保存是同步，不是搬家。对话不读库，库不驱动对话预览。

## Three planes

- **Birth workspace**: current robot steward workspace or group workspace. Conversation sidebar preview reads only this plane.
- **Staging**: skill / 成果中心 capture. Not a knowledge base, not 我的资产.
- **Canonical**: reserved folders only — 个人成果 (`openbot:personal-deliverables`) or 团队成果 (`openbot:team-deliverables`). Knowledge Universe and `knowledge_search` / `knowledge_get` consume this plane.

## Agent production step

Declare `file=` only after the workspace write succeeded and the relative path holds a non-empty file. Inline markdown is not a write. Collaboration peers and steward preview open that same path; a declaration with no bytes is 未写入工作区, not a synced chip.

Declare deliverables with a real file path:

```text
<<DELIVERABLE title="Report title" type="document" file="output/report.md">>
```

Steward behavior: see `src/agents/builtin-steward/behavior-rules.ts` for envelope rules.

## User / UI archive step

RPC: `knowledge.deliverables.saveAndArchive`

Implementation: `src/gateway/knowledge/deliverables/save-and-archive.ts`

Default KB resolution (`knowledgeBaseId: "auto"`):

- Collaboration group context → **团队成果**
- Personal chat → **个人成果**
- Ordinary / enterprise / third-party KBs are rejected
- Missing team write ACL fails closed (no silent personal fallback)

Save is write-through: copy the same bytes into the birth workspace **and** the reserved KB. Never move. Never symlink.

Second save asks in the sidebar (Overwrite / Save as / Cancel). Hash-unchanged first save, or an already-decided write, skip the prompt.

Chip restore uses `knowledge.deliverables.archiveLookup`. Conversation preview never calls `knowledge.document.preview`.

## Agent guidance

1. Ensure the file exists in the birth workspace before declaring `<<DELIVERABLE>>`.
2. Tell the user they can **Save** from the artifact sidebar.
3. Do not claim archive success until the user confirms the UI action or you receive save result.
4. After save, keep preview on the workspace file. Knowledge originals are consumed in Knowledge Universe or after the user loads them into a conversation.

## Related RPC

- `knowledge.deliverables.saveAndArchive`
- `knowledge.deliverables.archiveLookup`
- `knowledge.deliverables.attach` (Knowledge Universe attach into an ordinary KB; not the conversation Save path)
