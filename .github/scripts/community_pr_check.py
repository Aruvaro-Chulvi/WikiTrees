"""WikiTrees — checks a pull request that adds or changes community trees.

Run by .github/workflows/community-check.yml with the tools of the BASE branch
(so a pull request cannot change how it is checked) on the pull request's files:

    python base/.github/scripts/community_pr_check.py --repo=pr --base=SHA --out=work

Environment: PR_BODY, PR_USER. Writes work/report.md. Exit 1 if there are errors.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TOOLS / "community-kit"))
import wikitrees_check as wt  # noqa: E402

MAINTAINERS = {"aruvaro-chulvi", "github-actions[bot]"}
ALLOWED = {"tree.json", "cover.png", "submission.json"}
PATH_RX = re.compile(r"^community/([a-z0-9_]{1,39})\.([a-z0-9_]{2,40})/([^/]+)$")


def main() -> int:
    opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    repo, out = Path(opts["repo"]), Path(opts.get("out") or "work")
    out.mkdir(parents=True, exist_ok=True)
    user = os.environ.get("PR_USER", "")
    body = os.environ.get("PR_BODY", "")
    maint = user.lower() in MAINTAINERS
    login = user.lower().replace("-", "_")
    changed = subprocess.run(["git", "-C", str(repo), "diff", "--name-only", "--no-renames", f"{opts['base']}...HEAD"],
                             check=True, capture_output=True, text=True, encoding="utf-8").stdout.split()
    errors, lines, folders = [], [], set()
    for p in changed:
        if p in ("community/README.md", "community/retired.json"):
            if not maint:
                errors.append(f"`{p}`: only the maintainer changes this file.")
            continue
        if not p.startswith("community/"):
            if not maint:
                errors.append(f"`{p}`: a community pull request can only change files in `community/<user>.<slug>/`.")
            continue
        m = PATH_RX.match(p)
        if not m or m.group(3) not in ALLOWED:
            errors.append(f"`{p}`: only `community/<user>.<slug>/tree.json`, `cover.png` and `submission.json` are allowed.")
            continue
        if not maint and m.group(1) != login:
            errors.append(f"`{p}`: the folder must start with your GitHub user: `community/{login}.<slug>/`.")
        if m.group(3) == "submission.json" and not maint:
            errors.append(f"`{p}`: this file is written by the maintainer's tools.")
        folders.add((m.group(1), m.group(2)))
    if not maint and len(re.findall(r"^\s*- \[[xX]\] ", body, re.M)) < 2:
        errors.append("Tick both boxes of «Confirmation» in the pull request description. · Marca las dos casillas de «Confirmación».")
    if not maint and len(folders) > 1:
        errors.append("One tree per pull request, please. · Un árbol por pull request, por favor.")

    for user_dir, slug in sorted(folders):
        folder = repo / "community" / f"{user_dir}.{slug}"
        f = folder / "tree.json"
        lines.append(f"### `c.{user_dir}.{slug}`\n")
        if not f.is_file():
            lines.append("Folder removed or without tree.json (the tree is withdrawn).\n")
            continue
        rep = wt.Report()
        data = wt.load(f, rep)
        stats = wt.check(data, rep) if data else None
        if data and isinstance(data.get("meta"), dict) and data["meta"].get("slug") != slug:
            rep.err(f"«meta.slug» must be «{slug}», like the folder.")
        if data and isinstance(data.get("meta"), dict) and data["meta"].get("license") not in wt.LICENSES:
            rep.err("«meta.license» is required in a pull request: «CC-BY-4.0» or «CC0-1.0».")
        if stats and rep.ok:
            wt.check_online(stats, rep)
        cov = folder / "cover.png"
        if cov.exists() and not wt.cover_ok(cov):
            rep.err("cover.png must be a PNG of 64–2048 px per side, up to 600 KB.")
        if stats:
            lines.append(f"Nodes: {stats['nodes']} · depth {stats['depth']} · with article: "
                         + ", ".join(f"{l} {stats['linked'][l]}" for l in wt.LANGS) + "\n")
        lines += [f"- ❌ {e}" for e in rep.errors[:200]]
        lines += [f"- note: {w}" for w in rep.warnings[:100]]
        lines.append("")
        errors += [f"c.{user_dir}.{slug}: {e}" for e in rep.errors]

    head = ["## ✅ Community tree checks passed" if not errors else f"## ❌ {len(errors)} problem(s)", ""]
    head += [f"- {e}" for e in errors[:50] if not e.startswith("c.")]
    (out / "report.md").write_text("\n".join(head + [""] + lines) + "\n", encoding="utf-8")
    print("\n".join(head + lines))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
