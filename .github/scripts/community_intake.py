"""WikiTrees — community trees sent with the «New community tree» issue form.

Run by .github/workflows/community-intake.yml when such an issue is opened or edited.
It reads the issue (from environment variables: never from the command line), downloads
the attached tree (and cover), checks it with community-kit/wikitrees_check.py (also every
link against the live Wikipedia), writes a report and, if everything is right, puts the
tree in community/<user>.<slug>/ so the workflow can open a pull request with it.

    python .github/scripts/community_intake.py --out=work

Environment: ISSUE_BODY, ISSUE_NUMBER, ISSUE_USER, ISSUE_CREATED.
Writes work/report.md (the comment for the issue) and work/result.json
({"ok", "folder", "id", "title", "slug"}). Exit code 0 even if the tree has errors
(the report says so); 1 only if something unexpected failed.

Nothing in the issue is ever executed: the tree is JSON and the cover is checked as PNG.
"""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "community-kit"))
import wikitrees_check as wt  # noqa: E402

MARK = "<!-- wikitrees-community-bot -->"
# Option text of the «Licence» dropdown in the form → licence id
FORM_LICENSES = {"cc by 4.0": "CC-BY-4.0", "cc0 1.0": "CC0-1.0"}
ATTACH_RX = re.compile(r"https://github\.com/(?:user-attachments/(?:files|assets)/[\w./%-]+|[\w.-]+/[\w.-]+/files/\d+/[\w.%-]+)")
UA = {"User-Agent": "WikiTrees-community-intake"}


def sections(body: str) -> dict:
    """Issue form body → {heading: text}."""
    out, cur = {}, None
    for line in body.replace("\r\n", "\n").split("\n"):
        if line.startswith("### "):
            cur = line[4:].strip()
            out[cur] = ""
        elif cur is not None:
            out[cur] += line + "\n"
    return {k: v.strip() for k, v in out.items()}


def find(sec: dict, start: str) -> str:
    return next((v for k, v in sec.items() if k.lower().startswith(start)), "")


def fetch(url: str, limit: int) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError("too_big")
    return data


def main() -> int:
    opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    out = Path(opts.get("out") or "work")
    out.mkdir(parents=True, exist_ok=True)
    body = os.environ.get("ISSUE_BODY", "")
    issue = int(os.environ.get("ISSUE_NUMBER") or 0)
    user = os.environ.get("ISSUE_USER", "")
    login = user.lower().replace("-", "_")
    created = (os.environ.get("ISSUE_CREATED") or "")[:10]
    sec = sections(body)
    rep = wt.Report()
    result = {"ok": False, "folder": "", "id": "", "title": "", "slug": ""}
    stats = None

    if not wt.LOGIN_RX.match(login):
        rep.err("Unexpected GitHub user name.")
    # The two boxes of the form must be ticked (the form requires it, but the body can be edited)
    if len(re.findall(r"^- \[[xX]\] ", find(sec, "confirmation"), re.M)) < 2:
        rep.err("Tick both boxes of «Confirmation». · Marca las dos casillas de «Confirmación».")
    lic_text = find(sec, "licence").lower()
    license_id = next((v for k, v in FORM_LICENSES.items() if lic_text.startswith(k)), "")
    if not license_id:
        rep.err("Choose a licence: CC BY 4.0 or CC0 1.0. · Elige una licencia: CC BY 4.0 o CC0 1.0.")
    files = [u for u in ATTACH_RX.findall(find(sec, "tree file")) if not u.lower().endswith((".png", ".jpg", ".jpeg", ".gif"))]
    data = None
    if len(files) != 1:
        rep.err("Attach exactly one .json file in «Tree file». · Adjunta exactamente un archivo .json en «Archivo del árbol».")
    else:
        try:
            raw = fetch(files[0], wt.MAX_FILE_BYTES)
            data = wt.load(raw, rep)
        except ValueError:
            rep.err(f"The file is larger than {wt.MAX_FILE_BYTES // (1024 * 1024)} MB.")
        except Exception as e:
            rep.err(f"Could not download the attached file ({e}).")
    if data:
        stats = wt.check(data, rep)
        if rep.ok:
            print("Checking the links against Wikipedia…", flush=True)
            wt.check_online(stats, rep)

    cover = None
    curls = ATTACH_RX.findall(find(sec, "cover image"))
    if len(curls) > 1:
        rep.err("Attach at most one cover image. · Adjunta como mucho una portada.")
    elif curls:
        try:
            cover = fetch(curls[0], 600 * 1024)
        except ValueError:
            rep.err("The cover is larger than 600 KB. · La portada pasa de 600 KB.")
            cover = None
        except Exception as e:
            rep.err(f"Could not download the cover ({e}).")
        if cover is not None:
            tmp = out / "cover.png"
            tmp.write_bytes(cover)
            if not wt.cover_ok(tmp):
                rep.err("The cover must be a PNG of 64–2048 px per side, up to 600 KB. · La portada debe ser un PNG de 64–2048 px por lado, hasta 600 KB.")
                cover = None

    if data and isinstance(data.get("meta"), dict) and isinstance(data["meta"].get("slug"), str):
        slug = data["meta"]["slug"]
        result.update(slug=slug, folder=f"{login}.{slug}", id=f"c.{login}.{slug}")
        try:
            result["title"] = wt.clean_text(data["meta"]["i18n"]["en"]["title"])
        except Exception:
            pass

    if rep.ok and data:
        data["meta"]["license"] = license_id   # the one chosen in the form wins
        folder = ROOT / "community" / result["folder"]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "tree.json").write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        if cover is not None:
            (folder / "cover.png").write_bytes(cover)
        elif (folder / "cover.png").exists() and not curls:
            (folder / "cover.png").unlink()
        sub = {"github": user, "issue": issue, "date": created, "license": license_id,
               "note": "Sent with the «New community tree» form; the author chose the licence and ticked both confirmation boxes."}
        (folder / "submission.json").write_text(json.dumps(sub, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
        result["ok"] = True

    # ── report for the issue ──
    L = [MARK]
    if result["ok"]:
        L.append("## ✅ Your tree passes the checks · Tu árbol pasa las comprobaciones\n")
        L.append("A pull request with it is opened now. The maintainer will review it by hand and may ask you for changes "
                 "here. Thank you!\n\nAhora se abre un pull request con él. El responsable lo revisará a mano y puede pedirte "
                 "cambios aquí. ¡Gracias!\n")
    else:
        L.append("## ❌ Your tree needs some changes · Tu árbol necesita algunos cambios\n")
        L.append("Fix the file (your AI assistant can help: paste these errors to it), then **edit this issue** and replace the "
                 "attachment: it is checked again.\n\nCorrige el archivo (tu asistente de IA te puede ayudar: pégale estos "
                 "errores) y después **edita este issue** cambiando el adjunto: se vuelve a comprobar.\n")
    if result["id"]:
        L.append(f"- **Id:** `{result['id']}`" + (f" — {result['title']}" if result["title"] else ""))
    if stats:
        L.append(f"- **Nodes · Nodos:** {stats['nodes']} · **depth · profundidad:** {stats['depth']}")
        L.append("- **With article · Con artículo:** " + " · ".join(f"{l} {stats['linked'][l]}" for l in wt.LANGS))
    if license_id:
        L.append(f"- **Licence · Licencia:** {wt.LICENSES[license_id][0]}")
    L.append(f"- **Cover · Portada:** {'yes · sí' if cover is not None else 'no (drawn with the emoji · se dibuja con el emoji)'}\n")
    if rep.errors:
        L.append(f"### Errors · Errores ({len(rep.errors)})\n")
        L += [f"- {e}" for e in rep.errors[:150]]
        if len(rep.errors) > 150:
            L.append(f"- … and {len(rep.errors) - 150} more · y {len(rep.errors) - 150} más")
        L.append("")
    if rep.warnings:
        L.append(f"<details><summary>Notes · Notas ({len(rep.warnings)})</summary>\n")
        L += [f"- {w}" for w in rep.warnings[:150]]
        L.append("\n</details>\n")
    L.append("<sub>[Format](https://github.com/Aruvaro-Chulvi/WikiTrees/blob/main/community-kit/FORMAT.md) · "
             "[Web checker · Comprobador web](https://aruvaro-chulvi.github.io/WikiTrees/community-kit/check.html)</sub>")
    (out / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # unexpected: let the workflow fail visibly
        print(f"::error::{e}")
        raise
