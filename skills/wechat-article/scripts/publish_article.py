#!/usr/bin/env python3
"""
Leftover compatibility wrapper. Live draft-box writes use operational_identity
publish_draft (see skills/wechat-article/references/draft-handoff.md).

This file only forwards to leftover publish_agi_axios.js. Do not use either
script when an Official Account identity is already granted.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    script_path = Path(__file__).with_name("publish_agi_axios.js")
    result = subprocess.run(["node", str(script_path), *sys.argv[1:]], check=False)
    return int(result.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
