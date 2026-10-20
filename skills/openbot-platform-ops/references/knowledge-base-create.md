# Knowledge base creation

## When

User wants a new knowledge base, corpus, or document collection (personal, team, or enterprise).

## UI path

Employee workbench only, observed 2026-09-18:

1. Sidebar `知识宇宙`
2. `上传知识` opens `新建知识空间` (not a file picker)
3. Fields: `空间名称`, `描述（可选）`, radios `个人空间` / `团队空间` / `企业空间`
4. `创建空间` is a write. Confirm first.

Click script: `skills/user-guidance-protocol/references/employee-knowledge.yaml`.
Do not name library interior tabs; they were not on screen when no space existed.

## Canonical RPC (subset)

| Action                       | RPC                                                          |
| ---------------------------- | ------------------------------------------------------------ |
| Create                       | `knowledge.base.create`                                      |
| List / get / update / delete | `knowledge.base.list`, `.get`, `.update`, `.delete`          |
| Members                      | `knowledge.base.members.list`, `knowledge.access.request`    |
| Upload / import              | `knowledge.personal.upload`, `.collectWeb`, `.importDataset` |
| Local folder                 | `knowledge.local-folder.bind`, `.scan-now`, `.sync.*`        |
| Passive connector            | `knowledge.connector.bind`, `.sync.*`                        |
| Search                       | `knowledge.base.search`, `knowledge.search`                  |

## Default inboxes (lazy)

- Personal inbox: `ensurePersonalInboxKnowledgeBase`
- Team inbox (per collaboration group): `ensureTeamInboxKnowledgeBase`

## Agent tools

- `knowledge_source` — bind/sync/invoke **API sources**, not create passive KB folders
- No dedicated agent tool for `knowledge.base.create` — use UI guidance or operator RPC

## Confirm

- Medium: create KB with visibility (personal / team / enterprise)
- High: delete KB or revoke broad access

## Data governance

See `docs/design/openbot-data-governance-architecture-v2-2026-08-10.md` for L0–L3 layers when explaining scope to users.
