#!/usr/bin/env bash
# P0 schema smoke — safe for shell (no $schema expansion in caller).
# Lives under docs/ so this spec PR stays docs-only for CI scope detection.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCHEMA_DIR="$ROOT/docs/design/schemas"
for f in "$SCHEMA_DIR"/*.schema.json; do
  jq -e 'has("$schema") and has("type")' "$f" >/dev/null
  echo "ok: $(basename "$f")"
done
