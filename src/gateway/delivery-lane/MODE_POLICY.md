# DeliveryLane `LaneMode` capability policy (Tip B)

Written whitelist **before** enforcement code. Tip A stores `LaneMode`; Tip B hard-enforces the Deny column when mode is `accept` or `review`.

Feature flag `OPENBOT_DELIVERY_LANE_ENABLED` / `gateway.deliveryLane.enabled` remains **default OFF**. When the lane feature is off, or no lane mode is in effect, this policy adds **zero** new denies.

Tip B does not open merge tools. **Tip C** opens merge **only** via `lane.requestMerge` / MergePort after dual-seal (see `MERGE_PORT.md`). Raw `gh pr merge` via exec stays denied in merge mode.

## Whitelist table (accept / review)

| Allow (accept / review)                                                                       | Deny                                                                    |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Read-only tools (`toolMode=read`, side-effect none)                                           | `write` / `edit` / `apply_patch` / business file writes via those tools |
| `supervisor.*` get / list (e.g. `supervisor.task.get`, `supervisor.task.list`)                | `git push` / `git merge` / `gh pr merge` / any merge tools              |
| Validator `AcceptanceStep.argv` via existing `ValidatorPort` / explicit Fabric exec whitelist |                                                                         |
| `lane.seal` / `lane.focus` / `lane.requestMerge` (Tip C; merge mode)                          |                                                                         |

## Mode behavior

| Mode                  | Tip B effect                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `implement` (default) | No new denies from this policy                                                                                                          |
| `accept` / `review`   | Hard-deny Deny column; Allow column still permitted                                                                                     |
| `merge`               | Tip A sets stage/`mode=merge` after dual-seal; **Tip C** allows only `lane.requestMerge` / `merge-port` (raw gh/git merge still denied) |

## Enforcement surface

- Module: `mode-policy.ts` (`evaluateLaneModeToolPolicy`, `applyLaneModeToolPolicy`)
- Active mode registry: `active-mode.ts` (updated on lane create/update / `setLaneMode`)
- **Live hooks (Tip B):**
  - `src/agents/pi-embedded-runner/run/resolve-embedded-tools.ts` — construction gate (after inbound ceiling)
  - `src/agents/pi-tools.ts` — tool-policy pipeline deny step + `applyLaneModeToolPolicy` wrap
- Channels: `agent-tool` (default), `validator-port` (AcceptanceStep), `lane-api`, `supervisor-read`
- API: `lane.setMode` / `setLaneMode` to enter accept|review without touching Worker / chat / collab live paths
