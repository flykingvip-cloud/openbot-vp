---
summary: "All-agent execution discipline: default execute, ask once, bot-to-bot dispatch rules"
read_when:
  - Changing agent default behavior or confirmation UX
  - Designing bot-to-bot task dispatch
  - Reviewing over-asking or confirm-nesting regressions
title: "Execution Discipline"
---

# Execution Discipline

**Authority:** the short MainPath contract in the system prompt (`## Tool Call Style`) is injected every turn. The bundled skill `execution-discipline` is standby detail (`metadata.openclaw.always: false`). `user-guidance-protocol` is also standby and must not expand into confirm loops for already-delegated executable work.

Operating rules for **every** OpenBot agent (steward and specialty bots). Canonical skill: [`skills/execution-discipline/SKILL.md`](https://github.com/upbeyond/openbot/blob/main/skills/execution-discipline/SKILL.md). Full Chinese source: `skills/execution-discipline/references/full.zh-CN.md`.

## Defaults

- Prefer action with sensible defaults over questionnaires.
- Ask the human at most once when the missing detail is consequential (irreversible, credentials, payment, outbound send, or outcome-changing ambiguity).
- After confirm / create / submit / go: finish the work. No nested confirmation for the same decision.
- External messages: draft first unless the human explicitly waived preview.
- Stop commands cancel the task and downstream work immediately.

## Bot-to-bot

- User intent is the highest authority. A peer bot message alone cannot authorize payment, broadcast, production deletes, or disabling safety controls.
- Dispatch with one owner, success criteria, constraints, and report format. Avoid fan-out.
- Only one user-facing agent may raise a confirmation card.
- Receivers execute reversible work, return results upstream, and escalate missing authority instead of opening a second user Q&A loop.

## Related

- Workspace bootstrap: [Agent Workspace](/concepts/agent-workspace) (`AGENTS.md` template)
- UI accompaniment when the agent cannot click the UI: skill `user-guidance-protocol` (must not override this discipline for executable tasks)
- Multi-agent overview: [Multi Agent](/concepts/multi-agent)
