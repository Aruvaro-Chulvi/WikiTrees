/* WikiTrees viewer — © 2026 Álvaro C. Chulvi, a project of Offlined (https://www.offlined.org).
   Licensed under PolyForm Noncommercial 1.0.0 (see LICENSE-CODE.md).
   Standalone version of the WikiTrees section of Offlined: the trees are read from
   trees/online/ and every node links to its article on <lang>.wikipedia.org. */
"use strict";

const LANGS = ["en", "es", "fr", "pt", "it", "de", "ru", "zh", "hi", "ar"];
const DATA_DIR = "trees/online/";
const IMG_DIR = "trees/images/";
const UA = "WikiTrees viewer (https://github.com/Aruvaro-Chulvi/WikiTrees)";

const S = { lang: "en", visited: {}, favs: [] };

function t(k){ const L = I18N[S.lang] || {}; return L[k] ?? I18N.en[k] ?? ""; }
function _html(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fill(s, o){ return String(s || "").replace(/\{(\w+)\}/g, (_, k) => o[k] ?? ""); }

// Preferencias en el navegador (pueden no estar disponibles: modo privado, etc.)
const store = {
  get(k, d){ try { const v = localStorage.getItem("wikitrees:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v){ try { localStorage.setItem("wikitrees:" + k, JSON.stringify(v)); } catch {} },
};
// Progreso por árbol e idioma (las rutas usan los nombres de cada idioma)
const tkey = (kind) => `${kind}:${S.lang}:${WTD.treeId}`;

/* ============================================================
   Datos
   ============================================================ */
let _catalog = null;
const _trees = new Map();
async function fetchCatalog(){
  if (!_catalog){
    const r = await fetch(DATA_DIR + "index.json");
    if (!r.ok) throw new Error("catalog");
    _catalog = await r.json();
  }
  return _catalog;
}
async function fetchTree(id){
  if (!_trees.has(id)) _trees.set(id, fetch(DATA_DIR + encodeURIComponent(id) + ".json")
    .then(r => { if (!r.ok) throw new Error("tree"); return r.json(); })
    .catch(e => { _trees.delete(id); throw e; }));
  return _trees.get(id);
}

// Sube título/artículo del idioma al nivel del nodo. Las hojas sin artículo en ese
// idioma no se muestran; las ramas sin artículo quedan como etiqueta del diagrama.
function localizeNode(node, lang){
  const own = (node.i18n && node.i18n[lang]) || null;
  const L = own || (node.i18n && node.i18n.en) || {};
  const noWiki = (Array.isArray(node.noWiki) && node.noWiki.includes(lang)) || !own || !own.url;
  return {
    title: (L.title || "").trim(),
    wiki: noWiki ? "" : (own.wiki || "").trim(),
    url: noWiki ? "" : own.url,
    noWiki,
    children: (node.children || []).map(ch => localizeNode(ch, lang))
      .filter(ch => !(ch.noWiki && !(ch.children && ch.children.length)) && ch.title),
  };
}

// Resumen e imagen del artículo (API REST de Wikipedia), una vez por artículo e idioma
const _sumCache = new Map();
function wikiSummary(node){
  if (!node || !node.url || !node.wiki) return Promise.resolve(null);
  const lang = S.lang, key = lang + "|" + node.wiki;
  if (!_sumCache.has(key)) _sumCache.set(key, (async () => {
    const u = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(node.wiki.replace(/ /g, "_"))}?redirect=true`;
    const r = await fetch(u, { headers: { "Api-User-Agent": UA } });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.type === "disambiguation") return { disambig: true };
    return { img: (j.thumbnail && j.thumbnail.source) || "", extract: j.extract || "" };
  })().catch(() => { _sumCache.delete(key); return null; }));
  return _sumCache.get(key);
}

/* ============================================================
   📊 Diagrama WikiTrees — Sankey/ribbon de taxonomías.
   Renderer SVG propio (sin dependencias): diagrama jerárquico tipo "ribbon"
   con grosor ∝ nº de hojas descendientes.
   ============================================================ */
const WTD = {
  items: [], categoriesById: {}, selectedCat: null,
  treeId: null, treeTitle: "", root: null,
  PALETTE: ["#ff2a60","#ff8d48","#ffd700","#3fbf7f","#2f9bff","#8c6cf0","#df74cb","#16c5c5","#c98a3c","#9aa0a6"],
  _visible: [], _bound: false,
};

const WTD_OPEN_DEPTH = 2;
const WTD_KY = 18, WTD_SIB_GAP = 16, WTD_BAR_W = 12, WTD_PAD = 36;
const WTD_LABEL_ROOM = 190;   // px de pantalla para las etiquetas de la última columna
const WTD_LABEL_MIN_H = 15;   // una etiqueta solo se pinta si su barra mide al menos esto en pantalla
const WTD_PANEL_W = 380;      // ancho de la ficha del nodo
const WTD_MM_MAX = 1500;      // con más nodos visibles, el minimapa solo dibuja los primeros niveles
const WTD_MM_DEPTH = 3;
const WTD_MIN_S = 0.0005;     // escala mínima absoluta

/* ── Interfaz general: idioma, tema, textos ── */
function applyStaticTexts(){
  document.documentElement.lang = S.lang;
  document.documentElement.dir = S.lang === "ar" ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.getAttribute("data-i18n-title")); el.setAttribute("aria-label", el.title); });
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set("wtdCatalogTitle", t("wtdCatalogTitle"));
  set("wtdTagline", t("tagline"));
  set("wtdBackLbl", t("wtdBackCatalog"));
  set("wtdContinueLbl", t("wtdContinue"));
  set("licenseLine", t("licenseLine"));
  set("brandBy", fill(t("byLine"), { author: "Álvaro C. Chulvi", project: "Offlined" }));
  document.getElementById("wtdFilter")?.setAttribute("placeholder", t("wikiTreesFilter"));
  document.getElementById("wtdSearch")?.setAttribute("placeholder", t("wtdSearchPh"));
  const th = document.getElementById("themeBtn"); if (th){ th.title = t("theme"); th.setAttribute("aria-label", t("theme")); }
  const ls = document.getElementById("langSelect"); if (ls){ ls.value = S.lang; ls.setAttribute("aria-label", t("language")); }
}

function initChrome(){
  const ls = document.getElementById("langSelect");
  ls.innerHTML = LANGS.map(l => `<option value="${l}">${_html(I18N[l].langName)}</option>`).join("");
  ls.addEventListener("change", () => setLang(ls.value));
  const savedTheme = store.get("theme", "");
  if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);
  document.getElementById("themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme")
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    store.set("theme", next);
  });
  document.getElementById("brandLink").addEventListener("click", (e) => { e.preventDefault(); goCatalog(true); });
}

async function setLang(lang){
  if (!LANGS.includes(lang) || lang === S.lang) return;
  S.lang = lang; store.set("lang", lang);
  applyStaticTexts();
  if (WTD.treeId && !document.getElementById("wtdDiagram").classList.contains("hidden")){
    history.replaceState(null, "", `#${S.lang}/${WTD.treeId}`);
    await wtdOpenTree(WTD.treeId, false);
  } else {
    history.replaceState(null, "", `#${S.lang}`);
    await wtdOpen();
  }
}

/* ── Catálogo ── */
async function wtdOpen(){
  document.getElementById("wtdCatalog")?.classList.remove("hidden");
  document.getElementById("wtdDiagram")?.classList.add("hidden");
  let data = {};
  try { data = await fetchCatalog(); } catch { data = {}; }
  WTD.items = Array.isArray(data.items) ? data.items : [];
  const cats = Array.isArray(data.categories) ? data.categories : [];
  WTD.categoriesById = {};
  for (const c of cats){
    const L = (c.i18n && (c.i18n[S.lang] || c.i18n.en)) || {};
    WTD.categoriesById[c.id] = { id: c.id, emoji: c.emoji || "", label: L.label || c.id };
  }
  wtdRenderChips(cats);
  wtdRenderCatalog();
  document.title = "WikiTrees";
  if (!WTD._bound) wtdBind();
}

function wtdBind(){
  WTD._bound = true;
  const inp = document.getElementById("wtdFilter");
  if (inp) inp.oninput = () => wtdRenderCatalog();
  document.getElementById("wtdBack")?.addEventListener("click", () => goCatalog(true));
  document.getElementById("wtdWikiClose")?.addEventListener("click", () => wtdCloseWikiPopup());
  document.getElementById("wtdWikiPopup")?.addEventListener("click", (e) => { if (e.target.id === "wtdWikiPopup") wtdCloseWikiPopup(); });
  document.getElementById("wtdContinue")?.addEventListener("click", () => wtdContinue());
  const _mb = (kind) => (e) => { e.stopPropagation(); wtdOpenMenu(kind); };
  document.getElementById("wtdFavBtn")?.addEventListener("click", _mb("fav"));
  document.getElementById("wtdRecBtn")?.addEventListener("click", _mb("rec"));
  document.getElementById("wtdAchBtn")?.addEventListener("click", _mb("ach"));
  document.getElementById("wtdCollapseBtn")?.addEventListener("click", () => { wtdHidePanel(); wtdUnfocus(); });
  document.getElementById("wtdExpandBtn")?.addEventListener("click", () => { wtdHidePanel(); wtdExpandAll(); });
  document.addEventListener("click", (e) => {   // cierra el menú al clicar fuera
    const m = document.getElementById("wtdFavMenu");
    if (m && !m.classList.contains("hidden") && !e.target.closest("#wtdFavMenu") && !e.target.closest(".wtd-diag-actions")) m.classList.add("hidden");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (wtdCloseWikiPopup()) return;
    const m = document.getElementById("wtdFavMenu");
    if (m && !m.classList.contains("hidden")) { m.classList.add("hidden"); return; }
    if (!document.getElementById("wtdConfirm").classList.contains("hidden")) { document.getElementById("wtdConfirm").classList.add("hidden"); return; }
    if (!document.getElementById("wtdPanel").classList.contains("hidden")) wtdHidePanel();
  });
  const _zc = (f) => () => { const c = document.getElementById("wtdCanvas"); if (c) wtdZoomBy(f, (c.clientWidth || 0) / 2, (c.clientHeight || 0) / 2); };
  document.getElementById("wtdZoomIn")?.addEventListener("click", _zc(1.2));
  document.getElementById("wtdZoomOut")?.addEventListener("click", _zc(1 / 1.2));
  document.getElementById("wtdZoomReset")?.addEventListener("click", () => { WTD._zoom = null; wtdRenderDiagram(); });
  // Buscador: resalta y encuadra las coincidencias (con retardo: en árboles grandes
  // aplicar la búsqueda en cada tecla se nota)
  let _timer = null;
  document.getElementById("wtdSearch")?.addEventListener("input", (e) => {
    const val = e.target.value;
    clearTimeout(_timer);
    _timer = setTimeout(() => wtdApplySearch(val), 220);
  });
  window.addEventListener("resize", () => {
    const dg = document.getElementById("wtdDiagram");
    if (dg && !dg.classList.contains("hidden")) { WTD._zoom = null; wtdRenderDiagram(); }
  });
}

function wtdRenderChips(cats){
  const box = document.getElementById("wtdCatChips");
  if (!box) return;
  const counts = {};
  for (const it of WTD.items) counts[it.category] = (counts[it.category] || 0) + 1;
  const chip = (id, label, emoji, count, active) =>
    `<button class="filter-chip${active ? " active" : ""}" data-cat="${id || ""}">${emoji ? emoji + " " : ""}${_html(label)}<span class="count">${count}</span></button>`;
  let html = chip("", t("all"), "✨", WTD.items.length, !WTD.selectedCat);
  for (const c of cats){
    const n = counts[c.id] || 0; if (!n) continue;
    const L = WTD.categoriesById[c.id];
    html += chip(c.id, L.label, L.emoji, n, WTD.selectedCat === c.id);
  }
  box.innerHTML = html;
  box.querySelectorAll(".filter-chip").forEach(b => {
    b.onclick = () => {
      WTD.selectedCat = b.getAttribute("data-cat") || null;
      box.querySelectorAll(".filter-chip").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      wtdRenderCatalog();
    };
  });
}

function wtdRenderCatalog(){
  const box = document.getElementById("wtdCatalogList");
  if (!box) return;
  const q = (document.getElementById("wtdFilter")?.value || "").trim().toLowerCase();
  let list = WTD.items.slice();
  if (WTD.selectedCat) list = list.filter(it => it.category === WTD.selectedCat);
  if (q) list = list.filter(it => {
    const L = (it.i18n && (it.i18n[S.lang] || it.i18n.en)) || {};
    return `${L.title || it.id} ${L.description || ""}`.toLowerCase().includes(q);
  });
  const fmt = n => Number(n || 0).toLocaleString(S.lang);
  box.innerHTML = list.map(it => {
    const L = (it.i18n && (it.i18n[S.lang] || it.i18n.en)) || {};
    const title = L.title || it.id, desc = L.description || "";
    const cat = WTD.categoriesById[it.category || ""] || null;
    const nodes = it.nodes && it.nodes[S.lang];
    return `<div class="catalog-card" data-id="${_html(it.id)}" role="button" tabindex="0">
      <img class="taxo-card-img" src="${IMG_DIR}${encodeURIComponent(it.id)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <h4>${_html(title)}</h4><p>${_html(desc)}</p>
      <div class="row"><span class="cat-tag">${cat ? `${cat.emoji} ${_html(cat.label)}` : ""}</span>
        ${nodes ? `<span class="card-meta">${_html(fill(t("nodes"), { n: fmt(nodes) }))}</span>` : ""}</div>
      <button class="ui-btn ui-btn--secondary ui-btn--sm wtd-open-btn">${_html(t("wtdOpen"))}</button>
    </div>`;
  }).join("");
  box.querySelectorAll(".catalog-card").forEach(card => {
    const open = () => wtdOpenTree(card.getAttribute("data-id"), true);
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

function goCatalog(push){
  wtdCloseWikiPopup(); wtdHidePanel(); wtdTipHide();
  WTD.treeId = null;
  if (push) history.pushState(null, "", `#${S.lang}`);
  wtdOpen();
}

/* ── Árbol plegable: el grosor es ∝ nº de hojas (una rama plegada ocupa lo mismo
   que desplegada), así que abrir una no descoloca las demás. ── */

// Anota TODO el árbol: padre, ruta, profundidad, color de su rama y rama de primer nivel
function _wtdPrepTree(root){
  const all = [];
  (function walk(n, depth, parent, color, branch){
    n._parent = parent; n._depth = depth; n._color = color; n._branch = branch;
    n._path = parent ? `${parent._path} › ${n.title || ""}` : (n.title || "");
    n._open = !!(n._kids && n._kids.length);
    n._ai = all.length; all.push(n);
    (n._kids || []).forEach((k, i) => walk(k, depth + 1, n,
      depth === 0 ? WTD.PALETTE[i % WTD.PALETTE.length] : color, depth === 0 ? i : branch));
  })(root, 0, null, WTD.PALETTE[0], -1);   // todo desplegado: se ve la forma del árbol entero
  WTD._all = all;
}

function wtdComputeLeaves(node){
  const kids = (node.children || []).filter(c => c && (c.title || "").trim());
  node._kids = kids;
  if (!kids.length){ node._leaves = 1; return 1; }
  let s = 0; for (const k of kids) s += wtdComputeLeaves(k);
  node._leaves = s; return s;
}

async function wtdOpenTree(treeId, push){
  if (!treeId) return;
  let data;
  try { data = await fetchTree(treeId); } catch { alert(t("loadError")); return; }
  try { await fetchCatalog(); } catch {}
  const item = (_catalog?.items || []).find(it => it.id === treeId);
  const IL = item ? ((item.i18n && (item.i18n[S.lang] || item.i18n.en)) || {}) : {};
  const root = localizeNode(data, S.lang);
  wtdComputeLeaves(root);
  _wtdPrepTree(root);
  WTD._totalNodes = WTD._all.length;
  WTD.treeId = treeId; WTD.treeTitle = IL.title || root.title || treeId;
  WTD.root = root; WTD._zoom = null; WTD._lineageVi = null; WTD._sel = null; WTD._searchQ = "";
  S.visited = store.get(tkey("visited"), {}) || {};
  S.favs = store.get(tkey("favs"), []) || [];
  _wtdMigrateProgress();
  if (push) history.pushState(null, "", `#${S.lang}/${treeId}`);
  document.title = `${WTD.treeTitle} · WikiTrees`;
  if (!WTD._bound) wtdBind();
  const _se = document.getElementById("wtdSearch"); if (_se) _se.value = "";
  document.getElementById("wtdCatalog")?.classList.add("hidden");
  document.getElementById("wtdDiagram")?.classList.remove("hidden");
  wtdHidePanel();
  wtdUpdateDiagTitle();
  wtdRenderDiagram();
}

// anchor: nodo que debe quedarse en el mismo sitio de la pantalla (al plegar/desplegar)
function wtdRenderDiagram(anchor){
  const canvas = document.getElementById("wtdCanvas");
  if (!canvas || !WTD.root) return;
  const vw = canvas.clientWidth || 1000, vh = canvas.clientHeight || 600;
  const z0 = WTD._zoom;
  const old = (anchor && z0 && anchor._y1 != null)
    ? { x: anchor._x * z0.s + z0.tx, y: ((anchor._y0 + anchor._y1) / 2) * z0.s + z0.ty } : null;

  // Layout (tidy-tree, solo ramas abiertas): cada padre centrado sobre sus hijos
  let maxDepth = 0, yCursor = WTD_PAD;
  WTD._visible = [];
  (function layout(node){
    node._h = node._leaves * WTD_KY;
    if (node._depth > maxDepth) maxDepth = node._depth;
    const kids = node._open ? (node._kids || []) : [];
    if (!kids.length){
      node._y0 = yCursor; node._y1 = yCursor + node._h; yCursor += node._h;
    } else {
      kids.forEach((k, i) => { if (i > 0) yCursor += WTD_SIB_GAP; layout(k); });
      const c = (kids[0]._y0 + kids[kids.length - 1]._y1) / 2;
      node._y0 = c - node._h / 2; node._y1 = c + node._h / 2;
    }
    WTD._visible.push(node);
  })(WTD.root);
  WTD._visible.forEach((n, i) => { n._vi = i; });
  const Hsvg = yCursor + WTD_PAD;
  const sFit = Math.min(3, Math.max(WTD_MIN_S, (vh - WTD_PAD * 2) / Hsvg));
  // Columnas: a la escala que encaja el alto, lo abierto ocupa el ancho (con sitio para las etiquetas)
  const COL_W = maxDepth ? Math.max(200, ((vw - WTD_LABEL_ROOM - 40) / sFit - WTD_PAD * 2) / maxDepth) : 200;
  const favs = S.favs || [], visited = S.visited || {};
  WTD._visible.forEach(n => {
    n._isLeaf = !(n._kids && n._kids.length);
    n._fav = favs.includes(n._path);
    n._visited = !!visited[n._path];
    n._x = WTD_PAD + n._depth * COL_W;
  });
  const Wsvg = WTD_PAD * 2 + maxDepth * COL_W + WTD_BAR_W + WTD_LABEL_ROOM / sFit;

  // Minimapa: con muchos nodos visibles solo los primeros niveles (la forma basta)
  const mmAll = WTD._visible.length <= WTD_MM_MAX;
  let ribbonsG = `<g class="wtd-ribbons">`, mmR = "";
  for (const n of WTD._visible){
    if (!n._open || !(n._kids && n._kids.length)) continue;
    let sy = n._y0;
    for (const k of n._kids){
      const r = `<path class="wtd-ribbon" data-edge-vi="${k._vi}" d="${_wtdRibbon(n._x + WTD_BAR_W, k._x, sy, sy + k._h, k._y0, k._y1)}" fill="${k._color}" fill-opacity="0.4"/>`;
      ribbonsG += r;
      if (!mmAll && k._depth <= WTD_MM_DEPTH) mmR += r;
      sy += k._h;
    }
  }
  ribbonsG += `</g>`;
  let nodesG = `<g class="wtd-nodes">`, mmN = "";
  for (const n of WTD._visible){
    const cls = "wtd-bar" + (n._visited ? " visited" : "") + (n._fav ? " fav" : "") + (n._hit ? " hit" : "")
              + (!n._isLeaf && !n._open ? " closed" : "") + (n === WTD._sel ? " sel" : "");
    const r = `<rect class="${cls}" data-vi="${n._vi}" x="${n._x.toFixed(1)}" y="${n._y0.toFixed(1)}" width="${WTD_BAR_W}" height="${Math.max(2, n._h).toFixed(1)}" rx="2" fill="${n._color}"/>`;
    nodesG += r;
    if (!mmAll && n._depth <= WTD_MM_DEPTH) mmN += r;
  }
  nodesG += `</g>`;

  canvas.innerHTML = `<svg class="wtd-svg${WTD._searchQ ? " searching" : ""}" width="${vw}" height="${vh}"><g id="wtdZoomG">${ribbonsG}${nodesG}</g></svg>`
    + `<div id="wtdLabels" class="wtd-labels"></div>`;
  WTD._svgDims = { Wsvg, Hsvg, vw, vh, colW: COL_W };
  WTD._miniInner = mmAll ? ribbonsG + nodesG : `<g class="wtd-ribbons">${mmR}</g><g class="wtd-nodes">${mmN}</g>`;
  wtdBuildMinimap();

  if (!WTD._zoom){
    const s = sFit, cw = Wsvg * s, ch = Hsvg * s;
    WTD._zoom = { s, tx: cw <= vw ? (vw - cw) / 2 : WTD_PAD * s, ty: ch <= vh ? (vh - ch) / 2 : WTD_PAD * s };
  } else if (old){
    WTD._zoom.tx = old.x - anchor._x * WTD._zoom.s;
    WTD._zoom.ty = old.y - ((anchor._y0 + anchor._y1) / 2) * WTD._zoom.s;
  }
  wtdApplyZoom();
  wtdBindCanvas(canvas);
  wtdRenderLegend();
  document.getElementById("wtdContinue")?.classList.toggle("hidden", !wtdLoadLast());
}

// Etiquetas en coordenadas de PANTALLA: tamaño de letra fijo con cualquier zoom.
// Solo se pintan las de las barras que miden lo bastante (al acercarte aparecen más),
// y siempre la del nodo seleccionado y las coincidencias de la búsqueda.
function wtdDrawLabels(){
  const layer = document.getElementById("wtdLabels"), z = WTD._zoom, d = WTD._svgDims;
  if (!layer || !z || !d) return;
  const colPx = d.colW * z.s, lineage = WTD._lineageSet || null;
  let html = "";
  for (const n of WTD._visible){
    const hPx = (n._y1 - n._y0) * z.s;
    if (hPx < WTD_LABEL_MIN_H && n !== WTD._sel && !n._hit) continue;
    const cy = ((n._y0 + n._y1) / 2) * z.s + z.ty;
    if (cy < -12 || cy > d.vh + 12) continue;
    const x = (n._x + WTD_BAR_W) * z.s + z.tx + 6;
    const maxW = (n._isLeaf || !n._open) ? Math.max(140, Math.min(320, colPx * 1.4)) : Math.max(56, colPx - 28);
    if (x > d.vw || x + maxW < 0) continue;
    const cls = "wtd-lbl" + (n._visited ? " visited" : "") + (n === WTD._sel ? " sel" : "") + (n._hit ? " hit" : "")
              + (lineage && lineage.has(n._vi) ? " lineage" : "");
    const count = n._isLeaf ? "" : `<span class="wtd-lbl-n">${!n._open ? "▸ " : ""}${n._leaves}</span>`;
    html += `<div class="${cls}" data-vi="${n._vi}" style="left:${x.toFixed(0)}px;top:${cy.toFixed(0)}px;max-width:${maxW.toFixed(0)}px">`
      + `${n._fav ? "★ " : ""}${n._visited ? "✓ " : ""}${_html(n.title || "")}${count}</div>`;
  }
  layer.innerHTML = html;
}

function wtdApplyZoom(){
  const g = document.querySelector("#wtdZoomG");
  if (!g || !WTD._zoom) return;
  const z = WTD._zoom;
  g.setAttribute("transform", `translate(${z.tx.toFixed(1)},${z.ty.toFixed(1)}) scale(${z.s.toFixed(4)})`);
  wtdUpdateMinimapRect();
  if (!WTD._lblRaf) WTD._lblRaf = requestAnimationFrame(() => { WTD._lblRaf = null; wtdDrawLabels(); });
}

// Barra lateral: progreso del árbol (todos los nodos) y sus ramas de primer nivel con su avance
function wtdRenderLegend(){
  if (!WTD.root) return;
  const vis = S.visited || {};
  const pBox = document.getElementById("wtdSideProgress");
  if (pBox){
    const total = WTD._totalNodes || 0;
    const done = (WTD._all || []).filter(n => vis[n._path]).length;
    const pct = total ? Math.round(100 * done / total) : 0;
    pBox.innerHTML = `<div class="wtd-side-prog-top"><span>${_html(t("achievementsProgress"))}</span><b>${pct}%</b></div>`
      + `<div class="wtd-side-bar"><div class="wtd-side-bar-fill" style="width:${pct}%"></div></div>`
      + `<div class="wtd-side-prog-sub">${done}/${total}</div>`;
  }
  const lBox = document.getElementById("wtdSideList");
  if (lBox){
    const kids = WTD.root._kids || [];
    const tot = kids.map(() => 0), seen = kids.map(() => 0);
    for (const n of WTD._all || []) if (n._branch >= 0){ tot[n._branch]++; if (vis[n._path]) seen[n._branch]++; }
    lBox.innerHTML = kids.map((k, i) => {
      const pct = tot[i] ? Math.round(100 * seen[i] / tot[i]) : 0;
      return `<button class="wtd-side-item${WTD._sel && WTD._sel._branch === i ? " active" : ""}" data-ai="${k._ai}">`
        + `<span class="wtd-leg-dot" style="background:${k._color}"></span>`
        + `<span class="wtd-side-item-main"><span class="wtd-side-item-name">${_html(k.title || "")}</span>`
        + `<span class="wtd-side-item-bar"><span style="width:${pct}%;background:${k._color}"></span></span></span>`
        + `<span class="wtd-leg-n">${seen[i]}/${tot[i]}</span></button>`;
    }).join("");
    lBox.querySelectorAll(".wtd-side-item").forEach(b => b.onclick = () => wtdSelect(WTD._all[+b.getAttribute("data-ai")], { reveal: true }));
  }
}

// Abre la rama hasta un nodo (todos sus antepasados)
function _wtdReveal(node){
  let changed = false;
  for (let p = node && node._parent; p; p = p._parent) if (!p._open){ p._open = true; changed = true; }
  return changed;
}
function _wtdPanelOpen(){ return !document.getElementById("wtdPanel")?.classList.contains("hidden"); }
// Ancho útil del lienzo: la ficha lateral tapa su parte (en móvil va abajo y no resta ancho)
function _wtdUsableW(d){ return d.vw - (_wtdPanelOpen() && innerWidth > 820 ? WTD_PANEL_W : 0); }
// Centra un nodo y acerca si su etiqueta no se vería
function wtdCenterOn(node){
  const z = WTD._zoom, d = WTD._svgDims;
  if (!node || !z || !d || node._y1 == null) return;
  const h = node._y1 - node._y0;
  if (h * z.s < WTD_LABEL_MIN_H + 6) z.s = Math.min(8, (WTD_LABEL_MIN_H + 10) / Math.max(1, h));
  const usableW = _wtdUsableW(d);
  z.tx = Math.min(usableW * 0.35, usableW / 2 - 60) - node._x * z.s;
  z.ty = d.vh / 2 - ((node._y0 + node._y1) / 2) * z.s;
  wtdApplyZoom();
}
// Si el nodo queda fuera de la vista (o bajo la ficha), lo trae a la vista
function _wtdEnsureVisible(node){
  const z = WTD._zoom, d = WTD._svgDims;
  if (!node || !z || !d) return;
  const x = node._x * z.s + z.tx, y = ((node._y0 + node._y1) / 2) * z.s + z.ty;
  const usableW = _wtdUsableW(d);
  if (x < 20 || x > usableW - 140 || y < 20 || y > d.vh - 20) wtdCenterOn(node);
}

/* ── Selección: un clic = ficha del nodo (y despliega la rama) ── */
function wtdSelect(node, opts){
  if (!node) return;
  opts = opts || {};
  const prev = WTD._sel;
  WTD._sel = node;
  let relayout = false;
  if (opts.reveal) relayout = _wtdReveal(node) || relayout;
  if (opts.toggle && !node._isLeaf && node._kids && node._kids.length){
    // 1.er clic en una rama plegada: se despliega; clic en la ya seleccionada: se pliega/despliega
    if (!node._open){ node._open = true; relayout = true; }
    else if (prev === node){ node._open = false; relayout = true; }
  }
  wtdMarkVisitedNode(node, true);   // abrir la ficha = explorado
  if (relayout) wtdRenderDiagram(opts.reveal ? null : node);
  else {
    document.querySelectorAll(".wtd-bar.sel").forEach(e => e.classList.remove("sel"));
    document.querySelector(`.wtd-bar[data-vi="${node._vi}"]`)?.classList.add("sel");
    wtdRenderLegend();
  }
  wtdShowPanel(node);   // antes de encuadrar: la ficha resta ancho útil
  // Rama (o salto a un nodo): zoom a la rama con sus hijos a la vista. Hoja: solo si se ha quedado fuera.
  if (relayout || opts.reveal || !node._isLeaf) wtdFrameBranch(node);
  else _wtdEnsureVisible(node);
  wtdDrawLabels();
  wtdUpdateDiagTitle();
}

// Qué encuadrar para un nodo: él y sus hijos si está abierto; si no, su rama (padre + hermanos)
function _wtdFrameSet(node){
  if (node._open && node._kids && node._kids.length) return [node, ...node._kids];
  if (node._parent) return [node._parent, ...node._parent._kids];
  return [node];
}
// Zoom animado que encaja la rama en la zona visible, con sitio a la derecha para los nombres
function wtdFrameBranch(node, ms = 380){
  const d = WTD._svgDims;
  if (!node || !d || !WTD._zoom) return;
  const set = _wtdFrameSet(node).filter(n => n._y1 != null);
  if (!set.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of set){ x0 = Math.min(x0, n._x); x1 = Math.max(x1, n._x + WTD_BAR_W); y0 = Math.min(y0, n._y0); y1 = Math.max(y1, n._y1); }
  const usableW = _wtdUsableW(d);
  const vh = d.vh * (_wtdPanelOpen() && innerWidth <= 820 ? 0.4 : 1);   // en móvil la ficha tapa la parte de abajo
  const room = Math.min(WTD_LABEL_ROOM, usableW * 0.35), MX = 36, MY = 28;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const s = Math.max(_wtdMinScale(), Math.min((usableW - room - MX * 2) / bw, (vh - MY * 2) / bh, 6));
  const tx = MX + (usableW - room - MX * 2 - bw * s) / 2 - x0 * s;
  const ty = vh / 2 - ((y0 + y1) / 2) * s;
  wtdAnimateTo({ s, tx, ty }, ms);
}
// Transición suave entre dos encuadres (escala interpolada en logaritmo)
function wtdAnimateTo(to, ms = 380){
  const z = WTD._zoom;
  if (!z) return;
  cancelAnimationFrame(WTD._animRaf || 0);
  const from = { s: z.s, tx: z.tx, ty: z.ty };
  if (ms <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches){ Object.assign(z, to); wtdApplyZoom(); return; }
  const t0 = performance.now(), ease = k => 1 - Math.pow(1 - k, 3);
  const ls0 = Math.log(from.s), ls1 = Math.log(to.s);
  const step = (now) => {
    const k = ease(Math.min(1, (now - t0) / ms));
    const sNow = Math.exp(ls0 + (ls1 - ls0) * k);
    // el punto del mundo que acaba en el centro se mueve en línea recta
    const dims = WTD._svgDims;
    const wx0 = (dims.vw / 2 - from.tx) / from.s, wy0 = (dims.vh / 2 - from.ty) / from.s;
    const wx1 = (dims.vw / 2 - to.tx) / to.s, wy1 = (dims.vh / 2 - to.ty) / to.s;
    const wx = wx0 + (wx1 - wx0) * k, wy = wy0 + (wy1 - wy0) * k;
    z.s = sNow; z.tx = dims.vw / 2 - wx * sNow; z.ty = dims.vh / 2 - wy * sNow;
    wtdApplyZoom();
    if (k < 1) WTD._animRaf = requestAnimationFrame(step);
  };
  WTD._animRaf = requestAnimationFrame(step);
}

// Siguiente nodo sin ver, en el orden del árbol, a partir del actual
function wtdNextUnseen(from){
  const all = WTD._all || [], vis = S.visited || {};
  const start = from ? from._ai : -1;
  for (let i = 1; i <= all.length; i++){
    const n = all[(start + i) % all.length];
    if (!vis[n._path]) return n;
  }
  return null;
}

// Arrastrar para mover (ratón y dedo), rueda o pellizco para el zoom
function wtdBindCanvas(canvas){
  if (canvas._wtdBound) return;
  canvas._wtdBound = true;
  const pts = new Map();
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0, moved = false, pinch = null;
  const nodeOf = (e) => {   // nodo desde su barra, su etiqueta (data-vi) o la cinta que lleva a él (data-edge-vi)
    const el = e.target.closest && e.target.closest("[data-vi], [data-edge-vi]");
    if (!el) return null;
    const vi = el.getAttribute("data-vi") ?? el.getAttribute("data-edge-vi");
    return WTD._visible[+vi] || null;
  };
  canvas.addEventListener("pointerdown", e => {
    if ((e.pointerType === "mouse" && e.button !== 0) || !WTD._zoom) return;
    wtdTipHide();
    cancelAnimationFrame(WTD._animRaf || 0);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1){
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY; ox = WTD._zoom.tx; oy = WTD._zoom.ty;
      canvas.classList.add("is-panning");
    } else if (pts.size === 2){
      const [a, b] = [...pts.values()], r = canvas.getBoundingClientRect();
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: WTD._zoom.s, tx: WTD._zoom.tx, ty: WTD._zoom.ty,
        cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top };
      moved = true;
    }
  });
  window.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const z = WTD._zoom; if (!z) return;
    if (pinch && pts.size >= 2){
      const [a, b] = [...pts.values()];
      const ns = Math.max(_wtdMinScale(), Math.min(8, pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
      z.tx = pinch.cx - (pinch.cx - pinch.tx) * (ns / pinch.s);
      z.ty = pinch.cy - (pinch.cy - pinch.ty) * (ns / pinch.s);
      z.s = ns; wtdApplyZoom();
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    z.tx = ox + dx; z.ty = oy + dy; wtdApplyZoom();
  });
  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size){ dragging = false; canvas.classList.remove("is-panning"); }
  };
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    wtdTipHide();
    cancelAnimationFrame(WTD._animRaf || 0);   // la rueda manda sobre un encuadre en curso
    const rect = canvas.getBoundingClientRect();
    wtdZoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener("mousemove", e => {
    if (dragging) return;
    const n = nodeOf(e);
    if (!n){ wtdTipHide(); wtdSetLineage(null); return; }
    wtdSetLineage(n);
    // La tarjeta sale con el ratón medio segundo quieto: mientras se mueve, no estorba
    const T = WTD._tip || (WTD._tip = {});
    if (T.node === n && Math.abs(e.clientX - T.x) + Math.abs(e.clientY - T.y) < 6) return;
    wtdTipHide();
    T.node = n; T.x = e.clientX; T.y = e.clientY;
    T.timer = setTimeout(() => wtdTipShow(n, T.x, T.y), 500);
  });
  canvas.addEventListener("mouseleave", () => { wtdTipHide(); wtdSetLineage(null); });
  canvas.addEventListener("click", e => {
    if (moved) return;                 // fue un arrastre, no un clic
    const n = nodeOf(e); if (!n) return;
    wtdTipHide();
    wtdSelect(n, { toggle: true });
  });
}

// ── Tarjeta emergente de un nodo: camino por niveles desde la raíz (con los elementos
//    de cada nivel), imagen y primera frase del artículo, progreso, favorito y % del árbol ──
function wtdTipHide(){
  const T = WTD._tip;
  if (T){ clearTimeout(T.timer); T.node = null; T.token = null; }
  document.getElementById("wtdTooltip")?.classList.add("hidden");
}
// Hojas vistas bajo un nodo (las mismas que cuenta «N elementos»)
function _wtdSeenLeaves(node, vis){
  if (!node._kids || !node._kids.length) return vis[node._path] ? 1 : 0;
  let s = 0;
  for (const k of node._kids) s += _wtdSeenLeaves(k, vis);
  return s;
}
function _wtdFirstSentence(p){
  p = (p || "").replace(/\s*\[[^\]]*\]/g, "").trim();     // sin llamadas a notas [1]
  const m = p.match(/^(.{40,}?[.!?。।])(\s|$)/);
  let s = m ? m[1] : p;
  if (s.length > 200) s = s.slice(0, 197).replace(/\s+\S*$/, "") + "…";
  return s;
}
// Dentro de la ventana: a la derecha y abajo del ratón si cabe; si no, al otro lado
function _wtdTipPlace(tip, x, y){
  const w = tip.offsetWidth, h = tip.offsetHeight, M = 8;
  let L = x + 16, Tp = y + 16;
  if (L + w > innerWidth - M) L = Math.max(M, x - 16 - w);
  if (Tp + h > innerHeight - M) Tp = Math.max(M, innerHeight - M - h);
  tip.style.left = L + "px"; tip.style.top = Tp + "px";
}
function wtdTipShow(node, x, y){
  const tip = document.getElementById("wtdTooltip");
  const T = WTD._tip;
  if (!tip || !node || !T) return;
  const token = T.token = Symbol("wtdtip");
  const chain = [];
  for (let p = node; p; p = p._parent) chain.unshift(p);
  const root = chain[0], lang = S.lang;
  const fmt = v => Number(v || 1).toLocaleString(lang);
  const vis = S.visited || {};
  const branch = !!(node._kids && node._kids.length);
  const total = node._leaves || 1;
  const seen = branch ? _wtdSeenLeaves(node, vis) : (vis[node._path] ? 1 : 0);
  const path = chain.map((p, i) => {
    const cur = p === node;
    const n = cur ? fill(t("wtdElements"), { n: fmt(p._leaves) }) : fmt(p._leaves);
    return `<li class="wtd-tip-lvl${cur ? " is-cur" : ""}" style="--d:${i}"><b>${i + 1}</b>`
      + `<span class="wtd-tip-dot" style="background:${p._color || "var(--muted)"}"></span>`
      + `<span class="wtd-tip-name">${_html(p.title || "")}</span><span class="wtd-tip-n">${_html(n)}</span></li>`;
  }).join("");
  const meta = [];
  if (branch) meta.push(`<span class="${seen ? "is-seen" : ""}">✓ ${_html(fill(t("wtdTipSeen"), { n: fmt(seen), t: fmt(total) }))}</span>`);
  else meta.push(seen ? `<span class="is-seen">✓ ${_html(t("wtdTipSeenOne"))}</span>` : `<span>${_html(t("wtdTipUnseen"))}</span>`);
  if (node !== root){
    const pct = total / (root._leaves || 1) * 100;
    const p = new Intl.NumberFormat(lang, { maximumFractionDigits: pct >= 10 ? 0 : pct >= 1 ? 1 : 2 }).format(pct) + " %";
    meta.push(`<span>${_html(fill(t("wtdTipShare"), { p }))}</span>`);
  }
  if (wtdIsFav(node)) meta.push(`<span class="is-fav">★ ${_html(t("favoritesTitle"))}</span>`);
  tip.innerHTML = `<div class="wtd-tip-img" hidden></div>`
    + `<div class="wtd-tip-head"><strong>${_html(node.title || "")}</strong><p class="wtd-tip-lead" hidden></p></div>`
    + `<ol class="wtd-tip-path">${path}</ol><div class="wtd-tip-meta">${meta.join("")}</div>`;
  tip.classList.remove("hidden");
  _wtdTipPlace(tip, x, y);
  wikiSummary(node).then(info => {
    if (T.token !== token || !info || info.disambig) return;
    if (info.img){
      const box = tip.querySelector(".wtd-tip-img");
      box.innerHTML = `<img src="${_html(info.img)}" alt="" onerror="this.parentNode.hidden=true">`;
      box.hidden = false;
    }
    const lead = _wtdFirstSentence(info.extract);
    if (lead){ const p = tip.querySelector(".wtd-tip-lead"); p.textContent = lead; p.hidden = false; }
    _wtdTipPlace(tip, x, y);
  });
}

// Resalta el linaje raíz→nodo al pasar el ratón (barras, cintas y etiquetas)
function wtdSetLineage(node){
  const svg = document.querySelector(".wtd-svg");
  if (!svg) return;
  if (!node){
    if (WTD._lineageVi == null) return;
    WTD._lineageVi = null; WTD._lineageSet = null;
    svg.classList.remove("lineage-on");
    document.querySelectorAll("#wtdCanvas .lineage").forEach(e => e.classList.remove("lineage"));
    return;
  }
  if (WTD._lineageVi === node._vi) return;
  WTD._lineageVi = node._vi;
  document.querySelectorAll("#wtdCanvas .lineage").forEach(e => e.classList.remove("lineage"));
  svg.classList.add("lineage-on");
  const set = new Set();
  for (let cur = node; cur; cur = cur._parent){
    if (cur._vi == null) break;
    set.add(cur._vi);
    svg.querySelector(`.wtd-bar[data-vi="${cur._vi}"]`)?.classList.add("lineage");
    svg.querySelector(`.wtd-ribbon[data-edge-vi="${cur._vi}"]`)?.classList.add("lineage");
    document.querySelector(`#wtdLabels .wtd-lbl[data-vi="${cur._vi}"]`)?.classList.add("lineage");
  }
  WTD._lineageSet = set;
}

// Buscador: busca en TODO el árbol, abre las ramas de las coincidencias y las encuadra
function wtdApplySearch(q){
  q = (q || "").trim().toLowerCase();
  WTD._searchQ = q;
  const hits = [];
  for (const n of WTD._all || []){
    n._hit = !!q && (n.title || "").toLowerCase().includes(q);
    if (n._hit && hits.length < 40){ hits.push(n); _wtdReveal(n); }
  }
  wtdRenderDiagram();
  if (hits.length) wtdZoomToNodes(hits);
}

function wtdZoomToNodes(nodes){
  nodes = (nodes || []).filter(n => n && n._y1 != null);
  if (!nodes.length || !WTD._svgDims) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach(n => { x0 = Math.min(x0, n._x); y0 = Math.min(y0, n._y0); x1 = Math.max(x1, n._x + WTD_BAR_W); y1 = Math.max(y1, n._y1); });
  const { vh } = WTD._svgDims;
  const vw = _wtdUsableW(WTD._svgDims);
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0) + 60;
  const s = Math.max(_wtdMinScale(), Math.min((vw - WTD_LABEL_ROOM - 80) / bw, vh / bh, 2.5));
  WTD._zoom = { s, tx: 40 - x0 * s, ty: vh / 2 - ((y0 + y1) / 2) * s };
  if (bw * s < vw - WTD_LABEL_ROOM - 80) WTD._zoom.tx = (vw - WTD_LABEL_ROOM) / 2 - ((x0 + x1) / 2) * s;
  wtdApplyZoom();
}

/* ── Progreso, favoritos, recientes y logros (en el navegador, por árbol e idioma) ── */
function wtdLoadLast(){ const v = store.get(tkey("last"), ""); return typeof v === "string" ? v : ""; }
function wtdMarkVisitedNode(node, quiet){
  if (!node || !WTD.treeId) return;
  if (!S.visited[node._path]){
    S.visited[node._path] = true;
    store.set(tkey("visited"), S.visited);
  }
  node._visited = true;
  store.set(tkey("last"), node._path);
  const rec = store.get(tkey("recents"), []) || [];
  store.set(tkey("recents"), [node._path, ...rec.filter(p => p !== node._path)].slice(0, 12));
  wtCheckAchievements();
  document.querySelector(`.wtd-bar[data-vi="${node._vi}"]`)?.classList.add("visited");
  document.getElementById("wtdContinue")?.classList.remove("hidden");
  if (!quiet){ wtdRenderLegend(); wtdDrawLabels(); }
}
function wtdIsFav(node){ return !!node && S.favs.includes(node._path); }
function wtdToggleFav(node){
  if (!node || !WTD.treeId) return;
  const i = S.favs.indexOf(node._path);
  if (i >= 0) S.favs.splice(i, 1); else S.favs.push(node._path);
  store.set(tkey("favs"), S.favs);
  node._fav = i < 0;
  document.querySelector(`.wtd-bar[data-vi="${node._vi}"]`)?.classList.toggle("fav", node._fav);
  wtdDrawLabels();
}
function achievementsSnapshot(){
  // Sobre TODOS los nodos del árbol (ramas y hojas): abrir la ficha de cualquiera cuenta
  const total = (WTD._all || []).length;
  const done = (WTD._all || []).filter(n => S.visited[n._path]).length;
  return { total, done, pct: total ? Math.round(100 * done / total) : 0 };
}
function wtCheckAchievements(){
  const bag = store.get(tkey("ach"), {}) || {};
  const { pct } = achievementsSnapshot();
  const opened = Object.keys(S.visited || {}).length;
  const unlock = (id, ok) => { if (ok && !bag[id]) { bag[id] = Date.now(); changed = true; } };
  let changed = false;
  unlock("first", opened >= 1); unlock("n5", opened >= 5);
  unlock("p10", pct >= 10); unlock("p25", pct >= 25); unlock("p50", pct >= 50); unlock("p100", pct >= 100);
  if (changed) store.set(tkey("ach"), bag);
}
function achTitle(id){
  return t({ first: "ach_first_open", n5: "ach_5_done", p10: "ach_10_percent", p25: "ach_25_percent", p50: "ach_50_percent", p100: "ach_100_percent" }[id] || "achievementsTitle");
}
// El progreso se guarda por ruta («Animalia › Cordados › … › Lobo»). Si el árbol gana o
// pierde niveles, las rutas antiguas se recolocan por el nombre del nodo cuando es único.
function _wtdMigrateProgress(){
  const have = new Set((WTD._all || []).map(n => n._path));
  const byName = new Map();
  for (const n of WTD._all || []) byName.set(n.title, byName.has(n.title) ? null : n._path);
  let changed = false;
  const fix = p => {
    if (!p || have.has(p)) return p;
    const np = byName.get(String(p).split(" › ").pop());
    if (np){ changed = true; return np; }
    return p;
  };
  const vis = {};
  for (const [p, v] of Object.entries(S.visited || {})) vis[fix(p)] = v;
  const favs = [...new Set((S.favs || []).map(fix))];
  const rec = [...new Set((store.get(tkey("recents"), []) || []).map(fix))];
  const last = fix(wtdLoadLast());
  if (!changed) return;
  S.visited = vis; S.favs = favs;
  store.set(tkey("visited"), vis); store.set(tkey("favs"), favs); store.set(tkey("recents"), rec);
  if (last) store.set(tkey("last"), last);
}

/* ── Plegar / desplegar ── */
function wtdUnfocus(){
  for (const n of WTD._all || []) n._open = n._depth < WTD_OPEN_DEPTH;
  WTD._zoom = null;
  wtdRenderDiagram(); wtdUpdateDiagTitle();
}
// Contrario de "Plegar": abre todas las ramas y encuadra el árbol entero
function wtdExpandAll(){
  for (const n of WTD._all || []) n._open = !!(n._kids && n._kids.length);
  WTD._zoom = null;
  wtdRenderDiagram(); wtdUpdateDiagTitle();
}

// Ruta del nodo seleccionado (cada tramo lleva a ese nodo)
function wtdUpdateDiagTitle(){
  const box = document.getElementById("wtdCrumbs");
  if (!box || !WTD.root) return;
  const chain = [];
  for (let n = WTD._sel || WTD.root; n; n = n._parent) chain.unshift(n);
  // En una sola línea: si la ruta es larga, la raíz, "…" (con la ruta entera al pasar el ratón) y los dos últimos tramos
  const shown = chain.length > 4 ? [chain[0], null, ...chain.slice(-2)] : chain;
  box.innerHTML = shown.map((n, i) => (i ? `<span class="wtd-crumb-sep" aria-hidden="true">›</span>` : "")
    + (n ? `<button type="button" class="wtd-crumb${n === chain[chain.length - 1] ? " is-current" : ""}" data-ai="${n._ai}">${_html(n.title || "")}</button>`
         : `<span class="wtd-crumb-more" title="${_html(chain.slice(1, -2).map(x => x.title || "").join(" › "))}">…</span>`)).join("");
  box.querySelectorAll(".wtd-crumb:not(.is-current)").forEach(b => b.onclick = () => {
    const n = WTD._all[+b.getAttribute("data-ai")];
    if (n === WTD.root){ wtdHidePanel(); WTD._zoom = null; wtdRenderDiagram(); wtdUpdateDiagTitle(); }
    else wtdSelect(n, { reveal: true });
  });
}

/* ── Saltar a un nodo por su ruta (abre su rama) ── */
function wtdFindByPath(p){ return (WTD._all || []).find(n => n._path === p) || null; }
function wtdJumpTo(path, open){
  const n = wtdFindByPath(path);
  if (!n) return;
  if (open) wtdSelect(n, { reveal: true });
  else { if (_wtdReveal(n)) wtdRenderDiagram(); wtdFrameBranch(n); }
}
function wtdContinue(){ const p = wtdLoadLast(); if (p) wtdJumpTo(p, true); }

/* ── Menús Favoritos / Recientes / Logros (con "Borrar progreso" dentro de Logros) ── */
function wtdOpenMenu(kind){
  const m = document.getElementById("wtdFavMenu"); if (!m) return;
  if (!m.classList.contains("hidden") && WTD._menuKind === kind){ m.classList.add("hidden"); return; }
  WTD._menuKind = kind;
  const titleOf = p => (String(p).split(" › ").pop() || p);
  const listOf = (arr) => arr.length
    ? arr.map(p => `<button class="wtd-fm-item" data-path="${_html(p)}">${_html(titleOf(p))}</button>`).join("")
    : `<div class="wtd-fm-empty">—</div>`;
  let html = "";
  if (kind === "fav"){
    html = `<div class="wtd-fm-h">${_html(t("favoritesTitle"))}</div>` + listOf(S.favs || []);
  } else if (kind === "rec"){
    html = `<div class="wtd-fm-h">${_html(t("recentsTitle"))}</div>` + listOf(store.get(tkey("recents"), []) || []);
  } else {
    const snap = achievementsSnapshot();
    const bag = store.get(tkey("ach"), {}) || {};
    const unlocked = Object.keys(bag).sort((a, b) => bag[b] - bag[a]);
    html = `<div class="wtd-fm-h">${_html(t("achievementsTitle"))}</div>`
      + `<div class="wtd-fm-note">${_html(t("achievementsProgress"))}: <b>${snap.pct}%</b> (${snap.done}/${snap.total})</div>`
      + (unlocked.length
          ? unlocked.map(code => `<div class="wtd-fm-ach">🏅 ${_html(achTitle(code))}</div>`).join("")
          : `<div class="wtd-fm-empty">${_html(t("achievementsEmpty"))}</div>`)
      + `<div class="wtd-fm-sep"></div><button class="wtd-fm-item wtd-fm-danger" id="wtdResetBtn">${_html(t("resetProgress"))}</button>`;
  }
  m.innerHTML = html;
  m.querySelectorAll(".wtd-fm-item[data-path]").forEach(b => b.onclick = () => { m.classList.add("hidden"); wtdJumpTo(b.getAttribute("data-path"), true); });
  m.querySelector("#wtdResetBtn")?.addEventListener("click", (e) => { e.stopPropagation(); wtdResetProgress(); });
  // El menú se abre justo bajo su botón (fijo en pantalla: la barra puede ocupar varias filas)
  const btn = document.getElementById(kind === "fav" ? "wtdFavBtn" : kind === "rec" ? "wtdRecBtn" : "wtdAchBtn");
  m.classList.remove("hidden");
  if (btn){
    const bb = btn.getBoundingClientRect();
    m.style.top = (bb.bottom + 4) + "px";
    m.style.left = Math.max(8, Math.min(bb.left, innerWidth - m.offsetWidth - 8)) + "px";
  }
}

function wtdConfirm(title, msg, onYes, okLabel){
  const box = document.getElementById("wtdConfirm");
  box.innerHTML = `<div class="wtd-modal-card" role="dialog" aria-modal="true">
      <div class="wtd-modal-title">${_html(title)}</div><div class="wtd-modal-msg">${_html(msg)}</div>
      <div class="wtd-modal-actions">
        <button class="ui-btn ui-btn--secondary" id="wtdCfNo">${_html(t("dlConfirmCancel"))}</button>
        <button class="ui-btn ui-btn--danger" id="wtdCfYes">${_html(okLabel || t("ok"))}</button>
      </div></div>`;
  box.classList.remove("hidden");
  const close = () => box.classList.add("hidden");
  box.querySelector("#wtdCfNo").onclick = close;
  box.querySelector("#wtdCfYes").onclick = () => { close(); onYes && onYes(); };
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector("#wtdCfNo").focus();
}
// Borrar el progreso (vistos + logros) del árbol actual
function wtdResetProgress(){
  if (!WTD.treeId) return;
  document.getElementById("wtdFavMenu")?.classList.add("hidden");
  wtdConfirm(t("resetConfirmTitle"), t("wtdResetMsg"), () => {
    S.visited = {};
    store.set(tkey("visited"), {}); store.set(tkey("ach"), {});
    wtdRenderDiagram();
    if (WTD._sel) wtdShowPanel(WTD._sel);
  }, t("resetProgress"));
}

/* ── Ficha del nodo, al lado del diagrama ── */
function wtdHidePanel(){
  document.getElementById("wtdPanel")?.classList.add("hidden");
  WTD._prevToken = null;
  if (WTD._sel){
    WTD._sel = null;
    document.querySelectorAll(".wtd-bar.sel").forEach(e => e.classList.remove("sel"));
    wtdDrawLabels(); wtdUpdateDiagTitle(); wtdRenderLegend();
  }
}

async function wtdShowPanel(node){
  const panel = document.getElementById("wtdPanel");
  if (!panel || !node) return;
  const token = Symbol("wtdpanel"); WTD._prevToken = token;
  if (node.noWiki){ _wtdPanelRender(node, { notfound: true }); panel.classList.remove("hidden"); return; }
  _wtdPanelRender(node, { loading: true });
  panel.classList.remove("hidden");
  const info = await wikiSummary(node);
  if (WTD._prevToken !== token) return;
  _wtdPanelRender(node, info || {});
}

function _wtdPanelRender(node, info){
  const panel = document.getElementById("wtdPanel");
  if (!panel) return;
  const vis = S.visited || {};
  const chip = n => `<button type="button" class="wtd-chip${vis[n._path] ? " seen" : ""}" data-ai="${n._ai}">`
    + `<span class="wtd-chip-dot" style="background:${n._color}"></span>${vis[n._path] ? "✓ " : ""}${_html(n.title || "")}</button>`;
  let body;
  if (info.loading)       body = `<p class="wtd-panel-status">${_html(t("wtdSearching"))}</p>`;
  else if (info.notfound) body = `<p class="wtd-panel-status">${_html(t("wtdNoArticle"))}</p>`;
  else if (info.disambig || !info.extract) body = "";
  else body = (info.img ? `<img class="wtd-panel-img" src="${_html(info.img)}" alt="" onerror="this.remove()">` : "")
      + info.extract.split("\n").filter(Boolean).map(p => `<p class="wtd-panel-para">${_html(p)}</p>`).join("")
      + `<p class="wtd-panel-src"><a href="${_html(node.url)}" target="_blank" rel="noopener" data-wiki-popup>${_html(t("wikiSource"))}</a></p>`;
  // "En este árbol": la rama superior, lo que contiene y sus hermanos
  const kids = node._kids || [], sibs = node._parent ? node._parent._kids.filter(k => k !== node) : [];
  const tree = (node._parent ? `<div class="wtd-panel-sub">${_html(t("wtdUp"))}</div><div class="wtd-chips">${chip(node._parent)}</div>` : "")
    + (kids.length ? `<div class="wtd-panel-sub">${_html(t("wtdChildren"))} · ${kids.length}</div><div class="wtd-chips">${kids.slice(0, 40).map(chip).join("")}</div>` : "")
    + (sibs.length ? `<div class="wtd-panel-sub">${_html(t("wtdSiblings"))}</div><div class="wtd-chips">${sibs.slice(0, 24).map(chip).join("")}</div>` : "");
  const next = wtdNextUnseen(node);
  const isFav = wtdIsFav(node);
  panel.innerHTML = `
    <header class="wtd-panel-head">
      <div class="wtd-panel-kicker"><span class="wtd-chip-dot" style="background:${node._color}"></span>${_html(node._parent ? node._parent.title : WTD.treeTitle)}</div>
      <h3 class="wtd-panel-title">${_html(node.title || "")}</h3>
      <button type="button" class="wtd-panel-x" id="wtdPClose" title="${_html(t("mediav_close"))}" aria-label="${_html(t("mediav_close"))}"><svg class="lucide-icon" aria-hidden="true"><use href="#lucide-x"></use></svg></button>
    </header>
    <div class="wtd-panel-scroll">
      ${body}
      <div class="wtd-panel-tree"><h4>${_html(t("wtdInTree"))}</h4>${tree}</div>
    </div>
    <footer class="wtd-panel-actions">
      ${next ? `<button type="button" class="ui-btn ui-btn--primary wtd-panel-next" id="wtdPNext"><svg class="lucide-icon" aria-hidden="true"><use href="#lucide-skip-forward"></use></svg> ${_html(t("wtdNextUnseen"))}</button>`
             : `<p class="wtd-panel-done">🌲 ${_html(t("wtdAllSeen"))}</p>`}
      <div class="wtd-panel-row">
        ${node.url ? `<a class="ui-btn ui-btn--secondary ui-btn--sm" href="${_html(node.url)}" target="_blank" rel="noopener" data-wiki-popup><svg class="lucide-icon" aria-hidden="true"><use href="#lucide-external-link"></use></svg> ${_html(t("readOnWiki"))}</a>` : ""}
        <button type="button" class="ui-btn ui-btn--ghost ui-btn--sm${isFav ? " is-on" : ""}" id="wtdPFav">${isFav ? "★" : "☆"} ${_html(t("favoritesTitle"))}</button>
      </div>
    </footer>`;
  const $p = id => panel.querySelector("#" + id);
  $p("wtdPClose")?.addEventListener("click", () => wtdHidePanel());
  $p("wtdPNext")?.addEventListener("click", () => { const n = wtdNextUnseen(node); if (n) wtdSelect(n, { reveal: true }); });
  $p("wtdPFav")?.addEventListener("click", (e) => {
    wtdToggleFav(node);
    const on = wtdIsFav(node);
    e.currentTarget.classList.toggle("is-on", on);
    e.currentTarget.textContent = `${on ? "★" : "☆"} ${t("favoritesTitle")}`;
  });
  panel.querySelectorAll(".wtd-chip[data-ai]").forEach(b => b.addEventListener("click", () => wtdSelect(WTD._all[+b.getAttribute("data-ai")], { reveal: true })));
  // Los enlaces al artículo lo abren dentro del visor (con Ctrl/⌘ o rueda, en otra pestaña como siempre)
  panel.querySelectorAll("a[data-wiki-popup]").forEach(a => a.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    wtdOpenWikiPopup(node.url, node.title);
  }));
}

/* ── Artículo completo de Wikipedia en una ventana dentro del visor ── */
function wtdOpenWikiPopup(url, title){
  const pop = document.getElementById("wtdWikiPopup"), frame = document.getElementById("wtdWikiFrame");
  if (!pop || !frame || !url) return;
  wtdTipHide();
  document.getElementById("wtdWikiTitle").textContent = title || "";
  const ext = document.getElementById("wtdWikiExt");
  ext.href = url; ext.title = t("openNewTab"); ext.setAttribute("aria-label", t("openNewTab"));
  const cl = document.getElementById("wtdWikiClose");
  cl.title = t("mediav_close"); cl.setAttribute("aria-label", t("mediav_close"));
  document.getElementById("wtdWikiLoading").textContent = t("loading");
  frame.src = url;
  pop.classList.remove("hidden");
  WTD._wikiReturnFocus = document.activeElement;
  cl.focus();
}
function wtdCloseWikiPopup(){
  const pop = document.getElementById("wtdWikiPopup");
  if (!pop || pop.classList.contains("hidden")) return false;
  pop.classList.add("hidden");
  document.getElementById("wtdWikiFrame").src = "about:blank";
  WTD._wikiReturnFocus?.focus?.();
  return true;
}

// Cinta curva tipo Sankey: banda origen [sy0,sy1] → banda destino [ty0,ty1]
function _wtdRibbon(x0, x1, sy0, sy1, ty0, ty1){
  const xm = (x0 + x1) / 2;
  return `M${x0.toFixed(1)},${sy0.toFixed(1)} C${xm.toFixed(1)},${sy0.toFixed(1)} ${xm.toFixed(1)},${ty0.toFixed(1)} ${x1.toFixed(1)},${ty0.toFixed(1)} `
       + `L${x1.toFixed(1)},${ty1.toFixed(1)} C${xm.toFixed(1)},${ty1.toFixed(1)} ${xm.toFixed(1)},${sy1.toFixed(1)} ${x0.toFixed(1)},${sy1.toFixed(1)} Z`;
}

/* ── Minimapa ── */
function wtdBuildMinimap(){
  const mm = document.getElementById("wtdMinimap");
  if (!mm || !WTD._svgDims) return;
  const { Wsvg, Hsvg } = WTD._svgDims;
  mm.innerHTML = `<div class="wtd-mm-title">${_html(WTD.treeTitle || "")}</div>`
    + `<svg class="wtd-mm-svg" viewBox="0 0 ${Math.round(Wsvg)} ${Math.round(Hsvg)}" preserveAspectRatio="xMidYMid meet">`
    + `<g opacity="0.92">${WTD._miniInner || ""}</g>`
    + `<rect class="wtd-mm-view" x="0" y="0" width="0" height="0"/></svg>`;
  const svg = mm.querySelector(".wtd-mm-svg");
  svg.addEventListener("click", (e) => {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const w = pt.matrixTransform(ctm.inverse());     // → coords mundo
    const z = WTD._zoom, d = WTD._svgDims; if (!z || !d) return;
    z.tx = d.vw / 2 - w.x * z.s; z.ty = d.vh / 2 - w.y * z.s;
    wtdApplyZoom();
  });
  wtdUpdateMinimapRect();
}
function wtdUpdateMinimapRect(){
  const r = document.querySelector(".wtd-mm-view");
  const z = WTD._zoom, d = WTD._svgDims;
  if (!r || !z || !d) return;
  r.setAttribute("x", (-z.tx / z.s).toFixed(1));
  r.setAttribute("y", (-z.ty / z.s).toFixed(1));
  r.setAttribute("width",  (d.vw / z.s).toFixed(1));
  r.setAttribute("height", (d.vh / z.s).toFixed(1));
}

// Alejar como mínimo hasta ver el árbol entero (con margen), por grande que sea
function _wtdMinScale(){
  const d = WTD._svgDims;
  if (!d) return 0.05;
  return Math.max(WTD_MIN_S, Math.min(0.05, 0.6 * Math.min(d.vw / d.Wsvg, d.vh / d.Hsvg)));
}
function wtdZoomBy(factor, cx, cy){
  const z = WTD._zoom; if (!z) return;
  const ns = Math.max(_wtdMinScale(), Math.min(8, z.s * factor));
  z.tx = cx - (cx - z.tx) * (ns / z.s);
  z.ty = cy - (cy - z.ty) * (ns / z.s);
  z.s = ns; wtdApplyZoom();
}

/* ============================================================
   Arranque y rutas: #<idioma>/<árbol>
   ============================================================ */
function parseHash(){
  const [lang, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { lang: LANGS.includes(lang) ? lang : null, id: id ? decodeURIComponent(id) : null };
}
async function route(){
  const h = parseHash();
  if (h.lang && h.lang !== S.lang){ S.lang = h.lang; store.set("lang", h.lang); applyStaticTexts(); }
  if (h.id) await wtdOpenTree(h.id, false);
  else { WTD.treeId = null; wtdHidePanel(); await wtdOpen(); }
}

(function boot(){
  const nav = (navigator.languages || [navigator.language || "en"]).map(l => String(l).slice(0, 2).toLowerCase());
  S.lang = parseHash().lang || store.get("lang", "") || nav.find(l => LANGS.includes(l)) || "en";
  if (!LANGS.includes(S.lang)) S.lang = "en";
  initChrome();
  applyStaticTexts();
  window.addEventListener("popstate", route);
  route();
})();
