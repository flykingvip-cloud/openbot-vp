"""Controller / execution state vocabulary (§12.2)."""
from __future__ import annotations

# Local controller process states (may not all be persisted on the execution row).
LOCAL_STATES = (
    "IDLE",
    "DETECTING",
    "CLAIMING",
    "LOST_CLAIM",
    "OBSERVING",
    "TAKEN_OVER",
    "RETRYING",
    "DONE",
)

# Persisted on ha_failover_execution.state (subset + CLAIMED after win).
EXECUTION_STATES = (
    "CLAIMED",
    "FENCING_APP",
    "DRAIN_WAIT",
    "FENCING_NETWORK",
    "FENCING_COMPUTE",
    "TERMINATING_OLD_SESSIONS",
    "VERIFYING",
    "VERIFIED",
    "LEASED",  # after EPOCH_BUMP
    "PROMOTING",
    "CF_CUTOVER",
    "OBSERVING",
    "DONE",
    "ABORTED_MANUAL",
    "ABORTED_CLOSED",
)

# Happy-path transitions for a Claim winner (manual lab run). EPOCH_BUMP is a
# local step that lands state=LEASED via openbot_ha_bump_epoch().
HAPPY_PATH = (
    "CLAIMED",
    "FENCING_APP",
    "DRAIN_WAIT",
    "FENCING_NETWORK",
    "FENCING_COMPUTE",
    "TERMINATING_OLD_SESSIONS",
    "VERIFYING",
    "VERIFIED",
    # EPOCH_BUMP -> LEASED (function)
    "LEASED",
    "PROMOTING",
    "CF_CUTOVER",
    "OBSERVING",
    "DONE",
)

TERMINAL = frozenset({"DONE", "ABORTED_MANUAL", "ABORTED_CLOSED"})
NON_RENEWABLE = frozenset({"DONE", "ABORTED_MANUAL", "ABORTED_CLOSED"})

# States before VERIFIED must not jump to bump on recovery (§12.6).
PRE_VERIFIED = frozenset(
    {
        "CLAIMED",
        "FENCING_APP",
        "DRAIN_WAIT",
        "FENCING_NETWORK",
        "FENCING_COMPUTE",
        "TERMINATING_OLD_SESSIONS",
        "VERIFYING",
    }
)
