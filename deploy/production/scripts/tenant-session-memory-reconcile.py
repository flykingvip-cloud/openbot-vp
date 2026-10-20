#!/usr/bin/env python3
"""
Reconcile tenant-scoped session transcripts + sessions.json across duplicate
OpenBot state layouts on a Managed Enterprise host, and sync workspace memory
artifacts onto Catalog locators.

Canonical layout (production):
  sessions:  OPENBOT_TENANTS_ROOT/<tenant>/users/<user>/state/agents/<agent>/sessions/
  state:     OPENBOT_CONFIG_DIR  (default /var/lib/openbot/state)
  tenants:   OPENBOT_TENANTS_ROOT (default /var/lib/openbot/tenants)

Duplicate roots that historically diverged from the container mount:
  - <state>/tenants/          (nested under state volume)
  - <state>/agents/<agent>/sessions/  (legacy global agent scope — cron/webchat only;
    employee bot sessions must NOT be blindly copied into a user dir)

Usage:
  python3 tenant-session-memory-reconcile.py --tenant 001 --dry-run
  python3 tenant-session-memory-reconcile.py --tenant 001 --apply
  python3 tenant-session-memory-reconcile.py --tenant 001 --apply --restore-resets

Always run --dry-run first. Creates timestamped backups beside each mutated file.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from typing import Any

RESET_SUFFIX_RE = re.compile(r"^(.+\.jsonl)\.reset\.[A-Za-z0-9._:-]+$")


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S.%fZ")


def backup_path(path: str) -> str:
    return f"{path}.bak.{ts()}"


def load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def file_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def discover_session_dirs(tenant: str, tenants_root: str, state_root: str) -> dict[str, list[str]]:
    """Map canonical session dir -> list of source dirs (including itself)."""
    canonical_prefix = os.path.join(tenants_root, tenant, "users")
    duplicates = [
        os.path.join(state_root, "tenants", tenant, "users"),
        os.path.join("/root/.openbot", "tenants", tenant, "users"),
    ]

    groups: dict[str, list[str]] = {}

    def scan_users_root(users_root: str, bucket: dict[str, set[str]]) -> None:
        if not os.path.isdir(users_root):
            return
        for user in os.listdir(users_root):
            user_path = os.path.join(users_root, user)
            agents_root = os.path.join(user_path, "state", "agents")
            if not os.path.isdir(agents_root):
                continue
            for agent in os.listdir(agents_root):
                sess = os.path.join(agents_root, agent, "sessions")
                if os.path.isdir(sess):
                    bucket.setdefault(sess, set())

    # Build canonical keys first
    canonical_map: dict[str, set[str]] = {}
    scan_users_root(canonical_prefix, canonical_map)

    # Collect all paths keyed by relative suffix users/<uid>/state/agents/<aid>/sessions
    rel_index: dict[str, set[str]] = {}
    all_roots = [canonical_prefix] + [d for d in duplicates if d != canonical_prefix]
    for users_root in all_roots:
        if not os.path.isdir(users_root):
            continue
        for user in os.listdir(users_root):
            user_path = os.path.join(users_root, user)
            agents_root = os.path.join(user_path, "state", "agents")
            if not os.path.isdir(agents_root):
                continue
            for agent in os.listdir(agents_root):
                sess = os.path.join(agents_root, agent, "sessions")
                if not os.path.isdir(sess):
                    continue
                rel = f"users/{user}/state/agents/{agent}/sessions"
                rel_index.setdefault(rel, set()).add(os.path.normpath(sess))

    for rel, paths in sorted(rel_index.items()):
        canonical = os.path.normpath(os.path.join(tenants_root, tenant, rel))
        sources = sorted(paths)
        groups[canonical] = sources

    return groups


def merge_sessions_json(
    canonical_dir: str,
    source_dirs: list[str],
    dry_run: bool,
) -> dict[str, int]:
    stats = {"keys_added": 0, "keys_updated": 0, "files_copied": 0, "resets_restored": 0}
    store_path = os.path.join(canonical_dir, "sessions.json")
    merged: dict[str, Any] = {}
    if os.path.isfile(store_path):
        raw = load_json(store_path)
        if isinstance(raw, dict):
            merged = dict(raw)

    for src_dir in source_dirs:
        if os.path.normpath(src_dir) == os.path.normpath(canonical_dir):
            continue
        src_store = os.path.join(src_dir, "sessions.json")
        if os.path.isfile(src_store):
            raw = load_json(src_store)
            if not isinstance(raw, dict):
                continue
            for key, entry in raw.items():
                if not isinstance(entry, dict):
                    continue
                prev = merged.get(key)
                if not isinstance(prev, dict):
                    merged[key] = entry
                    stats["keys_added"] += 1
                    continue
                prev_at = int(prev.get("updatedAt") or 0)
                next_at = int(entry.get("updatedAt") or 0)
                if next_at >= prev_at:
                    merged[key] = entry
                    if next_at > prev_at:
                        stats["keys_updated"] += 1

    # Copy jsonl + sidecars from all sources into canonical dir
    os.makedirs(canonical_dir, exist_ok=True)
    for src_dir in source_dirs:
        if not os.path.isdir(src_dir):
            continue
        for name in os.listdir(src_dir):
            src = os.path.join(src_dir, name)
            if not os.path.isfile(src):
                continue
            if not (name.endswith(".jsonl") or name.endswith(".json") or ".jsonl." in name):
                continue
            dst = os.path.join(canonical_dir, name)
            if os.path.isfile(dst):
                if file_size(dst) >= file_size(src):
                    continue
            if dry_run:
                print(f"  [dry-run] copy {src} -> {dst} ({file_size(src)} bytes)")
            else:
                shutil.copy2(src, dst)
            stats["files_copied"] += 1

    if dry_run:
        print(f"  [dry-run] write sessions.json ({len(merged)} keys) -> {store_path}")
    else:
        if os.path.isfile(store_path):
            shutil.copy2(store_path, backup_path(store_path))
        save_json(store_path, merged)

    return stats


def largest_active_jsonl(canonical_dir: str) -> tuple[str, int] | None:
    """Return (basename, size) for the largest non-reset *.jsonl in a sessions dir."""
    best_name = ""
    best_size = 0
    for name in os.listdir(canonical_dir):
        if not name.endswith(".jsonl") or ".reset." in name or ".deleted." in name:
            continue
        size = file_size(os.path.join(canonical_dir, name))
        if size > best_size:
            best_size = size
            best_name = name
    if not best_name:
        return None
    return best_name, best_size


def repoint_main_session_to_largest(canonical_dir: str, dry_run: bool) -> int:
    """
    If the agent:*:main entry points at a tiny transcript while a larger sibling jsonl
    exists (typical after /new + reset), repoint sessionId/sessionFile to the largest file.
    """
    store_path = os.path.join(canonical_dir, "sessions.json")
    if not os.path.isfile(store_path):
        return 0
    raw = load_json(store_path)
    if not isinstance(raw, dict):
        return 0
    largest = largest_active_jsonl(canonical_dir)
    if not largest:
        return 0
    largest_name, largest_size = largest
    largest_id = largest_name[: -len(".jsonl")]
    changed = 0
    for key, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        if not (key.endswith(":main") or key.endswith(":direct:main")):
            continue
        sid = str(entry.get("sessionId") or "").strip()
        active_name = f"{sid}.jsonl" if sid else ""
        active_size = file_size(os.path.join(canonical_dir, active_name)) if active_name else 0
        if active_size >= largest_size * 0.9:
            continue
        if dry_run:
            print(
                f"  [dry-run] repoint {key}: {sid or '?'} ({active_size}B) "
                f"-> {largest_id} ({largest_size}B)"
            )
        else:
            entry["sessionId"] = largest_id
            entry["sessionFile"] = largest_name
            entry["updatedAt"] = int(time.time() * 1000)
        changed += 1
    if changed and not dry_run:
        shutil.copy2(store_path, backup_path(store_path))
        save_json(store_path, raw)
    return changed


def restore_reset_archives(canonical_dir: str, dry_run: bool) -> int:
    """Restore active transcript from newest .jsonl.reset.* when active file missing/smaller."""
    restored = 0
    reset_files = glob.glob(os.path.join(canonical_dir, "*.jsonl.reset.*"))
    by_session: dict[str, list[tuple[str, int]]] = {}
    for path in reset_files:
        base = os.path.basename(path)
        m = RESET_SUFFIX_RE.match(base)
        if not m:
            continue
        active_name = m.group(1)
        by_session.setdefault(active_name, []).append((path, file_size(path)))

    for active_name, candidates in by_session.items():
        candidates.sort(key=lambda x: x[1], reverse=True)
        best_reset, best_size = candidates[0]
        active_path = os.path.join(canonical_dir, active_name)
        active_size = file_size(active_path)
        if active_size >= best_size * 0.9:
            continue
        if dry_run:
            print(
                f"  [dry-run] restore reset {best_reset} -> {active_path} "
                f"(active={active_size}, reset={best_size})"
            )
        else:
            if os.path.isfile(active_path):
                shutil.copy2(active_path, backup_path(active_path))
            shutil.copy2(best_reset, active_path)
        restored += 1
    return restored


def load_registry_locators(state_root: str) -> dict[str, str]:
    """agentSlug / legacyAgentId -> workspace locator directory."""
    path = os.path.join(state_root, "openbot-agent-registry.json")
    if not os.path.isfile(path):
        return {}
    try:
        data = load_json(path)
    except (OSError, json.JSONDecodeError):
        return {}
    out: dict[str, str] = {}
    assets = data.get("assets") or data.get("agentAssets") or []
    if isinstance(assets, dict):
        assets = list(assets.values())
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        slug = (asset.get("legacyAgentId") or asset.get("agentSlug") or asset.get("slug") or "").strip()
        locator = (asset.get("locator") or asset.get("workspaceLocator") or "").strip()
        if slug and locator and os.path.isdir(locator):
            out[slug] = locator
    return out


def sync_workspace_memory(
    state_root: str,
    locators: dict[str, str],
    dry_run: bool,
) -> dict[str, int]:
    """Copy memory.sqlite / MEMORY.md / memory/*.md from legacy workspace trees to locators."""
    stats = {"agents": 0, "files": 0}
    legacy_roots = [
        os.path.join(state_root, "workspace"),
        os.path.join(state_root, "workspace-agents"),
        "/root/.openbot/workspace",
    ]
    memory_names = ("memory.sqlite", "MEMORY.md")

    for agent_id, locator in locators.items():
        targets_found = False
        for root in legacy_roots:
            candidates = [
                os.path.join(root, "agents", agent_id),
                os.path.join(root, f"workspace-{agent_id}"),
                os.path.join(root, agent_id),
            ]
            for src_ws in candidates:
                if not os.path.isdir(src_ws):
                    continue
                os.makedirs(locator, exist_ok=True)
                for name in memory_names:
                    src = os.path.join(src_ws, name)
                    dst = os.path.join(locator, name)
                    if os.path.isfile(src):
                        if os.path.isfile(dst) and file_size(dst) >= file_size(src):
                            continue
                        if dry_run:
                            print(f"  [dry-run] memory {src} -> {dst}")
                        else:
                            shutil.copy2(dst, backup_path(dst)) if os.path.isfile(dst) else None
                            shutil.copy2(src, dst)
                        stats["files"] += 1
                        targets_found = True
                mem_dir = os.path.join(src_ws, "memory")
                if os.path.isdir(mem_dir):
                    dst_mem = os.path.join(locator, "memory")
                    os.makedirs(dst_mem, exist_ok=True)
                    for md in glob.glob(os.path.join(mem_dir, "*.md")):
                        base = os.path.basename(md)
                        dst = os.path.join(dst_mem, base)
                        if os.path.isfile(dst) and file_size(dst) >= file_size(md):
                            continue
                        if dry_run:
                            print(f"  [dry-run] memory {md} -> {dst}")
                        else:
                            if os.path.isfile(dst):
                                shutil.copy2(dst, backup_path(dst))
                            shutil.copy2(md, dst)
                        stats["files"] += 1
                        targets_found = True
        if targets_found:
            stats["agents"] += 1
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcile tenant sessions + workspace memory.")
    parser.add_argument("--tenant", default="001", help="Tenant id (default: 001)")
    parser.add_argument(
        "--tenants-root",
        default=os.environ.get("OPENBOT_TENANTS_ROOT", "/var/lib/openbot/tenants"),
    )
    parser.add_argument(
        "--state-root",
        default=os.environ.get("OPENBOT_CONFIG_DIR", "/var/lib/openbot/state"),
    )
    parser.add_argument("--dry-run", action="store_true", help="Report only (default if no --apply)")
    parser.add_argument("--apply", action="store_true", help="Perform copies and writes")
    parser.add_argument(
        "--restore-resets",
        action="store_true",
        help="Restore active jsonl from .jsonl.reset.* when smaller/missing",
    )
    parser.add_argument(
        "--repoint-main",
        action="store_true",
        help="Repoint agent:*:main to the largest non-reset jsonl when current is much smaller",
    )
    args = parser.parse_args()
    dry_run = not args.apply

    print(f"tenant={args.tenant} tenants_root={args.tenants_root} state_root={args.state_root}")
    print(
        f"mode={'DRY-RUN' if dry_run else 'APPLY'} "
        f"restore_resets={args.restore_resets} repoint_main={args.repoint_main}"
    )
    print()

    groups = discover_session_dirs(args.tenant, args.tenants_root, args.state_root)
    print(f"Found {len(groups)} session directory groups")
    print()

    total = {
        "keys_added": 0,
        "keys_updated": 0,
        "files_copied": 0,
        "resets_restored": 0,
        "main_repointed": 0,
    }
    for canonical, sources in sorted(groups.items()):
        if len(sources) <= 1 and not (args.restore_resets or args.repoint_main):
            continue
        rel = canonical.replace(args.tenants_root, "").lstrip(os.sep)
        print(f"## {rel}")
        print(f"   canonical: {canonical}")
        print(f"   sources:   {len(sources)}")
        st = merge_sessions_json(canonical, sources, dry_run)
        for k, v in st.items():
            total[k] = total.get(k, 0) + v
        if args.restore_resets:
            r = restore_reset_archives(canonical, dry_run)
            total["resets_restored"] += r
        if args.repoint_main:
            r = repoint_main_session_to_largest(canonical, dry_run)
            total["main_repointed"] += r
        print()

    locators = load_registry_locators(args.state_root)
    print(f"Registry locators: {len(locators)}")
    mem_stats = sync_workspace_memory(args.state_root, locators, dry_run)
    print(f"Memory sync: agents={mem_stats['agents']} files={mem_stats['files']}")
    print()
    print("Summary:", json.dumps({**total, **mem_stats}, ensure_ascii=False))

    if dry_run:
        print("\nRe-run with --apply (and optionally --restore-resets) after review.")
    else:
        print("\nDone. Restart gateway: podman restart openbot-gateway-rc")
    return 0


if __name__ == "__main__":
    sys.exit(main())
