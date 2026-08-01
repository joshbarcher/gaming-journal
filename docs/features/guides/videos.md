# Guides — YouTube videos (Tributary)

Guides routinely embed a video: Steam authors drop one into a section, IGN links one mid-sentence. Every route in was being deleted by the parser, so a downloaded guide silently lost content — a section that was nothing but a video came out empty. They now survive as `video` ContentBlocks (rendered as a poster-frame card) and preserved inline links, both of which open in Tributary's modal player over the guide rather than sending the reader to youtube.com. Tributary is the user's own YouTube front-end at `https://tributary.home` (repo: `C:\dev\tributary`, integration contract: its `docs/general/embedding.md`); the communities app embeds it the same way.

## What used to eat them

| Embed | Killed by |
|-------|-----------|
| `<iframe src=".../embed/ID">` | `ALWAYS_REMOVE` in html-cleaner — removed with its subtree before parsing |
| `<div class="sharedFilePreviewYouTubeVideo" id="ID">` (Steam) | `collapseEmpties` — Steam's embed is an *empty* div (the id **is** the video id), so it looked like a spent wrapper |
| `<a href="youtube.com/watch?v=ID">` | The external-link policy (`cfg.links.keepExternal === false`) replaced the anchor with its text |

## Data flow

```
1. loadAndClean → markVideoEmbeds($)      iframe + Steam div → <div data-yt-video="ID">
                                          (runs BEFORE ALWAYS_REMOVE / collapseEmpties)
2. collapseEmpties                        skips [data-yt-video] — empty by design
3. cleanInlineHtml                        YouTube <a> keeps its href, gains data-yt="ID"
4. parseContent                           [data-yt-video] → { type:'video', videoId, url, thumb }
5. collectImageBlocks                     yields block.thumb, so downloadImages fetches the
                                          poster frame into {section}/img/ and convertImgDir
                                          makes the .webp — same path as any guide image
6. GuideBlockRenderer                     video block → GuideVideo.svelte (poster + play + title)
7. GuideViewer $effect                    a[data-yt] hrefs → https://tributary.home/embed/<id>
8. click                                  openTributarySync() → Tributary.open() → modal
```

## What lands in content.json

```jsonc
{
  "type": "video",
  "provider": "youtube",
  "videoId": "14V7YEJgSeI",
  "url": "https://www.youtube.com/watch?v=14V7YEJgSeI",   // canonical — the archival record
  "thumb": { "type": "image", "role": "video-thumb", "alt": "", "localSrc": "img/001.jpg" },
  "caption": "…"                                          // only from a wrapping <figure>
}
```

Stored data names YouTube, never Tributary. The player is a *presentation* choice the viewer makes, so moving or renaming Tributary is a one-line change in `src/lib/tributary.ts` instead of a re-parse of every guide on the NAS.

## Key files

| File | Role |
|------|------|
| `src/lib/server/relay/guides/parser/html-cleaner.js` | `markVideoEmbeds`, `youtubeId`, the anchor exemption |
| `src/lib/server/relay/guides/parser/content-parser.js` | `videoBlock()` + the placeholder branches (top level, `<p>`, `<figure>`) |
| `src/lib/server/relay/guides/parser/image-downloader.js` | `srcFallback` — maxres → hqdefault |
| `src/lib/tributary.ts` | Loader bootstrap, `openTributarySync`, `tributaryEmbedUrl`, title fetch |
| `src/lib/svelte/journal/guide/GuideVideo.svelte` | The card |
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | Inline-link href rewrite + click interception (`onContentClick`) |
| `public/css/guide-viewer.css` (`.gv-video*`) | Card styling |

## Common questions

**Q: Why doesn't an existing guide show its videos?**
`content.json` is written at parse time, so a guide downloaded before this shipped has no video blocks. Re-parse it — the Re-parse button on the guides list card, or:
`DATA_DIR=… RELAY_DATA_ROOT=… node src/lib/server/relay/guides/tools/parse-guide.js --steam-id X --source Y --guide-id Z`
Dev and prod read *different* trees: without `RELAY_DATA_ROOT` a dev run rewrites `$DATA_DIR/relay/guides`, which prod never reads. Set `RELAY_DATA_ROOT=//192.168.86.74/app-data/gaming-journal/relay` or the fix never reaches the running app.

**Q: Where does the poster frame come from?**
`i.ytimg.com/vi/<id>/maxresdefault.jpg`, falling back to `hqdefault.jpg` (`thumb.srcFallback`) — YouTube only stores maxres for some videos. It is downloaded at parse time into the section's `img/` dir, so a reader's browser never contacts a YouTube host. Both are 16:9-cropped by CSS; hqdefault is 4:3 with letterbox bars, and `object-fit: cover` lands on the frame.

**Q: A card shows a blank tinted box.**
Both thumbnail URLs 404'd — the video was deleted or made private since the guide was written. The card still links to the player, which will say so.

**Q: Why isn't the video's title in `_fulltext.json`?**
Titles live on Tributary (`/api/video/<id>`) and are fetched at render, not parse — nothing about a video id tells you its title offline. Only a `<figure>` caption is indexed.

**Q: Does the modal work if Tributary is down?**
No, and it isn't supposed to fake it. `openTributarySync` returns false, the click isn't swallowed, and the browser follows the href to Tributary's own player page. There is deliberately no youtube.com fallback in the UI — same posture as the communities app.

## Gotchas

- **`markVideoEmbeds` must stay ahead of `ALWAYS_REMOVE`.** Move it after and every iframe embed disappears again, silently — nothing errors, the video is just gone.
- **`aspect-ratio` alone doesn't crop.** The poster `<img>` is `position: absolute` inside the 16:9 box; in flow, its intrinsic 4:3 height wins over the ratio and the letterbox bars come back.
- **The loader is preloaded, not loaded on click.** A click handler has to choose between the modal and the link synchronously; awaiting the script would mean either a swallowed click that opens nothing or a popup-blocked `window.open`. Pages with video call `preloadTributary()` on render.
- **Video poster frames are excluded from the landing mosaic** (`role: 'video-thumb'`) — they are letterboxed and read as a mistake among screenshots.
- **The React Native guide viewer doesn't render `video` blocks yet.** It will skip them, the same way it skips any unknown type — parity work, not a regression.
