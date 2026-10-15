#!/usr/bin/env python3
"""Regenerate static/sources.json after adding/removing source HTML files."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
manifest = STATIC / "sources.json"
files = sorted(
    path.name
    for path in STATIC.glob("*.html")
    if path.is_file() and not path.name.lower().startswith("index.")
)
manifest.write_text(json.dumps({"files": files}, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {manifest.relative_to(ROOT)} with {len(files)} source HTML file(s)")
