# Guide Fetching

CLI tool that downloads raw guide HTML from a source. Stores raw HTML pages plus a manifest. Spawned as a child process by the job queue (and by the direct-download controller). Fetch and parse are separate phases so a parser fix can re-run against cached HTML without re-downloading.

Sources: `gamefaqs` (default/fallback), `ign`, `steam`, `game8`, `gamerguides`, `fandom`, `neoseeker`, `thegamer`.

## Data flow

1. Job queue (or `beginDownload`) spawns `process.execPath` on `fetch-guide.js` with named flags: `--url <u> --steam-id <id> --source <src> --guide-id <id> [--force]`.
2. `fetch-guide.js` derives `guideId` from the URL per source (`guideIdFromUrl`) if `--guide-id` is absent, then dynamically imports the source fetcher (`{source}/fetcher.js`; unrecognized → `gamefaqs`).
3. Fetcher performs source-specific BFS/pagination to enumerate the guide's pages/sections.
4. Each page is saved as raw HTML to `guides/{steamId}/{source}/{guideId}/_raw/{file}`. Crawling sources also save the entry page as `_index.html`.
5. Progress lines go to stdout. The queue scrapes `[n/N]` for the download bar, or honours an explicit `[PROGRESS] {"bar":"download",…}` emit when the page total isn't known up front.
6. `_manifest.json` is written to `_raw/` — guide metadata, page list, `fetchedAt`, `sourceUrl`.
7. `fetch-guide.js` forces `process.exit(0)` after flushing stdout so the parent's child `close` fires promptly (browser/keep-alive sockets otherwise keep the loop referenced).

### Source dispatchers
Each source has its own `fetcher.js`:
- **gamefaqs** — Puppeteer + stealth; BFS from the guide root
- **ign** — wiki page/section enumeration; saves `_index.html`
- **game8**, **gamerguides** — JS-heavy paginated HTML via Puppeteer
- **fandom** — MediaWiki-style wiki page BFS (unbounded — the `MAX_PAGES` cap is the real guard)
- **neoseeker** — multi-page HTML walkthroughs
- **thegamer** — directory page set + a bounded related-article BFS (see `parsing.md`); maintains `_raw/_crawl-cache.json`
- **steam** — single Steam Community shared-file page

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/guides/tools/fetch-guide.js` | CLI entry, guideId derivation, source dispatch |
| `src/lib/server/relay/guides/{source}/fetcher.js` | Per-source download logic |
| `src/lib/server/relay/guides/config.js` | `defaults` (fetch delays, UA, timeout) + `applyCliOverrides` |
| `src/lib/server/relay/guides/tools-dir.js` | `TOOLS_DIR` — where the spawned tools live |

## Storage layout

Root is `featureDir('guides')` = `relayDataRoot()/guides`. `relayDataRoot()` is `$RELAY_DATA_ROOT` if set (prod `/mnt/data-dir/gaming-journal/relay`), else `$DATA_DIR/relay`.

```
{RELAY_DATA_ROOT}/guides/
  {steamId}/
    {source}/
      {guideId}/
        _raw/
          _manifest.json        ← { pages[], fetchedAt, sourceUrl, … }
          _index.html           ← entry page (ign/game8/gamerguides/fandom/neoseeker/thegamer)
          _crawl-cache.json     ← thegamer only: dead slugs, tag allowlist, per-page links/tags
          {file}.html           ← one file per page
```

## Common questions

**Q: Why is raw HTML stored rather than parsed in the fetcher?**
Separating fetch and parse allows re-parsing without re-downloading. A parser fix only needs the parse phase re-run against the cached `_raw/`.

**Q: Does re-running re-fetch everything?**
Fetchers skip pages already on disk; `--force` re-downloads. But note: the job queue always runs `fetch-guide.js` before `parse-guide.js`, so re-enqueueing does hit the network. To re-parse only, run `parse-guide.js` directly (see `parsing.md`).

## Gotchas

- Most fetchers drive Puppeteer directly (no shared server browser in the fold-in). Each spawned tool owns its own browser lifecycle and exits `0` when done.
- gamefaqs has anti-bot measures; the fetcher uses stealth, randomized delays (`config.js` `delayMinMs`/`delayMaxMs`), and screen-property spoofing. Aggressive re-fetching risks an IP block.
- `_manifest.json` isn't validated by the queue — a failed mid-fetch leaves a partial `_raw/`. The parse phase reads whatever is there.
- `fetch-guide.js` hard-requires `process.env.DATA_DIR` even though the output path resolves through `featureDir()` (which prefers `RELAY_DATA_ROOT`). The spawn inherits `process.env`, so DATA_DIR must be present in the app's env.
- Per-source `MAX_PAGES`/`MAX_ARTICLES` runaway guards are all `1000`; truncation is logged, not silent. `fandom` (unbounded BFS) leans on this hardest; `thegamer`/`gamerguides` are intrinsically bounded.
