# Ledger integrity follow-up (2026-10-31)

- Classification: `ledger-error-classification-2026-10-31.md`
- Fix PR scope: close seq 127 `liveTo` with successor StartedAt attestation; **one-shot** sync of `RELEASE_RECORD.md` L3 from seq 151 JSONL tip; **no** bulk `regressionAcknowledged`
- **RELEASE_RECORD anti-drift (gap):** this PR only rewrote static human-view text from the machine tip. That is **not** a durable anti-drift mechanism. Until a generator (human view from `releases.jsonl`) and/or a consistency check (CI / `delivery:ledger:audit` compare of RELEASE_RECORD pointers vs open tip) exists, the next cutover can drift again. Track as follow-up; out of this PR’s ledger-row scope.
- Re-audit after merge: report separately (1) current LIVE identity vs open tip (2) historical integrity / remaining ERROR classes
- Cutover posture: do not claim delivery-gate green for new DIGEST until open-interval cleared and remaining classes addressed; do not stop healthy service
- A3 still PENDING AUTH; registration requires workflow on **default branch** before dispatch (`--ref` ≠ registration)
