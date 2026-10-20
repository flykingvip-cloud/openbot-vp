# OGUI P4 — Skill runtime UI capability declaration

> Status: **skill-contract extension**. `LIVE_touched=false`.
> No Floor live, no `ui.*` RPC, no `ChatSendParamsSchema` expand.

## Goal

Let skills optionally declare which **chat-inline OGUI** components they may emit,
via existing SKILL.md frontmatter → `SkillRuntimeContract`. Skills without the
new fields stay prompt-only (unchanged).

## Frontmatter

| Key | Type | Meaning |
| --- | --- | --- |
| `supported-ui-components` | comma list | Whitelist: `ogui-form`, `ogui-choice` |
| `requires-ui-confirmation` | `true`/`false` | Prefer OGUI / Steward / Exec Approvals over invented buttons |

Unknown component ids are **dropped** (soft), not a hard crash — keeps older
skills safe.

## Code

- `src/agents/execution-preflight/skill-contract.ts`
- Tests: `skill-contract.ui.test.ts`
- Example: `skills/ogui-form/SKILL.md`
- Canvas note: `skills/canvas/SKILL.md` (routing only; no ogui component claim)

## Non-goals

- Forcing every skill to declare UI
- A2UI v0.9 / Canvas as default for simple choices
- Expanding Gateway chat send schema
