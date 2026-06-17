# Pages Inventory & Responsive Status

Tracks every visitable page in the app, how to reach it, and its responsive polish status across breakpoints.

**Breakpoints (based on Samsung Galaxy S25 + Galaxy Tab S9):**
- Desktop / Tab landscape: ≥ 1280px (baseline — already done; Tab S9 landscape = 1280px CSS px)
- Phone landscape + Tab portrait: 480px–1279px (S25 landscape = 780px, Tab S9 portrait = 800px)
- Phone portrait: ≤ 479px (S25 portrait = 360px CSS px)

**Sidebar behavior per group:**
- ≥ 1280px: always visible
- 480px–1279px: hamburger, slides in at 300px
- ≤ 479px: hamburger, full-screen

**Status legend:** ✅ Done · 🔲 Not started · 🚧 In progress

---

## Sidebar Nav Pages

### Main

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| Home | `/` | ✅ | ✅ | ✅ | ✅ |
| Steam Library | `/library` | ✅ | ✅ | ✅ | ✅ |
| Wishlist | `/wishlist` | ✅ | ✅ | ✅ | ✅ |
| Discover | `/discover` | 🔲 | 🔲 | 🔲 | 🔲 |
| Recommend | `/recommend` | 🔲 | 🔲 | 🔲 | 🔲 |
| Sale Alerts | `/alerts` | 🔲 | 🔲 | 🔲 | 🔲 |
| Calendar | `/calendar` | 🔲 | 🔲 | 🔲 | 🔲 |
| Top Games | `/top-games` | 🔲 | 🔲 | 🔲 | 🔲 |

### Collection

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| History | `/history` | ✅ | ✅ | ✅ | ✅ |
| In Progress | `/in-progress` | ✅ | ✅ | ✅ | ✅ |
| Backlog | `/backlog` | ✅ | ✅ | ✅ | ✅ |
| Favorites | `/favorites` | ✅ | ✅ | ✅ | ✅ |
| Abandoned | `/abandoned` | ✅ | ✅ | ✅ | ✅ |
| Completed | `/hall-of-fame` | ✅ | ✅ | ✅ | ✅ |
| Franchises | `/franchises` | ✅ | ✅ | ✅ | ✅ |

### Account / Meta

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| My Reviews | `/my-reviews` | 🔲 | 🔲 | 🔲 | 🔲 |
| Account | `/account` | 🔲 | 🔲 | 🔲 | 🔲 |
| Settings | `/settings` | 🔲 | 🔲 | 🔲 | 🔲 |

---

## Drilldown Pages

Reached by navigating from list pages, not direct sidebar links.

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| Game Detail | `/game/[appid]` | 🔲 | 🔲 | 🔲 | 🔲 |
| Journal Dashboard | `/journal/[appid]` | 🔲 | 🔲 | 🔲 | 🔲 |
| Journal – Achievements | `/journal/[appid]/achievements` | 🔲 | 🔲 | 🔲 | 🔲 |
| Journal – Notes | `/journal/[appid]/notes` | 🔲 | 🔲 | 🔲 | 🔲 |
| Journal – Progress | `/journal/[appid]/progress` | 🔲 | 🔲 | 🔲 | 🔲 |
| Journal – Pages | `/journal/[appid]/pages` | 🔲 | 🔲 | 🔲 | 🔲 |
| Community | `/community/[appid]` | 🔲 | 🔲 | 🔲 | 🔲 |
| Community Thread | `/community/[appid]/thread/[postId]` | 🔲 | 🔲 | 🔲 | 🔲 |
| Franchise Detail | `/franchise/[id]` | ✅ | ✅ | ✅ | ✅ |

---

## Other / Utility Routes

| Page | Route | Notes | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|-------|----------|----------|---------|---------|
| Table of Contents | `/toc` | Lists user-created custom pages | 🔲 | 🔲 | 🔲 | 🔲 |
| Custom Page | `/[pageId]` | Renders list / progress / notes / counter / etc. | 🔲 | 🔲 | 🔲 | 🔲 |
| Releases | `/releases` | Redirects to `/calendar?mode=releases` | — | — | — | — |

---

See [responsive-pages.md](responsive-pages.md) for the phased work plan.
