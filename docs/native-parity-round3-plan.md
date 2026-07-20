# Native parity — Round 3 plan (2026-07-18)

12 issues from user review, queued into groups. Each fix is verified on the Tab S10 FE+ (1440dp landscape = desktop tier) against web @1536, per the visual-parity rule. Batched rebuilds per group. Nothing committed.

## Group A — Guides (biggest cluster)
- [ ] **A1 — TOC link styling** — native nav-tree links styled wrong vs web `.gv-toc-*` (colors/indent/active/group chevron). Match web.
- [ ] **A2 — Group-header-as-top-level-page** — web just fixed: a nav item that is a group header but also has its own `slug` must be navigable (tap label → go to that page; chevron → toggle). Native currently only toggles group headers. Fix to match.
- [ ] **A3 — Guide page gutters** — add left/right gutters (padding/max-width) to guide landing + section pages to match web.
- [ ] **A4 — Pins in a page (big feature)** — (i) render a VISIBLE inline pin marker at the pinned block, (ii) auto-scroll to the pin when navigating to a page, (iii) right-sidebar pin → navigate to page + scroll to section. Match web.
- [ ] **A5 — Local page search scroll** — clicking a "search this page" result must scroll to the matching section (native currently shows results but doesn't jump). Fix the blockPath/measureLayout mismatch.

## Group B — Individual game page
- [ ] **B1 — Hero foreground too dim** — brighten the hero title, description, tag/feature badges, and the right side stat panel (they're too transparent/deemphasized vs web).
- [ ] **B2 — Loading/updating badge** — show the live "content updating" indicator (spinner/badge) when a section is being refreshed, like web.
- [ ] **B3 — Left section-nav rail** — sticky left-gutter section jump-nav (scroll-spy) to hop between sections (Trailers/About/HLTB/Player Count/Screenshots/News/Reviews/Prices/…), moving with scroll. Currently absent.

## Group C — Achievements
- [ ] **C1 — Cards not rows** — convert the native achievements list (full-width rows) to a fluid CARD GRID matching web (rail-aware `useGridColumns`).

## Group D — Recommend
- [ ] **D1 — Tiny-then-correct sizing glitch** — nodes/icons render tiny for ~1.5s at every step, then snap correct. Fix the measure-on-mount race (seed dimensions synchronously; don't render pre-measure).
- [ ] **D2 — Empty circles / missing nodes** — some branches render as empty circles (no node/icon) until after the first choice. Fix the graph data→render mapping.
- [ ] (D1 covers the "tiny game icons at end of lines each step" — same measure race.)

## Group E — Global search (DECISION NEEDED, suggestion first)
- [ ] **E1 — Global cross-game search** — web triggers it with Ctrl-Space anywhere. Native needs a discoverable touch trigger for the existing `GlobalSearchHost`. Awaiting user's choice of pattern before implementing.

## Execution order
A (guides) → C (achievements, small) → B (hero+nav) → D (recommend) → E (after decision). Verify each group on device before moving on.

---

## Round 3 — RESULTS (2026-07-19, device-verified on Tab S10 FE+)

| # | Item | Status |
|---|------|--------|
| A1 | TOC link styling → web (dim links, bordered gold group boxes, dim-gold labels) | ✅ verified |
| A2 | Group-header navigates on tap (slug-bearing) + chevron toggles; auto-expands on path | ✅ verified |
| A3 | Guide gutters — 44px wide / 20px phone; deterministic `contentWidth` to ContentBlockRenderer | ✅ verified |
| A4 | Pins — visible 📌 marker + gold highlight + auto-scroll; **web↔native coordinate off-by-one fixed** (`webPinToNative`/`nativePinToWeb`); pin `[3,8,0]` landed exactly on "Rank 7 → Rank 8" | ✅ verified |
| A5 | Local page search scroll — deterministic onLayout-offset scroll (`blockOffsets` prefix-sum, replaces unreliable New-Arch measureLayout); jump gated on `keyboardDidHide` + instant scroll | ✅ verified (from page top, jump scrolled all the way to the target section) |
| B1 | Hero brightened — horizontal gradient scrim (dark-left) + `dataPanel` 0.72→0.90 + brighter badges; also HTML-entity decode for `&amp;` | ✅ verified |
| B2 | Live "updating N sections… / ✓ Up to date" badge (bottom-right) | ✅ verified |
| B3 | Left section-nav rail (`GameSectionRail`) — 14 Feather icons, scroll-spy active highlight, jump-to-section; wide tier only, appears past hero | ✅ verified |
| C1 | Achievements → fluid card grid (`useGridColumns(260,gap10)`, 80px stretch icon) | ✅ verified |
| D1 | Recommend graph tiny-then-snap — removed onLayout `size` race, Svg fills parent (`width/height 100%`) | ✅ verified (correct size on first frame) |
| D2 | Recommend empty circles — same first-mount race; cleared by D1 | ✅ verified |
| E1 | Global search — header magnifying-glass icon (index + main screens) | ✅ verified; detail-screen (game/journal/guide) coverage = remaining follow-up |

**Key engineering notes:** the guide scroll now uses a deterministic parent-relative onLayout offset map summed over path prefixes (New-Arch `measureLayout` was silently no-op'ing); guide pins carry TWO coordinate conventions (web section-child +1 vs native +0) — reconciled by translating at the native boundary in both directions, leaving the native search extractor untouched. Nothing committed.
