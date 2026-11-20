# Prompt to build a tree with an AI · Prompt para hacer un árbol con una IA

Copy the prompt in your language into your AI assistant (Claude, for example), fill in the three lines at the
top, and attach or paste [FORMAT.md](FORMAT.md) and [example/vitamins.json](example/vitamins.json) if your
assistant can read files. Assistants that can search the web or Wikipedia/Wikidata give much better results.

Copia el prompt en tu idioma en tu asistente de IA (Claude, por ejemplo), rellena las tres líneas de arriba y
adjunta o pega [FORMAT.md](FORMAT.md) y [example/vitamins.json](example/vitamins.json) si tu asistente puede
leer archivos. Los asistentes que pueden buscar en internet o en Wikipedia/Wikidata dan resultados mucho mejores.

---

## English

```text
TOPIC: <what the tree is about, e.g. "the volcanoes of the world, by type and region">
SIZE: <roughly how many nodes, e.g. "about 300" (minimum 20 with articles, maximum 5,000)>
MY NAME (to credit): <your name as you want it shown>

You are helping me build a "community tree" for WikiTrees (https://github.com/Aruvaro-Chulvi/WikiTrees),
a project of Offlined. A tree organises a topic into branches and leaves, and every node links to its exact
Wikipedia article in 10 languages: en, es, fr, pt, it, de, ru, zh, hi, ar.

Produce ONE JSON file in the format "wikitrees-community/1":
{"format": "wikitrees-community/1",
 "meta": {"slug": "...", "author": "...", "category": "...", "emoji": "...",
          "i18n": {"en": {"title": "...", "description": "..."}, ... all 10 languages}},
 "tree": {root node}}

Each node: {"i18n": {"<lang>": {"title": "...", "wiki": "..."}, ... all 10 languages},
            "noWiki": ["<lang>", ...] (only if needed), "children": [ ... ] (only if it has any)}
- slug: 2-40 characters, a-z 0-9 _ only.
- category: one of natlife, human, geo, education, history, art, food_nutrition, misc.
- title: the natural name in that language (plain text, up to 150 characters).
- wiki: the EXACT title of the Wikipedia article about exactly that node, in that language's Wikipedia
  (spaces, no URL, no #section). Take it from the article's interlanguage links or the Wikidata item's
  sitelinks. NEVER invent or translate a title: if you are not sure the article exists, check it.
- If a language has no article for exactly that node, put the language in "noWiki", leave "wiki" out, and
  still give a good title in that language.
- No lists, no disambiguation pages, no broader article, no section of another article.
- Two children of the same node must not link to the same article.
- Limits: at most 5,000 nodes, 12 levels below the root, 400 children per node; at least 20 nodes with an
  article in every language. No other keys than the ones above.

Work step by step: first propose the structure (branches) and wait for my OK; then build it branch by branch,
checking the articles; finally give me the complete JSON file to download. Tell me which nodes you could not
verify.
```

## Español

```text
TEMA: <de qué trata el árbol, p. ej. "los volcanes del mundo, por tipo y región">
TAMAÑO: <cuántos nodos más o menos, p. ej. "unos 300" (mínimo 20 con artículo, máximo 5.000)>
MI NOMBRE (para el crédito): <tu nombre tal como quieres que aparezca>

Me vas a ayudar a hacer un "árbol de la comunidad" para WikiTrees (https://github.com/Aruvaro-Chulvi/WikiTrees),
un proyecto de Offlined. Un árbol organiza un tema en ramas y hojas, y cada nodo enlaza con su artículo
exacto de Wikipedia en 10 idiomas: en, es, fr, pt, it, de, ru, zh, hi, ar.

Genera UN archivo JSON con el formato "wikitrees-community/1":
{"format": "wikitrees-community/1",
 "meta": {"slug": "...", "author": "...", "category": "...", "emoji": "...",
          "i18n": {"en": {"title": "...", "description": "..."}, ... los 10 idiomas}},
 "tree": {nodo raíz}}

Cada nodo: {"i18n": {"<idioma>": {"title": "...", "wiki": "..."}, ... los 10 idiomas},
            "noWiki": ["<idioma>", ...] (solo si hace falta), "children": [ ... ] (solo si tiene)}
- slug: 2-40 caracteres, solo a-z 0-9 _.
- category: una de natlife, human, geo, education, history, art, food_nutrition, misc.
- title: el nombre natural en ese idioma (texto normal, hasta 150 caracteres).
- wiki: el título EXACTO del artículo de Wikipedia sobre exactamente ese nodo, en la Wikipedia de ese idioma
  (con espacios, sin URL, sin #sección). Sácalo de los enlaces a otros idiomas del artículo o de los
  sitelinks del elemento de Wikidata. NUNCA inventes ni traduzcas un título: si no estás seguro de que el
  artículo existe, compruébalo.
- Si en un idioma no hay artículo de exactamente ese nodo, pon el idioma en "noWiki", no pongas "wiki" y da
  igualmente un buen título en ese idioma.
- Nada de listas, páginas de desambiguación, artículos más generales ni secciones de otro artículo.
- Dos hijos del mismo nodo no pueden enlazar al mismo artículo.
- Límites: como mucho 5.000 nodos, 12 niveles bajo la raíz y 400 hijos por nodo; al menos 20 nodos con
  artículo en cada idioma. No uses más claves que las de arriba.

Trabaja paso a paso: primero propón la estructura (las ramas) y espera mi visto bueno; después constrúyelo
rama a rama comprobando los artículos; al final dame el archivo JSON completo para descargar. Dime qué nodos
no has podido comprobar.
```
