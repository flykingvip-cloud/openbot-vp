# AI assistant creation

## When

User wants a new AI assistant, digital employee, robot, or agent from a template.

## Solver path (UI — preferred for most users)

Guide via `user-guidance-protocol` and `references/employee-assistant.yaml`.

Observed path: sidebar `AI 助手` plus (`add AI 助手`) → title `新建数字员工` → `创建机器人`. The plus hides after 4 self-created assistants (大白管家 excluded). `系统设置` → `我的机器人` has no `新建`. Asking 大白管家 is a guide to that plus, not a background create. Collaboration `成员管理` → `添加机器人` only adds an existing robot to a space. Do not say `Create Agent` or `机器人管理`.

## Canonical RPC sequence (for operators / advanced context)

1. `workspaces.local.validate` or choose cloud workspace
2. `workspaces.create` (if new workspace needed)
3. `agents.create` — name, workspace, emoji, templateId, tenantId, ownerPositionId
4. `robots.bind-workspace`
5. Switch session to `agent:<id>:main`

Starter skills may auto-install from capability packs on create (see `src/gateway/capability-packs/starter-packs.ts`).

## Install skills to robot

- Governed: `employee-install.create-request` → `preview-risk` → `confirm` → `apply-configuration`
- Catalog: `employee-capability.install-to-robot`, `robot-skills.toggle` / `upgrade` / `remove` (steward catalog only)

## Confirm

- Medium: creating assistant with template and workspace binding
- High: removing skills or resetting workspace

## Done

User can open the new assistant session; robot appears in roster with expected starter capabilities.

## Recovery

If template install fails, check capability pack entitlements and governance registry for the skillKey.
