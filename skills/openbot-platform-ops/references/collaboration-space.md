# Collaboration space creation

## When

User wants a team collaboration space, group workspace, or multi-member chat space.

## UI path (preferred)

Guide via `user-guidance-protocol` and `references/employee-collaboration.yaml`.

Observed path: sidebar `协作空间`, then the space name. `成员管理` opens a panel with `添加成员` and `添加机器人`. The create wizard after the plus button was not re-opened on the logged-in pass; confirm the title `新建协作空间` before naming fields. No interior tab bar (`概览` / `聊天` / `治理`) was on screen.

## Canonical RPC

**First creation** uses:

`collaboration.spaces.members.update` — initial members update creates the space.

Related:

- `collaboration.spaces.list`
- `collaboration.spaces.charter.get`
- `collaboration.spaces.reset` / `dissolve`

## Group workspace files

- `group-workspace-file.*` for group-attached files
- Team inbox KB: `src/gateway/knowledge/team-inbox-knowledge-base.ts`

## Steward policy

Only group owner may add builtin steward to a group (`src/gateway/collaboration-learning/steward-group-policy.ts`).

## Confirm

- Medium: creating space with member list
- High: dissolve / reset space

## Done

Space appears in collaboration list; members can join; group deliverables route to team inbox KB when archived.
