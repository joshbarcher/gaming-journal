# Native app — visual parity audit & fix plan

**Date:** 2026-07-18
**Scope:** `react-native/` (Expo Router) vs the SvelteKit web app, compared **visually** at the intended matching sizes — **web desktop (1536px)** vs **native tablet-landscape** (Galaxy Tab S10 FE+, SM-X620, 2880×1800).
**Why this doc exists:** an earlier "parity" pass was done by source-diffing + typecheck, which **cannot** see layout, navigation chrome, safe-area, or runtime errors. This audit was done by rendering both apps and comparing screenshots pair-by-pair. Treat visual side-by-side (not source-diff) as the definition of "parity" going forward.

## Method
- Web: Playwright against the live gateway `http://192.168.86.65:8061`, viewport 1536×960, full-page for detail screens.
- Native: real device over adb (`am start -a VIEW -d gamingjournal://<route>` deep-links + `exec-out screencap`), forced landscape, scrolled captures for long screens, logcat for the calendar failure.
- Reference game for game/journal/community/guide: **2161700 (Persona 3 Reload)** — it is the live "Now Playing" game, which is what surfaces the session bug.

## CORRECTED framing — tablet-landscape IS the desktop tier (reframes the whole audit)
Measured: the Tab S10 FE+ is density **320 (2.0×)**, so its 2880px long edge = **1440 DP**. `breakpointForWidth(1440)` → **`desktop`** (the web's ≥1280 tier). Tablet-landscape does **not** fall in the ≤1279 "collapse to one column" bucket — it qualifies for the **full desktop experience**, and the web at 1440 shows the multi-column hero + fluid grids + permanent sidebar.

**Therefore the single-column game/journal layouts, the 2–3-column grids, and the collapsed detail pages are parity BUGS, not faithful responsive behavior.** (An earlier draft of this doc wrongly called them "faithful," on the mistaken assumption the tablet was ≤1279.) The `desktop` tier already classifies correctly; the screens just never render a distinct desktop layout — every grid is hardcoded `mobilePortrait ? 2 : 3` (discover is even backwards: `tabletLandscape ? 3 : 2`, giving desktop only 2). `desktop` is used only for the permanent rail + a couple of home/top-games flags, never for content richness.

### Locked decisions (2026-07-18, with the user)
- **D1 — Treat tablet-landscape as a true desktop tier.** Drive grids by **available content width** (fluid, mirroring the web's `minmax(...)` auto-fill) instead of coarse tier checks — so 1440 → ~5–6 columns, and it stays correct as the rail collapses (280↔68 DP) and on other devices. Render the **desktop structural layouts** (multi-column game hero, journal grid, in-progress/backlog "Up Next" row + queue grid, community masonry) at this tier.
- **D2 — Safe-area on every page.** Nothing currently sits between the system bars (no `SafeAreaProvider` at all). Fix app-wide; verify page-by-page (S2 checklist below).
- **D3 — Context menu = anchored popover on tablet/desktop** (positioned near the card, like the web right-click menu), bottom sheet only on phone (`components/shared/LongPressMenu.tsx`).

---

## Systemic root causes (fix these first — they explain most per-screen symptoms)

### S1 — Detail routes have no navigation chrome
`src/app/_layout.tsx` is a bare `<Slot/>`. `game/[appid]`, `journal/[appid]`, `community/[appid]`, and `journal/[appid]/guides/**` are **top-level routes outside the `(drawer)` group**, so they render with **no rail, no hamburger, no header, no back** — the user is stranded. Web keeps nav on every page.
**Fix:** move the detail routes under the drawer navigator (Expo Router route group — parentheses don't change the URL), or nest a stack inside the drawer, so detail pages inherit the permanent rail at tablet-landscape (and the hamburger+overlay at narrower tiers). Files: `src/app/_layout.tsx`, `src/app/(drawer)/_layout.tsx`, and the four detail route trees.

### S2 — No safe-area insets anywhere
No `SafeAreaProvider` / `useSafeAreaInsets` / `SafeAreaView` in the app. On edge-to-edge Android 16 everything draws under the system bars:
- Bottom: page content + the drawer's bottom "Settings" item sit under the 3-button nav bar (every native shot).
- Top: the drawer's Now Playing card and the community header render under the status bar clock/battery.
**Fix:** wrap root in `SafeAreaProvider`; apply `useSafeAreaInsets().bottom` to every scroll `contentContainerStyle` (`settings.tsx` `styles.content`, `calendar.tsx` `styles.grid`, `alerts.tsx` `styles.listContent`, collections lists, detail `ScrollView`s), and top+bottom to `DrawerContent.tsx` `styles.fitted`.

### S3 — Session contract rejects null `endedAt` (breaks 3 screens while a game is playing)
`contracts/journalSessions.ts:15` = `endedAt: z.string().optional()` — `.optional()` allows `undefined` but **rejects `null`**. A live session has `endedAt: null`, so `apiGet('/relay/api/account', …)` throws Zod and the screen dies. Confirmed on Calendar (raw JSON dump replaces the grid); the **Journal session history is empty** for the same reason; **Account** likely too. Web survives because it never validates (`Calendar.svelte:185` raw `.json()`).
**Fix (one line):** `endedAt: z.string().nullish()` (or `.nullable().optional()`). `contracts/account.ts:47` already uses `.nullable()` — the two session contracts are simply inconsistent. Secondary: the native error path prints the whole Zod issue array; truncate error text so a future failure isn't a wall of JSON.

### S4 — Hour formatting keeps a spurious decimal
Native `formatPlaytime` renders `1036.0h` where web `fmtHours` rounds ≥10h to a whole number (`1036h`). Visible in every collection subtitle and most badges.
**Fix:** use a web-matching rounding helper at those call sites (HLTB estimate badges already use a correct local `hoursLabel`; only the `formatPlaytime` call sites are wrong).

### S5 — Hardcoded column counts instead of fluid grids
Native pins 2–3 columns where web uses `repeat(auto-fill, minmax(~200px,1fr))` (~5–6 at desktop). On a wide tablet native shows web's **phone** density (double-size cards, half the columns).
**Affected:** Favorites (`minmax(160px)` → ~6 cols web vs fixed 3), Abandoned (`minmax(200px)` → 5 vs 3), Completed non-Legend tiers (`minmax(180px)` → ~6 vs 3), Alerts on-sale grid (`minmax(260px)` → 4 vs `alerts.tsx:40` fixed 2).
**Fix:** compute columns from available width to match the web `minmax` targets.

---

## Per-screen findings

### Game page (`app/game/[appid]/index.tsx`, `components/game/*`)
Sections all present and correctly ordered (Trailers → About → HLTB → Player chart → Screenshots → News → Local/Steam/Community reviews → ITAD → ProtonDB → PCGW → NexusMods) — strong structural mirror.
- [CRITICAL] No nav chrome (S1).
- [MAJOR] Hero data-panel re-interpreted: web keeps score chips inside one bounded `.game-data-panel` card with stats + buttons (`GameHero.svelte:185-282`); native pulls chips into a separate row over the raw hero art with no bounded panel (`GameHero.tsx:78-135`).
- [MAJOR] ProtonDB: web = PLATINUM award-badge block; native = plain "Proton: Platinum" text chip (`GameHero.tsx:82-89`).
- [MAJOR] FlagsBar: web = icon-only toolbar (`FlagsBar.svelte:15-36`); native = wide row of text pills (`FlagsBar.tsx:12-17`).
- [MAJOR] Bottom safe-area (S2).
- [MINOR] Genre pills below the stats panel vs web above; Trailers thumbnail rail is below vs web's right-side rail; native video renders as a plain black box (no poster). Price label "Best Price $18.55 −69%" vs web "$59.99" is ITAD-load timing, not a defect.

### Journal page (`app/journal/[appid]/index.tsx`, `components/journal/*`)
Card order matches web DOM order (Rating → Achievements → LastSession → Guides → HLTB → SessionHistory → Progress → Notes → JournalPages) — faithful single-column collapse.
- [CRITICAL] No nav chrome (S1).
- [MAJOR] Session data empty (S3): "No sessions recorded yet" + "Past Sessions 0 total" where web shows a live session + 11-card rail. `getGameSessions` returns empty (same null-endedAt validation failure).
- [MAJOR] LastSession card has no "Playing Now" active variant and no game-art background. Web flips to a green, art-backed "PLAYING NOW · Xh so far · EARNED (n)" state (`LastSessionCard.svelte:34-52`; `JournalDashboard.svelte:537-544`). Native `LastSessionCard.tsx` has only the "Last Session" branch, and `index.tsx:196` never passes the active session in. The in-file comment (`index.tsx:48-54`) claiming web never passes activeSession is **stale/wrong**.
- [MAJOR] HLTB card segment-overflow render bug: `HltbCard.tsx:42-47` lays milestones in a flex row each `width: pct(h)%` (~77%+89%+96% ≈ 262%) → overflow, COMPLETE pushed off-screen, no gold fill. Web positions segments cumulatively via `leftPct`, last extends to 100%, with a gold `hltb-fill` (`JournalDashboard.svelte:186-198`).
- [MINOR] HLTB "played" pin: native adds the full active-session length (69h) vs web's elapsed-since-render (61.5h) (`index.tsx:92-99,174`). (Irony: native counts the active session for HLTB but not for LastSession.)
- [MINOR] Guides tiles: full-width vertical list vs web's 2-col grid inside the card.
- [MAJOR] Bottom safe-area (S2).

### Community (`app/community/[appid]/index.tsx`, `components/community/PostCard.tsx`)
- [CRITICAL] No nav chrome + header overlaps the top status bar (S1/S2) — `‹ Back` + title render at y≈0 over the clock/wifi (`index.tsx:246,369`).
- [MAJOR] Post layout is a different design: web = multi-column masonry **card grid** (`.community-panel { grid-template-columns: repeat(auto-fill,minmax(260px,1fr)) }`, vertical cards with a large top image); native = single-column **list rows** with a 96×72 left thumb and a bottom divider (`PostCard.tsx:77-85`).
- [MAJOR] Hero title shrunk to fontSize 16 (`index.tsx:372`) vs web's ~2.5rem serif hero.
- [MAJOR] Breadcrumb (`HOME › PERSONA 3 RELOAD › COMMUNITY`) replaced by "‹ Back".
- [GOOD] Source tabs, meta row, video/gallery badges, flair pills, infinite scroll all faithful.

### Guide (`app/journal/[appid]/guides/[source]/[guideId]/index.tsx` + `[slug].tsx`, `components/shared/GuideTocHost.tsx`)
- [CRITICAL] No nav chrome (S1).
- [CRITICAL] The 176-page nav tree is hidden behind a summoned bottom-sheet instead of the web's **always-visible right "Contents" column** (full filtered tree + pins). Core of "guides are unusable."
- [CRITICAL] Button mislabeled: `Contents (6)` where `(6)` is the **pin count**, not pages (`index.tsx:150`, `[slug].tsx:192`). Reads as "6 items" for a 176-page guide.
- [MAJOR] No breadcrumb (web landing has `Home › … › Guides › Walkthrough`, `GuideViewer.svelte:881`).
- [MAJOR] Per-page nav friction: the drawer `close()`s on every navigation (`GuideTocHost.tsx:80`), so hopping pages = open → scroll → tap → closes → repeat.
- [MAJOR] Bottom safe-area (S2).
- [CLARIFICATION] The TOC drawer **is** root-mounted and renders the complete tree when opened (`GuideTocHost.tsx:105-166`) — so pages are reachable. The failure is discoverability + labeling + the lost persistent panel, not a dead control.
- [GOOD] Landing hero (title, `IGN · 176 pages · 1428.2 MB · Synced … · View original`, search, 6-tile mosaic) is a faithful mirror.

### Recommend (`app/(drawer)/recommend.tsx`)
- [CRITICAL] Ships the web's ≤479px **stacked-list fallback**, not the desktop **SVG node-graph** (`RecommendGraph.svelte`: radial nodes, elbow-routed per-type-colored edges, result nodes with art). Explicitly intentional in `recommend.tsx:17-23` but **contradicts the requirement that Recommend match desktop.**
- [MAJOR] Duplicate header: drawer bar "RECOMMEND" + screen topbar "Recommendations".
- [MINOR] Start icon is a text glyph `◎` vs web's compass SVG.
- [GOOD] Pre-start card, depth toggle, pips, and (drawer route) persistent rail all match.

### In-Progress / Backlog (`app/(drawer)/{in-progress,backlog}.tsx`)
- [CRITICAL] Web's 3-across "Up Next" hero-card row + ~5-col queue grid → native single-column list of horizontal thumb+text rows (deliberate re: draggable-flatlist not supporting multi-col drag, but a different design). Wrong column count, card orientation, and card proportions.
- [MAJOR] "▶ UP NEXT … Drag to reorder" header band missing; only the "QUEUE · N MORE" divider survives.
- [MAJOR] Card anatomy: web vertical (image → body → full-width progress bar); native horizontal (image | text), progress bar squeezed into the text column.
- [MINOR] Backlog "Random Pick": web filled indigo button w/ shuffle icon; native gold outline text, no icon.
- [MINOR] Subtitle decimals (S4).

### Favorites (`app/(drawer)/favorites.tsx`)
- [CRITICAL] Hero is structurally different: web = contained portrait card (span 2×3) with crossfade art, 5 hearts + title overlay, a 4-cell labeled chip strip (Played / stars / Steam % / HLTB), tags, review quote; native = full-bleed 220px banner with one inline meta row.
- [MAJOR] Hero metadata reworked: native inline "13h main · 28.3h played · Very Positive" vs web's 4 labeled chips; native shows word-score ("Very Positive") vs web's numeric Steam % ("92%"); native missing the 5-heart love meter.
- [MAJOR] Favorite cards drop the hours badge and the **5-heart row** (the collection's defining visual) — native shows art + title only.
- [MAJOR] Grid density 3 fixed cols vs web ~5-6 (S5).

### Abandoned (`app/(drawer)/abandoned.tsx`)
- [MAJOR] 3 cols vs web 5 (S5).
- [MAJOR] "Invested" badge top-right (native) vs web bottom-left; value formatting differs.
- [MINOR] Web desaturates art (`saturate(.75) brightness(.9)`); native uses a dark fog overlay — cards look more vivid than web.

### Completed / Hall of Fame (`app/(drawer)/hall-of-fame.tsx`)
- [GOOD] All tiers render + group correctly on scroll (Legend/Veteran/Completed/Finished), symbols + colors ported.
- [MAJOR] Non-Legend tiers forced to 3 cols vs web ~5-6 (S5); only featured Legend tier matches.
- [MINOR] Hours badge top-right vs web bottom-right; tier heading/label plain colored text vs web amber pill + underline bar.
- [MINOR] Subtitle decimals (S4).

### Settings (`app/(drawer)/settings.tsx`)
- [GOOD] All web settings present and ordered (Content Filters incl. Software & Adult, Discovery filter, Wishlist, Mod Images/Nexus). The 2026-07-18 additions render correctly.
- [MAJOR] No content-width cap: web `.settings-body { max-width: 640px }` (`settings.css:10`); native rows span the full tablet width so switches strand at the far-right edge — a scannability regression.
- [MAJOR] Safe-area (S2): drawer "Settings" item + last content row under the nav bar.
- [MINOR] Save button is NOT clipped at rest (only caught mid-scroll under the opaque header). Software row shows a `2 games` count web omits + different description wording. Count badges render as plain gold text vs web's gray rounded pill. Platform `<Switch>` vs web's custom gold track.
- [NOTE] The native-only "API Host" section at top is intentional (RN needs a server address) — not a defect.

### Calendar (`app/(drawer)/calendar.tsx`)
- [CRITICAL] Hard-fails to a raw Zod dump (S3); month grid missing entirely. Chrome (Play/Releases toggle, year nav, month tabs) renders — only the grid body is dead. Renderer is fine; the fix is the contract line.

### Sale Alerts (`app/(drawer)/alerts.tsx` + `components/shared/DrawerContent.tsx`)
- [MAJOR] Sidebar Sale Alerts item missing the sale-game backdrop + green cut-% tag: web `Sidebar.svelte:159-175` renders `.sidebar-alerts-backdrop` (hour-stable sale game header) + `.sidebar-alerts-cut`; native `DrawerContent.tsx:30` alerts entry has `countKey/badgeVariant` but no `hasBackdrop` (only `history` line 33 gets one). Machinery exists (`HistoryBackdrop`) — wire a sale backdrop + cut onto the alerts row. (Neither the web nor native alerts *screen* has a hero image — don't add one; the gap is the rail item.)
- [MAJOR] On-sale grid fixed 2 cols (`alerts.tsx:40`, web's phone layout) vs web fluid ~4 (S5).
- [MINOR] Invented "WATCHLIST" eyebrow (`alerts.tsx:60,77`) that the web header (`Alerts.svelte:92-109`) doesn't have; title shown twice (drawer bar + page).
- [MAJOR] Bottom safe-area (S2).

### Long-press card menu (`components/shared/useGameCardMenu.ts`)
- Works on grid screens (Play status / Lists & alerts / Visibility / Game info / Journal / Community / Game guides), verified on-device.
- [MAJOR] Absent on the drag screens (backlog, in-progress, franchise entries) where long-press = reorder — exactly where a user browsing the queue expects it. Undiscoverable elsewhere.

---

## Fix plan (phased)

### Phase 1 — Systemic foundations (highest leverage; most per-screen pain evaporates)
1. **S1 nav chrome** — detail routes into the drawer navigator (permanent rail at tablet-landscape; hamburger+overlay narrower). `src/app/_layout.tsx`, `(drawer)/_layout.tsx`, detail route trees.
2. **S2 safe-area** — `SafeAreaProvider` at root + insets on all scroll views + drawer top/bottom.
3. **S3 contract** — `contracts/journalSessions.ts:15` → `z.string().nullish()`. Fixes Calendar + Journal sessions + Account. Truncate the native calendar error text.
4. **S4 hour rounding** helper at collection subtitle/badge call sites.

### Phase 2 — Layout density & structure
5. **S5 responsive columns** — favorites/abandoned/completed/alerts driven by available width.
6. In-Progress/Backlog — restore the "Up Next" 3-card row + "Up Next" header + multi-column queue grid (keep vertical card orientation even if drag stays single-column).
7. Favorites — contained hero card (chip strip + heart meter); per-card hearts + hours badge.
8. Community — masonry card grid instead of list rows; restore hero title + breadcrumb.

### Phase 3 — Component/render bugs & feature parity
9. Journal HLTB — cumulative segment positioning + gold fill (`HltbCard.tsx`).
10. Journal LastSession — "Playing Now" variant + game-art bg; wire `activeSession`; verify session data post-S3.
11. Game hero — bounded data-panel (chips inside), ProtonDB badge block, FlagsBar icon toolbar.
12. Guide — persistent/always-open Contents panel at tablet width; fix the "Contents (N)" label to page count (or split "Pages"/"Pins"); add breadcrumb; keep the tree open across jumps.
13. Recommend — build the desktop SVG node-graph.
14. Alerts — sidebar sale backdrop + cut%; drop the "WATCHLIST" eyebrow.
15. Long-press menu — add to the drag screens via an alternate affordance.

### Phase 4 — Polish
Badge corners (abandoned invested → bottom-left; completed hours → bottom-right); tier-label amber pills; count-badge gray pills; Settings max-width cap; trailers right-side thumbnail rail; guide/journal grid tiles; genre-pill order; Backlog Random-Pick button style.

---

## Execution — Phase 0 foundations, safe-area checklist, agent split

### Phase 0 — shared foundations (build FIRST, mostly sequential; everything else consumes them)
These are shared primitives; they must land before per-screen work so agents build on them, not around them.
- **F1 `SafeAreaProvider` at root** (`src/app/_layout.tsx`) + a `useSafeAreaInsets()` convention. Once the provider exists, react-navigation's drawer header auto-insets below the status bar (fixes the top-clip); then apply `insets.bottom` to every scroll `contentContainerStyle` and top+bottom to `DrawerContent`.
- **F2 Fluid-grid helper** — e.g. `useGridColumns(minItemWidth)` computing `floor(contentWidth / minItemWidth)` from the measured content area (window width minus the current rail width). Replaces every `mobilePortrait ? 2 : 3`. Mirror the web `minmax` targets: library/wishlist/my-reviews/favorites 160, abandoned 200, hall-of-fame 180, alerts 260, discover per its CSS.
- **F3 Nav chrome** — bring `game/[appid]`, `journal/[appid]`, `community/[appid]`, `journal/[appid]/guides/**` under the drawer navigator so they inherit the permanent rail at desktop tier (`src/app/_layout.tsx`, `(drawer)/_layout.tsx`, route moves).
- **F4 Anchored context-menu popover** — `LongPressMenu` renders a positioned popover near the anchor on desktop/tablet tier, bottom sheet on phone (measure the long-pressed card, clamp to viewport).
- **F5 Contract fix** — `contracts/journalSessions.ts:15` → `z.string().nullish()` (fixes Calendar + Journal sessions + Account). Truncate native calendar error text.
- **F6 Hour-rounding helper** matching web `fmtHours` at the collection subtitle/badge call sites.

### S2 safe-area — per-page review (every page is affected; verify each after F1)
Root cause is uniform (no `SafeAreaProvider`), so this is a **verify-every-page** checklist, not a hunt. Categories:
- **(drawer) list screens** (home, library, wishlist, discover, recommend, downloads, alerts, calendar, top-games, history, in-progress, backlog, favorites, abandoned, hall-of-fame, franchises, my-reviews, account, settings): drawer **header renders under the status bar** (top) and list/last content + the drawer's own bottom "Settings" item render under the nav bar (bottom). Confirmed on library (Now Playing card under the clock), calendar, settings, backlog, alerts, collections.
- **Detail routes** (game, journal, community, guide, [pageId]): **no header at all**, so content starts under the status bar (top) and runs under the nav bar (bottom). Confirmed on community (header over clock), game, journal, guide.
- **Drawer rail itself** (`DrawerContent`): Now Playing card under the status bar (top); bottom items under the nav bar (bottom) — needs top **and** bottom insets.
Acceptance: after F1 + per-screen bottom padding, re-capture each page on the tablet and confirm the top-most and bottom-most content clear both system bars.

### Agent parallelization plan
Yes — this splits well, but with two rules learned the hard way: (1) **foundations first, sequentially** (F1–F6 touch shared infra; parallelizing them causes conflicts); (2) **after each parallel batch, re-verify visually on the tablet** (typecheck ≠ parity — that's what produced this whole doc). Per-screen work is file-disjoint and fans out cleanly once F1–F6 land:
- **Agent A — collection grids:** library, wishlist, my-reviews, favorites, abandoned, hall-of-fame, history — adopt F2 fluid grids; favorites hero card + hearts + hours badge; badge corners; tier-label pills.
- **Agent B — queue screens:** in-progress, backlog — "Up Next" row + header + multi-column queue grid.
- **Agent C — game page:** hero bounded panel, ProtonDB badge, FlagsBar icon toolbar, section polish.
- **Agent D — journal:** HLTB cumulative segments, LastSession "Playing Now" + art bg, verify session data post-F5.
- **Agent E — community + guide:** community masonry grid + hero title + breadcrumb; guide persistent Contents panel + "(N pages)" label + breadcrumb + keep-open-on-nav.
- **Agent F — recommend + alerts:** desktop node-graph; alerts fluid grid + sidebar sale backdrop/cut% + drop WATCHLIST eyebrow.
- **Agent G — settings + calendar + drawer:** settings max-width cap; calendar verify post-F5; DrawerContent insets + sale backdrop.
Then: rebuild → adb screenshot every screen → side-by-side vs web → iterate. Do not mark parity "done" off a typecheck.

## Execution status — DONE + device-verified (2026-07-18)
All phases implemented and **re-verified on the tablet against the web, screen by screen** (not off a typecheck). The final release build is installed on the Tab S10 FE+.
- Phase 0 (F1–F6): safe-area (rail + all screens sit between the system bars), fluid `useGridColumns`, detail routes moved inside the drawer group so the permanent rail + top-inset show on game/journal/community/guide, anchored context-menu popover, `journalSessions.endedAt` nullish (calendar + journal sessions + account restored), hour rounding.
- Phase 1: game (bounded data-panel + ProtonDB badge + icon FlagsBar), journal (Playing-Now card + cumulative HLTB bar + populated sessions), community (masonry grid + breadcrumb + serif title), guide (persistent Contents side-panel + breadcrumb + page-count label), recommend (SVG node-graph matching desktop + single header), in-progress/backlog ("Up Next" trio + multi-col queue grid), favorites (hero chip-strip + hearts + quote, 6-col grid with hearts/hours), abandoned/completed (fluid grids, badge corners, amber tier pills), settings (640px column cap), alerts (fluid on-sale grid + drawer sale backdrop/cut%).
- Regressions caught + fixed on device: favorites hero (Link-asChild drops explicit width → full-width fill + expo-image zoom on a flex-height parent — fixed with a definite-size hero + plain-Pressable cards). Guide Contents tree is empty on the *landing* (populates on section pages) — minor follow-up.

## Round 2 — deep parity pass (2026-07-18, user review of the shipped build)
Method reminder: for EACH item capture web (Playwright @1536) + native (adb tablet) of the exact section, compare, fix, rebuild, re-verify on device. Don't rush; get it right.

### Cross-cutting
- [ ] **R2-1 Context menu everywhere** — the game-card long-press menu is missing on many pages. Wire it onto EVERY game card that can lead to an info page (audit all screens: home mosaics, discover, calendar, history, franchise, top-games rows, journal cards, community-linked cards, etc.). Pass the touch anchor.
- [ ] **R2-2 Now-Playing nav element (rail top)** — missing the glow + spinning-glow animation that signals something's playing; and it must be a LINK to the game being played.

### Journal / History / Favorites
- [ ] **R2-3 Journal page columns** — native is multi-column in the wrong shape; match desktop's exact rows/cols grid.
- [ ] **R2-4 History cards** — weird transparent scrim covering the upper half of each card (above the bottom text). Remove/fix.
- [ ] **R2-5 Favorites highlight card** — the hero/highlight card is in the wrong location; match web placement.

### Game info page — header + each section (the bulk)
- [ ] **R2-6 Secondary/trailer videos** — wrong size.
- [ ] **R2-7 About the game** — missing inline gifs/images/videos (rich media), currently text-only.
- [ ] **R2-8 How Long To Beat** — FULL pass: bar size, colors, a missing image/file, text location, the over-bar tooltip, incorrect text — rebuild to match web exactly.
- [ ] **R2-9 Player count** — missing the chart grid lines + axis labels; the time filters (24h/7d/30d/1y) are in the wrong location.
- [ ] **R2-10 Screenshots** — should be 3 columns.
- [ ] **R2-11 News (game page section)** — should be a single row.
- [ ] **R2-12 Local review area** — looks different; full check WITH and WITHOUT a local review present.
- [ ] **R2-13 Community/Steam reviews** — not in parity; make them match.
- [ ] **R2-14 ITAD prices** — should be 4 columns, currently 2.
- [ ] **R2-15 ProtonDB / Linux compatibility** — not in parity.
- [ ] **R2-16 PCGW** — old design; missing badges; missing the full PCGW page. Redesign to match + build the full page.
- [ ] **R2-17 Mods grid (info page section)** — should be 3 columns.

### Sub-pages
- [ ] **R2-18 Individual mod page** — an adaptation, not parity; rebuild to match web.
- [ ] **R2-19 Individual news article page** — text not centered / not aligned with the images.

### Wrap
- [ ] **R2-20** rebuild + re-verify every touched section on the tablet vs web.

## Screenshot inventory
`<scratchpad>/shots/` — `web_<screen>.png` (desktop) and `nat_<screen>.png` (tablet) for: game, journal, community, recommend, in-progress, backlog, favorites, abandoned, completed, settings, calendar, alerts, guide; plus `nat_game_s1..s3`, `nat_journal_s1..s2`, `nat_completed_s1..s2`, `nat_community_s1`, `nat_settings_bottom`, `nat_longpress`. Re-capture via Playwright (web) + adb deep-links (native) as above.

---

## Round 2 — RESULTS (2026-07-18, device-verified on Tab S10 FE+ vs web @1536)

All Round-2 items rebuilt and **device-verified against web** (rendered pixel comparison, per the visual-parity rule):

| # | Item | Status |
|---|------|--------|
| R2-1 | Context menu on every game card → anchored popover | ✅ verified (home mosaic; wired via FlipMosaic + CalendarEntryTile + `useGameCardMenu`) |
| R2-2 | Now-playing rail: glow + spinning spark + link | ✅ verified |
| R2-3 | Journal page 3-col dashboard grid | ✅ verified |
| R2-4 | History card scrim (bottom-only, clean art) | ✅ verified |
| R2-5 | Favorites hero beside-the-grid | ✅ verified |
| R2-6 | Trailer/secondary video size (player + thumb rail) | ✅ verified |
| R2-7 | About inline images/gifs (expo-image renderer) | ✅ verified (BG3 About banners render) |
| R2-8 | HLTB gold cumulative bar + pill tooltip | ✅ verified |
| R2-9 | Player count gridlines + axes + filters top-right | ✅ verified |
| R2-10 | Screenshots 3-col | ✅ verified |
| R2-11 | News single row (game-page section) | ✅ verified |
| R2-12 | Local review — empty **and** populated states | ✅ verified (P3 empty CTA; BG3 ★-rating + body + Edit + Steam Review card, matches web) |
| R2-13 | Community/Steam reviews | ✅ verified |
| R2-14 | ITAD prices 4-col + cut% badges | ✅ verified |
| R2-15 | Linux compatibility / ProtonDB | ✅ verified |
| R2-16 | PCGW 7 circular badges + full detail page | ✅ verified |
| R2-17 | Mods grid 3-col | ✅ verified |
| R2-18 | Individual mod detail page | ⚠️ **blocked** — mod data fails to load on **both** web and native (shared backend bug, not a native regression); nothing to render/compare |
| R2-19 | News **article** page centering/alignment | ✅ **caught broken → fixed** — web = 1000px page, meta row full-width with `Read full article` flush-right (`margin-left:auto`) + breadcrumb; native had it stacked/narrow. Rewrote `(drawer)/game/[appid]/news/[gid].tsx` (PAGE_MAX 1000 / TEXT_MAX 840 / HERO_MAX 900). Rebuilt + verified. |
| R2-20 | Rebuild + re-verify | ✅ done (final release APK with news fix installed) |

**Nothing committed.** Only open follow-up is R2-18's shared mod-detail data bug.
