# Guide Refreshing

Users can re-download a guide that's already on disk — typically to pick up newly discovered pages or fix parse issues — without re-fetching every page from the network.

## Refresh vs. Re-parse

Two distinct actions, easily confused:

| | **Refresh** (Guides modal) | **Re-parse** (guides list card) |
|---|---|---|
| Entry point | Guides modal, circular-arrow button | Guides **list** page, refresh icon top-right of each card |
| Runs | `fetch-guide.js` (no `--force`) **then** `parse-guide.js` | `parse-guide.js` **only** |
| Touches the network | Yes — for pages missing from `_raw/` | **Never** |
| Finds new upstream pages | Yes | No |
| Use when | Pages are missing, or the source added pages | An adapter/parser fix needs to reach existing `content.json` |

Re-parse posts `{ mode: 'reparse' }` to the job queue, which skips the fetch phase entirely
(see [../../server/guides/job-queue.md](../../server/guides/job-queue.md)). It appears in the
Downloads page like any other job, badged **Re-parse**, with the Fetch bar omitted since no
fetch happens. This replaces the old advice below of dropping to the CLI for a parse-only run.

Implemented on **both** web (`GuidesList.svelte`) and native
(`app/(drawer)/journal/[appid]/guides/index.tsx`).

## Data flow

Same pipeline as a fresh download (see [downloading.md](downloading.md)), with one key difference: **fetch-guide.js runs without `--force`**, so pages whose `.html` file already exists in `_raw/` are read from disk rather than re-fetched.

1. User opens Guides modal → existing guide shows **Open ›** button + circular arrow **Refresh** icon
2. Clicking Refresh calls `downloadGuide(guide)` → `jobStore.enqueue()` → same job queue as a fresh download
3. fetch-guide.js runs: for each page in BFS order —
   - If `_raw/{slug}.html` exists: read from disk, mark `servedFromCache = true`
   - If missing: fetch from network, save to `_raw/`
   - Either way: scan the page for newly reachable sub-pages and add them to the BFS queue
4. parse-guide.js re-runs on all pages (both cached and newly fetched), rewriting `content.json` and `_meta.json`

The net effect: only genuinely missing pages hit the network; everything else uses local cache.

## When to refresh

- **Missing pages**: a page linked in guide content returns empty (no `content.json`). This typically means it wasn't discovered during the original BFS — refresh will find and fetch it.
- **Parse fix**: a bug in the adapter/parser was fixed and you want updated `content.json` without re-fetching HTML. Use **Re-parse** on the guides list card (above) — it runs `parse-guide.js` alone. Refresh is the wrong tool here: it also runs the fetch step. (Historically this meant dropping to the CLI with `parse-guide.js --no-images`; that's no longer necessary from the UI.)
- **New pages added upstream**: the source added new pages to the guide since original download.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuidesModal.svelte:227` | Refresh button (`gm-refresh-btn`) — calls `downloadGuide()` |
| `relay-server/src/services/guides/ign/fetcher.js:228` | BFS loop — cache-or-fetch logic, sub-page discovery |
| `relay-server/src/services/guides/ign/adapter.js:203` | `extractNavLinksFromDoc` — scans sidebar + article body for page links |

## Common questions

**Q: Does the relay server need to restart to pick up fetcher.js changes before refreshing?**
No. The fetch/parse tools are spawned as child processes, so they re-import the updated adapter/fetcher from disk on each run.

**Q: Why is a previously empty page still empty after refresh?**
Most likely causes:
1. The page's `.html` was already on disk from the original fetch (possibly empty or broken). Since `force=false`, the old file is reused. Fix: delete the specific `_raw/{slug}.html` file, then refresh.
2. The page was never added to `_manifest.json` — it wasn't discovered during BFS. After the June 2026 body-scan fix, a refresh should now find body-only linked pages. If still missing, check whether the link appears in `.wiki-html` or only in JS-rendered content.

**Q: How is the Refresh button different from re-clicking Download on the same guide?**
They're identical — both call the same `downloadGuide()` function. The button label changes to distinguish intent visually, but the underlying job is the same. The `force=false` default applies in both cases.

**Q: Will refresh overwrite my pins?**
Yes — the GuidesModal warns you if the guide has saved pins before enqueueing the job. Pins are stored in `localStorage` under `guide-pins:{appid}:{source}:{guideId}`. If you confirm the re-download, pins are deleted before the job runs.

**Q: Can I refresh just one page instead of the whole guide?**
Not via the UI. Via CLI: delete `_raw/{slug}.html`, then run `node src/tools/fetch-guide.js` (without `--force`) — only the missing file gets fetched — then `node src/tools/parse-guide.js --no-images`.

## Gotchas

- **Refresh always re-runs parse-guide on all pages**, not just new ones. This is intentional — the manifest may have changed (new pages added to BFS), so `_meta.json` and the navTree need to be rebuilt from scratch.
- **The `_fulltext.json` search index is not invalidated** by a refresh. Delete it manually after a refresh that adds new pages, or it will be missing the new content until the next search request rebuilds it.
- **IGN body-scan fix (June 2026)**: pages linked only in article bodies (e.g. individual social link pages in Persona 3 Reload) were silently skipped in the original BFS. After the fix, a refresh will discover and fetch them. If a guide was downloaded before this fix, refresh is the way to pick up the missing pages without a full re-download.
