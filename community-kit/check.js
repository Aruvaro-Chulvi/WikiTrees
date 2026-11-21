/* WikiTrees — web checker for community trees.
   The same rules as wikitrees_check.py (keep them in sync). Everything runs in the browser:
   the file is never uploaded anywhere; the link check asks <lang>.wikipedia.org directly.
   MIT License — © 2026 Álvaro C. Chulvi (Offlined, https://www.offlined.org). */
"use strict";

const FORMAT = "wikitrees-community/1";
const LANGS = ["en", "es", "fr", "pt", "it", "de", "ru", "zh", "hi", "ar"];
const LANG_NAMES = { en: "English", es: "Español", fr: "Français", pt: "Português", it: "Italiano", de: "Deutsch",
                     ru: "Русский", zh: "中文", hi: "हिन्दी", ar: "العربية" };
const CATEGORIES = ["natlife", "human", "geo", "education", "history", "art", "food_nutrition", "misc"];
const OFFICIAL = new Set(["animalia", "plantae", "fungi", "protista", "astronomy_bodies", "dinosaurs", "human_body_parts",
  "viruses", "diseases_icd", "medicines_atc", "continents_countries_cities", "world_languages", "ethnic_groups",
  "branches_of_knowledge", "periodic_elements", "mathematics", "physics", "chemistry", "art_movements_artists",
  "world_museums", "world_cuisines", "nutrients", "aromatic_plants", "minerals", "mythologies", "empires"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024, MAX_NODES = 5000, MAX_DEPTH = 12, MAX_CHILDREN = 400, MIN_LINKED = 20;
const MAX_TITLE = 150, MAX_DESC = 300, MAX_AUTHOR = 60;
const SLUG_RX = /^[a-z0-9_]{2,40}$/;
const BAD_CHARS = /[<>{}\[\]|\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/;
const BAD_WIKI = /[#<>\[\]{}|\u0000-\u001f\u007f]/;
const NODE_KEYS = new Set(["id", "i18n", "noWiki", "children"]);
const I18N_NODE_KEYS = new Set(["title", "wiki", "url"]);

const UI = {
  en: { title: "Community tree checker", intro: "Check the tree file you made (with an AI assistant, for example) before sending it. The file stays in your browser.",
        drop: "Drop your .json file here or click to choose it", checking: "Checking…", ok: "The tree passes the checks.",
        bad: "{n} error(s): fix them and check again.", online: "Check the links against Wikipedia", onlineRun: "Checking the links: {l} {i}/{n}…",
        onlineOk: "All the links are real articles.", preview: "Preview in the viewer", send: "Send it", notes: "Notes",
        stats: "{n} nodes · {d} levels", linked: "With article", howto: "How to make a tree", format: "Format", prompt: "Prompt for your AI",
        example: "Example", tooBig: "The preview is too big for your browser's storage; the check is still valid.",
        sendFirst: "Check the links first: the bot will do it anyway, and it is quicker to fix things now." },
  es: { title: "Comprobador de árboles de la comunidad", intro: "Comprueba el archivo del árbol que has hecho (con un asistente de IA, por ejemplo) antes de enviarlo. El archivo no sale de tu navegador.",
        drop: "Suelta aquí tu archivo .json o haz clic para elegirlo", checking: "Comprobando…", ok: "El árbol pasa las comprobaciones.",
        bad: "{n} error(es): corrígelos y vuelve a comprobarlo.", online: "Comprobar los enlaces con Wikipedia", onlineRun: "Comprobando los enlaces: {l} {i}/{n}…",
        onlineOk: "Todos los enlaces son artículos reales.", preview: "Vista previa en el visor", send: "Enviarlo", notes: "Notas",
        stats: "{n} nodos · {d} niveles", linked: "Con artículo", howto: "Cómo hacer un árbol", format: "Formato", prompt: "Prompt para tu IA",
        example: "Ejemplo", tooBig: "La vista previa no cabe en el almacenamiento de tu navegador; la comprobación sigue siendo válida.",
        sendFirst: "Comprueba antes los enlaces: el bot lo hará igualmente, y es más rápido corregirlo ahora." },
};
const L = UI[(navigator.language || "en").slice(0, 2)] || UI.en;
const lang = (navigator.language || "en").slice(0, 2) === "es" ? "es" : "en";
const tr = (k, o = {}) => String(L[k] || UI.en[k] || "").replace(/\{(\w+)\}/g, (_, x) => o[x] ?? "");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clean = s => typeof s === "string" ? s.normalize("NFC").trim() : "";
const isObj = x => x && typeof x === "object" && !Array.isArray(x);

function newReport(){
  return { errors: [], warnings: [],
    err(m){ if (this.errors.length < 400) this.errors.push(m); else if (this.errors.length === 400) this.errors.push("… (too many errors, the rest are not shown)"); },
    warn(m){ if (this.warnings.length < 200) this.warnings.push(m); } };
}

function checkMeta(meta, rep){
  if (!isObj(meta)) { rep.err("«meta» is missing or is not an object."); return; }
  const extra = Object.keys(meta).filter(k => !["slug", "author", "category", "emoji", "license", "i18n"].includes(k));
  if (extra.length) rep.err(`«meta» has unknown keys: ${extra.sort().join(", ")}.`);
  if ("license" in meta && !["CC-BY-4.0", "CC0-1.0"].includes(meta.license)) rep.err("«meta.license» must be one of: CC-BY-4.0, CC0-1.0 (or be left out: you choose it in the form).");
  if (typeof meta.slug !== "string" || !SLUG_RX.test(meta.slug)) rep.err("«meta.slug» must be 2–40 characters: lowercase letters a–z, digits and «_» (e.g. «volcanoes»).");
  else if (OFFICIAL.has(meta.slug)) rep.err(`«meta.slug» «${meta.slug}» is the name of an official WikiTrees tree: choose another one.`);
  const author = clean(meta.author);
  if (!author || author.length > MAX_AUTHOR || BAD_CHARS.test(author)) rep.err(`«meta.author» (the name we credit) is required, up to ${MAX_AUTHOR} characters, plain text.`);
  if (!CATEGORIES.includes(meta.category)) rep.err(`«meta.category» must be one of: ${CATEGORIES.join(", ")}.`);
  const emoji = meta.emoji || "";
  if (emoji && (typeof emoji !== "string" || emoji.length > 8 || /[\p{L}\p{N}]/u.test(emoji))) rep.err("«meta.emoji» must be a single emoji (or be left out).");
  if (!isObj(meta.i18n)) { rep.err("«meta.i18n» is missing: the title and description in the 10 languages."); return; }
  for (const l of LANGS){
    const x = meta.i18n[l];
    if (!isObj(x)) { rep.err(`«meta.i18n.${l}» is missing (${LANG_NAMES[l]}).`); continue; }
    const ex = Object.keys(x).filter(k => k !== "title" && k !== "description");
    if (ex.length) rep.err(`«meta.i18n.${l}» has unknown keys: ${ex.sort().join(", ")}.`);
    const ti = clean(x.title), de = clean(x.description);
    if (!ti || ti.length > 80 || BAD_CHARS.test(ti)) rep.err(`«meta.i18n.${l}.title» is required (plain text, up to 80 characters).`);
    if (!de || de.length > MAX_DESC || BAD_CHARS.test(de)) rep.err(`«meta.i18n.${l}.description» is required (plain text, up to ${MAX_DESC} characters).`);
  }
  const ex = Object.keys(meta.i18n).filter(k => !LANGS.includes(k));
  if (ex.length) rep.err(`«meta.i18n» has languages WikiTrees does not use: ${ex.sort().join(", ")}.`);
}

function checkTree(root, rep){
  const st = { nodes: 0, depth: 0, linked: {}, wikis: {} };
  for (const l of LANGS){ st.linked[l] = 0; st.wikis[l] = new Set(); }
  if (!isObj(root)) { rep.err("«tree» is missing or is not an object (the root node)."); return st; }
  const label = p => p.length ? p.join(" › ") : "(root)";
  (function walk(n, depth, path){
    st.nodes++; st.depth = Math.max(st.depth, depth);
    let here = label(path);
    if (st.nodes === MAX_NODES + 1) rep.err(`The tree has more than ${MAX_NODES} nodes. Split it into smaller trees.`);
    if (!isObj(n)) { rep.err(`${here}: a node must be an object.`); return; }
    const extra = Object.keys(n).filter(k => !NODE_KEYS.has(k));
    if (extra.length) rep.err(`${here}: unknown keys ${extra.sort().join(", ")} (allowed: id, i18n, noWiki, children).`);
    if ("id" in n && (typeof n.id !== "string" || n.id.length > 80 || BAD_CHARS.test(n.id))) rep.err(`${here}: «id» must be a short text (or be left out).`);
    let nowiki = n.noWiki ?? [];
    if (!Array.isArray(nowiki) || nowiki.some(x => !LANGS.includes(x))) { rep.err(`${here}: «noWiki» must be a list of language codes (${LANGS.join(", ")}).`); nowiki = []; }
    const i18n = isObj(n.i18n) ? n.i18n : (rep.err(`${here}: «i18n» is missing.`), {});
    const exL = Object.keys(i18n).filter(k => !LANGS.includes(k));
    if (exL.length) rep.err(`${here}: languages WikiTrees does not use: ${exL.sort().join(", ")}.`);
    const me = [...path, clean(isObj(i18n.en) ? i18n.en.title : "") || "?"];
    here = label(me);
    for (const l of LANGS){
      const x = i18n[l];
      if (!isObj(x)) { rep.err(`${here}: the ${LANG_NAMES[l]} (${l}) title is missing. All 10 languages are required.`); continue; }
      const ex = Object.keys(x).filter(k => !I18N_NODE_KEYS.has(k));
      if (ex.length) rep.err(`${here} [${l}]: unknown keys ${ex.sort().join(", ")} (allowed: title, wiki).`);
      const ti = clean(x.title);
      if (!ti) rep.err(`${here} [${l}]: «title» is empty.`);
      else if (ti.length > MAX_TITLE || BAD_CHARS.test(ti)) rep.err(`${here} [${l}]: «title» must be plain text up to ${MAX_TITLE} characters.`);
      const wiki = clean(x.wiki);
      if (nowiki.includes(l)) { if (wiki) rep.err(`${here} [${l}]: it has a «wiki» article but «${l}» is also in «noWiki». Choose one.`); }
      else if (!wiki) rep.err(`${here} [${l}]: «wiki» (the exact Wikipedia article) is missing. If there is no article in that language, add «${l}» to «noWiki».`);
      else if (wiki.length > 255 || BAD_WIKI.test(wiki) || /^(https?:|\/)/.test(wiki)) rep.err(`${here} [${l}]: «wiki» must be the article title only (no URL, no «#section»): «${wiki}».`);
      else { st.linked[l]++; st.wikis[l].add(wiki); }
    }
    let kids = n.children ?? [];
    if (!Array.isArray(kids)) { rep.err(`${here}: «children» must be a list.`); kids = []; }
    if ("children" in n && Array.isArray(n.children) && !n.children.length) rep.warn(`${here}: «children» is empty; leave it out on leaves.`);
    if (kids.length > MAX_CHILDREN) rep.err(`${here}: ${kids.length} children; the maximum is ${MAX_CHILDREN}. Group them in sub-branches.`);
    if (depth + 1 > MAX_DEPTH && kids.length) { rep.err(`${here}: the tree is deeper than ${MAX_DEPTH} levels.`); kids = []; }
    const seen = new Map();
    for (const k of kids){
      if (isObj(k) && isObj(k.i18n)) for (const l of LANGS){
        const x = k.i18n[l];
        if (isObj(x) && clean(x.wiki)){
          const key = l + "|" + clean(x.wiki).replace(/_/g, " ").toLowerCase();
          seen.set(key, (seen.get(key) || 0) + 1);
          if (seen.get(key) === 2) rep.err(`${here}: two children link to the same ${l} article «${clean(x.wiki)}».`);
        }
      }
      walk(k, depth + 1, me);
    }
  })(root, 0, []);
  for (const l of LANGS) if (st.linked[l] < MIN_LINKED) rep.err(`Only ${st.linked[l]} nodes have a ${LANG_NAMES[l]} article; at least ${MIN_LINKED} are needed.`);
  if (st.nodes > 1 && !Array.isArray(root.children)) rep.err("The root has no children.");
  return st;
}

function parse(text, rep){
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, "")); }
  catch (e) { rep.err(`It is not valid JSON: ${e.message}`); return null; }
  if (!isObj(data)) { rep.err("The file must contain one JSON object."); return null; }
  if (data.format !== FORMAT) rep.err(`«format» must be "${FORMAT}".`);
  const extra = Object.keys(data).filter(k => !["format", "meta", "tree"].includes(k));
  if (extra.length) rep.err(`Unknown keys at the top: ${extra.sort().join(", ")} (allowed: format, meta, tree).`);
  return data;
}

async function checkOnline(st, rep, progress){
  for (const l of LANGS){
    const titles = [...st.wikis[l]].sort();
    for (let i = 0; i < titles.length; i += 50){
      const chunk = titles.slice(i, i + 50);
      progress(l, i, titles.length);
      const body = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", origin: "*",
                                         prop: "pageprops", ppprop: "disambiguation", titles: chunk.join("|") });
      let j;
      try {
        const r = await fetch(`https://${l}.wikipedia.org/w/api.php`, { method: "POST", body });
        j = await r.json();
      } catch (e) { rep.err(`Could not reach ${l}.wikipedia.org to check the links. Try again later.`); break; }
      const q = j.query || {};
      const norm = Object.fromEntries((q.normalized || []).map(x => [x.from, x.to]));
      const redir = Object.fromEntries((q.redirects || []).map(x => [x.from, x.to]));
      const pages = Object.fromEntries((q.pages || []).map(p => [p.title, p]));
      for (const t of chunk){
        const n = norm[t] || t, fin = redir[n] || n, p = pages[fin];
        if (!p || p.missing || p.invalid) rep.err(`[${l}] «${t}»: there is no such article on ${l}.wikipedia.org. Fix the title or put «${l}» in that node's «noWiki».`);
        else if (p.pageprops && "disambiguation" in p.pageprops) rep.err(`[${l}] «${t}» is a disambiguation page, not an article. Link the exact article.`);
        else if (fin !== n) rep.warn(`[${l}] «${t}» redirects to «${fin}».`);
      }
    }
  }
}

// Formato «online» del visor (con url), para la vista previa
function toOnline(n){
  const nw = Array.isArray(n.noWiki) ? n.noWiki : [];
  const out = { i18n: {} };
  for (const l of LANGS){
    const x = (n.i18n || {})[l] || {}, w = clean(x.wiki);
    out.i18n[l] = { title: clean(x.title) };
    if (w && !nw.includes(l)) { out.i18n[l].wiki = w; out.i18n[l].url = `https://${l}.wikipedia.org/wiki/${encodeURIComponent(w.replace(/ /g, "_"))}`; }
  }
  if (nw.length) out.noWiki = nw;
  if (Array.isArray(n.children) && n.children.length) out.children = n.children.map(toOnline);
  return out;
}

/* ── Página ── */
const $ = id => document.getElementById(id);
let current = null;   // { data, st, rep }

function render(){
  const box = $("ckResult");
  if (!current) { box.innerHTML = ""; return; }
  const { data, st, rep, online } = current;
  const ok = !rep.errors.length;
  let h = `<div class="ck-status ${ok ? "is-ok" : "is-bad"}"><svg class="lucide-icon" aria-hidden="true"><use href="#lucide-${ok ? "circle-check" : "circle-x"}"></use></svg>
    <b>${esc(ok ? (online ? tr("onlineOk") + " " : "") + tr("ok") : tr("bad", { n: rep.errors.length }))}</b></div>`;
  if (st && st.nodes) {
    const m = data && isObj(data.meta) && isObj(data.meta.i18n) && isObj(data.meta.i18n[lang]) ? data.meta.i18n[lang] : {};
    h += `<div class="ck-card">${m.title ? `<h3>${esc(data.meta.emoji || "")} ${esc(m.title)}</h3>` : ""}${m.description ? `<p>${esc(m.description)}</p>` : ""}
      <p class="ck-meta">${esc(tr("stats", { n: st.nodes, d: st.depth }))}</p>
      <p class="ck-meta">${esc(tr("linked"))}: ${LANGS.map(l => `${l} ${st.linked[l]}`).join(" · ")}</p></div>`;
  }
  if (rep.errors.length) h += `<ul class="ck-list ck-errors">${rep.errors.map(e => `<li>${esc(e)}</li>`).join("")}</ul>`;
  if (rep.warnings.length) h += `<details class="ck-notes"><summary>${esc(tr("notes"))} (${rep.warnings.length})</summary><ul class="ck-list">${rep.warnings.map(e => `<li>${esc(e)}</li>`).join("")}</ul></details>`;
  box.innerHTML = h;
  $("ckOnline").disabled = !(ok && !online);
  $("ckPreview").disabled = !(st && st.nodes && isObj(data.tree) && !rep.errors.some(e => /is missing or is not|not valid JSON/.test(e)));
  $("ckSend").classList.toggle("is-ready", ok && !!online);
  $("ckSend").title = ok && online ? "" : tr("sendFirst");
}

async function loadFile(file){
  const rep = newReport();
  if (file.size > MAX_FILE_BYTES) { rep.err(`The file is larger than ${MAX_FILE_BYTES / 1048576} MB.`); current = { rep }; render(); return; }
  $("ckFileName").textContent = file.name;
  const data = parse(await file.text(), rep);
  let st = null;
  if (data) { checkMeta(data.meta, rep); st = checkTree(data.tree, rep); }
  current = { data, st, rep, online: false };
  render();
}

async function runOnline(){
  if (!current || current.rep.errors.length) return;
  $("ckOnline").disabled = true;
  const prog = $("ckProgress");
  await checkOnline(current.st, current.rep, (l, i, n) => { prog.textContent = tr("onlineRun", { l, i, n }); });
  prog.textContent = "";
  current.online = true;
  render();
}

function openPreview(){
  if (!current || !current.data) return;
  const d = current.data;
  const meta = isObj(d.meta) ? { i18n: d.meta.i18n || {}, emoji: d.meta.emoji || "" } : {};
  try { localStorage.setItem("wikitrees:preview", JSON.stringify({ meta, tree: toOnline(d.tree) })); }
  catch { alert(tr("tooBig")); return; }
  window.open(`../index.html#${lang}/preview`, "_blank", "noopener");
}

(function boot(){
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-t]")) el.textContent = tr(el.dataset.t);
  document.title = tr("title") + " · WikiTrees";
  const drop = $("ckDrop"), inp = $("ckInput");
  drop.addEventListener("click", () => inp.click());
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } });
  inp.addEventListener("change", () => { if (inp.files[0]) loadFile(inp.files[0]); inp.value = ""; });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("is-over"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  $("ckOnline").addEventListener("click", runOnline);
  $("ckPreview").addEventListener("click", openPreview);
  const repo = "https://github.com/Aruvaro-Chulvi/OfflinedWikiTrees";
  $("ckSend").href = `${repo}/issues/new?template=new-tree.yml`;
  $("ckHowto").href = `${repo}/blob/main/CONTRIBUTING${lang === "es" ? ".es" : ""}.md`;
  $("ckFormat").href = `${repo}/blob/main/community-kit/FORMAT.md`;
  $("ckPrompt").href = `${repo}/blob/main/community-kit/PROMPT.md`;
  $("ckExample").href = "example/vitamins.json";
})();
