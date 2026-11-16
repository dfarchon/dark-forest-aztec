#!/usr/bin/env bash
# Clone tools/ checkouts at the commits in tools/vendor-pins.json.
# Existing checkouts must already be that commit. This script does not
# reset or delete a checkout that is on a different commit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PINS="${ROOT}/tools/vendor-pins.json"

python3 - "${ROOT}" "${PINS}" <<'PY'
import json, os, shutil, subprocess, sys

root, pins_path = sys.argv[1], sys.argv[2]
pins = json.loads(open(pins_path, encoding="utf-8").read())

def run(args, cwd=None):
    print("[vendor]", " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)

for clone in pins["clones"]:
    dest = os.path.join(root, clone["path"])
    sha = clone["commit"]
    git_dir = os.path.join(dest, ".git")
    if os.path.isdir(git_dir):
        head = subprocess.check_output(["git", "-C", dest, "rev-parse", "HEAD"], text=True).strip()
        if head != sha:
            raise SystemExit(
                f"[vendor] {clone['path']} is {head}, pin is {sha}. "
                "Refusing to replace an existing checkout."
            )
        print(f"[vendor] {clone['path']} already at {sha}", flush=True)
    elif os.path.exists(dest):
        raise SystemExit(f"[vendor] {clone['path']} exists but is not a git checkout")
    else:
        os.makedirs(dest, exist_ok=True)
        run(["git", "init"], cwd=dest)
        run(["git", "remote", "add", "origin", clone["url"]], cwd=dest)
        run(["git", "fetch", "--depth", "1", "origin", sha], cwd=dest)
        run(["git", "checkout", "--detach", "FETCH_HEAD"], cwd=dest)
        head = subprocess.check_output(["git", "-C", dest, "rev-parse", "HEAD"], text=True).strip()
        if head != sha:
            raise SystemExit(f"[vendor] {clone['path']} fetched {head}, expected {sha}")

    overlay = clone.get("overlay")
    if not overlay:
        continue
    src = os.path.join(root, overlay)
    if not os.path.isdir(src):
        raise SystemExit(f"[vendor] missing overlay {overlay}")
    for dirpath, _dirnames, filenames in os.walk(src):
        rel = os.path.relpath(dirpath, src)
        target_dir = dest if rel == "." else os.path.join(dest, rel)
        os.makedirs(target_dir, exist_ok=True)
        for name in filenames:
            shutil.copy2(os.path.join(dirpath, name), os.path.join(target_dir, name))
    print(f"[vendor] applied overlay {overlay}", flush=True)
PY
