import { escapeHtml } from '../utils.js'

const STAR_CHARS = ['', '★', '★★', '★★★', '★★★★', '★★★★★', '✦']

function _starDisplay(stars) {
    if (!stars || stars <= 0) return ''
    const items = []
    for (let i = 1; i <= Math.min(stars, 6); i++) {
        if (i === 6) {
            items.push(`<span class="mr-card-star mr-card-star--legendary">✦</span>`)
        } else {
            items.push(`<span class="mr-card-star">★</span>`)
        }
    }
    return items.join('')
}

function _buildCard(appid, review, gameInfo, navigate) {
    const name    = gameInfo?.name ?? `App ${appid}`
    const imgUrl  = `/relay/images/steam/games/${appid}/header.jpg`
    const stars   = review.stars ?? 0
    const tags    = review.tags ?? []
    const excerpt = review.review ?? ''

    const starsHtml = stars > 0
        ? `<div class="mr-card-stars">${_starDisplay(stars)}</div>`
        : ''

    const tagsHtml = tags.length
        ? `<div class="mr-card-tags">${tags.slice(0, 3).map(t =>
            `<span class="mr-card-tag">${escapeHtml(t)}</span>`
          ).join('')}</div>`
        : ''

    const excerptHtml = excerpt
        ? `<div class="mr-card-excerpt">${escapeHtml(excerpt)}</div>`
        : ''

    const imgClass = 'mr-card-img' + (stars === 0 ? ' mr-card-img--unrated' : '')

    const card = document.createElement('a')
    card.className = 'mr-card'
    card.href = `/game/${appid}`
    card.innerHTML = `
        <div class="mr-card-img-wrap">
            <img class="${imgClass}" src="${imgUrl}" alt="${escapeHtml(name)}"
                 onerror="this.style.opacity='0.3'">
            ${starsHtml}
        </div>
        <div class="mr-card-body">
            <div class="mr-card-name">${escapeHtml(name)}</div>
            ${tagsHtml}
            ${excerptHtml}
        </div>`

    card.addEventListener('click', e => {
        e.preventDefault()
        navigate(`game/${appid}`)
    })

    return card
}

export async function renderMyReviews(container, navigate) {
    container.innerHTML = `<p class="page-loading">Loading reviews…</p>`

    let reviews = {}
    let gamesMap = {}

    try {
        const [reviewsRes, gamesRes] = await Promise.all([
            fetch('/api/local-reviews'),
            fetch('/relay/api/steam/games'),
        ])
        if (reviewsRes.ok) reviews = await reviewsRes.json()
        if (gamesRes.ok) {
            const gamesRaw = await gamesRes.json()
            const gamesArr = Array.isArray(gamesRaw) ? gamesRaw
                : Array.isArray(gamesRaw?.games) ? gamesRaw.games
                : []
            for (const g of gamesArr) {
                if (g?.appid) gamesMap[String(g.appid)] = g
            }
        }
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load reviews: ${escapeHtml(err.message)}</p>`
        return
    }

    const allEntries = Object.entries(reviews)

    if (!allEntries.length) {
        container.innerHTML = `
            <div class="mr-header">
                <div class="mr-header-eyebrow">Collection</div>
                <h1>My Reviews</h1>
            </div>
            <div class="mr-grid">
                <div class="mr-empty">
                    <div class="mr-empty-title">No reviews yet</div>
                    <div class="mr-empty-sub">Visit a game page and write your first review.</div>
                </div>
            </div>`
        return
    }

    // Sort state
    let sortBy  = 'stars'
    let search  = ''

    container.innerHTML = `
        <div class="mr-header">
            <div class="mr-header-eyebrow">Collection</div>
            <h1>My Reviews</h1>
        </div>
        <div class="mr-controls">
            <input class="mr-search" type="search" placeholder="Search by name or tag…" value="">
            <select class="mr-sort">
                <option value="stars">By Stars</option>
                <option value="name">By Name</option>
                <option value="recent">Recently Reviewed</option>
            </select>
        </div>
        <div class="mr-grid"></div>`

    const searchInput = container.querySelector('.mr-search')
    const sortSelect  = container.querySelector('.mr-sort')
    const grid        = container.querySelector('.mr-grid')

    function _render() {
        const q = search.toLowerCase().trim()

        let entries = allEntries.filter(([appid, rev]) => {
            if (!q) return true
            const name = (gamesMap[String(appid)]?.name ?? '').toLowerCase()
            const tags = (rev.tags ?? []).map(t => t.toLowerCase())
            return name.includes(q) || tags.some(t => t.includes(q))
        })

        entries = entries.sort(([aId, aRev], [bId, bRev]) => {
            if (sortBy === 'stars') {
                const diff = (bRev.stars ?? 0) - (aRev.stars ?? 0)
                if (diff !== 0) return diff
                const aName = gamesMap[String(aId)]?.name ?? ''
                const bName = gamesMap[String(bId)]?.name ?? ''
                return aName.localeCompare(bName)
            }
            if (sortBy === 'name') {
                const aName = gamesMap[String(aId)]?.name ?? ''
                const bName = gamesMap[String(bId)]?.name ?? ''
                return aName.localeCompare(bName)
            }
            if (sortBy === 'recent') {
                const aDate = aRev.updatedAt ?? ''
                const bDate = bRev.updatedAt ?? ''
                return bDate.localeCompare(aDate)
            }
            return 0
        })

        grid.innerHTML = ''

        if (!entries.length) {
            const empty = document.createElement('div')
            empty.className = 'mr-empty'
            empty.innerHTML = `<div class="mr-empty-title">No results</div><div class="mr-empty-sub">Try a different search.</div>`
            grid.appendChild(empty)
            return
        }

        for (const [appid, rev] of entries) {
            const gameInfo = gamesMap[String(appid)]
            grid.appendChild(_buildCard(appid, rev, gameInfo, navigate))
        }
    }

    searchInput.addEventListener('input', () => {
        search = searchInput.value
        _render()
    })

    sortSelect.addEventListener('change', () => {
        sortBy = sortSelect.value
        _render()
    })

    _render()
}
