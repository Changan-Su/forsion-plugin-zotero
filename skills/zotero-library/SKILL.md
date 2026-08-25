---
name: zotero-library
description: Use when the user asks about their own Zotero library on this machine — "do I have anything on X", "what did I save about diffusion models", "read me the reading note for that paper", "who wrote the one I filed under Methods", or when they ask you to check or summarise a reading note the 文献工作台 (Zotero Workbench) plugin created. Zotero's local API only answers on loopback, so this skill also tells you how to reach it and what you must never write.
version: 1.0.0
author: Forsion
category: Forsion
---

# Zotero library (文献工作台)

Zotero 7 runs a **local HTTP API on this machine** — no key, no cloud round trip. The Forsion
文献工作台 plugin is one client of it; with `run_bash` you are another. This skill covers the read
side (yours) and draws a hard line around the write side (the plugin's).

## 1. Reading the library — `run_bash` + `curl`, never `web_fetch`

Base URL: `http://localhost:23119/api/users/0` — always `users/0`, whatever account the user has.
23119 is the default port; the user can change it in Zotero and mirror it in the plugin settings,
which you cannot read. If 23119 refuses, say so; **do not scan ports and do not guess.**

```sh
B=http://localhost:23119/api/users/0
# search — let curl URL-encode the query; a term with a space, a quote or any CJK breaks a hand-built URL
curl -s --max-time 5 --get "$B/items" --data 'itemType=-attachment' --data 'limit=100' --data-urlencode 'q=<term>'
curl -s --max-time 5 "$B/collections?limit=100"
curl -s --max-time 5 "$B/items/<ITEM_KEY>/children?limit=100"   # notes + annotations
```

- **Keep `--max-time`.** A firewalled port makes the connection hang rather than refuse; the plugin
  runs the same 5s guard for the same reason.
- **`limit=100` is a ceiling, not a total.** Multi-object endpoints default to 25 and cap at 100;
  there is no pagination here. Exactly 100 results means "at least 100" — say that, never report it
  as the size of their library.
- **Do not use `web_fetch` for this.** It resolves and pins public IPs and rejects loopback by
  design, so it returns a refusal that has nothing to do with whether Zotero is running. Reading its
  error as "Zotero isn't available" is the specific wrong conclusion this section exists to prevent.
- **No `run_bash` → you cannot check, which is not the same as "Zotero is not running".** In a cloud
  session or a thin worker there is genuinely no Zotero. In plan mode you are on the user's own
  machine and the tool is merely hidden — say you cannot probe this round and point at the workbench;
  do not report the library as unavailable.

If the request is refused outright, the likely cause is the switch: Zotero 7 → 设置 → 高级 →
「允许本机其他应用与 Zotero 通信」.

## 2. Reading notes on disk (so you can read them, not rewrite them)

The plugin writes one reading note per item, at `<work folder>/<cite name>.md` — work folder
defaults to `文献工作台/`, and every plugin gets a 「工作文件夹」 row on its detail page, so the
user may have renamed it and you cannot read that setting from here.

```markdown
---
zt_key: "ABCD1234"
zt_title: "Attention Is All You Need"
zt_authors: "Vaswani 等"
zt_year: "2017"
zt_doi: "10.48550/arXiv.1706.03762"
---

> [在 Zotero 中打开](zotero://select/…)

## 划线与批注
一条划线的正文
<!-- zann:XYZ789 -->

## AI 速览
…

## 我的笔记
…the user's own writing, to the end of the file…
```

**The section headings are Chinese string constants and do not follow the UI language** — the plugin
pins every disk-facing string to Chinese on purpose, because these headings are the parse anchors and
the idempotency sentinels for annotation import. A note written while the app was in English looks
exactly the same. Match `## 划线与批注` / `## AI 速览` / `## 我的笔记` literally; do not look for
"Highlights".

`<!-- zann:KEY -->` after an annotation line is the import sentinel: it is how re-importing stays
idempotent. `## 我的笔记` is the user's free-form area and runs to end of file.

## 3. Hard limits — what belongs to the plugin

- **Never create a reading note, and never rewrite one wholesale.** Note creation goes through the
  plugin's claim-by-cite-name logic plus `.zotero-index.json`; a note you invent will not be claimed,
  and the next import will build a *second* note for the same item — after which the user's own
  writing in the first one is invisible to them.
- **Never read or write `.zotero-index.json`.** It is plugin-internal and self-heals when the
  workbench opens.
- **Never add, delete or edit a `<!-- zann:KEY -->` line**, and never hand-write annotation lines.
- **Never touch `## 我的笔记` or anything below it.** Not one byte. That area is the user's.
- **Never assemble `.bib` or `.csl.json` yourself.** LaTeX escaping, title-case protection and cite-key
  disambiguation are deterministic algorithms living in the plugin; a prose reimplementation of them
  drifts silently and the user only finds out when biber chokes. Send them to the export buttons.
- Reading notes are ordinary Amadeus notes, so the general note-editing discipline in
  `amadeus-note-format` applies on top of this section.

There is no exception to the `## 我的笔记` rule, not even an explicit request: that area is the one
place in the note the plugin never rewrites, which is exactly why the user's own writing survives
there. If they want you to add something to it, tell them to paste it in themselves.

## 4. Routing

| The user wants | What to do |
|---|---|
| To find something, or to know an item's metadata — "do I have anything on X", "who wrote it", "what year" | Do it yourself with §1 and answer. No plugin needed. |
| To read or summarise an existing reading note | Read it with `read_file` per §2 and answer. |
| To create a reading note, import highlights, insert a citation, or export `.bib` / `.csl.json` | Send them to the command palette 「文献工作台:打开」 and the buttons on the item card (citation insert also has its own command, 「文献工作台:插入引用(检索)」). Say why: those actions own on-disk state you must not fabricate. |
| A citation as plain text | Still the plugin — the item card's 「复制引用」 (the insert button degrades to copy on its own when there is no block surface). Do not compose the citation line yourself; a drifted one gets pasted into a manuscript and nothing reports it. |

## Self-check before delivering

- [ ] I reached Zotero with `run_bash` + `curl`, not `web_fetch`.
- [ ] If a result set hit 100, I said it may be truncated instead of reporting it as a total.
- [ ] I created no reading note, touched no `zann` sentinel, and wrote nothing under `## 我的笔记`.
- [ ] I composed no `.bib`, no `.csl.json` and no citation line by hand.
- [ ] Every claim about an item came from the API or from a note I actually read.
