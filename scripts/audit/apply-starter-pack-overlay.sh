#!/usr/bin/env bash
# Package + apply A/B/C starter-pack skill overlay to production (r43-style host overlay).
#
# Default: plan/dry-run only. Apply requires --apply.
#
# Usage (from maintainer laptop with SSH to prod):
#   bash scripts/audit/apply-starter-pack-overlay.sh            # package + plan
#   bash scripts/audit/apply-starter-pack-overlay.sh --apply    # backup, copy skills, seed, restart
#
# Env:
#   OPENBOT_PRODUCTION_SSH_HOST   default root@8.217.93.71
#   OPENBOT_PRODUCTION_CONTAINER  default openbot-gateway-rc
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SSH_HOST="${OPENBOT_PRODUCTION_SSH_HOST:-root@8.217.93.71}"
CONTAINER="${OPENBOT_PRODUCTION_CONTAINER:-openbot-gateway-rc}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SLUG="starter-pack-abc-${STAMP}"
APPLY=false
LOCAL_EXEC=false

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=true ;;
    --local) LOCAL_EXEC=true; SSH_HOST=local ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
  esac
done

remote() {
  if [[ "$LOCAL_EXEC" == true || "$SSH_HOST" == local ]]; then
    bash -lc "$*"
  else
    ssh -o BatchMode=yes "$SSH_HOST" "$*"
  fi
}

remote_stdin() {
  if [[ "$LOCAL_EXEC" == true || "$SSH_HOST" == local ]]; then
    bash -s
  else
    ssh -o BatchMode=yes "$SSH_HOST" bash -s
  fi
}

STARTER_SKILLS=(
  summarize meeting-notes-specialist nano-pdf cyber-ppt weather defuddle canvas
  json-canvas agent-reach user-guidance-protocol configure-external-api-source
  openbot-platform-ops openai-whisper-api wechat-article finance-research
)

echo "== package $SLUG =="
PKG_DIR="$(mktemp -d "/tmp/${SLUG}.XXXX")"
mkdir -p "$PKG_DIR/skills" "$PKG_DIR/capability-packs" "$PKG_DIR/scripts"

for key in "${STARTER_SKILLS[@]}"; do
  src="$ROOT/skills/$key"
  if [[ ! -f "$src/SKILL.md" ]]; then
    echo "ERROR: missing $src/SKILL.md" >&2
    exit 1
  fi
  # refuse to package outside-repo symlinks
  if [[ -L "$src" ]]; then
    echo "ERROR: $src is still a symlink; vendor it first" >&2
    exit 1
  fi
  rsync -a --delete "$src/" "$PKG_DIR/skills/$key/"
  echo " packed skill $key"
done

rsync -a "$ROOT/src/gateway/capability-packs/" "$PKG_DIR/capability-packs/"
cp "$ROOT/scripts/seed-capability-starter-packs.ts" "$PKG_DIR/scripts/"
# minimal runner that uses container node + mounted paths is overkill; ship a node seed helper
cat > "$PKG_DIR/scripts/seed-on-host.mjs" <<'EOF'
/**
 * Host-side seed without full repo: reads packaged starter-packs + writes governance registry.
 * Invoked as: node seed-on-host.mjs --skills-root=... --packs-root=...
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const configDir = args["config-dir"] || process.env.OPENBOT_STATE_DIR || "/root/.openbot";
const skillsRoot = args["skills-root"];
const packsRoot = args["packs-root"];
if (!skillsRoot || !packsRoot) {
  console.error("need --skills-root and --packs-root");
  process.exit(2);
}

// Dynamic import compiled-free: evaluate starter-packs via tsx if available, else parse JSON snapshot.
async function loadPacks() {
  const snapshotPath = path.join(packsRoot, "starter-packs.snapshot.json");
  if (fs.existsSync(snapshotPath)) {
    return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  }
  throw new Error(`missing ${snapshotPath}`);
}

function parseFrontmatter(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!normalized.startsWith("---")) return {};
  const parts = normalized.split("---", 3);
  if (parts.length < 3) return {};
  const meta = {};
  for (const line of parts[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value) meta[key] = value;
  }
  return meta;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

const packs = await loadPacks();
const registryPath = path.join(configDir, "governance", "registry.json");
const entitlementsPath = path.join(configDir, "governance", "tenant-pack-entitlements.json");
let registry = readJson(registryPath, []);
if (!Array.isArray(registry)) {
  registry = registry.entries || [];
}

function findBySkillKey(skillKey) {
  return registry.findIndex((e) => (e?.manifest?.skillKey || "").trim() === skillKey);
}

function upsertSkill(skill, pack) {
  const skillMd = path.join(skillsRoot, skill.skillKey, "SKILL.md");
  let name = skill.name || skill.skillKey;
  let description = skill.description || `${skill.skillKey} (official pack ${pack.id})`;
  if (fs.existsSync(skillMd)) {
    const meta = parseFrontmatter(fs.readFileSync(skillMd, "utf8").slice(0, 4000));
    name = skill.name || meta.name || name;
    description = skill.description || meta.description || description;
  }
  const id = `urn:openbot:skill:${skill.skillKey}@1.0.0`;
  const now = new Date().toISOString();
  const entry = {
    manifest: {
      id,
      kind: "skill",
      version: "1.0.0",
      skillKey: skill.skillKey,
      name,
      description,
      ...(skill.categoryId ? { categoryId: skill.categoryId } : {}),
      packId: pack.id,
      source: {
        kind: "builtin",
        origin: `openbot/pack/${pack.id}/${skill.skillKey}`,
        trustTier: "first-party",
      },
      risk: {
        level: skill.riskLevel || "low",
        network: !!skill.network,
        filesystem: !!skill.filesystem,
        subprocess: !!skill.subprocess,
        secrets: !!skill.secrets,
      },
    },
    lifecycleState: "active",
    distribution: {
      defaultEnabled: pack.defaultEnabled !== false,
      employeeVisibilityMode: pack.employeeVisibilityMode,
      scope: {},
    },
    updatedAt: now,
    updatedBy: "apply-starter-pack-overlay",
  };
  const idx = findBySkillKey(skill.skillKey);
  if (idx >= 0) {
    const prev = registry[idx];
    entry.manifest.id = prev.manifest?.id || id;
    entry.manifest.version = prev.manifest?.version || "1.0.0";
    entry.distribution.scope = prev.distribution?.scope || {};
    registry[idx] = entry;
    return "updated";
  }
  registry.push(entry);
  return "registered";
}

let registered = 0;
let updated = 0;
const packSkillKeys = new Set();
for (const pack of packs.packs) {
  for (const skill of pack.skills) {
    packSkillKeys.add(skill.skillKey);
    const r = upsertSkill(skill, pack);
    if (r === "registered") registered += 1;
    else updated += 1;
  }
}

let demoted = 0;
if (args["demote-non-pack"]) {
  for (const entry of registry) {
    const key = (entry?.manifest?.skillKey || "").trim();
    if (!key || packSkillKeys.has(key)) continue;
    if (entry.lifecycleState === "retired") continue;
    const dist = entry.distribution || (entry.distribution = {});
    if (dist.defaultEnabled === false && dist.employeeVisibilityMode === "enterprise_only") continue;
    dist.defaultEnabled = false;
    dist.employeeVisibilityMode = "enterprise_only";
    entry.updatedAt = new Date().toISOString();
    entry.updatedBy = "apply-starter-pack-overlay";
    demoted += 1;
  }
}

writeJson(registryPath, registry);

// entitle all known tenants from existing entitlements file + keep packs
const ent = readJson(entitlementsPath, { version: 1, tenants: {} });
if (!ent.tenants || typeof ent.tenants !== "object") ent.tenants = {};
const packIds = packs.packs.map((p) => p.id);
for (const [tenantId, row] of Object.entries(ent.tenants)) {
  const next = new Set([...(row.packIds || []), ...packIds]);
  ent.tenants[tenantId] = {
    ...row,
    packIds: [...next],
    plan: row.plan || "trial",
    source: row.source || "seed",
    updatedAt: new Date().toISOString(),
  };
}
writeJson(entitlementsPath, ent);

console.log(JSON.stringify({ registered, updated, demoted, packs: packIds, registryPath }, null, 2));
EOF

# snapshot packs as JSON so host node can seed without TS compile
pnpm exec tsx -e '
import fs from "node:fs";
import { ALL_CAPABILITY_PACKS } from "./src/gateway/capability-packs/starter-packs.ts";
const packs = ALL_CAPABILITY_PACKS.filter((p) => p.id === "starter" || p.id === "cn-office");
fs.writeFileSync(process.argv[1], JSON.stringify({ packs }, null, 2));
' "$PKG_DIR/capability-packs/starter-packs.snapshot.json"

TAR="/tmp/${SLUG}.tar.gz"
tar -C "$PKG_DIR" -czf "$TAR" .
echo "package: $TAR ($(du -h "$TAR" | awk '{print $1}'))"

echo "== remote plan =="
remote "echo host=\$(hostname); podman inspect -f '{{.State.Status}}' $CONTAINER; echo LIVE; podman exec $CONTAINER cat /app/dist/build-info.json | head -c 200; echo"

if [[ "$APPLY" != true ]]; then
  cat <<EOF

DRY-RUN only. To apply on production:

  bash scripts/audit/apply-starter-pack-overlay.sh --apply

This will:
  1) backup /root/.openbot/governance/{registry,tenant-pack-entitlements}.json
  2) sync starter skills → /root/.openbot/skills + container /app/skills
  3) seed A/B registry visibility + refresh tenant pack entitlements
  4) podman restart $CONTAINER
EOF
  exit 0
fi

echo "== upload =="
REMOTE_DIR="/root/openbot-maintenance-${SLUG}"
if [[ "$LOCAL_EXEC" == true || "$SSH_HOST" == local ]]; then
  mkdir -p "$REMOTE_DIR"
  tar -C "$REMOTE_DIR" -xzf "$TAR"
else
  ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
  scp -o BatchMode=yes "$TAR" "$SSH_HOST:/tmp/${SLUG}.tar.gz"
  ssh -o BatchMode=yes "$SSH_HOST" "mkdir -p '$REMOTE_DIR' && tar -C '$REMOTE_DIR' -xzf /tmp/${SLUG}.tar.gz"
fi

echo "== apply on host =="
remote_stdin <<REMOTE
set -euo pipefail
CONTAINER="$CONTAINER"
REMOTE_DIR="$REMOTE_DIR"
STAMP="$STAMP"
BK="/root/openbot-maintenance-starter-pack-abc-\${STAMP}"
mkdir -p "\$BK"
cp -a /root/.openbot/governance/registry.json "\$BK/registry.json.before"
cp -a /root/.openbot/governance/tenant-pack-entitlements.json "\$BK/tenant-pack-entitlements.json.before" 2>/dev/null || true
if [[ -d /root/.openbot/skills ]]; then
  cp -a /root/.openbot/skills "\$BK/skills.before"
fi
echo "backup: \$BK"

# sync managed skills
mkdir -p /root/.openbot/skills
for d in "\$REMOTE_DIR"/skills/*; do
  key=\$(basename "\$d")
  rm -rf "/root/.openbot/skills/\$key"
  cp -a "\$d" "/root/.openbot/skills/\$key"
  echo "managed \$key"
done

# sync container bundled skills
for d in "\$REMOTE_DIR"/skills/*; do
  key=\$(basename "\$d")
  podman exec "\$CONTAINER" sh -c "rm -rf /app/skills/\$key && mkdir -p /app/skills/\$key"
  podman cp "\$d/." "\$CONTAINER:/app/skills/\$key/"
  echo "container \$key"
done

# seed registry via host node
node "\$REMOTE_DIR/scripts/seed-on-host.mjs" \
  --config-dir=/root/.openbot \
  --skills-root="\$REMOTE_DIR/skills" \
  --packs-root="\$REMOTE_DIR/capability-packs" \
  --demote-non-pack

# smoke: starter files exist
for k in summarize canvas finance-research agent-reach openbot-platform-ops defuddle wechat-article; do
  podman exec "\$CONTAINER" test -f "/app/skills/\$k/SKILL.md"
  echo "smoke file OK \$k"
done

podman restart "\$CONTAINER"
ok=false
for i in \$(seq 1 30); do
  if curl -fsS http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    echo "healthz=200 after \${i} attempts"
    ok=true
    break
  fi
  sleep 2
done
if [[ "\$ok" != true ]]; then
  echo "ERROR: healthz not ready" >&2
  exit 7
fi
curl -fsS http://127.0.0.1:18789/readyz | head -c 200; echo

python3 - <<'PY'
import json
reg=json.load(open("/root/.openbot/governance/registry.json"))
items=reg if isinstance(reg,list) else []
direct=sorted([ (e.get("manifest") or {}).get("skillKey") for e in items if (e.get("distribution") or {}).get("employeeVisibilityMode")=="direct_employee_visible" and e.get("lifecycleState")=="active" and (e.get("manifest") or {}).get("skillKey") ])
print("direct_count", len(direct))
print("direct_keys", ",".join(direct))
ghost=[k for k in ("web-search","ppt-generator") if any((e.get("manifest") or {}).get("skillKey")==k and (e.get("distribution") or {}).get("employeeVisibilityMode")=="direct_employee_visible" for e in items)]
print("ghost_still_direct", ghost)
PY

echo "rollback:"
echo "  cp -a \$BK/registry.json.before /root/.openbot/governance/registry.json"
echo "  cp -a \$BK/tenant-pack-entitlements.json.before /root/.openbot/governance/tenant-pack-entitlements.json"
echo "  rm -rf /root/.openbot/skills && cp -a \$BK/skills.before /root/.openbot/skills"
echo "  podman restart $CONTAINER"
REMOTE

echo "== done $SLUG =="
