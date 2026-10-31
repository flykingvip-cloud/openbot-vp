# Ledger integrity follow-up (2026-10-31)

- Classification: `ledger-error-classification-2026-10-31.md`
- Fix PR scope: close seq 127 `liveTo` with successor StartedAt attestation; sync RELEASE_RECORD L3 from seq 151 JSONL tip; **no** bulk `regressionAcknowledged`
- Re-audit after merge: report separately (1) current LIVE identity vs open tip (2) historical integrity / remaining ERROR classes
- Cutover posture: do not claim delivery-gate green for new DIGEST until open-interval cleared; do not stop healthy service
