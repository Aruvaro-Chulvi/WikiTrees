# Contributing a community tree

*[Español](CONTRIBUTING.es.md)*

Anyone can propose a new tree for WikiTrees. If the maintainer approves it, it is published as a
**community tree**: it appears in the [web viewer](https://aruvaro-chulvi.github.io/WikiTrees/) and anyone
can download it from **Offlined** (WikiTrees → *Community WikiTrees*).

The 26 official trees are part of Offlined and are not edited by the community. If you find a wrong link in
one of them, use the [wrong link form](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=wrong-link.yml).

## How it works

1. **Build your tree with an AI assistant.** Copy the [prompt](community-kit/PROMPT.md) into your assistant
   (Claude, for example), fill in the topic, the size and your name, and give it [FORMAT.md](community-kit/FORMAT.md)
   and the [example](community-kit/example/vitamins.json). You will get one `.json` file.
   You do not need to know how to program, but **you are responsible for the result**: read it.
2. **Check it.** Open the **[web checker](https://aruvaro-chulvi.github.io/WikiTrees/community-kit/check.html)**,
   drop your file, press *Check the links* and look at the preview. Fix what it reports (your assistant can
   help: paste the errors back to it). Every node needs a title in the 10 languages, and an exact Wikipedia
   article in each language or that language in `noWiki`.
3. **Send it.** Open the **[“New community tree” form](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=new-tree.yml)**
   (you need a free GitHub account), attach the `.json` file (and a cover image if you have one) and choose
   the [licence](#licence) of your tree.
4. **Automatic check.** A bot checks the file again, including every link against Wikipedia, and replies in
   your issue. If there are errors, fix the file and **edit the issue** with the new attachment: it is
   checked again. When it passes, the bot opens a pull request with your tree.
5. **Review.** The maintainer reviews the tree by hand (topic, structure, titles and links) and may ask you
   for changes or correct small things. When it is approved and merged, it is published within minutes.

You can also open a pull request yourself: add `community/<your-github-user>.<slug>/tree.json` (and
optionally `cover.png`), with your GitHub user in lowercase and `-` replaced by `_`. Put the licence in
`meta.license` (`CC-BY-4.0` or `CC0-1.0`) and tick the confirmation boxes in the pull request description.

## What makes a good tree

- A clear topic that **is not already covered** by an official tree, with a sensible hierarchy
  (branches that really contain their children).
- Nodes that have Wikipedia articles: WikiTrees is a way to explore Wikipedia.
- Natural titles in every language — not word-for-word translations.
- Neutral and suitable for everyone: Offlined is used by families and schools. Trees about living people,
  politics or religion are welcome only if they are factual and neutral; offensive, hateful or adult content
  is rejected.

## Licence

Your tree stays yours. You publish it, and its cover, under the licence you choose in the form:

- **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)** (the default): anyone may use, share and adapt it,
  also commercially, as long as they **credit you** by the name in `meta.author`.
- **[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)**: you give up your rights; anyone may use it
  for anything, without conditions. WikiTrees and Offlined will still show your name.

Both let WikiTrees publish your tree and let Offlined include it in the application, also if Offlined is sold
one day; that is why a licence that forbids commercial use is not offered. This is different from the 26 official
trees, which are under [CC BY-NC-SA 4.0](LICENSE): do not copy them into a community tree. The tools in
`community-kit/` are under the [MIT licence](community-kit/LICENSE).

## Withdrawal and problems

To report a problem with a published community tree, use the
[community tree problem form](https://github.com/Aruvaro-Chulvi/WikiTrees/issues/new?template=community-report.yml).
The maintainer can withdraw a tree by deleting its folder or listing it in `community/retired.json`;
Offlined then stops offering it.
