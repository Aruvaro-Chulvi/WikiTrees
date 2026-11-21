#!/usr/bin/env python3
"""WikiTrees — community trees: check a tree file and build what gets published.

Only the Python standard library is needed (Python 3.9 or newer).

    python wikitrees_check.py check my_tree.json            checks the format and the rules
    python wikitrees_check.py check my_tree.json --online   also checks every link against the live
                                                            Wikipedia in the 10 languages (needs internet)
    python wikitrees_check.py site --out=_site              (maintainers) builds the web site with the
                                                            approved community trees

The same checks run on GitHub when you send your tree, and again when the maintainer
approves it. FORMAT.md explains the format; CONTRIBUTING.md, how to send a tree.

MIT License — Copyright (c) 2026 Álvaro C. Chulvi (Offlined, https://www.offlined.org).
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

FORMAT = "wikitrees-community/1"
LANGS = ["en", "es", "fr", "pt", "it", "de", "ru", "zh", "hi", "ar"]
LANG_NAMES = {"en": "English", "es": "Español", "fr": "Français", "pt": "Português", "it": "Italiano",
              "de": "Deutsch", "ru": "Русский", "zh": "中文", "hi": "हिन्दी", "ar": "العربية"}
CATEGORIES = ["natlife", "human", "geo", "education", "history", "art", "food_nutrition", "misc"]
OFFICIAL = {"animalia", "plantae", "fungi", "protista", "astronomy_bodies", "dinosaurs", "human_body_parts",
            "viruses", "diseases_icd", "medicines_atc", "continents_countries_cities", "world_languages",
            "ethnic_groups", "branches_of_knowledge", "periodic_elements", "mathematics", "physics", "chemistry",
            "art_movements_artists", "world_museums", "world_cuisines", "nutrients", "aromatic_plants", "minerals",
            "mythologies", "empires"}
# Licences a community tree may have (chosen by its author; both allow any use, also commercial)
LICENSES = {"CC-BY-4.0": ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
            "CC0-1.0": ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/")}

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_NODES = 5000
MAX_DEPTH = 12            # the root is level 0
MAX_CHILDREN = 400
MIN_LINKED = 20           # nodes with an article, in every language
MAX_TITLE = 150
MAX_DESC = 300
MAX_AUTHOR = 60
SLUG_RX = re.compile(r"^[a-z0-9_]{2,40}$")
LOGIN_RX = re.compile(r"^[a-z0-9_]{1,39}$")
BAD_CHARS = re.compile(r"[<>{}\[\]|\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]")
# Wikipedia titles cannot contain these (and we never link to sections: no «#»)
BAD_WIKI = re.compile(r"[#<>\[\]{}|\u0000-\u001f\u007f]")
NODE_KEYS = {"id", "i18n", "noWiki", "children"}
I18N_NODE_KEYS = {"title", "wiki", "url"}
UA = "WikiTrees-community-check/1.0 (https://github.com/Aruvaro-Chulvi/WikiTrees)"


class Report:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def err(self, msg: str):
        if len(self.errors) < 400:
            self.errors.append(msg)
        elif len(self.errors) == 400:
            self.errors.append("… (too many errors, the rest are not shown)")

    def warn(self, msg: str):
        if len(self.warnings) < 200:
            self.warnings.append(msg)

    @property
    def ok(self) -> bool:
        return not self.errors


def clean_text(s) -> str:
    return unicodedata.normalize("NFC", str(s)).strip() if isinstance(s, str) else ""


def node_label(path: list[str]) -> str:
    return " › ".join(path) if path else "(root)"


# ── 1. Format and rules (no internet) ──────────────────────────────────────

def check_meta(meta, rep: Report) -> None:
    if not isinstance(meta, dict):
        rep.err("«meta» is missing or is not an object.")
        return
    extra = set(meta) - {"slug", "author", "category", "emoji", "license", "i18n"}
    if extra:
        rep.err(f"«meta» has unknown keys: {', '.join(sorted(extra))}.")
    if "license" in meta and meta["license"] not in LICENSES:
        rep.err(f"«meta.license» must be one of: {', '.join(LICENSES)} (or be left out: you choose it in the form).")
    slug = meta.get("slug")
    if not isinstance(slug, str) or not SLUG_RX.match(slug):
        rep.err("«meta.slug» must be 2–40 characters: lowercase letters a–z, digits and «_» (e.g. «volcanoes»).")
    elif slug in OFFICIAL:
        rep.err(f"«meta.slug» «{slug}» is the name of an official WikiTrees tree: choose another one.")
    author = clean_text(meta.get("author"))
    if not author or len(author) > MAX_AUTHOR or BAD_CHARS.search(author):
        rep.err(f"«meta.author» (the name we credit) is required, up to {MAX_AUTHOR} characters, plain text.")
    if meta.get("category") not in CATEGORIES:
        rep.err(f"«meta.category» must be one of: {', '.join(CATEGORIES)}.")
    emoji = meta.get("emoji", "")
    if emoji and (not isinstance(emoji, str) or len(emoji) > 8 or any(c.isalnum() for c in emoji)):
        rep.err("«meta.emoji» must be a single emoji (or be left out).")
    i18n = meta.get("i18n")
    if not isinstance(i18n, dict):
        rep.err("«meta.i18n» is missing: the title and description in the 10 languages.")
        return
    for lang in LANGS:
        L = i18n.get(lang)
        if not isinstance(L, dict):
            rep.err(f"«meta.i18n.{lang}» is missing ({LANG_NAMES[lang]}).")
            continue
        if set(L) - {"title", "description"}:
            rep.err(f"«meta.i18n.{lang}» has unknown keys: {', '.join(sorted(set(L) - {'title', 'description'}))}.")
        title, desc = clean_text(L.get("title")), clean_text(L.get("description"))
        if not title or len(title) > 80 or BAD_CHARS.search(title):
            rep.err(f"«meta.i18n.{lang}.title» is required (plain text, up to 80 characters).")
        if not desc or len(desc) > MAX_DESC or BAD_CHARS.search(desc):
            rep.err(f"«meta.i18n.{lang}.description» is required (plain text, up to {MAX_DESC} characters).")
    extra = set(i18n) - set(LANGS)
    if extra:
        rep.err(f"«meta.i18n» has languages WikiTrees does not use: {', '.join(sorted(extra))}.")


def check_tree(root, rep: Report) -> dict:
    """Walks the tree. Returns stats: nodes, depth, linked per language, titles per language."""
    stats = {"nodes": 0, "depth": 0, "linked": {l: 0 for l in LANGS}, "visible": {l: 0 for l in LANGS},
             "wikis": {l: set() for l in LANGS}}
    if not isinstance(root, dict):
        rep.err("«tree» is missing or is not an object (the root node).")
        return stats

    def walk(n, depth: int, path: list[str]) -> dict:
        """Returns {lang: visible?} for this node."""
        stats["nodes"] += 1
        stats["depth"] = max(stats["depth"], depth)
        here = node_label(path)
        if stats["nodes"] == MAX_NODES + 1:
            rep.err(f"The tree has more than {MAX_NODES} nodes. Split it into smaller trees.")
        if not isinstance(n, dict):
            rep.err(f"{here}: a node must be an object.")
            return {l: False for l in LANGS}
        extra = set(n) - NODE_KEYS
        if extra:
            rep.err(f"{here}: unknown keys {', '.join(sorted(extra))} (allowed: id, i18n, noWiki, children).")
        if "id" in n and (not isinstance(n["id"], str) or len(n["id"]) > 80 or BAD_CHARS.search(n["id"])):
            rep.err(f"{here}: «id» must be a short text (or be left out).")
        nowiki = n.get("noWiki", [])
        if not isinstance(nowiki, list) or any(x not in LANGS for x in nowiki):
            rep.err(f"{here}: «noWiki» must be a list of language codes ({', '.join(LANGS)}).")
            nowiki = []
        i18n = n.get("i18n")
        if not isinstance(i18n, dict):
            rep.err(f"{here}: «i18n» is missing.")
            i18n = {}
        extra = set(i18n) - set(LANGS)
        if extra:
            rep.err(f"{here}: languages WikiTrees does not use: {', '.join(sorted(extra))}.")
        title_en = clean_text((i18n.get("en") or {}).get("title")) if isinstance(i18n.get("en"), dict) else ""
        me = path + [title_en or "?"]
        here = node_label(me)
        has = {}
        for lang in LANGS:
            L = i18n.get(lang)
            if not isinstance(L, dict):
                rep.err(f"{here}: the {LANG_NAMES[lang]} ({lang}) title is missing. All 10 languages are required.")
                has[lang] = False
                continue
            extra = set(L) - I18N_NODE_KEYS
            if extra:
                rep.err(f"{here} [{lang}]: unknown keys {', '.join(sorted(extra))} (allowed: title, wiki).")
            title = clean_text(L.get("title"))
            if not title:
                rep.err(f"{here} [{lang}]: «title» is empty.")
            elif len(title) > MAX_TITLE or BAD_CHARS.search(title):
                rep.err(f"{here} [{lang}]: «title» must be plain text up to {MAX_TITLE} characters.")
            wiki = clean_text(L.get("wiki"))
            if lang in nowiki:
                if wiki:
                    rep.err(f"{here} [{lang}]: it has a «wiki» article but «{lang}» is also in «noWiki». Choose one.")
                has[lang] = False
            elif not wiki:
                rep.err(f"{here} [{lang}]: «wiki» (the exact Wikipedia article) is missing. "
                        f"If there is no article in that language, add «{lang}» to «noWiki».")
                has[lang] = False
            elif len(wiki) > 255 or BAD_WIKI.search(wiki) or wiki.startswith(("http:", "https:", "/")):
                rep.err(f"{here} [{lang}]: «wiki» must be the article title only (no URL, no «#section»): «{wiki}».")
                has[lang] = False
            else:
                has[lang] = True
                stats["linked"][lang] += 1
                stats["wikis"][lang].add(wiki)
        kids = n.get("children", [])
        if not isinstance(kids, list):
            rep.err(f"{here}: «children» must be a list.")
            kids = []
        if "children" in n and not kids:
            rep.warn(f"{here}: «children» is empty; leave it out on leaves.")
        if len(kids) > MAX_CHILDREN:
            rep.err(f"{here}: {len(kids)} children; the maximum is {MAX_CHILDREN}. Group them in sub-branches.")
        if depth + 1 > MAX_DEPTH and kids:
            rep.err(f"{here}: the tree is deeper than {MAX_DEPTH} levels.")
            kids = []
        seen: dict[tuple, int] = {}
        vis_kids = {l: False for l in LANGS}
        for k in kids:
            if isinstance(k, dict) and isinstance(k.get("i18n"), dict):
                for lang in LANGS:
                    L = k["i18n"].get(lang)
                    if isinstance(L, dict) and clean_text(L.get("wiki")):
                        key = (lang, clean_text(L["wiki"]).replace("_", " ").casefold())
                        seen[key] = seen.get(key, 0) + 1
                        if seen[key] == 2:
                            rep.err(f"{here}: two children link to the same {lang} article «{clean_text(L['wiki'])}».")
            sub = walk(k, depth + 1, me)
            for lang in LANGS:
                vis_kids[lang] = vis_kids[lang] or sub[lang]
        vis = {}
        for lang in LANGS:
            # as in WikiTrees: a leaf without an article is hidden; a branch stays as a label
            vis[lang] = has[lang] or vis_kids[lang]
            if vis[lang]:
                stats["visible"][lang] += 1
        return vis

    walk(root, 0, [])
    for lang in LANGS:
        if stats["linked"][lang] < MIN_LINKED:
            rep.err(f"Only {stats['linked'][lang]} nodes have a {LANG_NAMES[lang]} article; at least {MIN_LINKED} are needed.")
    if stats["nodes"] > 1 and not isinstance(root.get("children"), list):
        rep.err("The root has no children.")
    return stats


def load(path_or_bytes, rep: Report):
    raw = path_or_bytes if isinstance(path_or_bytes, bytes) else Path(path_or_bytes).read_bytes()
    if len(raw) > MAX_FILE_BYTES:
        rep.err(f"The file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")
        return None
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except UnicodeDecodeError:
        rep.err("The file is not UTF-8 text.")
        return None
    except json.JSONDecodeError as e:
        rep.err(f"It is not valid JSON: {e.msg} (line {e.lineno}, column {e.colno}).")
        return None
    if not isinstance(data, dict):
        rep.err("The file must contain one JSON object.")
        return None
    if data.get("format") != FORMAT:
        rep.err(f"«format» must be \"{FORMAT}\".")
    extra = set(data) - {"format", "meta", "tree"}
    if extra:
        rep.err(f"Unknown keys at the top: {', '.join(sorted(extra))} (allowed: format, meta, tree).")
    return data


def check(data, rep: Report) -> dict:
    check_meta(data.get("meta"), rep)
    return check_tree(data.get("tree"), rep)


# ── 2. Links against the live Wikipedia ────────────────────────────────────

def _api(lang: str, titles: list[str]) -> dict:
    body = urllib.parse.urlencode({
        "action": "query", "format": "json", "formatversion": "2", "redirects": "1",
        "prop": "pageprops", "ppprop": "disambiguation", "titles": "|".join(titles),
    }).encode()
    req = urllib.request.Request(f"https://{lang}.wikipedia.org/w/api.php", data=body,
                                 headers={"User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 4:
                raise
            time.sleep(2 + attempt * 3)
    return {}


def check_online(stats: dict, rep: Report, progress=None) -> dict:
    """Checks that every «wiki» title is a real article (not missing, not a disambiguation page).
    Redirects are accepted (Wikipedia and Kiwix follow them) but reported as notes.
    Returns {lang: {title: final_title}}."""
    resolved: dict[str, dict] = {}
    for lang in LANGS:
        titles = sorted(stats["wikis"][lang])
        res = {}
        for i in range(0, len(titles), 50):
            chunk = titles[i:i + 50]
            if progress:
                progress(lang, i, len(titles))
            try:
                j = _api(lang, chunk)
            except Exception as e:
                rep.err(f"Could not reach {lang}.wikipedia.org to check the links ({e}). Try again later.")
                break
            q = j.get("query") or {}
            norm = {x["from"]: x["to"] for x in q.get("normalized") or []}
            redir = {x["from"]: x["to"] for x in q.get("redirects") or []}
            pages = {p.get("title"): p for p in q.get("pages") or []}
            for t in chunk:
                n = norm.get(t, t)
                final = redir.get(n, n)
                p = pages.get(final) or {}
                if p.get("missing") or p.get("invalid") or not p:
                    rep.err(f"[{lang}] «{t}»: there is no such article on {lang}.wikipedia.org. "
                            f"Fix the title or put «{lang}» in that node's «noWiki».")
                elif "disambiguation" in (p.get("pageprops") or {}):
                    rep.err(f"[{lang}] «{t}» is a disambiguation page, not an article. Link the exact article.")
                else:
                    if final != n:
                        rep.warn(f"[{lang}] «{t}» redirects to «{final}».")
                    res[t] = final
            time.sleep(0.2)
        resolved[lang] = res
    return resolved


# ── 3. Building what gets published ────────────────────────────────────────

def node_count(stats: dict) -> dict:
    return {l: stats["visible"][l] for l in LANGS}


def _norm_node(n: dict, online: bool) -> dict:
    out = {}
    if n.get("id"):
        out["id"] = clean_text(n["id"])
    i18n = {}
    nowiki = [l for l in LANGS if l in (n.get("noWiki") or [])]
    for lang in LANGS:
        L = n["i18n"][lang]
        x = {"title": clean_text(L["title"])}
        wiki = clean_text(L.get("wiki"))
        if wiki and lang not in nowiki:
            x["wiki"] = wiki.replace("_", " ")
            if online:
                x["url"] = f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(x["wiki"].replace(" ", "_"), safe="()_,'!:-.~*")
        i18n[lang] = x
    out["i18n"] = i18n
    if nowiki:
        out["noWiki"] = nowiki
    kids = n.get("children") or []
    if kids:
        out["children"] = [_norm_node(k, online) for k in kids]
    return out


def build_tree(data: dict, tree_id: str, github: str, fmt: str) -> dict:
    meta = data["meta"]
    root = _norm_node(data["tree"], fmt == "online")
    about = {
        "name": "WikiTrees — community tree", "id": tree_id, "author": clean_text(meta["author"]),
        "github": github, "project": "Offlined", "website": "https://www.offlined.org",
        "repository": "https://github.com/Aruvaro-Chulvi/WikiTrees",
        "license": LICENSES[meta["license"]][0], "licenseUrl": LICENSES[meta["license"]][1],
        "copyright": f"© {clean_text(meta['author'])} — a WikiTrees community tree (Offlined)",
        "format": fmt,
    }
    return {"about": about, **root}


def file_sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def cover_ok(p: Path) -> bool:
    b = p.read_bytes()
    if len(b) > 600 * 1024 or not b.startswith(b"\x89PNG\r\n\x1a\n") or b[12:16] != b"IHDR":
        return False
    w, h = int.from_bytes(b[16:20], "big"), int.from_bytes(b[20:24], "big")
    return 64 <= w <= 2048 and 64 <= h <= 2048


def site(repo: Path, out: Path) -> int:
    """Copies the public web site and adds trees/community/ (index.json, offlined/, online/, images/)."""
    if out.exists():
        shutil.rmtree(out)
    skip = {".git", ".github", "private", "community", "community-kit", "_site", "__pycache__"}
    for p in repo.iterdir():
        if p.name in skip:
            continue
        if p.is_dir():
            shutil.copytree(p, out / p.name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        else:
            out.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, out / p.name)
    # the kit is published too (the web checker and the example are useful to authors)
    shutil.copytree(repo / "community-kit", out / "community-kit", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    cdir = out / "trees" / "community"
    for sub in ("offlined", "online", "images"):
        (cdir / sub).mkdir(parents=True, exist_ok=True)
    retired = []
    rf = repo / "community" / "retired.json"
    if rf.exists():
        retired = [x for x in json.loads(rf.read_text(encoding="utf-8")) if isinstance(x, dict) and x.get("id")]
    gone = {x["id"] for x in retired}
    items, bad = [], 0
    for folder in sorted((repo / "community").glob("*.*/")) if (repo / "community").exists() else []:
        m = re.match(r"^([a-z0-9_]{1,39})\.([a-z0-9_]{2,40})$", folder.name)
        f = folder / "tree.json"
        if not m or not f.is_file():
            continue
        tree_id = "c." + folder.name
        if tree_id in gone:
            continue
        rep = Report()
        data = load(f, rep)
        stats = check(data, rep) if data else None
        if rep.ok and data["meta"].get("license") not in LICENSES:
            rep.err("«meta.license» is missing (CC-BY-4.0 or CC0-1.0).")
        if not rep.ok or data["meta"]["slug"] != m.group(2):
            print(f"::error::{folder.name}: does not pass the checks, not published: {rep.errors[:3]}")
            bad += 1
            continue
        github = m.group(1)
        sub = json.loads((folder / "submission.json").read_text(encoding="utf-8")) if (folder / "submission.json").exists() else {}
        entry = {"id": tree_id, "author": clean_text(data["meta"]["author"]), "github": sub.get("github") or github,
                 "category": data["meta"]["category"], "emoji": data["meta"].get("emoji") or "",
                 "i18n": {l: {"title": clean_text(data["meta"]["i18n"][l]["title"]),
                              "description": clean_text(data["meta"]["i18n"][l]["description"])} for l in LANGS},
                 "nodes": node_count(stats), "date": sub.get("date") or "", "issue": sub.get("issue"),
                 "license": LICENSES[data["meta"]["license"]][0],
                 "licenseUrl": LICENSES[data["meta"]["license"]][1], "community": True}
        for fmt in ("offlined", "online"):
            dst = cdir / fmt / f"{tree_id}.json"
            dst.write_text(json.dumps(build_tree(data, tree_id, entry["github"], fmt), ensure_ascii=False,
                                      separators=(",", ":")), encoding="utf-8")
            entry[fmt] = {"path": f"trees/community/{fmt}/{tree_id}.json", "size": dst.stat().st_size, "sha256": file_sha(dst)}
        entry["version"] = entry["offlined"]["sha256"][:12]
        cov = folder / "cover.png"
        if cov.is_file() and cover_ok(cov):
            dst = cdir / "images" / f"{tree_id}.png"
            shutil.copy2(cov, dst)
            entry["cover"] = {"path": f"trees/community/images/{tree_id}.png", "size": dst.stat().st_size, "sha256": file_sha(dst)}
        items.append(entry)
    items.sort(key=lambda x: x["i18n"]["en"]["title"].casefold())
    index = {"format": 1, "about": {"name": "WikiTrees — community trees",
                                    "repository": "https://github.com/Aruvaro-Chulvi/WikiTrees",
                                    "license": "Each tree has its own licence (CC BY 4.0 or CC0 1.0): see «license».",
                                    "note": "Trees made by the community and reviewed by the maintainer before publishing."},
             "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "trees": items,
             "retired": [{"id": x["id"], "reason": str(x.get("reason") or "")[:300]} for x in retired]}
    (cdir / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Site built in {out}: {len(items)} community trees, {len(retired)} retired, {bad} skipped.")
    return 1 if bad else 0


# ── Command line ───────────────────────────────────────────────────────────

def print_report(rep: Report, stats: dict | None) -> None:
    if stats:
        print(f"Nodes: {stats['nodes']} · depth: {stats['depth']} · with article: "
              + ", ".join(f"{l} {stats['linked'][l]}" for l in LANGS))
    for w in rep.warnings:
        print("  note:", w)
    for e in rep.errors:
        print("  ERROR:", e)
    print("\nOK — the tree passes the checks." if rep.ok else f"\n{len(rep.errors)} error(s): fix them and check again.")


def main(argv: list[str]) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in argv if not a.startswith("--")]
    opts = dict(a[2:].split("=", 1) if "=" in a else (a[2:], "1") for a in argv if a.startswith("--"))
    if not args or args[0] not in ("check", "site"):
        print(__doc__)
        return 2
    if args[0] == "site":
        repo = Path(opts.get("repo") or Path(__file__).resolve().parents[1])
        return site(repo, Path(opts.get("out") or "_site").resolve())
    if len(args) < 2:
        print("Usage: python wikitrees_check.py check FILE.json [--online]")
        return 2
    rep = Report()
    data = load(args[1], rep)
    stats = check(data, rep) if data else None
    if stats and rep.ok and "online" in opts:
        print("Checking the links against Wikipedia…")
        tty = sys.stdout.isatty()
        check_online(stats, rep, progress=(lambda l, i, n: print(f"  {l}: {i}/{n}   ", end="\r")) if tty else None)
        if tty:
            print(" " * 40, end="\r")
    print_report(rep, stats)
    return 0 if rep.ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
