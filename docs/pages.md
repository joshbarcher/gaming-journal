# Pages Inventory & Responsive Status

Tracks every visitable page in the app, how to reach it, and its responsive polish status across breakpoints.

**Breakpoints:**
- Desktop: 1024px+ (baseline — already done)
- Tablet landscape: ~768px–1023px
- Tablet portrait: ~600px–767px
- Phone landscape: ~480px–599px
- Phone portrait: <480px

**Status legend:** ✅ Done · 🔲 Not started · 🚧 In progress

---

## Sidebar Nav Pages

### Main

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| Home | `/` | 🔲 | 🔲 | 🔲 | 🔲 |
| Steam Library | `/library` | 🔲 | 🔲 | 🔲 | 🔲 |
| Wishlist | `/wishlist` | 🔲 | 🔲 | 🔲 | 🔲 |
| Discover | `/discover` | 🔲 | 🔲 | 🔲 | 🔲 |
| Recommend | `/recommend` | 🔲 | 🔲 | 🔲 | 🔲 |
| Sale Alerts | `/alerts` | 🔲 | 🔲 | 🔲 | 🔲 |
| Calendar | `/calendar` | 🔲 | 🔲 | 🔲 | 🔲 |
| Top Games | `/top-games` | 🔲 | 🔲 | 🔲 | 🔲 |

### Collection

| Page | Route | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|----------|----------|---------|---------|
| History | `/history` | 🔲 | 🔲 | 🔲 | 🔲 |
| In Progress | `/in-progress` | 🔲 | 🔲 | 🔲 | 🔲 |
| Backlog | `/backlog` | 🔲 | 🔲 | 🔲 | 🔲 |
| Favorites | `/favorites` | 🔲 | 🔲 | 🔲 | 🔲 |
| Abandoned | `/abandoned` | 🔲 | 🔲 | 🔲 | 🔲 |
| Completed | `/hall-of-fame` | 🔲 | 🔲 | 🔲 | 🔲 |
| Franchises | `/franchises` | 🔲 | 🔲 | 🔲 | 🔲 |

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
| Franchise Detail | `/franchise/[id]` | 🔲 | 🔲 | 🔲 | 🔲 |

---

## Other / Utility Routes

| Page | Route | Notes | Tablet L | Tablet P | Phone L | Phone P |
|------|-------|-------|----------|----------|---------|---------|
| Table of Contents | `/toc` | Lists user-created custom pages | 🔲 | 🔲 | 🔲 | 🔲 |
| Custom Page | `/[pageId]` | Renders list / progress / notes / counter / etc. | 🔲 | 🔲 | 🔲 | 🔲 |
| Releases | `/releases` | Redirects to `/calendar?mode=releases` | — | — | — | — |

---

See [responsive-pages.md](responsive-pages.md) for the phased work plan.
