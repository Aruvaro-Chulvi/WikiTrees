# WikiTrees community tree — file format

*Format version: `wikitrees-community/1`. This page is written so that a person **or an AI assistant** can
follow it exactly. [CONTRIBUTING.md](../CONTRIBUTING.md) explains how to send a tree.*

A community tree is **one JSON file** (UTF-8) with three keys:

```json
{
  "format": "wikitrees-community/1",
  "meta": { ... },
  "tree": { ... }
}
```

No other keys are allowed anywhere: the checker rejects unknown keys.

## `meta`

| Key | Required | Rules |
|---|---|---|
| `slug` | yes | Short name of the tree: 2–40 characters, only `a-z`, `0-9` and `_` (e.g. `volcanoes`). It cannot be the name of an official tree. |
| `author` | yes | The name we will credit, as you want it shown (up to 60 characters). |
| `category` | yes | One of `natlife` (Nature & Life), `human` (Human Body & Health), `geo` (Geography & Society), `education` (Education & Knowledge), `history` (History & Culture), `art` (Art & Entertainment), `food_nutrition` (Food & Nutrition), `misc` (Various & Curious). |
| `emoji` | no | One emoji for the tree's card (e.g. `"🌋"`). |
| `i18n` | yes | For **each of the 10 languages**: `{"title": "…", "description": "…"}`. Title up to 80 characters, description up to 300, plain text. |

## `tree`: the nodes

`tree` is the root node. Every node is an object:

```json
{
  "i18n": {
    "en": { "title": "Stratovolcano", "wiki": "Stratovolcano" },
    "es": { "title": "Estratovolcán", "wiki": "Estratovolcán" },
    "fr": { "title": "Stratovolcan",  "wiki": "Stratovolcan" },
    "pt": { "title": "Estratovulcão", "wiki": "Estratovulcão" },
    "it": { "title": "Stratovulcano", "wiki": "Stratovulcano" },
    "de": { "title": "Schichtvulkan", "wiki": "Schichtvulkan" },
    "ru": { "title": "Стратовулкан",  "wiki": "Стратовулкан" },
    "zh": { "title": "层状火山",       "wiki": "层状火山" },
    "hi": { "title": "स्ट्रैटोज्वालामुखी" },
    "ar": { "title": "بركان طبقي",     "wiki": "بركان طبقي" }
  },
  "noWiki": ["hi"],
  "children": [ ... ]
}
```

| Key | Required | Rules |
|---|---|---|
| `i18n` | yes | **All 10 languages**: `en`, `es`, `fr`, `pt`, `it`, `de`, `ru`, `zh`, `hi`, `ar`. |
| `i18n.<lang>.title` | yes | The name shown in that language. Plain text, up to 150 characters, natural and correctly spelled in that language. |
| `i18n.<lang>.wiki` | yes, unless the language is in `noWiki` | The **exact title** of the Wikipedia article in that language, as it appears on `<lang>.wikipedia.org` (spaces, not underscores; no URL; no `#section`). |
| `noWiki` | no | Languages in which there is **no** article for exactly this topic. For those languages leave `wiki` out. |
| `children` | no | The sub-nodes. Leave it out on leaves. |
| `id` | no | An optional stable identifier of your own. |

### The rules about articles (the important part)

1. **Exact articles only.** `wiki` must be the article about *exactly* this node, in that language's Wikipedia.
   Not a broader article, not a list, not a disambiguation page, not a section of another article.
2. **Never invent or translate titles.** Each language's `wiki` must come from that Wikipedia (the
   "Languages" links of the article, or the Wikidata item's sitelinks). A translated title that is not an
   article is an error.
3. **If there is no exact article in a language**, put that language in `noWiki` and still write a good
   `title` in that language. In WikiTrees, a leaf without an article is hidden in that language; a branch
   without an article is shown as a plain label.
4. **Two children of the same node cannot link to the same article.**
5. Redirects are accepted (they are reported as a note), but prefer the article's real title.

### Limits

- Up to **5,000 nodes**, up to **12 levels** below the root, up to **400 children** per node.
- At least **20 nodes with an article in every language**.
- The file can be up to 10 MB.

## Optional cover image

A PNG, 64–2048 px on each side (2:1 looks best, e.g. 1024×512, like the official covers), up to 600 KB, that **you made or have the
right to share** under the WikiTrees licence. Without a cover, WikiTrees and Offlined draw one with the
tree's emoji.

## Checking your file

- In the browser: open the **[web checker](https://aruvaro-chulvi.github.io/WikiTrees/community-kit/check.html)**,
  drop your file, check the links and preview the tree.
- With Python 3.9+ (no extra packages): `python community-kit/wikitrees_check.py check my_tree.json --online`

A complete, valid example: [example/vitamins.json](example/vitamins.json).
