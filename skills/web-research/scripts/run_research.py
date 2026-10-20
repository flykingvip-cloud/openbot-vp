#!/usr/bin/env python3
"""Web-research CLI: plan queries, validate task JSON, optionally search/fetch/synthesize."""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from uuid import uuid4

SCRIPT_DIR = Path(__file__).resolve().parent
REFERENCES_DIR = SCRIPT_DIR.parent / "references"
DEFAULT_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "20"))
MAX_SOURCES = int(os.getenv("MAX_SOURCES", "8"))
USER_AGENT = "OpenBot-WebResearch/1.0"

BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def mock_mode() -> bool:
    return os.getenv("MOCK_MODE", "true").lower() == "true"


def build_queries(question: str, depth: str) -> list[str]:
    base = question.strip()
    queries = [base]
    if depth in ("standard", "deep"):
        queries += [f"{base} 官方资料", f"{base} 数据 报告"]
    if depth == "deep":
        queries += [f"{base} 研究 证据", f"{base} 对比 分析"]
    return queries


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_required(payload: dict[str, Any], required: list[str], label: str) -> list[str]:
    return [f"{label} missing {key}" for key in required if key not in payload or payload[key] in ("", None)]


def validate_task(task_path: Path) -> dict[str, Any]:
    schema = load_json(REFERENCES_DIR / "research_task.schema.json")
    task = load_json(task_path)
    if not isinstance(task, dict):
        raise ValueError("task must be a JSON object")
    errors = validate_required(task, schema.get("required", []), "task")
    depth = task.get("depth")
    if depth is not None and depth not in schema.get("properties", {}).get("depth", {}).get("enum", []):
        errors.append(f"invalid depth: {depth}")
    output_format = task.get("output_format")
    if output_format is not None and output_format not in schema.get("properties", {}).get(
        "output_format", {}
    ).get("enum", []):
        errors.append(f"invalid output_format: {output_format}")
    if errors:
        raise ValueError("; ".join(errors))
    return task


def is_blocked_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return True
    host = (parsed.hostname or "").strip().lower()
    if not host or host in BLOCKED_HOSTS or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast)


def http_json(url: str, *, headers: dict[str, str] | None = None, timeout: float = DEFAULT_TIMEOUT) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_text(url: str, timeout: float = DEFAULT_TIMEOUT) -> tuple[str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        body = resp.read().decode(charset, errors="replace")
        return str(resp.url), body


def search(query: str) -> list[dict[str, Any]]:
    if mock_mode() or not os.getenv("SEARCH_API_URL"):
        return [
            {
                "title": f"示例来源：{query}",
                "url": "https://example.com/research-source",
                "snippet": "Mock 模式示例结果，不能作为真实调研证据。",
                "published_at": None,
            }
        ]
    params = {"q": query}
    search_url = os.environ["SEARCH_API_URL"]
    parsed = urllib.parse.urlparse(search_url)
    if parsed.query:
        search_url = f"{search_url}&{urllib.parse.urlencode(params)}"
    else:
        search_url = f"{search_url}?{urllib.parse.urlencode(params)}"
    headers = {}
    api_key = os.getenv("SEARCH_API_KEY", "")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = http_json(search_url, headers=headers)
    return [item for item in payload.get("results", []) if isinstance(item, dict)]


def fetch_url(url: str) -> dict[str, Any]:
    if mock_mode():
        return {
            "url": url,
            "title": "Mock 网页内容",
            "text": "当前处于 MOCK_MODE，此处为示例正文，不能作为真实调研证据。",
            "published_at": None,
        }
    if is_blocked_url(url):
        raise ValueError(f"blocked url: {url}")
    final_url, html = http_text(url)
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.I | re.S)
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, flags=re.I | re.S)
    title = unescape(re.sub(r"\s+", " ", title_match.group(1))).strip() if title_match else ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    return {"url": final_url, "title": title, "text": text[:50000], "published_at": None}


def synthesize(question: str, depth: str, sources: list[dict[str, Any]]) -> str:
    if mock_mode() or not os.getenv("MODEL_API_KEY") or not os.getenv("MODEL_NAME"):
        source_lines = "\n".join(
            f"- [{item.get('source_id')}] {item.get('title')} — {item.get('url')}" for item in sources
        ) or "- 没有获取到来源"
        return (
            "## 调研摘要\n\n"
            "当前未连接真实模型，或处于 MOCK_MODE。以下为可追溯骨架，不是已核验结论。\n\n"
            f"**问题**：{question}\n\n"
            f"**深度**：{depth}\n\n"
            "## 核心发现\n\n- 证据不足，待真实检索与阅读后再写发现。\n\n"
            "## 参考来源\n\n"
            f"{source_lines}\n"
        )
    evidence = "\n\n".join(
        f"[{item.get('source_id')}] {item.get('title')}\nURL: {item.get('url')}\n内容：{(item.get('content') or '')[:6000]}"
        for item in sources
    )
    payload = json.dumps(
        {
            "model": os.environ["MODEL_NAME"],
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是严谨的网页调研代理。必须区分事实、来源观点、推断和未知信息；"
                        "不得编造来源、数据或访问记录。重要主张必须关联来源 ID。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"调研问题：{question}\n深度：{depth}\n\n来源与网页内容：\n"
                        f"{evidence or '没有获取到来源，请明确说明。'}\n\n"
                        "请输出：1. 调研摘要 2. 核心发现 3. 分主题分析 4. 不确定性与限制 "
                        "5. 参考来源（使用 [S1] 这样的来源 ID）"
                    ),
                },
            ],
            "temperature": 0.2,
        }
    ).encode("utf-8")
    base = os.getenv("MODEL_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=payload,
        headers={
            "Authorization": f"Bearer {os.environ['MODEL_API_KEY']}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["choices"][0]["message"]["content"]


def collect_sources(question: str, depth: str) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for query in build_queries(question, depth):
        for item in search(query):
            url = str(item.get("url") or "").strip()
            if url:
                unique[url] = item
    sources: list[dict[str, Any]] = []
    for index, item in enumerate(list(unique.values())[:MAX_SOURCES], start=1):
        url = str(item.get("url") or "")
        try:
            fetched = fetch_url(url)
        except (ValueError, urllib.error.URLError, TimeoutError, OSError) as exc:
            fetched = {"url": url, "title": item.get("title") or "", "text": "", "published_at": None}
            quality = f"fetch failed: {exc}"
        else:
            quality = "Mock 数据，未进行真实来源验证。" if mock_mode() else None
        sources.append(
            {
                "source_id": f"S{index}",
                "title": item.get("title") or fetched.get("title") or "",
                "url": fetched.get("url") or url,
                "publisher": None,
                "published_at": item.get("published_at") or fetched.get("published_at"),
                "accessed_at": utc_now(),
                "content": fetched.get("text") or "",
                "quality_notes": quality,
            }
        )
    return sources


def write_outputs(out_dir: Path, report: str, sources: list[dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "report.md").write_text(report + "\n", encoding="utf-8")
    source_md = "\n".join(
        f"- [{item['source_id']}] {item['title']} — {item['url']}"
        + (f" ({item['quality_notes']})" if item.get("quality_notes") else "")
        for item in sources
    )
    (out_dir / "sources.md").write_text((source_md or "暂无来源") + "\n", encoding="utf-8")
    (out_dir / "claims.json").write_text("[]\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenBot web-research helper")
    parser.add_argument("--question", help="Research question")
    parser.add_argument("--depth", choices=["quick", "standard", "deep"], default="standard")
    parser.add_argument("--task", help="Path to research_task JSON")
    parser.add_argument("--plan", action="store_true", help="Print search queries only")
    parser.add_argument("--validate", metavar="TASK_JSON", help="Validate a task JSON file")
    parser.add_argument("--out-dir", help="Write report.md / sources.md / claims.json")
    args = parser.parse_args(argv)

    if args.validate:
        try:
            task = validate_task(Path(args.validate))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
            return 1
        print(json.dumps({"ok": True, "task": task}, ensure_ascii=False, indent=2))
        return 0

    question = (args.question or "").strip()
    depth = args.depth
    if args.task:
        task = validate_task(Path(args.task))
        question = str(task.get("research_question") or question).strip()
        depth = str(task.get("depth") or depth)

    if not question:
        parser.error("provide --question or --task")

    if args.plan:
        payload = {
            "question": question,
            "depth": depth,
            "queries": build_queries(question, depth),
            "mock_mode": mock_mode(),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    limitations = []
    if mock_mode():
        limitations.append("当前处于 MOCK_MODE，搜索结果和网页内容为示例。")
    sources = collect_sources(question, depth)
    if not sources:
        limitations.append("没有获取到可用来源。")
    report = synthesize(question, depth, sources)
    result = {
        "task_id": str(uuid4()),
        "status": "completed",
        "question": question,
        "depth": depth,
        "mock_mode": mock_mode(),
        "report": report,
        "sources": sources,
        "claims": [],
        "limitations": limitations,
    }
    if args.out_dir:
        write_outputs(Path(args.out_dir), report, sources)
        result["out_dir"] = str(Path(args.out_dir))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from exc
