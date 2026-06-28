# Game8 Source

Game8 is an article-wiki with numeric archive IDs per page. Guide ID is the game slug from the URL.

## Guide ID & URL shape

```
Index:   https://game8.co/games/{gameSlug}
Article: https://game8.co/games/{gameSlug}/archives/{numericId}
```

Guide ID = `gameSlug` (e.g. `Octopath-Traveler-2`). Page slugs = numeric archive IDs (e.g. `404331`).

## Site DOM structure

```
.p-archiveContent__main    ← article body  ← content selector
.p-archiveHeader           ← title/author chrome  (stripped as junk)
.p-archiveBody__side       ← right sidebar  (stripped as junk)
```

Content selector tried in order: `.p-archiveContent__main` → `.p-archiveBody__main` → `article` → `main`.

## Fetch strategy

Puppeteer (stealth). BFS from game index page. Max 600 articles.

1. Fetch `game8.co/games/{gameSlug}` index page; save as `_index.html`.
2. `extractArchiveLinks` scans the index for archive links, tracking h2 headings as group labels.
3. BFS: for each queued article, fetch → save `{archiveId}.html`, then scan the page for more archive links (with that article's label as `defaultGroup`).
4. Write `_manifest.json` with `{ slug, label, group, url, file }` per page.

## Parse preprocessing

Two transforms applied before content parsing:

1. **Lazy image promotion** — `data-src` contains the real URL; placeholder `src` is a 1px GIF:
   ```
   src="data:image/gif…"  →  removed
   data-src="real.jpg"    →  src="real.jpg"
   ```

2. **Fragment anchor rewrite** — Game8 uses `id="hl_N"` on headings and `href="#hl_N"` on TOC links. `preprocessRawHtml` builds a `hl_N → slug` map from the heading text, then rewrites anchors so intra-page links resolve after the content parser renames heading IDs.

## Image handling

`needsBrowserImageCapture = false` — images load from `assets.game8.co` via plain HTTP after `data-src` is promoted. No Puppeteer capture needed.

## Nav tree

Built from manifest pages. If any page has a `group` field (set during BFS from index h2 headings), the tree is grouped:
```js
{ type: 'group', label: groupName, children: [{ type: 'link', slug, label }] }
```
Otherwise flat `type: 'link'` list.

## Search strategy

Puppeteer — searches `game8.co` for the game, identifies the game's guide hub URL, returns it.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/game8/adapter.js` | Selectors, lazy image + fragment preprocessing, grouped nav |
| `relay-server/src/services/guides/game8/fetcher.js` | Puppeteer BFS, h2-grouped manifest |
| `relay-server/src/services/guides/game8/search.service.js` | Game8 site search |

## Gotchas

- Group labels come from h2 elements on the **index page only**. Articles discovered by BFS from a non-index page inherit their parent article's label as `defaultGroup`, not a new h2 group.
- Archive IDs are numeric strings used as-is for slugs and filenames — no slug normalization needed.
- `rewriteInternalLinks` strips archive links for pages not in `knownSlugs` to `#` (not live URLs). Game index links (`/games/{slug}` without `/archives/`) always become `#`.
- The `hl_N` → heading-slug rewrite only works within a single page — cross-page `#hl_N` anchors (if any) will resolve to `href=""` after the rewrite.
