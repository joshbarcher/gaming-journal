# Steam Source

Steam community guides load all sections in a single page. Guide ID is the numeric `publishedfileid`.

## Guide ID & URL shape

```
Guide: https://steamcommunity.com/sharedfiles/filedetails/?id={publishedfileid}
```

The `id` parameter is the guide ID (e.g. `2867472246`). No per-section URLs — all sections live on one page.

## Site DOM structure

```
div.guide.subSections
  div.subSection.detailBox[id="{sectionId}"]   ← one per authored section
    div.subSectionTitle                          ← section heading (not in per-section files)
    div.subSectionDesc                           ← BBCode-rendered content  ← content selector

div.rightbox_list_option[id="guideSectionSelection_{sectionId}"]
  div.guideSubSectionSelectionLink              ← nav label text
```

Skip `sectionId="0"` (Steam's "show all" overview) and `sectionId="-1"` (comments thread).

## Fetch strategy

Single Puppeteer fetch. No BFS — one page has everything.

1. Set `birthtime` + `mature_content` cookies before navigation (bypasses age gates).
2. Fetch the guide page; extract `extractSections` from `.rightbox_list_option` sidebar nav.
3. For each section: call `buildSectionHtml` to extract `.subSectionDesc` HTML + embed guide title/author.
4. Write one `{slug}.html` file per section. Also save `_raw.html` (full page, unused by parse step).
5. Write `_manifest.json`.

Duplicate section labels get a `-{sectionId}` suffix on their slug.

## Parse preprocessing

BBCode heading divs → standard HTML headings (before content parser sees them):
```
<div class="bb_h1">…</div>  →  <h1>…</h1>
<div class="bb_h2">…</div>  →  <h2>…</h2>
<div class="bb_h3">…</div>  →  <h3>…</h3>
<div class="bb_hr" />       →  <hr>
```

## Image handling

Images are wrapped in `<a class="modalContentLink">` (Steam's popup viewer).
`unwrapSelectors: ['a.modalContentLink']` strips the wrapper before junk removal, leaving the `<img>` in place.
`img.src` already points to the full-size Steam CDN URL — no `transformImageUrl` needed.
`needsBrowserImageCapture = false`.

## Per-section file structure

Each section file embeds hidden metadata so `extractTitle`/`extractAuthor` work on any single file:
```html
<div class="workshopItemTitle">{guide title}</div>
<div class="friendBlockContent">{author name (pre-cleaned)}</div>
<div class="subSectionDesc">{section content}</div>
```

Author raw text includes `"\nOffline"` / `"\nOnline"` — the fetcher takes only the first line before embedding.

## Nav tree

Built entirely from `manifestPages` — no DOM reading. Each manifest entry has `{ slug, label, sectionId }`. Labels come from Steam's nav sidebar text, not from parsing the content.

## Search strategy

Steam Published File API — no browser needed:
```
GET https://api.steampowered.com/ISteamPublishedFileService/QueryFiles/v1
    ?file_type=9       (guides)
    &query_type=1      (popularity sort)
    &search_text={gameName}
```

Returns `publishedfileid` values directly.

## Key files

| File | Role |
|------|------|
| `relay-server/src/services/guides/steam/adapter.js` | Selectors, BBCode preprocessing, nav from manifest |
| `relay-server/src/services/guides/steam/fetcher.js` | Single-page fetch, section slicing, file writing |
| `relay-server/src/services/guides/steam/search.service.js` | Published File API search |

## Gotchas

- Steam guides have **no internal cross-section links** — `rewriteInternalLinks` is a no-op.
- `_raw.html` is saved for reference but parse-guide.js never reads it; it always reads per-section files.
- If a `subSection[id]` is missing from the DOM (rare — sometimes a section has no body), `buildSectionHtml` returns `null` and that section is skipped with a console warning.
- The manifest includes `title` and `author` at the top level (not just in pages) — useful for display without opening a section file.
