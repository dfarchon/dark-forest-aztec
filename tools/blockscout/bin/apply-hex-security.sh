#!/usr/bin/env bash
# Patch cloned Blockscout Mix pins to Hex-patched releases (same major where possible).
# Phoenix 1.6.16 → 1.6.17 (CVE-2026-56811, CVE-2026-56812)
# Mint 1.10.0 → 1.10.1 (CVE-2026-82672)
# Decimal 2.4.1 → 3.1.1 override (CVE-2026-32686; no 2.x Hex-clean release)
set -euo pipefail

BACKEND="${1:?backend dir}"

python3 - "${BACKEND}" <<'PY'
import pathlib, sys

root = pathlib.Path(sys.argv[1])

def sub(path, old, new):
    p = root / path
    text = p.read_text()
    if old not in text:
        if new in text:
            return
        raise SystemExit(f"pattern not found in {path}: {old}")
    p.write_text(text.replace(old, new, 1))

sub(
    "apps/block_scout_web/mix.exs",
    '{:phoenix, "== 1.6.16"}',
    '{:phoenix, "== 1.6.17"}',
)
sub(
    "mix.exs",
    '{:mint, "~> 1.10.0"}',
    '{:mint, "~> 1.10.1"}',
)
sub(
    "apps/explorer/mix.exs",
    '{:decimal, "~> 2.0"}',
    '{:decimal, ">= 2.0.0"}',
)
sub(
    "apps/ethereum_jsonrpc/mix.exs",
    '{:decimal, "~> 2.0"}',
    '{:decimal, ">= 2.0.0"}',
)

# Next.js is the explorer UI. Do not run the old Phoenix webpack watcher.
dev = root / "apps/block_scout_web/config/dev.exs"
d = dev.read_text()
old_w = """  watchers: [
    node: [
      "node_modules/webpack/bin/webpack.js",
      "--mode",
      "development",
      "--watch",
      cd: Path.expand("../assets", __DIR__)
    ]
  ]
"""
new_w = "  watchers: []\n"
if old_w in d:
    d = d.replace(old_w, new_w, 1)
    d = d.replace("  code_reloader: true,", "  code_reloader: false,", 1)
    dev.write_text(d)


mix = root / "mix.exs"
text = mix.read_text()
needle = '{:mint, "~> 1.10.1"},'
insert = """{:mint, "~> 1.10.1"},
      {:phoenix, "== 1.6.17", override: true},
      {:decimal, "~> 3.1", override: true},"""
if "{:decimal, \"~> 3.1\", override: true}" not in text:
    if needle not in text:
        raise SystemExit("root mix.exs mint pin missing after edit")
    mix.write_text(text.replace(needle, insert, 1))
print("[blockscout] hex security pins applied")
PY
