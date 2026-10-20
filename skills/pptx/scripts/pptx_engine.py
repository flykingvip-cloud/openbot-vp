#!/usr/bin/env python3
"""Legacy thin pptx engine — RETIRED.

OpenBot consulting PPTX must use skills/cyber-ppt (PptxGenJS / pptx-generator).
This script intentionally fails so agents cannot treat python-pptx as a final engine.
Sandbox lacking pip/python-pptx is expected and is NOT a reason PPT cannot be made.
"""

from __future__ import annotations

import sys

MESSAGE = (
    "pptx_engine.py is retired. Load skills/cyber-ppt and generate the final PPTX with "
    "PptxGenJS (primary-engine). Do not pip-install python-pptx; sandbox without "
    "python-pptx/pip is expected. Missing Node/PptxGenJS would be the real blocker."
)


def main(argv: list[str] | None = None) -> int:
    print(MESSAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
