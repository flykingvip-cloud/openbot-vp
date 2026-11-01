# SBOM smoke — summary only (JSON not tracked)

- **Command:** CycloneDX / SBOM generation during independent PR #192 review
- **Result:** Large artifact (~31MB) produced; left **untracked** then relocated out of worktree to `/tmp/pr192-review-artifacts/sbom-cyclonedx.json` so `oxfmt --check` does not see it as a new format failure.
- **Files kept in repo:** `09-sbom-smoke.log`, `09-sbom-smoke.exit.txt`, `09-sbom-smoke.TIMEOUT.txt`, this SUMMARY
- **Live credentials:** NOT RUN
