# Watchdog task-closure

Repair group-task heartbeat / wake-round closed loop so failures are not masked as success, escalate state is stage-bound, and safely retryable work recovers.

## Agents
- grok-sentinel-link · role: owner · scope: heartbeat + wake-round dispatch closed loop · paths: src/gateway/collaboration-dispatch/**, src/gateway/wake-round-dispatcher-boot.ts, src/gateway/group-task-heartbeat-scheduler-boot.ts · since: 2026-11-01
