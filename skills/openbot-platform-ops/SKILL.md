---
name: openbot-platform-ops
description: OpenBot platform operations guide for any agent. Use when the user wants to create AI assistants, collaboration spaces, or knowledge bases; save deliverables to knowledge; incubate skills/assets; connect external APIs; design scheduled tasks; or configure digital operational identity and authorization. Prefer agent tools and user-guidance-protocol for UI steps; never use plaintext credentials or ADMIN actions.
metadata: { "openclaw": { "emoji": "🛠️" } }
---

# OpenBot Platform Operations

Platform-wide playbook for OpenBot agents (including steward agents when installed). Not steward-exclusive.

## When to use

Invoke when the user asks to:

- create an AI assistant / digital employee / robot
- create a collaboration space or group workspace
- create or manage a knowledge base
- save chat deliverables into knowledge
- incubate a skill or capability asset
- connect or repair an external API knowledge source
- add cron jobs or personal schedule entries
- configure operational identity (email, WeChat Official Account, etc.) or grants

Do NOT use for: host security hardening (`healthcheck`), ClawHub skill market CLI (`openbot-skills`), or generic coding delegation (`coding-agent`) unless the user explicitly asks for those.

## Role router (solver / guide / escalator)

```
User request
  → Can an agent tool or catalog action do it safely?
      YES → solver (execute with confirm policy)
      NO but UI path exists → guide (load user-guidance-protocol)
      NO and high risk / ADMIN → escalator (explain limit, offer support path)
```

| Mode          | When                                                                                                                    | Action                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Solver**    | Tool exists (`knowledge_source`, `user_operational_identity`, `cron`, `schedule`, `guidance_event`, `skill_asset_save`) | Call tool; follow confirm policy                           |
| **Guide**     | No tool; UI wizard exists                                                                                               | Load `user-guidance-protocol`; lazy-load reference YAML/MD |
| **Escalator** | ADMIN, cross-tenant, irreversible without ownership                                                                     | Refuse automation; document next human step                |

## Tool priority matrix

| Priority | Mechanism                | Rule                                                                           |
| -------- | ------------------------ | ------------------------------------------------------------------------------ |
| 1        | Dedicated agent tool     | MUST use when available                                                        |
| 2        | `user.daibai.execute`    | ONLY for action IDs in `daibai-action-catalog` (steward sessions)              |
| 3        | `user-guidance-protocol` | UI navigation when no safe write tool                                          |
| 4        | Gateway RPC              | Never invent RPC names; references list canonical methods for human/UI context |

Delegated skills (do not duplicate their workflows):

- External API sources → `configure-external-api-source`
- Step-by-step UI navigation → `user-guidance-protocol`
- Skill authoring spec → `skill-creator`

## Confirm policy

| Risk      | Examples                                                            | Rule                                    |
| --------- | ------------------------------------------------------------------- | --------------------------------------- |
| Low       | list KBs, list identities, read-only diagnostics                    | Proceed                                 |
| Medium    | bind API source, create cron/schedule entry, create KB              | Summarize plan; single explicit confirm |
| High      | delete KB, revoke grants, replace credentials, remove skills        | Second confirm + impact summary         |
| Forbidden | ADMIN scope, plaintext secrets in chat, free repo mutation via exec | Refuse; offer safe alternative          |

## Multi-step orchestration

When a request spans multiple capabilities (e.g. "create assistant + KB + API"):

1. State the ordered plan (≤ 5 steps).
2. Execute one capability at a time; confirm between medium/high-risk steps.
3. Reuse outcome states from delegated skills (e.g. API source: `configured` / `configured-with-limitations` / `not-configured`).
4. Do not wrap unrelated steps in one tool call.

## Capability playbooks (lazy-load)

Read only the reference needed for the current request:

| Topic                    | Reference                                  |
| ------------------------ | ------------------------------------------ |
| AI assistant creation    | `references/agent-create.md`               |
| Deliverable → knowledge  | `references/deliverable-save-archive.md`   |
| Skill / asset incubation | `references/skill-asset-incubation.md`     |
| Collaboration space      | `references/collaboration-space.md`        |
| Knowledge base create    | `references/knowledge-base-create.md`      |
| External API source      | `references/api-source.md`                 |
| Cron / schedule          | `references/cron-schedule.md`              |
| Operational identity     | `references/operational-identity.md`       |
| Employee workbench map   | `references/employee-workbench-modules.md` |

## Deliverable envelope

When producing files the user may archive, declare:

```text
<<DELIVERABLE title="Human title" type="document|code|data" file="relative/path">>
```

Use a real workspace-relative path, and only after the write tool succeeded with a non-empty file at that path. An inline body is not a write; peers and preview open the file on disk. A `file=` with no bytes shows 未写入工作区. See `references/deliverable-save-archive.md`.

## Not responsible for

- ADMIN or cross-tenant platform mutations
- Replacing `user-guidance-protocol` click-level UI instructions
- Replacing `configure-external-api-source` probe/bind implementation
- Arbitrary shell access to change the git repository
- Steward required-skills management (this skill is optional platform library)

## Architecture context

For pillar overview see `docs/design/openbot-agent-os-architecture-map.md`. For steward safety boundaries see `.kiro/specs/daibai-super-steward/steward-service-and-safety-spec.md`.
