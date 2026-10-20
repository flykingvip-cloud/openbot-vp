#!/usr/bin/env python3
"""Deterministic trigger-boundary check for the web-extract-html-pdf skill.

Keyword heuristic (no model call): should_trigger cases must score on-topic,
should_not_trigger cases must stay off-topic.
"""

import argparse
import json
import re
from pathlib import Path

TRIGGER_TERMS = [
    "pdf", "网页", "正文", "排版", "重排", "排版精良", "论文", "文章", "报告",
    "章节", "中文化", "表格", "图表", "重绘", "封面", "目录", "a4", "打印",
    "导出", "转成", "生成", "交付物", "pdftotext", "html", "翻译排版",
]

# Off-topic signals that suppress the skill even if a stray word matches.
SUPPRESS_TERMS = [
    "1:1", "还原", "复刻原始版式", "纯 txt", "登录", "验证码", "天气",
    "换背景", "技能库", "抓取 b站", "下载视频",
]


def score(text: str) -> int:
    low = text.lower()
    hits = sum(1 for t in TRIGGER_TERMS if t in low)
    for s in SUPPRESS_TERMS:
        if s in low:
            hits -= 2
    return hits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_dir", nargs="?", default=".")
    args = parser.parse_args()
    root = Path(args.skill_dir).resolve()
    cases = json.loads((root / "evals/trigger_cases.json").read_text(encoding="utf-8"))

    failures = []
    results = {"triggered": [], "suppressed": []}

    for case in cases["should_trigger"]:
        s = score(case)
        results["triggered"].append({"case": case, "score": s, "ok": s >= 2})
        if s < 2:
            failures.append(f"should trigger but scored {s}: {case}")

    for case in cases["should_not_trigger"]:
        s = score(case)
        results["suppressed"].append({"case": case, "score": s, "ok": s < 2})
        if s >= 2:
            failures.append(f"should NOT trigger but scored {s}: {case}")

    print(json.dumps({"ok": not failures, "detail": results, "failures": failures},
                     ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
