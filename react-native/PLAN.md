# Gaming Journal — React Native Mobile Client

## Context

The gaming-journal web app (SvelteKit, `c:\dev\gaming-journal`) is desktop-oriented; several patterns (hover tooltips, right-click menus, keyboard shortcuts, `position:fixed` viewport tricks) actively fight a touch/mobile experience even though the app already has a responsive mobile mode. The goal is a dedicated React Native + TypeScript app that reuses the existing backend untouched and gives every one of the ~42 documented features (`docs/features/`) a real touch-native UI — no permanent web-view shims.

Research completed before this plan was written:
- Full relay-server (`c:\dev\relay-server`) API surface: Express, **no auth at all**, all-JSON-file persistence, heavy use of SSE for slow jobs (guides, AI tracker suggestions, Reddit sync), most `GET`s are eventually-consistent caches refreshed by internal timers or explicit `POST .../sync`.
- Full read of all 42 `docs/features/*.md` — consolidated inventory of data deps, UI complexity, and browser-only patterns that won't port (right-click menus, hover tooltips, keyboard shortcuts, `MutationObserver`, Web Worker, `{@html}` injection, DOM-position-based pins, SvelteKit SSR).
- Confirmed there is **no existing shared design-system package** to reuse (`@archerjb/ui-components` is an unrelated TreeView/FolderView/CodeView library) — all gaming-journal UI is bespoke Svelte, so the RN app needs its own component library, informed by (not literally ported from) the Svelte components.
- Confirmed topology: SvelteKit server (`server.js`, port `8061`, deployed on a Linux host per `start.sh` — `/home/jarcher/gaming-journal`) is itself the single HTTP gateway the browser talks to. It has its own `src/routes/api/*` endpoints (pages, local-reviews, local-wishlist, flags, order, franchises, settings — file-backed, separate from relay) **and** transparently proxies everything else to relay-server via `src/routes/relay/[...path]/+server.ts`, including SSE (dedicated undici agent, `Accept: text/event-stream` detection). relay-server itself (port `8050`, Windows host) is never hit directly by the browser today.

Decisions made:
- **Remote access**: Tailscale/VPN — install on the host running the SvelteKit server; no backend auth code needed since traffic never touches the public internet.
- **Tooling**: Expo (managed workflow + dev client/EAS build, not Expo Go-only, since some libraries below need native modules).
- **V1 ambition**: full parity — every feature gets a real native implementation eventually, including the hardest custom UI (sticky-note corkboard, tracker drag+particles, guide pins, recommend graph). No feature is permanently stubbed. Work is still sequenced (can't build 42 features at once) — phases below are an engineering order, not a scope cut.
- **Location**: nested inside the existing gaming-journal repo at `react-native/`, not a separate sibling repo.

## Architecture

**Single gateway, no relay changes.** The RN app talks to exactly one host — the existing SvelteKit server — over Tailscale, exactly like the browser does today. This reuses its already-solved SSE proxying and means relay-server (LAN/Windows-only, zero auth) never needs its own Tailscale exposure or auth layer.

**Location**: `c:\dev\gaming-journal\react-native\` — nested inside the existing repo rather than a sibling repo. The HTTP API is still the contract between the two; shared TS types get hand-ported into `react-native/src/types/` rather than imported across the boundary, so the RN project stays buildable independently (its own `package.json`, own dependency tree) even though it lives in the same working tree.

**Routing — Expo Router.** SvelteKit's `src/routes/` is already file-based; Expo Router's file-based routing maps almost 1:1 (`game/[appid]/+page.svelte` → `app/game/[appid]/index.tsx`), which minimizes translation effort for the ~15 dynamic routes in this app.

**Server state — TanStack Query.** This is the single highest-leverage choice: the relay's whole design ("GET reads a cache, POST /sync kicks a refresh, poll or SSE for completion") maps directly onto queries + mutations + `refetchInterval`/`invalidateQueries`. It also replaces the app's ad hoc `setWithTTL`/`getWithTTL` (`src/lib/js/storage.ts`) uniformly via `@tanstack/query-async-storage-persister`, instead of reimplementing that helper per-screen.

**Client UI state — Zustand.** Drawer/sidebar open state, active nav item, ephemeral UI flags. Small, hook-based, no boilerplate.

**Styling — plain `StyleSheet` + `theme/tokens.ts`**, not NativeWind. NativeWind was the original plan and got installed in Phase 0, but was never actually wired (no `babel.config.js`/`tailwind.config.js` ever existed) — every real component ended up using `StyleSheet.create` + the token constants directly, and it read cleanly, so NativeWind/Tailwind were uninstalled rather than retrofitting working code to an approach that was only ever aspirational. Tokens (colors/fonts/spacing/radius) ported once from the web app's CSS variables (`public/css/base.css`) into `theme/tokens.ts`.

**Key shared components to build once, reuse everywhere** (this is the biggest cost-saver identified in the feature audit):
| Component | Replaces / reused by |
|---|---|
| `FlipMosaic` | guides/landing, franchise 4-cell mosaic, home ×2 (Library + Wishlist panels) — 3D rotation-flip grid, built Phase 1 |
| `HeroCrossfade` | favorites hero, game hero, franchise hero — 2-layer opacity crossfade, a **different component from `FlipMosaic`**, not a 7th call site of it. Original scoping in this table was wrong: it lumped "hero crossfade" and "6-cell flip mosaic" together as one component because the early feature audit described them as the same visual *family*, but they're mechanically different animations (rotation vs. opacity) — caught and split apart while building Favorites (Phase 1), which needed the crossfade first. Extended for the Franchise detail hero (Phase 1): takes an optional `frames`/`intervalMs`/`fadeMs` prop path (discriminated union against the original `appid`-probing path) since the franchise hero already has every entry's screenshots from data it loaded anyway (no per-appid probe) and uses different timing (6000ms/1800ms vs Favorites' 14000ms/1500ms, confirmed in `franchises.css`) — one component, two frame-sourcing strategies, not a fork. |
| `DraggableList` (wraps `react-native-draggable-flatlist`, built on Reanimated + Gesture Handler) | backlog, in-progress, franchise entries, list-page items/subtasks, tracker bars/chips — **6 call sites** |
| `ContentBlockRenderer` (wraps `react-native-render-html` v6.3.4) | built Phase 3 — real block shapes confirmed against live parsed guide data (not the guides-architecture memory alone, which omits exact `heading`/`list` shapes): `section`/`paragraph`/`image`/`table`/`list` all found live, `heading` handled defensively per source but never observed. Tables render as a native grid (structured JSON, not HTML) with only each cell's own html/text routed through `RenderHTMLSource`. Two real bugs found verifying against real content: an `alignItems:'center'` wrapper collapsed images to 0×0 despite the underlying image genuinely loading, and a missing `contentWidth` prop (now threaded to every `RenderHTMLSource` call) triggered the library's own rotation-inconsistency warning. |
| `LongPressMenu` | guide viewer, guide pins, tracker context menu, community post menu — **4 right-click menus → 1 touch primitive** |
| `Sparkline` (react-native-svg) | top-games trend chart |
| `LegendaryStars` | built Phase 2 — two real variants (`badge`: 5 stars + separate text badge, used by the upcoming Reviews section; `compact`: 5 stars + trailing `✦`, retrofitted onto Favorites' hero, replacing its inline `starStr()`). A **third** variant (MyReviews' filled-only/inline-✦ pattern) is deliberately NOT built yet — deferred until the My Reviews screen (Phase 6) actually needs it, rather than guessing its shape blind. |
| `ConfirmDialog` | replaces the web's `confirmDialog` (no native `confirm()` on RN either) |
| `ScreenshotLightboxHost` (Zustand-backed, root-mounted) | built Phase 2 for the Game detail screen's screenshot grid — same root-mounted pattern as `ConfirmDialogHost`/`LongPressMenuHost`, **required** (not just convention) after a real react-native-web bug: an embedded `<Modal>` nested inside a scrolled screen rendered its backdrop with a gap at the true viewport top on very tall pages. Any future full-screen overlay (guide image lightbox, sticky-note fullscreen view, etc.) should use this same root-mounted-store pattern from the start, not a locally-embedded `<Modal>`. |
| SSE client (`src/api/sse.ts`) | guide download/search, progress-suggest jobs, reddit sync progress |

**Notable redesigns (browser pattern → touch pattern, decided now to avoid rework later)**:
- Guide pins: currently DOM-position (`blockPath` child-index walk in live HTML) — RN has no persistent DOM, so pins become a `{ blockIndex, offset? }` reference into the `ContentBlock[]` array instead. Same semantics, different addressing.
- Right-click context menus (4 features) → long-press (`LongPressMenu`).
- `Ctrl+Space` global search / arrow-key nav → persistent search tab + tap-to-select (simpler than the desktop version, not a downgrade).
- Collapsed-sidebar hover tooltips / `position:fixed` gutter button (guide viewer sidebar) → the app's **own existing mobile drawer pattern** (already in `sidebar.md`) is reused directly instead of the desktop collapse mode.
- Web Worker (game page Phase 2 fetches) → plain parallel `useQuery` hooks; no worker needed without a real main-thread/DOM to protect.
- Recommend's SVG node-graph → the app **already ships a mobile fallback** (stacked list, pill buttons, staggered entrance) for ≤479px screens per `discovery/recommend.md` — reuse that design as the RN implementation directly rather than porting the SVG graph.
- StickyWall corkboard — **correction (Phase 5 build)**: this was originally assessed here as "the highest-risk single feature, no RN equivalent exists anywhere," assuming a freeform x/y-position drag corkboard needing a custom `PanGesture` + Reanimated transform. Reading the real vendor lib (`src/lib/js/vendor/stickywall.js`) directly instead of inferring from the doc showed that assumption was wrong: a note has NO position field at all. It's a `flex-wrap` grid of note cards with a small fixed cosmetic per-index rotation (not user-adjustable) and 3 fixed widths; "draggable" means HTML5 drag-and-drop LIST REORDERING (insert before/after a target), not a free 2D transform. Built as a plain RN `flexWrap` row of note cards, with reordering as a long-press → "Move earlier"/"Move later" action (same precedented simplification as `ProgressBarsTracker.tsx`'s chip reorder, for the same reason: a variable-width wrap-grid has no good off-the-shelf RN drag primitive). Persists to the existing `/api/journal-notes` endpoint unchanged (full-array PUT on every add/update/remove/reorder, matching the web's own save-on-every-event model).

**Open technical risk to spike early**: RN has no native `EventSource`, and two of the relay's SSE endpoints are POST-based (unusual for streaming clients). Phase 0 includes a throw-away spike screen against the guide-download SSE endpoint to prove `fetch` + `ReadableStream` (or `react-native-sse`) works end-to-end through the SvelteKit proxy on-device before Phase 3 (Guides) is built on top of it. If it doesn't work reliably, fall back to polling `GET /relay/api/guides/jobs`.

**Confirmed (not just predicted) during Phase 0**: fetching the gateway from the **web** target (`expo start --web`) throws a real browser CORS error — `192.168.86.65:8061` sends no `Access-Control-Allow-Origin` header, and the web dev server runs on a different origin/port. This only affects the web preview target; native iOS/Android `fetch` has no CORS enforcement. Implication: don't trust the web target alone to validate networking during development — verify real device/simulator behavior for anything that does a live fetch, and treat web-target console errors involving CORS as expected noise rather than a bug to chase.

**Refined during Phase 1 (Franchises)**: the CORS failure is specifically about *preflighted* requests, not all cross-origin fetches. Every GET across ~15 screens so far (all bodyless, all against `localhost:8061`) has worked with zero console errors — a "simple" cross-origin GET doesn't trigger a preflight. The very first mutating call attempted interactively through the web target (Franchises' create-franchise POST) failed immediately: a JSON body makes it a "non-simple" request, the browser sends an OPTIONS preflight first, and the SvelteKit dev server doesn't answer it. **Practical implication for every phase from here on**: no `POST`/`PUT`/`DELETE` can be interactively verified through `expo start --web` at all, full stop — not a caveat about being careful with test data, a hard wall. Real device/simulator testing is required to observe any mutation actually round-trip through the RN UI. Until then, the fallback verification path is: (1) confirm the mutation function's request/response shape against the live server directly (curl, or a throwaway record for endpoints that support one — see Verification recipe rule 6), (2) trust the already-typechecked, already-contract-verified call site code.

**Found during Phase 2 (Game detail screen) — full-screen `<Modal>` overlays need to be root-mounted, not embedded**: a `<Modal>` built directly inside the Game detail screen (for the screenshot lightbox) rendered its backdrop with a real gap at the true viewport top, with page content bleeding through — reproducible in both headless *and* headed real Chromium, on this app's very tall (~5000-6000px) scrolled pages. Investigated thoroughly: `getBoundingClientRect` confirmed the backdrop's own box was genuinely full-viewport, and the whole ancestor chain was checked for `transform`/`filter`/`will-change`/`contain`/`isolation` (all clean) — so this isn't a CSS mistake in the component's own styles, and moving the backdrop to `position:'fixed'` explicitly (react-native-web's own Modal wraps children in an inner `{top:0,flex:1}` container whose resolved height doesn't reliably fill the viewport, a separate real quirk fixed along the way) didn't fully resolve the remaining artifact either. Given it reproduces with provably-correct CSS in a real browser window, this looks like a genuine Chromium compositor/paint-invalidation edge case for newly-inserted `position:fixed` elements on extremely tall pages — not something fixable from this app's side, and **not expected to reproduce on native** (iOS/Android Modal presentation is a native overlay, not CSS `position:fixed`, a completely different pathway). **Standing rule from here on**: build every full-screen overlay (image lightboxes, sticky-note fullscreen view, etc.) as a root-mounted Zustand-store-backed host (see `ScreenshotLightboxHost` for the reference implementation) — the same pattern `ConfirmDialogHost`/`LongPressMenuHost` already used, now confirmed necessary rather than just tidy. Re-verify the screenshot lightbox specifically on a real device/simulator before trusting it fully; this residual visual glitch is flagged, not silently accepted as done.

**Found during Phase 3 (Guide landing) — `@react-native-masked-view/masked-view` does not work on
RN Web at all**: its own `MaskedView.web.js` is a complete no-op (`React.createElement(View, props,
maskElement)`) — it silently discards every child except the mask element and performs zero actual
masking, confirmed by reading the library's own source after a gradient-masked shimmer title
rendered as plain solid-black text in a real screenshot. **Standing rule**: any component needing
real gradient/image-masked content (masked text, masked shapes) needs a genuine `Platform.OS`
split — native can use MaskedView normally; web needs a different technique entirely (for
gradient text specifically, raw CSS `backgroundClip`/`WebkitTextFillColor`/`backgroundImage`
applied directly via the `style` prop, which react-native-web does pass through to the underlying
DOM element, confirmed working in `ShimmerTitle.tsx`). Don't assume a cross-platform masking
library "just works" on web without a real screenshot check.

**Local development setup (standing, as of Phase 0)**: run both servers locally instead of pointing at the LAN box, for isolation — `gaming-journal/.env` already has `RELAY_URL=http://localhost:8050`. Start relay-server first (`cd relay-server && npm run dev`, port 8050), then gaming-journal (`cd gaming-journal && npm run dev`, port 8061, proxies to the local relay). This also surfaced a real gap: the LAN-deployed relay-server at `192.168.86.65:8050` is a stale build missing the entire Guides/Reddit/Home/Recommend/Pin/Wishlist/Account/ProtonDB feature set — worth a redeploy on that box independent of this RN work.

## Type contracts & verification

**The gap this closes**: gaming-journal already has a hand-typed contract file (`src/lib/types.ts`, ~600 lines) but zero runtime validation. It shows the cost of that — `SteamGame` carries `playtimeMinutes?`, `playtimeMin?`, `playtime?`, and `playtime_forever?` as separate optional fields, four names for what's likely one drifted value, because nothing ever caught the drift. Hand-porting a second copy of these interfaces into `react-native/` would just create a second place for the same drift to happen invisibly. Both apps need to prove, mechanically, that what they assume about a response is what the response actually is — the live server, not the doc, is the ground truth (confirmed reachable at `192.168.86.65:8061` gaming-journal / `:8050` relay-server).

**`contracts/` at the repo root** (sibling to `src/` and `react-native/`), not nested in either — Zod schemas are the single source of truth per resource (`SteamGame`, `Page`, `AccountData`, `ContentBlock`, `NavTree`, etc.). TS types are `z.infer<typeof Schema>` — one definition, not two hand-synced ones. Both apps import the same literal files, but reach them differently:
- SvelteKit/Vite side: SvelteKit's `kit.alias` (`svelte.config.js`) maps `$contracts` → `contracts` (auto-generates the tsconfig path too, via `npx svelte-kit sync`).
- Expo/Metro side: **not** a raw Metro `watchFolders` + relative-import (tried first, didn't work — Metro's resolver kept failing to follow the cross-project-root relative path even with the parent watched; not worth the time to root-cause further). What actually works: `contracts/` has its own minimal `package.json` (name `gaming-journal-contracts`), and `react-native/package.json` depends on it as `"gaming-journal-contracts": "file:../contracts"` — `npm install` creates a **real symlink** (confirmed via `fs.lstatSync().isSymbolicLink()`) into `react-native/node_modules/`, so Metro resolves it exactly like any other dependency, no custom resolver config needed, and edits to `contracts/` are picked up immediately (no reinstall step). `metro.config.js` still sets `watchFolders = [workspaceRoot]` so Metro can follow the symlink back to its real location one level up. Import style differs per app (`$contracts/steamGamesList` on web, `gaming-journal-contracts/steamGamesList` on RN) — cosmetic only, same underlying files.
- `zod` becomes a dependency in **all three** `package.json`s (gaming-journal root, `contracts/` has none since schemas import it directly from whichever consumer's node_modules, and `react-native/`) — gaming-journal had none before this.

**Retrofit is symmetric, not additive-only** — both apps validate:
- `react-native/src/api/client.ts` parses every response through its schema; throws loudly on mismatch instead of an `undefined` surfacing three screens later.
- gaming-journal gets the same treatment per endpoint: `src/lib/js/api.ts` for this app's own `/api/*` routes, and a new `src/lib/js/relay-api.ts` for anything proxied through `/relay/*` (this data was never routed through `api.ts` — 25 Svelte files call `/relay/api/steam/games` directly with ad hoc envelope-guessing). Each retrofit replaces the corresponding hand-typed interface in `src/lib/types.ts` with the schema-derived type as it's ported (incremental, not a big-bang rewrite — see standing rule below).

**Standing rule for every TODO item that touches a new endpoint** (applies across all phases, not just Phase 0): write or reuse the Zod schema in `contracts/`, retrofit the matching `src/lib/js/api.ts` call site to validate through it, then build the RN side against the same schema. One schema, two consumers, checked every time either side calls it.

**`scripts/verify-contracts.ts`** (repo root, run via the `tsx` devDependency already in this repo as `npm run verify-contracts` — no new tooling needed, just `fetch` + the schemas) — for each schema, hits the live server with real data and asserts `schema.safeParse(json).success`. This is the literal "check" for any TODO item introducing a new endpoint — run it, it must pass against the live server, not just against a fixture.

**Playwright as the reference implementation, not the doc.** `@playwright/test` is already configured in gaming-journal (`playwright.config.js`, `src/tests/e2e/`). For any RN screen with a web equivalent, load the real page at `192.168.86.65:8061/<route>` first — screenshot + the actual rendered data (counts, specific values) — and diff the RN screen against *that*, since the markdown docs in `docs/features/` can go stale but the running app can't.

## Project structure

```
gaming-journal/                 # repo root
  contracts/                    # shared Zod schemas — single source of truth for both apps
    games.ts, guides.ts, pages.ts, account.ts, ...
  scripts/
    verify-contracts.ts         # hits the live server, validates real payloads against contracts/
  src/                          # existing SvelteKit app (unchanged except relay-api.ts retrofit + kit.alias)
  react-native/
    src/
      app/                      # Expo Router screens (SDK 57 default template convention — under
                                 # src/app/, not top-level app/)
        (drawer)/                # drawer nav group — 19 real nav items from Sidebar.svelte (home,
                                  # library, wishlist, discover, recommend, downloads, alerts, calendar,
                                  # top-games, history, in-progress, backlog, favorites, abandoned,
                                  # hall-of-fame, franchises, my-reviews, account, settings). Community
                                  # is NOT here — nested under game/[appid]/community, not top-level.
        game/[appid]/index.tsx, community.tsx     # not yet built (Phase 2/5)
        journal/[appid]/index.tsx                 # not yet built (Phase 2)
        franchise/[id]/index.tsx                   # not yet built (Phase 1)
        guides/[appid]/[source]/[guideId]/index.tsx # not yet built (Phase 3)
        [pageId]/index.tsx       # tracker/list pages, not yet built (Phase 2/4)
        _layout.tsx              # providers (TanStack Query, fonts, ConfirmDialog/LongPressMenu hosts) + <Slot/>
      api/                       # client.ts (validated fetch + config), sse.ts, one module per resource
      hooks/                     # TanStack Query hooks: useNowPlaying, useSidebarCounts, useHomeData, ...
      components/
        shared/                  # ConfirmDialog, LongPressMenu, DrawerContent, ComingSoon — built.
                                  # FlipMosaic, DraggableList, ContentBlockRenderer, Sparkline,
                                  # LegendaryStars, StatBar — not yet built (Phase 1+)
        game/ journal/ guides/ collections/ discovery/ community/ account/  # not yet built
      theme/                     # tokens.ts (colors/fonts/spacing/radius), fonts.ts (useFonts map)
      store/                     # zustand: confirmDialogStore, longPressMenuStore
      storage/                   # ttl.ts — AsyncStorage TTL wrapper
      utils/                     # not yet built — ported pure logic (tier grouping, spreadIndices,
                                  # session color hash, HLTB sqrt scale, globalSegments, splitAtMidnight)
                                  # comes with the screens that need them, Phase 1+
    app.json / eas.json / metro.config.js
```

## Build sequence (engineering order toward full parity)

**Phase 0 — Foundation** — ✅ done, see `TODO.md` section `0.` for the full account of what was built and
every real course-correction along the way (Metro/contracts resolution, the `@react-navigation/drawer` →
`expo-router/drawer` SDK-56 incompatibility, dropping NativeWind, the relay-server staleness discovery).
Scaffold, contracts sharing, API client + Zod validation, TanStack Query, TTL storage, `ConfirmDialog` +
`LongPressMenu`, SSE client (web-target verified, native still open), theme tokens, Drawer nav shell (all 19
real nav items from `Sidebar.svelte`), Now Playing polling, and a simplified Home screen (no mosaic yet —
that's Phase 1's `FlipMosaic`).

**Phase 1 — Core collection screens**: Library, Wishlist, Backlog, In-Progress, Favorites (+ new `HeroCrossfade`, split out from the mis-scoped `FlipMosaic` entry above), Abandoned, Hall of Fame, Top Games (+ `Sparkline`), Franchises list/detail (+ `FlipMosaic`, `DraggableList`). Global search overlay (touch redesign).

**Phase 2 — Game & Journal hubs**: Game detail (sequential `useQuery` phases replacing Web Worker; `NavRail` rebuilt via `onLayout` section offsets instead of `MutationObserver`/portal), Reviews (`LegendaryStars`), Pricing, Journal dashboard (7 parallel hooks), Sessions (focus-scoped polling via `useFocusEffect`), Notes/Pages.

**Phase 3 — Guides**: Landing (shimmer via Reanimated, Fuse.js works as-is in RN), download/search via the SSE client from Phase 0, `ContentBlockRenderer`, TOC as bottom-sheet/drawer, pins redesigned to `ContentBlock` index addressing.

**Phase 4 — Trackers & Discovery**: 4 tracker types via `DraggableList` + scrub-bar counters (`PanGestureHandler`) + Reanimated confetti on completion; Recommend (reuse existing mobile-fallback design); Calendar (month grid — real day cells are game thumbnail tiles, not color-hash dots as first assumed; see TODO.md's writeup — + midnight-split logic ported verbatim).

**Phase 5 — Community & Sticky Notes**: Community feed/comments + `LongPressMenu`; StickyWall-equivalent corkboard (plain `flexWrap` note grid + long-press move-earlier/later reorder — see the correction above, not the custom Pan+Reanimated transform originally planned here).

**Phase 6 — Account/Settings polish & parity pass**: Account, My Reviews, Settings (replicate the inverted `hideUnavailable` flag and dual relay/localStorage blocklist write exactly for parity); cross-check every "Gotcha" from the feature-doc audit against the RN implementation; performance pass (FlatList tuning, image cache sizing); offline-read for previously-fetched guide content.

## Responsive design system (standing rule, applies to every screen from here on)

**Breakpoints are not invented for RN — they're the web app's own.** Every one of ~30 files in `public/css/*.css` (library.css, game.css, layout.css, sidebar.css, and everything else) uses precisely the same three thresholds, confirmed via grep across the whole stylesheet directory:

| Tier | Web breakpoint | Represents |
|---|---|---|
| `mobilePortrait` | `max-width: 479px` | phone portrait |
| `mobileLandscapeTabletPortrait` | `480px – 799px` | phone landscape **and** tablet portrait share one tier |
| `tabletLandscape` | `800px – 1279px` | tablet landscape |
| *(desktop, web-only)* | `min-width: 1280px` | permanent sidebar etc. — not one of RN's 3 required tiers, but `useBreakpoint()` still returns it rather than silently falling through if a device is ever wider |

`react-native/src/hooks/useBreakpoint.ts` implements this exactly (`useWindowDimensions()` + the same three numeric cutoffs). **Standing rule**: before building any responsive behavior for a screen, check that screen's web equivalent's `@media` blocks in `public/css/` first — port the decision, don't re-derive one from scratch. Stop and check this even when it feels obvious; the web version has already made (and tested) the call.

**Canonical test viewports** for the three tiers (concrete sizes to set in Playwright when screenshotting, not the breakpoint thresholds themselves — those are the table above):
| Tier | Test viewport | Why |
|---|---|---|
| `mobilePortrait` | 360×780 | Galaxy S25 portrait, real CSS viewport size (confirmed via search) |
| `mobileLandscapeTabletPortrait` | 780×360 | Galaxy S25 landscape, real CSS viewport size, fits cleanly under 799 |
| `tabletLandscape` | 1200×800 | Representative mid-band size, not a literal device — the real Galaxy Tab S10+'s CSS viewport (876×1400 portrait, so 1400 wide landscape) actually *exceeds* the web app's own 1279px ceiling and would be treated as desktop-width by the existing CSS, so a real Tab S10+ number wouldn't even exercise this tier |

**Per-screen build recipe (mandatory, not optional)**:
1. Load the screen in Playwright at each of the 3 canonical viewports above and screenshot the *current* state before writing/changing layout code — this is the "no guessing" rule. Don't write responsive styles blind and check after; look first.
2. Check the equivalent web page's `@media` blocks for what actually changes at each tier (padding, column counts, hidden elements, stacking order) and port those decisions.
3. Implement, then re-screenshot at all 3 viewports and compare.
4. Only check off the TODO item once all 3 tiers have been visually confirmed — note in the TODO checkbox what was actually seen (matches the existing verification-logging convention from Phase 0), not just "looks fine."

**Touch adaptation is expected, not a compromise.** Where a web interaction only works with a mouse/keyboard (hover, right-click, `Ctrl+`-shortcuts), adapt it to a real touch pattern rather than forcing a literal port — this is already the standing approach from Phase 0 (right-click → `LongPressMenu`, hover tooltips → dropped, `Ctrl+Space` → persistent search tab). Document the adaptation inline the same way those were.

**Nav shell width note**: the Drawer stays an off-canvas overlay across all 3 RN tiers (no "permanent sidebar" mode) — the web app itself doesn't switch to a permanent sidebar until `min-width: 1280px`, which is outside RN's 3 required tiers, so there's nothing to port at any width RN actually needs to support. This was already the default `expo-router/drawer` behavior in Phase 0; no rework needed, just now justified by rule rather than accident.

**Recurring gotcha, now a standing rule**: `<Link asChild>`'s child must receive a single flattened style object, never an array (`style={[a, b, c]}` throws "You are passing an array of styles to a child of `<Slot>`" — `Slot` needs to merge its own injected style in). Hit this independently on both the Library and Backlog card components before catching the pattern. Any card/row component built with conditional styles (`isActive && styles.x`) that's wrapped in `<Link asChild>` needs `StyleSheet.flatten([...])` before the `style` prop, every time — check for this proactively now rather than waiting for the screenshot recipe to catch it again.

**Mutation-testing safety (learned the hard way — see TODO.md verification recipe rule 6)**: never test a `PUT`/`POST`/`DELETE` endpoint with synthetic data against real persisted state. A test write to `/api/order/backlog` overwrote the user's real 16-game order, and the "restore" write was (correctly) blocked by the permission system since it can't verify the value is genuinely original vs. fabricated — required manual user intervention to fully recover. Read-and-write-back-the-same-value, or mutate a throwaway record you created yourself, instead.

## Verification

- `npx expo start` → run on a physical device via Expo Go/dev client and iOS Simulator/Android emulator.
- Confirm drawer renders all nav sections from `global/sidebar.md` and Now Playing card polls live.
- Confirm the API client reaches the SvelteKit gateway both over plain LAN (dev) and over Tailscale (device off local wifi, e.g. cellular).
- TanStack Query devtools (Flipper or in-app overlay) show successful cache population for the Home screen's real fetch.
- SSE spike screen shows live `phase` updates from an actual guide-download job started from relay-server, proving the streaming path works before Phase 3 depends on it.

## How this gets iterated on

`TODO.md` (same folder) is a flat ordered checklist. Each item is a unit of work sized for one `/loop` iteration: do the item, run a check (typecheck / `expo start` smoke test / on-device verification against the relevant `docs/features/*.md` doc), tick it off, move to the next. Prerequisite steps (shared components, API client, SSE spike) are interleaved immediately before the first feature that needs them, not batched separately — so the list can be worked top-to-bottom with no forward references.
