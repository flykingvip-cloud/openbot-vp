---
summary: "Guidance for choosing between heartbeat and cron jobs for automation"
read_when:
  - Deciding how to schedule recurring tasks
  - Setting up background monitoring or notifications
  - Optimizing token usage for periodic checks
title: "Cron vs Heartbeat"
---

# Cron vs Heartbeat: When to Use Each

Both heartbeats and cron jobs let you run tasks on a schedule. This guide helps you choose the right mechanism for your use case.

## Quick Decision Guide

| Use Case                            | Recommended         | Why                                        |
| ----------------------------------- | ------------------- | ------------------------------------------ |
| Check inbox every 30 min            | Cron (isolated)     | Real due time; do not poll via heartbeat   |
| Send daily report at 9am sharp      | Cron (isolated)     | Exact timing needed                        |
| Calendar event is about to start    | Cron (main, `--at`) | Hang the follow-up on the due time         |
| Run weekly deep analysis            | Cron (isolated)     | Standalone task, can use different model   |
| Remind me in 20 minutes             | Cron (main, `--at`) | One-shot with precise timing               |
| Background task finished            | Heartbeat wake      | Exec/cron completion already has a trigger |
| Relay several due items in one turn | Heartbeat           | Batch only after something already woke    |

## Heartbeat: Wake Router

Heartbeat delivers follow-ups in the **main session** when a real trigger fires
(due time, external event, finished task, or manual wake). The default interval
is `0m` (off). It does not ask the model “anything I should say?” every 30 minutes.

### When to use heartbeat

- **Relay a completed job**: exec/cron finished and the user should see the result.
- **Batch due items**: several cron/event wakes can share one already-triggered turn; `HEARTBEAT.md` is a due-item checklist, not a wake reason.
- **Conversational continuity**: the wake stays on the main session so the agent can speak in context.

### When not to use heartbeat

- **Periodic awareness / inbox / calendar polling**: put those on cron or an external subscription.
- **Human check-in**: do not wake just to prove the agent is alive.

### Heartbeat advantages

- **Silent by default**: no pending trigger means no model turn.
- **Context-aware when it speaks**: the wake shares the main session.
- **Smart suppression**: if a wake finds nothing to say, the agent replies `HEARTBEAT_OK` and the turn is dropped.

### Heartbeat example: HEARTBEAT.md checklist

```md
# Due items (read only after a real wake)

- If cron `inbox-urgent` just fired, summarize new urgent mail
- If a background task finished, tell the user the result
```

Do not list “check email every cycle” or “if idle, send a check-in”. Those are
triggers that belong on cron, not reasons for idle patrol.

### Configuring heartbeat

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "0m", // off; event/manual wakes still run
        activeHours: { start: "08:00", end: "22:00" }, // optional
      },
    },
  },
}
```

See [Heartbeat](/gateway/heartbeat) for full configuration.

## Cron: Precise Scheduling

Cron jobs run at precise times and can run in isolated sessions without affecting main context.
Recurring top-of-hour schedules are automatically spread by a deterministic
per-job offset in a 0-5 minute window.

### When to use cron

- **Exact timing required**: "Send this at 9:00 AM every Monday" (not "sometime around 9").
- **Standalone tasks**: Tasks that don't need conversational context.
- **Different model/thinking**: Heavy analysis that warrants a more powerful model.
- **One-shot reminders**: "Remind me in 20 minutes" with `--at`.
- **Noisy/frequent tasks**: Tasks that would clutter main session history.
- **External triggers**: Tasks that should run independently of whether the agent is otherwise active.

### Cron advantages

- **Precise timing**: 5-field or 6-field (seconds) cron expressions with timezone support.
- **Built-in load spreading**: recurring top-of-hour schedules are staggered by up to 5 minutes by default.
- **Per-job control**: override stagger with `--stagger <duration>` or force exact timing with `--exact`.
- **Session isolation**: Runs in `cron:<jobId>` without polluting main history.
- **Model overrides**: Use a cheaper or more powerful model per job.
- **Delivery control**: Isolated jobs default to `announce` (summary); choose `none` as needed.
- **Immediate delivery**: Announce mode posts directly without waiting for heartbeat.
- **No agent context needed**: Runs even if main session is idle or compacted.
- **One-shot support**: `--at` for precise future timestamps.

### Cron example: Daily morning briefing

```bash
openbot cron add \
  --name "Morning briefing" \
  --cron "0 7 * * *" \
  --tz "America/New_York" \
  --session isolated \
  --message "Generate today's briefing: weather, calendar, top emails, news summary." \
  --model opus \
  --announce \
  --channel whatsapp \
  --to "+15551234567"
```

This runs at exactly 7:00 AM New York time, uses Opus for quality, and announces a summary directly to WhatsApp.

### Cron example: One-shot reminder

```bash
openbot cron add \
  --name "Meeting reminder" \
  --at "20m" \
  --session main \
  --system-event "Reminder: standup meeting starts in 10 minutes." \
  --wake now \
  --delete-after-run
```

See [Cron jobs](/automation/cron-jobs) for full CLI reference.

## Decision Flowchart

```
Does the task need to run at an EXACT time?
  YES -> Use cron
  NO  -> Continue...

Does the task need isolation from main session?
  YES -> Use cron (isolated)
  NO  -> Continue...

Can this task be batched with other periodic checks?
  YES -> Use heartbeat (add to HEARTBEAT.md)
  NO  -> Use cron

Is this a one-shot reminder?
  YES -> Use cron with --at
  NO  -> Continue...

Does it need a different model or thinking level?
  YES -> Use cron (isolated) with --model/--thinking
  NO  -> Use heartbeat
```

## Combining Both

The most efficient setup uses **both**:

1. **Cron / events** own the trigger (inbox poll, calendar due time, daily report).
2. **Heartbeat** only relays or batches after something already woke it. `HEARTBEAT.md` is a due-item checklist, not a 30-minute patrol.

### Example: Efficient automation setup

**HEARTBEAT.md** (read only after a real wake):

```md
# Due items

- If cron `inbox-urgent` just fired, summarize new urgent mail
- If a background task finished, tell the user the result
```

**Cron jobs** (precise timing):

```bash
# Daily morning briefing at 7am
openbot cron add --name "Morning brief" --cron "0 7 * * *" --session isolated --message "..." --announce

# Weekly project review on Mondays at 9am
openbot cron add --name "Weekly review" --cron "0 9 * * 1" --session isolated --message "..." --model opus

# One-shot reminder
openbot cron add --name "Call back" --at "2h" --session main --system-event "Call back the client" --wake now
```

## Lobster: Deterministic workflows with approvals

Lobster is the workflow runtime for **multi-step tool pipelines** that need deterministic execution and explicit approvals.
Use it when the task is more than a single agent turn, and you want a resumable workflow with human checkpoints.

### When Lobster fits

- **Multi-step automation**: You need a fixed pipeline of tool calls, not a one-off prompt.
- **Approval gates**: Side effects should pause until you approve, then resume.
- **Resumable runs**: Continue a paused workflow without re-running earlier steps.

### How it pairs with heartbeat and cron

- **Heartbeat/cron** decide _when_ a run happens.
- **Lobster** defines _what steps_ happen once the run starts.

For scheduled workflows, use cron or heartbeat to trigger an agent turn that calls Lobster.
For ad-hoc workflows, call Lobster directly.

### Operational notes (from the code)

- Lobster runs as a **local subprocess** (`lobster` CLI) in tool mode and returns a **JSON envelope**.
- If the tool returns `needs_approval`, you resume with a `resumeToken` and `approve` flag.
- The tool is an **optional plugin**; enable it additively via `tools.alsoAllow: ["lobster"]` (recommended).
- Lobster expects the `lobster` CLI to be available on `PATH`.

See [Lobster](/tools/lobster) for full usage and examples.

## Main Session vs Isolated Session

Both heartbeat and cron can interact with the main session, but differently:

|         | Heartbeat                       | Cron (main)              | Cron (isolated)            |
| ------- | ------------------------------- | ------------------------ | -------------------------- |
| Session | Main                            | Main (via system event)  | `cron:<jobId>`             |
| History | Shared                          | Shared                   | Fresh each run             |
| Context | Full                            | Full                     | None (starts clean)        |
| Model   | Main session model              | Main session model       | Can override               |
| Output  | Delivered if not `HEARTBEAT_OK` | Heartbeat prompt + event | Announce summary (default) |

### When to use main session cron

Use `--session main` with `--system-event` when you want:

- The reminder/event to appear in main session context
- The agent to handle it during the next heartbeat with full context
- No separate isolated run

```bash
openbot cron add \
  --name "Check project" \
  --every "4h" \
  --session main \
  --system-event "Time for a project health check" \
  --wake now
```

### When to use isolated cron

Use `--session isolated` when you want:

- A clean slate without prior context
- Different model or thinking settings
- Announce summaries directly to a channel
- History that doesn't clutter main session

```bash
openbot cron add \
  --name "Deep analysis" \
  --cron "0 6 * * 0" \
  --session isolated \
  --message "Weekly codebase analysis..." \
  --model opus \
  --thinking high \
  --announce
```

## Cost Considerations

| Mechanism       | Cost Profile                                            |
| --------------- | ------------------------------------------------------- |
| Heartbeat       | One turn every N minutes; scales with HEARTBEAT.md size |
| Cron (main)     | Adds event to next heartbeat (no isolated turn)         |
| Cron (isolated) | Full agent turn per job; can use cheaper model          |

**Tips**:

- Keep `HEARTBEAT.md` small to minimize token overhead.
- Batch similar checks into heartbeat instead of multiple cron jobs.
- Heartbeat alerts stay in the OpenBot main session. Interval patrols skip when `HEARTBEAT.md` is missing or empty.
- Use isolated cron with a cheaper model for routine tasks.

## Related

- [Heartbeat](/gateway/heartbeat) - full heartbeat configuration
- [Cron jobs](/automation/cron-jobs) - full cron CLI and API reference
- [System](/cli/system) - system events + heartbeat controls
