import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { globalSegments, percentToColor, percentToStateLabel } from './progress-helpers.js'
import { confirmDialog } from '../dialog.js'

// ── SVG icons (Lucide paths) ───────────────────────────────────────────────────

const _ic = (d, size = 14) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle">${d}</svg>`

const IC = {
    pin:    _ic(`<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>`),
    bars:   _ic(`<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`),
    check:  _ic(`<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`),
    file:   _ic(`<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>`),
    notes:  _ic(`<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><polyline points="15 3 15 9 21 9"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="12" y1="17" y2="17"/>`),
    hash:   _ic(`<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>`),
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _fmt(date) {
    if (!date) return ''
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function _cleanAchName(apiname) {
    return apiname
        .replace(/^[A-Z0-9]+_/, '')
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase())
}

function _progressPct(page) {
    if (page.type === 'progress') {
        const tasks = page.tasks ?? []
        if (!tasks.length) return 0
        return Math.round(tasks.filter(t => t.state === 'done').length / tasks.length * 100)
    }
    if (page.type === 'progress-bars') {
        const bars = page.bars ?? []
        if (!bars.length) return 0
        let done = 0, total = 0
        for (const bar of bars) {
            const chips = bar.chips ?? []
            done  += chips.filter(c => c.state === 'done').length
            total += chips.length
        }
        return total > 0 ? Math.round(done / total * 100) : 0
    }
    if (page.type === 'counter') {
        const target = page.target ?? 0
        return target > 0 ? Math.min(100, Math.round((page.current ?? 0) / target * 100)) : 0
    }
    if (page.type === 'multi-counter') {
        const counters = page.counters ?? []
        const totalT   = counters.reduce((s, c) => s + (c.target  ?? 0), 0)
        const totalC   = counters.reduce((s, c) => s + (c.current ?? 0), 0)
        return totalT > 0 ? Math.min(100, Math.round(totalC / totalT * 100)) : 0
    }
    return 0
}

// Must match review-modal.js: 1-5 = regular stars, 6 = Legendary (5 stars + badge)
const STAR_LABELS = ['Not Rated', '1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars', 'Legendary']
const RATING_KEYS = ['story', 'soundMusic', 'gameplay', 'graphics', 'replayability', 'performance', 'agendaFree']
const RATING_LBLS = { story: 'Story', soundMusic: 'Sound & Music', gameplay: 'Gameplay', graphics: 'Graphics', replayability: 'Replayability', performance: 'Performance', agendaFree: 'Agenda-Free' }

function _starsHtml(stars) {
    if (stars == null || stars === 0) return ''
    const isLegendary  = stars === 6
    const displayStars = isLegendary ? 5 : stars
    let out = ''
    for (let i = 1; i <= 5; i++) {
        out += `<span class="gj-star${i <= displayStars ? ' gj-star--on' : ''}">${i <= displayStars ? '★' : '☆'}</span>`
    }
    if (isLegendary) out += `<span class="gj-star-legendary">✦ Legendary</span>`
    return out
}

function _fmtHours(h) {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`
    return `${(Math.round(h * 10) / 10)}h`
}

/**
 * Merges achievements earned during an active session into the full achievement list
 * so counts and recent-unlock displays are immediately accurate without waiting for
 * the cache to refresh.
 */
function _mergeSessionAchievements(achList, achievementsDuring) {
    if (!achievementsDuring?.length) return achList
    const sessionMap = {}
    for (const a of achievementsDuring) sessionMap[a.apiname] = a
    return achList.map(a =>
        (!a.achieved && sessionMap[a.apiname])
            ? { ...a, achieved: 1, unlocktime: sessionMap[a.apiname].unlocktime ?? Math.floor(Date.now() / 1000) }
            : a
    )
}

/** Inner HTML for the recent-achievement strip used by the ach card (and its live patch). */
function _recentAchStripHtml(recent) {
    return recent.map(a => {
        const src        = a.localIcon ?? a.icon ?? null
        const fallback   = a.icon ?? null
        const name       = a.displayName ?? _cleanAchName(a.apiname)
        const date       = _fmt(new Date(a.unlocktime * 1000))
        const errHandler = src && fallback && src !== fallback
            ? `this.onerror=null;this.src='${fallback}'`
            : `this.style.visibility='hidden'`
        return `<div class="gj-ach-strip-item" title="${escapeHtml(name)}">
            ${src
              ? `<img class="gj-ach-strip-img" src="${src}" alt="" onerror="${errHandler}">`
              : `<div class="gj-ach-strip-fallback">${escapeHtml(name[0]?.toUpperCase() ?? '?')}</div>`}
            <span class="gj-ach-strip-name">${escapeHtml(name)}</span>
            <span class="gj-ach-strip-date">${date}</span>
        </div>`
    }).join('')
}

/**
 * Renders the session-achievement icons strip (or a no-data line) for a session card.
 * Returns the full inner HTML of the [data-role="session-achs-area"] container.
 */
function _sessionAchsHtml(achs, achMap, noDataMsg = 'No achievements this session') {
    if (!achs.length) return `<p class="gj-no-data">${escapeHtml(noDataMsg)}</p>`
    return `<div class="gj-session-achs">
        ${achs.slice(0, 8).map(a => {
            const full       = achMap[a.apiname]
            const name       = full?.displayName ?? _cleanAchName(a.apiname)
            const src        = full?.localIcon ?? full?.icon ?? null
            const fallback   = full?.icon ?? null
            const errHandler = src && fallback && src !== fallback
                ? `this.onerror=null;this.src='${fallback}'`
                : `this.style.visibility='hidden'`
            return `<div class="gj-session-ach" title="${escapeHtml(name)}">
                ${src
                  ? `<img class="gj-session-ach-img" src="${src}" alt="" onerror="${errHandler}">`
                  : `<div class="gj-session-ach-img gj-session-ach-img--fallback">${escapeHtml(name[0]?.toUpperCase() ?? '?')}</div>`}
            </div>`
        }).join('')}
        ${achs.length > 8 ? `<span class="gj-session-ach-more">+${achs.length - 8} more</span>` : ''}
    </div>`
}

// ── Module-level timers — survive re-renders, cleared on navigation ───────────

let _sessionTimer = null  // 30s tick — updates session elapsed display

// Dashboard live-update polling
let _dashPollTimer    = null  // 60s  — now-playing delta (session achs + ach card)
let _dataPollTimer    = null  // 5min — achievement cache + game data (HLTB pin)
let _schemaAwaitTimer = null  // 15s  — waits for achievement schema on brand-new games
let _rawAchList     = []    // base ach list without session-merge, kept fresh by slow poll
let _lastAchsDuring = []    // last known achievementsDuring from now-playing
let _hltbMilestones  = null  // [{label, h}] stored as side-effect by _hltbCard
let _hltbMaxScale    = null  // pre-computed scale for consistent pin positioning
let _basePlaytimeMin = 0     // relay effectiveMin at render time; timer adds delta-from-render, not session-start

function _clearSessionTimer() {
    if (_sessionTimer)      { clearInterval(_sessionTimer);      _sessionTimer      = null }
    if (_dashPollTimer)     { clearInterval(_dashPollTimer);     _dashPollTimer     = null }
    if (_dataPollTimer)     { clearInterval(_dataPollTimer);     _dataPollTimer     = null }
    if (_schemaAwaitTimer)  { clearInterval(_schemaAwaitTimer);  _schemaAwaitTimer  = null }
}

// ── Entry point ────────────────────────────────────────────────────────────────

export async function renderGameJournal(appid, sub, container, navigate) {
    if (sub === 'achievements') { _clearSessionTimer(); return _renderAchievements(appid, container) }
    if (sub === 'notes')        { _clearSessionTimer(); return _renderNotes(appid, container) }
    if (sub === 'progress')     { _clearSessionTimer(); return _renderProgress(appid, container, navigate) }
    if (sub === 'pages')        { _clearSessionTimer(); return _renderPages(appid, container, navigate) }
    await _renderDashboard(appid, container, navigate)
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

async function _renderDashboard(appid, container, navigate) {
    _clearSessionTimer()  // cancel any live timer from a previous render
    container.innerHTML = `<p class="page-loading">Loading journal…</p>`

    const [gameRes, reviewRes, pagesRes, achRes, accountRes, nowPlayingRes] = await Promise.allSettled([
        fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
        api.localReviews.get(appid).catch(() => null),
        api.pages.listByGame(appid).catch(() => []),
        fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null),
        fetch('/relay/api/account').then(r => r.ok ? r.json() : null),
        fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null),
    ])

    const game        = gameRes.value       ?? null
    const review      = reviewRes.value     ?? null
    const pages       = pagesRes.value      ?? []
    const achData     = achRes.value        ?? null
    const accountData = accountRes.value    ?? null
    const nowPlaying  = nowPlayingRes.value ?? null

    if (!game) {
        container.innerHTML = `<p class="page-error">Failed to load game data.</p>`
        return
    }

    const achList       = achData?.achievements ?? []
    const progressPages = pages.filter(p => ['progress', 'progress-bars', 'counter', 'multi-counter'].includes(p.type))
    const journalPages  = pages.filter(p => p.type === 'page'     || p.type === 'notes')
    const pinnedNotes   = (review?.notes ?? []).filter(n => n.pinned)
    // Sessions indexed by appid (may be numeric or string key)
    const gameSessions  = accountData?.sessions?.[appid]?.sessions
                       ?? accountData?.sessions?.[String(appid)]?.sessions
                       ?? []

    // If this game is currently being played, show a live current-session card
    const activeSession = nowPlaying?.playing?.appid === Number(appid)
        ? nowPlaying.playing
        : null

    // Merge in-session unlocks so achievement counts and recent-unlock lists are
    // immediately current without waiting for the 30-min cache refresh tick.
    const achievementsDuring = activeSession?.achievementsDuring ?? []
    const displayAchList     = _mergeSessionAchievements(achList, achievementsDuring)

    // Closed sessions sorted newest-first — drives the history rail
    const closedSessions = gameSessions
        .filter(s => s.endedAt)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))

    // game.playtimeMinutes is relay effectiveMin — the single source of truth.
    // It already includes live session elapsed up to this fetch, so we use it
    // directly as the HLTB pin base without adding any extra session time.
    const basePlaytimeMins = game.playtimeMinutes ?? 0
    const renderTime       = Date.now()  // marks when the base was captured

    container.innerHTML = `
        <div class="gj-dash">
            <div class="gj-header">
                <a href="/game/${appid}" class="gj-back">&#8592; ${escapeHtml(game.name)}</a>
                <span class="gj-header-title">Journal</span>
            </div>
            <div class="gj-grid${closedSessions.length ? ' gj-grid--with-history' : ''}">
                ${_ratingCard(review)}
                ${_achCard(displayAchList, appid)}
                ${activeSession
                    ? _currentSessionCard(activeSession, displayAchList, appid)
                    : _sessionCard(gameSessions, displayAchList, appid)}
                ${_hltbCard(game, 0, basePlaytimeMins)}
                ${closedSessions.length ? _sessionHistoryRail(closedSessions) : ''}
                ${_progressCard(progressPages, appid)}
                ${_notesAndPagesCard(pinnedNotes, journalPages, appid)}
            </div>
        </div>`

    _initDashboard(container, appid, game, navigate)

    // Start a live elapsed-time ticker if the game is actively being played.
    // renderTime is passed so the HLTB pin uses delta from render (not session start),
    // since effectiveMin already includes session elapsed up to render time.
    if (activeSession) _initSessionTimer(container, activeSession.sessionStartedAt, renderTime)

    // Persist poll baseline and kick off background delta-updaters
    _rawAchList      = achList
    _lastAchsDuring  = achievementsDuring
    _basePlaytimeMin = basePlaytimeMins
    _startDashPollers(container, appid, !!activeSession, navigate)
}

// ── Card HTML ──────────────────────────────────────────────────────────────────

function _ratingCard(review) {
    const stars   = review?.stars ?? null
    const ratings = review?.ratings ?? {}

    const headerRight = stars != null && stars > 0
        ? `<div class="gj-rating-header-stars">
               <div class="gj-rating-stars-row">${_starsHtml(stars)}</div>
               <span class="gj-rating-label">${STAR_LABELS[stars] ?? ''}</span>
           </div>`
        : `<span class="gj-no-data">No rating</span>`

    const ratedKeys = RATING_KEYS.filter(k => ratings[k] != null)
    const barsHtml = ratedKeys.length
        ? `<div class="gj-rating-bars">
              ${ratedKeys.map(k => `
              <div class="gj-rating-bar-labeled">
                  <div class="gj-rating-bar-fill" style="width:${ratings[k] * 10}%"></div>
                  <span class="gj-rating-bar-lbl">${RATING_LBLS[k]}</span>
                  <span class="gj-rating-bar-val">${ratings[k]}</span>
              </div>`).join('')}
           </div>`
        : `<p class="gj-no-data">Click to add a review</p>`

    return `
        <div class="gj-card gj-card--clickable" data-role="open-review">
            <div class="gj-card-header">
                <span class="gj-card-title">My Rating</span>
                ${headerRight}
            </div>
            ${barsHtml}
        </div>`
}

function _achCard(achList, appid) {
    const total    = achList.length
    const unlocked = achList.filter(a => a.achieved).length
    const pct      = total > 0 ? Math.round(unlocked / total * 100) : 0

    const recent = [...achList]
        .filter(a => a.achieved)
        .sort((a, b) => b.unlocktime - a.unlocktime)
        .slice(0, 4)

    const bodyHtml = total > 0
        ? `<div class="gj-ach-summary">
               <div class="gj-ach-summary-line">
                   <span data-role="ach-unlocked">${unlocked} / ${total} unlocked</span>
                   <span data-role="ach-pct">${pct}%</span>
               </div>
               <div class="gj-ach-track"><div class="gj-ach-fill" data-role="ach-fill" style="width:${pct}%"></div></div>
           </div>
           <div data-role="ach-recent-section">${recent.length
               ? `<p class="gj-ach-recent-label">Recent</p>
                  <div class="gj-ach-strip">${_recentAchStripHtml(recent)}</div>`
               : ''}</div>`
        : `<p class="gj-no-data">No achievement data</p>`

    return `
        <div class="gj-card" data-role="ach-card">
            <div class="gj-card-header">
                <span class="gj-card-title">Achievements</span>
                ${total > 0 ? `<a href="/journal/${appid}/achievements" class="gj-view-all">View All →</a>` : ''}
            </div>
            ${bodyHtml}
        </div>`
}

function _hltbCard(game, sessionElapsedMins = 0, basePlaytimeMins = null) {
    const playerHours = (basePlaytimeMins ?? game.playtimeMinutes ?? 0) / 60 + sessionElapsedMins / 60
    const hltb        = game.hltb?.matched ? game.hltb : null

    const milestones = [
        { label: 'Main',          h: hltb?.gameplayMain          },
        { label: 'Main + Extras', h: hltb?.gameplayMainExtra     },
        { label: 'Completionist', h: hltb?.gameplayCompletionist },
    ].filter(m => m.h != null && m.h > 0)

    // Store for live HLTB pin recalculation — null when no HLTB data available
    _hltbMilestones = milestones.length ? milestones : null
    _hltbMaxScale   = null   // computed below after we have the full value range

    if (!milestones.length) {
        return `
        <div class="gj-card gj-card--wide gj-card--hltb">
            <div class="gj-card-header"><span class="gj-card-title">How Long to Beat</span></div>
            <p class="gj-no-data">${playerHours > 0 ? `Played ${_fmtHours(playerHours)} — no HLTB data` : 'No playtime or HLTB data'}</p>
        </div>`
    }

    // Sqrt scale — prevents wide ranges from clustering left (mirrors game.js)
    const allVals  = [...milestones.map(m => m.h), playerHours > 0 ? playerHours : null].filter(Boolean)
    const maxScale = Math.max(...allVals) * 1.08
    _hltbMaxScale  = maxScale   // persist so delta updates use the same coordinate space
    const pct      = h => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    const labelsHtml = milestones.map(m =>
        `<span class="hltb-lbl" style="left:${pct(m.h).toFixed(2)}%">${escapeHtml(m.label)}</span>`
    ).join('')

    const ticksHtml = milestones.map(m =>
        `<div class="hltb-tick" style="left:${pct(m.h).toFixed(2)}%"></div>`
    ).join('')

    const hoursHtml = milestones.map(m =>
        `<span class="hltb-hr" style="left:${pct(m.h).toFixed(2)}%">${_fmtHours(m.h)}</span>`
    ).join('')

    const pinPos  = playerHours > 0 ? pct(playerHours) : null
    const fillPct = pinPos ?? pct(milestones[0].h)
    const pinHtml = pinPos != null
        ? `<div class="hltb-pin" data-role="hltb-pin" style="left:${pinPos.toFixed(2)}%" data-label="${_fmtHours(playerHours)} played"></div>`
        : ''

    return `
        <div class="gj-card gj-card--wide gj-card--hltb">
            <div class="hltb-bar-wrap">
                <div class="hltb-labels-row">
                    <span class="gj-hltb-overlay-title">How Long to Beat</span>
                    ${labelsHtml}
                </div>
                <div class="hltb-track-wrap">
                    <div class="hltb-track">
                        <div class="hltb-fill" data-role="hltb-fill" style="width:${fillPct.toFixed(2)}%"></div>
                    </div>
                    ${ticksHtml}
                    ${pinHtml}
                </div>
                <div class="hltb-hours-row">${hoursHtml}</div>
            </div>
        </div>`
}

function _notesCard(pinnedNotes, appid) {
    const notesHtml = pinnedNotes.length
        ? pinnedNotes.map(n => `
            <div class="gj-note-card" data-id="${escapeHtml(n.id)}">
                ${escapeHtml(n.text)}
                <div class="gj-note-btns">
                    <button class="gj-note-btn" data-role="unpin-note" data-id="${escapeHtml(n.id)}" title="Unpin">${IC.pin}</button>
                    <button class="gj-note-btn gj-note-btn--del" data-role="del-note" data-id="${escapeHtml(n.id)}" title="Delete">&times;</button>
                </div>
                <div class="gj-note-date">${_fmt(n.createdAt)}</div>
            </div>`).join('')
        : `<p class="gj-no-data" style="align-self:center">No pinned notes — add one below</p>`

    return `
        <div class="gj-card gj-card--wide" data-role="notes-card">
            <div class="gj-card-header">
                <span class="gj-card-title">Pinned Notes</span>
                <a href="/journal/${appid}/notes" class="gj-view-all">All Notes →</a>
            </div>
            <div class="gj-notes-row">${notesHtml}</div>
            <div class="gj-add-note">
                <input class="gj-add-note-input" placeholder="Quick note…" data-role="note-input">
                <button class="gj-pin-toggle" data-role="pin-toggle" title="Pin note">${IC.pin}</button>
                <button class="gj-btn gj-btn--accent" data-role="add-note">Add</button>
            </div>
        </div>`
}

function _progressCard(pages, appid) {
    if (!pages.length) {
        return `
        <div class="gj-card">
            <div class="gj-card-header">
                <span class="gj-card-title">Progress Trackers</span>
                <a href="/journal/${appid}/progress" class="gj-view-all">Manage →</a>
            </div>
            <p class="gj-no-data">No trackers yet</p>
        </div>`
    }

    const n    = pages.length
    const cols = n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5

    const cells = pages.map(p => {
        const pct   = _progressPct(p)
        const color = percentToColor(pct)
        const state = percentToStateLabel(pct)
        const tip   = state
            ? `${p.title} · ${state} (${pct}%)`
            : `${p.title} · ${pct}%`
        return `<a class="gj-heat-cell" href="/${p.id}" data-tooltip="${escapeHtml(tip)}" style="background:${color}"></a>`
    }).join('')

    return `
        <div class="gj-card gj-card--fill">
            <div class="gj-card-header">
                <span class="gj-card-title">Progress Trackers</span>
                <a href="/journal/${appid}/progress" class="gj-view-all">Manage →</a>
            </div>
            <div class="gj-heat-grid" style="--cols:${cols}">${cells}</div>
        </div>`
}

function _pagesCard(pages, appid) {
    const listHtml = pages.length
        ? pages.slice(0, 5).map(p => `
            <a class="gj-page-item" href="/${p.id}">
                <span class="gj-page-icon">${p.type === 'notes' ? IC.notes : IC.file}</span>
                <span class="gj-page-name">${escapeHtml(p.title)}</span>
                <span class="gj-page-date">${_fmt(p.updatedAt)}</span>
            </a>`).join('')
        : `<p class="gj-no-data">No pages yet</p>`

    return `
        <div class="gj-card">
            <div class="gj-card-header">
                <span class="gj-card-title">Journal Pages</span>
                <a href="/journal/${appid}/pages" class="gj-view-all">View All →</a>
            </div>
            <div class="gj-pages-list">${listHtml}</div>
            <div class="gj-card-actions">
                <button class="gj-btn" data-role="new-notes-page">+ New Page</button>
            </div>
        </div>`
}

function _currentSessionCard(session, achList, appid) {
    const achMap = {}
    for (const a of achList) achMap[a.apiname] = a

    const achs  = session.achievementsDuring ?? []
    const bgUrl = `/relay/images/steam/games/${appid}/header.jpg`

    return `
        <div class="gj-card gj-card--active-session gj-card--game-bg" data-role="playing-now" style="--gj-game-bg: url('${bgUrl}')">
            <div class="gj-card-header">
                <span class="gj-card-title">Playing Now</span>
                <span class="gj-active-dot"></span>
            </div>
            <div class="gj-session-stat">
                <span class="gj-session-big" data-role="session-elapsed">—</span>
                <span class="gj-session-sublabel">so far</span>
            </div>
            <p class="gj-ach-recent-label" data-role="session-ach-label"${achs.length ? '' : ' hidden'}>${achs.length ? `Earned (${achs.length})` : ''}</p>
            <div data-role="session-achs-area">${_sessionAchsHtml(achs, achMap, 'No achievements yet')}</div>
        </div>`
}

function _initSessionTimer(container, startedAt, renderTime = Date.now()) {
    const el = container.querySelector('[data-role="session-elapsed"]')
    if (!el) return

    const update = () => {
        // Display: elapsed since session start (correct for "playing for X time" label)
        const totalMins = Math.floor((Date.now() - new Date(startedAt)) / 60_000)
        const h = Math.floor(totalMins / 60)
        const m = totalMins % 60
        el.textContent = h > 0 ? `${h}h ${m}m` : `${m}m`
        // HLTB pin: _basePlaytimeMin is effectiveMin captured at render, which already
        // includes session elapsed up to then. Add only delta since render — not since
        // session start — to avoid double-counting.
        const deltaMins = Math.floor((Date.now() - renderTime) / 60_000)
        _patchHltbPin(container, _basePlaytimeMin + deltaMins)
    }
    update()
    _sessionTimer = setInterval(update, 30_000)
}

function _sessionCard(sessions, achList, appid) {
    const sorted = [...sessions].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    const last   = sorted[0] ?? null

    if (!last) {
        return `
        <div class="gj-card">
            <div class="gj-card-header"><span class="gj-card-title">Last Session</span></div>
            <p class="gj-no-data">No sessions recorded yet</p>
        </div>`
    }

    const mins     = last.durationMin ?? 0
    const duration = mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`
    const date     = _fmt(last.startedAt)
    const achs     = last.achievements ?? []
    const bgUrl    = `/relay/images/steam/games/${appid}/header.jpg`

    // Cross-reference session achievements with the full achievement list for icons/names
    const achMap = {}
    for (const a of achList) achMap[a.apiname] = a

    const achsHtml = _sessionAchsHtml(achs, achMap)

    return `
        <div class="gj-card gj-card--game-bg" style="--gj-game-bg: url('${bgUrl}')">
            <div class="gj-card-header">
                <span class="gj-card-title">Last Session</span>
                <span class="gj-session-date-chip">${date}</span>
            </div>
            <div class="gj-session-stat">
                <span class="gj-session-big">${duration}</span>
                <span class="gj-session-sublabel">played</span>
            </div>
            ${achs.length ? `<p class="gj-ach-recent-label">Earned (${achs.length})</p>` : ''}
            ${achsHtml}
        </div>`
}

function _sessionHistoryRail(closedSessions) {
    const chips = closedSessions.slice(0, 30).map(s => {
        const mins = s.durationMin ?? 0
        const h    = Math.floor(mins / 60)
        const m    = mins % 60
        const dur  = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
        const achs = s.achievements?.length ?? 0
        return `
        <div class="gj-session-chip">
            <span class="gj-session-chip-when">${_fmt(s.startedAt)}</span>
            <span class="gj-session-chip-dur">${dur || '—'}</span>
            <span class="gj-session-chip-achs">${achs ? `${achs} ach` : '—'}</span>
        </div>`
    }).join('')

    return `
        <div class="gj-card gj-card--wide gj-card--sessions-rail">
            <div class="gj-card-header">
                <span class="gj-card-title">Past Sessions</span>
                <span class="gj-sessions-count">${closedSessions.length} total</span>
            </div>
            <div class="gj-sessions-scroll">${chips}</div>
        </div>`
}

function _notesAndPagesCard(pinnedNotes, journalPages, appid) {
    return `
        <div class="gj-card gj-card--span2 gj-card--compact-np" data-role="notes-card">
            <div class="gj-cnp-body">
                <div class="gj-cnp-section">
                    <div class="gj-card-header">
                        <span class="gj-card-title">Pinned Notes</span>
                        <a href="/journal/${appid}/notes" class="gj-view-all">All (${pinnedNotes.length}) →</a>
                    </div>
                    <div class="gj-add-note" style="margin-top:auto">
                        <input class="gj-add-note-input" placeholder="Quick note…" data-role="note-input">
                        <button class="gj-pin-toggle" data-role="pin-toggle" title="Pin note">${IC.pin}</button>
                        <button class="gj-btn gj-btn--accent" data-role="add-note">Add</button>
                    </div>
                </div>
                <div class="gj-cnp-sep"></div>
                <div class="gj-cnp-section">
                    <div class="gj-card-header">
                        <span class="gj-card-title">Journal Pages</span>
                        <a href="/journal/${appid}/pages" class="gj-view-all">All (${journalPages.length}) →</a>
                    </div>
                    <div class="gj-card-actions" style="margin-top:auto">
                        <button class="gj-btn" data-role="new-notes-page">+ New Page</button>
                    </div>
                </div>
            </div>
        </div>`
}

// ── Dashboard live delta-update ────────────────────────────────────────────────

/**
 * Full card replacement — used when the achievement schema first arrives for a
 * brand-new game.  The "No achievement data" card has no patchable data-role
 * elements, so targeted patches silently no-op; we must replace the whole card.
 */
function _replaceAchCard(container, achList, appid) {
    const cardEl = container.querySelector('[data-role="ach-card"]')
    if (!cardEl) return
    const wrapper = document.createElement('div')
    wrapper.innerHTML = _achCard(achList, appid)
    const newCard = wrapper.firstElementChild
    if (newCard) cardEl.replaceWith(newCard)
}

/** Patches the achievement card counts, fill bar, and recent strip in-place. */
function _patchAchCard(container, achList) {
    const total    = achList.length
    const unlocked = achList.filter(a => a.achieved).length
    const pct      = total > 0 ? Math.round(unlocked / total * 100) : 0

    const unlockedEl = container.querySelector('[data-role="ach-unlocked"]')
    const pctEl      = container.querySelector('[data-role="ach-pct"]')
    const fillEl     = container.querySelector('[data-role="ach-fill"]')
    const recentEl   = container.querySelector('[data-role="ach-recent-section"]')

    if (unlockedEl) unlockedEl.textContent = `${unlocked} / ${total} unlocked`
    if (pctEl)      pctEl.textContent      = `${pct}%`
    if (fillEl)     fillEl.style.width     = `${pct}%`

    if (recentEl) {
        const recent = [...achList]
            .filter(a => a.achieved)
            .sort((a, b) => b.unlocktime - a.unlocktime)
            .slice(0, 4)
        recentEl.innerHTML = recent.length
            ? `<p class="gj-ach-recent-label">Recent</p>
               <div class="gj-ach-strip">${_recentAchStripHtml(recent)}</div>`
            : ''
    }
}

/**
 * Patches the achievement icons area on the "Playing Now" session card.
 * No-ops silently if the card isn't in the DOM (e.g. last-session card is shown).
 */
function _patchSessionAchs(container, achsDuring, displayAchList) {
    const labelEl = container.querySelector('[data-role="session-ach-label"]')
    const achsEl  = container.querySelector('[data-role="session-achs-area"]')
    if (!labelEl && !achsEl) return

    if (labelEl) {
        labelEl.textContent = achsDuring.length ? `Earned (${achsDuring.length})` : ''
        labelEl.hidden      = achsDuring.length === 0
    }

    if (achsEl) {
        const achMap = {}
        for (const a of displayAchList) achMap[a.apiname] = a
        achsEl.innerHTML = _sessionAchsHtml(achsDuring, achMap, 'No achievements yet')
    }
}

/**
 * Moves the HLTB pin and fill bar to reflect updated playtime.
 * Uses the coordinate space baked in at render time so tick labels stay aligned.
 */
function _patchHltbPin(container, playtimeMinutes) {
    if (!_hltbMilestones?.length || _hltbMaxScale == null || !(playtimeMinutes > 0)) return
    const playerHours = playtimeMinutes / 60
    const pct         = h => (Math.sqrt(h) / Math.sqrt(_hltbMaxScale)) * 100
    const pinPos      = pct(playerHours)

    const fillEl = container.querySelector('[data-role="hltb-fill"]')
    let   pinEl  = container.querySelector('[data-role="hltb-pin"]')

    // Create pin if it was absent at render time (player had 0 playtime when the
    // dashboard loaded, so no pin element was emitted in the initial HTML).
    if (!pinEl && fillEl) {
        pinEl = document.createElement('div')
        pinEl.className    = 'hltb-pin'
        pinEl.dataset.role = 'hltb-pin'
        fillEl.closest('.hltb-track-wrap')?.appendChild(pinEl)
    }

    if (pinEl) {
        pinEl.style.left    = `${pinPos.toFixed(2)}%`
        pinEl.dataset.label = `${_fmtHours(playerHours)} played`
    }
    if (fillEl) fillEl.style.width = `${pinPos.toFixed(2)}%`
}

/**
 * Short-term poller that fires every 15s waiting for the achievement schema
 * to arrive for a brand-new game.  Stops itself once data appears (max 2 min).
 * Called only when the dashboard opens with no achievement data + active session.
 */
function _startSchemaAwaitPoller(container, appid) {
    if (_schemaAwaitTimer) return   // already running
    const MAX_TRIES = 8             // 8 × 15s = 2 minutes max wait
    let tries = 0
    _schemaAwaitTimer = setInterval(async () => {
        tries++
        try {
            const data = await fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null)
            const achs = data?.achievements
            if (achs?.length) {
                clearInterval(_schemaAwaitTimer)
                _schemaAwaitTimer = null
                _rawAchList = achs
                _replaceAchCard(container, _mergeSessionAchievements(_rawAchList, _lastAchsDuring), appid)
                return
            }
        } catch { /* retry next tick */ }
        if (tries >= MAX_TRIES) { clearInterval(_schemaAwaitTimer); _schemaAwaitTimer = null }
    }, 15_000)
}

/**
 * Starts two background polling loops:
 *   fast (60s)  — fetches now-playing; patches in-session achs OR re-renders on session end
 *   slow (5min) — fetches achievements + game data for cache-backed counts + HLTB
 */
function _startDashPollers(container, appid, hasActiveSession, navigate) {
    // Short-term schema poller — brand-new games have no cached achievement data yet.
    if (hasActiveSession && _rawAchList.length === 0) {
        _startSchemaAwaitPoller(container, appid)
    }

    // Fast loop — only when a game is actively playing
    if (hasActiveSession) {
        _dashPollTimer = setInterval(async () => {
            try {
                const np      = await fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null)
                const session = np?.playing?.appid === Number(appid) ? np.playing : null

                // Session ended — do a full re-render so the card flips to "Last Session"
                if (!session) {
                    _clearSessionTimer()
                    _renderDashboard(appid, container, navigate)
                    return
                }

                const achsDuring = session.achievementsDuring ?? []

                // Only patch when the achievement list actually changed
                const changed = achsDuring.length !== _lastAchsDuring.length ||
                    (achsDuring.length > 0 &&
                     achsDuring[achsDuring.length - 1]?.apiname !== _lastAchsDuring[_lastAchsDuring.length - 1]?.apiname)

                if (changed) {
                    _lastAchsDuring = achsDuring
                    const display   = _mergeSessionAchievements(_rawAchList, achsDuring)
                    _patchAchCard(container, display)
                    _patchSessionAchs(container, achsDuring, display)
                }
            } catch { /* silent — next tick retries */ }
        }, 60_000)
    }

    // Slow loop — always; refreshes achievement cache counts + HLTB pin
    _dataPollTimer = setInterval(async () => {
        try {
            const [achRes, gameRes] = await Promise.allSettled([
                fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null),
                fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
            ])

            const newRaw  = achRes.value?.achievements
            const newGame = gameRes.value

            if (newRaw) {
                const prevTotal    = _rawAchList.length
                const prevUnlocked = _rawAchList.filter(a => a.achieved).length
                _rawAchList        = newRaw   // always refresh for future merges
                const newUnlocked  = newRaw.filter(a => a.achieved).length

                if (newRaw.length !== prevTotal) {
                    // Schema appeared (or achievement list grew) — full card swap needed
                    // because "No achievement data" has no patchable elements.
                    _replaceAchCard(container, _mergeSessionAchievements(_rawAchList, _lastAchsDuring), appid)
                    if (_schemaAwaitTimer) { clearInterval(_schemaAwaitTimer); _schemaAwaitTimer = null }
                } else if (newUnlocked !== prevUnlocked) {
                    _patchAchCard(container, _mergeSessionAchievements(_rawAchList, _lastAchsDuring))
                }
            }

            if (newGame?.playtimeMinutes != null) {
                const hasSessionTimer = !!container.querySelector('[data-role="session-elapsed"]')
                if (hasSessionTimer) {
                    // Session timer owns the HLTB pin — it adds delta from renderTime on top
                    // of _basePlaytimeMin.  Don't update _basePlaytimeMin here: effectiveMin
                    // at poll time already includes live elapsed, and the timer would then add
                    // it again (double-count).  The full re-render on session end resets all state.
                } else {
                    // No active session — safe to advance base directly from effectiveMin.
                    _basePlaytimeMin = Math.max(_basePlaytimeMin, newGame.playtimeMinutes)
                    _patchHltbPin(container, _basePlaytimeMin)
                }
            }
        } catch { /* silent — next tick retries */ }
    }, 5 * 60_000)
}

// ── Dashboard interactions ─────────────────────────────────────────────────────

function _initDashboard(container, appid, game, navigate) {
    let _pinned = false
    const pinToggle = container.querySelector('[data-role="pin-toggle"]')
    pinToggle?.addEventListener('click', () => {
        _pinned = !_pinned
        pinToggle.classList.toggle('active', _pinned)
    })

    const noteInput = container.querySelector('[data-role="note-input"]')
    const doAdd = () => _doAddNote(appid, noteInput, () => _pinned, container, navigate)
    container.querySelector('[data-role="add-note"]')?.addEventListener('click', doAdd)
    noteInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAdd() }
    })

    container.querySelector('[data-role="notes-card"]')?.addEventListener('click', async e => {
        const btn = e.target.closest('button[data-id]')
        if (!btn) return
        const id = btn.dataset.id
        if (btn.dataset.role === 'unpin-note') {
            await api.localReviews.updateNote(appid, id, { pinned: false })
            _renderDashboard(appid, container, navigate)
        } else if (btn.dataset.role === 'del-note') {
            await api.localReviews.deleteNote(appid, id)
            _renderDashboard(appid, container, navigate)
        }
    })

    container.querySelector('[data-role="open-review"]')?.addEventListener('click', async () => {
        const { openReviewModal } = await import('../review-modal.js')
        const res = await fetch(`/api/local-reviews/${appid}`)
        const existing = res.ok ? await res.json() : null
        await openReviewModal(appid, game.name, existing)
        _renderDashboard(appid, container, navigate)
    })

    // Heatmap tooltip delegation
    const heatGrid = container.querySelector('.gj-heat-grid')
    if (heatGrid) {
        let _lastHeatTip = null
        heatGrid.addEventListener('mouseover', e => {
            const cell = e.target.closest('.gj-heat-cell[data-tooltip]')
            if (cell === _lastHeatTip) return
            _lastHeatTip = cell
            if (cell) _showTip(cell.dataset.tooltip, cell.getBoundingClientRect())
            else _hideTip()
        })
        heatGrid.addEventListener('mouseleave', () => { _lastHeatTip = null; _hideTip() })
    }

    container.querySelector('[data-role="new-notes-page"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'notes', title: 'New Page', appid: String(appid) })
        if (page) navigate(page.id)
    })
}

async function _doAddNote(appid, input, getPinned, container, navigate) {
    const text = input?.value.trim()
    if (!text) return
    const note = await api.localReviews.addNote(appid, text)
    if (getPinned() && note?.id) {
        await api.localReviews.updateNote(appid, note.id, { pinned: true })
    }
    _renderDashboard(appid, container, navigate)
}

// ── Achievement tooltip ────────────────────────────────────────────────────────

let _achTipEl = null

function _showTip(text, rect) {
    if (!_achTipEl) {
        _achTipEl = document.createElement('div')
        _achTipEl.className = 'gj-tooltip'
        document.body.appendChild(_achTipEl)
    }
    _achTipEl.textContent = text
    _achTipEl.style.display = 'block'
    // Measure after paint so we have real dimensions to position against
    requestAnimationFrame(() => {
        if (!_achTipEl) return
        const tw  = _achTipEl.offsetWidth
        const th  = _achTipEl.offsetHeight
        const gap = 8
        let x = rect.left + rect.width / 2 - tw / 2
        let y = rect.top - th - gap
        if (y < gap) y = rect.bottom + gap          // flip below if too close to top
        _achTipEl.style.left = Math.max(gap, Math.min(x, window.innerWidth  - tw - gap)) + 'px'
        _achTipEl.style.top  = Math.max(gap, Math.min(y, window.innerHeight - th - gap)) + 'px'
    })
}

function _hideTip() {
    if (_achTipEl) _achTipEl.style.display = 'none'
}

// ── Sub-view: Achievements ─────────────────────────────────────────────────────

async function _renderAchievements(appid, container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    const [achRes, npRes] = await Promise.allSettled([
        fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    const rawAchList    = achRes.value?.achievements ?? []
    const nowPlaying    = npRes.value ?? null
    const activeSession = nowPlaying?.playing?.appid === Number(appid) ? nowPlaying.playing : null
    // Merge any achievements earned in the current session so this view stays current
    const achList       = _mergeSessionAchievements(rawAchList, activeSession?.achievementsDuring)

    const unlocked     = achList.filter(a => a.achieved).sort((a, b) => b.unlocktime - a.unlocktime)
    const lockedVis    = achList.filter(a => !a.achieved && !a.hidden)
    const lockedHidden = achList.filter(a => !a.achieved && a.hidden)

    let showHidden = false

    function _draw() {
        container.innerHTML = `
            <div class="gj-sub-header">
                <a href="/journal/${appid}" class="gj-sub-back">&#8592; Journal</a>
                <span class="gj-sub-title">Achievements</span>
                ${lockedHidden.length ? `
                <div class="gj-sub-actions">
                    <label class="gj-ach-toggle">
                        <input type="checkbox" data-role="show-hidden" ${showHidden ? 'checked' : ''}>
                        Show hidden (${lockedHidden.length})
                    </label>
                </div>` : ''}
            </div>
            ${!achList.length ? `<p class="gj-no-data">No achievement data available.</p>` : ''}
            ${unlocked.length ? `
            <p class="gj-ach-section-label">Unlocked (${unlocked.length})</p>
            <div class="gj-ach-grid">
                ${unlocked.map(a => _achItem(a, true, false)).join('')}
            </div>` : ''}
            ${lockedVis.length ? `
            <p class="gj-ach-section-label">Locked (${lockedVis.length})</p>
            <div class="gj-ach-grid">
                ${lockedVis.map(a => _achItem(a, false, false)).join('')}
            </div>` : ''}
            ${showHidden && lockedHidden.length ? `
            <p class="gj-ach-section-label">Hidden (${lockedHidden.length})</p>
            <div class="gj-ach-grid">
                ${lockedHidden.map(a => _achItem(a, false, true)).join('')}
            </div>` : ''}`

        container.querySelector('[data-role="show-hidden"]')?.addEventListener('change', e => {
            showHidden = e.target.checked
            _draw()
        })
    }

    _draw()

    // Tooltip delegation — survives _draw() re-renders since it's on the container
    let _lastTipTarget = null
    container.addEventListener('mouseover', e => {
        const el = e.target.closest('[data-tooltip]')
        if (el === _lastTipTarget) return
        _lastTipTarget = el
        if (el) _showTip(el.dataset.tooltip, el.getBoundingClientRect())
        else _hideTip()
    })
    container.addEventListener('mouseleave', () => { _lastTipTarget = null; _hideTip() })
}

function _achItem(a, isUnlocked, isHidden) {
    const name        = a.displayName ?? _cleanAchName(a.apiname)
    const localSrc    = isUnlocked ? (a.localIcon ?? null) : (a.localIconGray ?? null)
    const cdnFallback = isUnlocked ? (a.icon ?? null)      : (a.icongray ?? a.icon ?? null)
    const imgSrc      = localSrc ?? cdnFallback
    const letter      = name[0]?.toUpperCase() ?? '?'
    const date        = isUnlocked && a.unlocktime ? _fmt(new Date(a.unlocktime * 1000)) : ''
    const desc        = !isHidden ? (a.description ?? '') : ''
    const badgeCls    = isUnlocked ? 'gj-ach-badge--unlocked' : 'gj-ach-badge--locked'

    const errHandler = localSrc && cdnFallback
        ? `this.onerror=null;this.src='${cdnFallback}'`
        : `this.outerHTML='<div class="gj-ach-badge ${badgeCls}">${letter}</div>'`

    const badgeHtml = imgSrc
        ? `<img class="gj-ach-badge" src="${imgSrc}" onerror="${errHandler}">`
        : `<div class="gj-ach-badge ${badgeCls}">${letter}</div>`

    return `
        <div class="gj-ach-full-item ${isUnlocked ? 'gj-ach-full-item--unlocked' : ''}">
            ${badgeHtml}
            <div class="gj-ach-info">
                <div class="gj-ach-full-name" data-tooltip="${escapeHtml(name)}">${escapeHtml(name)}</div>
                ${desc ? `<div class="gj-ach-full-desc" data-tooltip="${escapeHtml(desc)}">${escapeHtml(desc)}</div>` : ''}
                ${date ? `<div class="gj-ach-full-date">${date}</div>` : ''}
            </div>
        </div>`
}

// ── Sub-view: Notes ────────────────────────────────────────────────────────────

async function _renderNotes(appid, container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    const reviewRes = await api.localReviews.get(appid).catch(() => null)

    function _draw(review) {
        const notes   = review?.notes ?? []
        const pinned  = notes.filter(n => n.pinned)
        const regular = notes.filter(n => !n.pinned)
        const all     = [...pinned, ...regular]

        let _pinActive = false

        container.innerHTML = `
            <div class="gj-sub-header">
                <a href="/journal/${appid}" class="gj-sub-back">&#8592; Journal</a>
                <span class="gj-sub-title">Notes</span>
            </div>
            <div class="gj-add-note" style="margin-bottom:20px">
                <input class="gj-add-note-input" placeholder="New note…" data-role="note-input">
                <button class="gj-pin-toggle" data-role="pin-toggle" title="Pin note">${IC.pin}</button>
                <button class="gj-btn gj-btn--accent" data-role="add-note">Add</button>
            </div>
            ${all.length ? `
            <div class="gj-notes-full-grid">
                ${all.map(n => `
                <div class="gj-note-full-card ${n.pinned ? 'gj-note-full-card--pinned' : ''}" data-id="${escapeHtml(n.id)}">
                    ${escapeHtml(n.text)}
                    <div class="gj-note-full-btns">
                        <button class="gj-note-btn" data-role="toggle-pin" data-id="${escapeHtml(n.id)}" data-pinned="${n.pinned}" title="${n.pinned ? 'Unpin' : 'Pin'}">${IC.pin}</button>
                        <button class="gj-note-btn gj-note-btn--del" data-role="del-note" data-id="${escapeHtml(n.id)}" title="Delete">&times;</button>
                    </div>
                    <div class="gj-note-date">${_fmt(n.createdAt)}</div>
                </div>`).join('')}
            </div>` : `<p class="gj-no-data">No notes yet.</p>`}`

        const pinToggle = container.querySelector('[data-role="pin-toggle"]')
        pinToggle?.addEventListener('click', () => {
            _pinActive = !_pinActive
            pinToggle.classList.toggle('active', _pinActive)
        })

        const noteInput = container.querySelector('[data-role="note-input"]')
        const doAdd = async () => {
            const text = noteInput?.value.trim()
            if (!text) return
            const note = await api.localReviews.addNote(appid, text)
            if (_pinActive && note?.id) await api.localReviews.updateNote(appid, note.id, { pinned: true })
            const updated = await api.localReviews.get(appid).catch(() => null)
            _draw(updated)
        }
        container.querySelector('[data-role="add-note"]')?.addEventListener('click', doAdd)
        noteInput?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doAdd() } })

        container.querySelectorAll('[data-role="toggle-pin"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const isPinned = btn.dataset.pinned === 'true'
                await api.localReviews.updateNote(appid, btn.dataset.id, { pinned: !isPinned })
                const updated = await api.localReviews.get(appid).catch(() => null)
                _draw(updated)
            })
        })

        container.querySelectorAll('[data-role="del-note"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await api.localReviews.deleteNote(appid, btn.dataset.id)
                const updated = await api.localReviews.get(appid).catch(() => null)
                _draw(updated)
            })
        })
    }

    _draw(reviewRes)
}

// ── Sub-view: Progress ─────────────────────────────────────────────────────────

const _TRACKER_TYPES = ['progress', 'progress-bars', 'counter', 'multi-counter']

const _TRACKER_META = {
    'progress':       { label: 'Progress tracker',  icon: () => IC.check },
    'progress-bars':  { label: 'Multi-bar tracker',  icon: () => IC.bars  },
    'counter':        { label: 'Counter',             icon: () => IC.hash  },
    'multi-counter':  { label: 'Multi-counter',       icon: () => IC.hash  },
}

async function _renderProgress(appid, container, navigate) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    const pagesRes = await api.pages.listByGame(appid).catch(() => [])
    const pages    = (pagesRes ?? []).filter(p => _TRACKER_TYPES.includes(p.type))

    container.innerHTML = `
        <div class="gj-sub-header">
            <a href="/journal/${appid}" class="gj-sub-back">&#8592; Journal</a>
            <span class="gj-sub-title">Progress Trackers</span>
            <div class="gj-sub-actions">
                <button class="gj-btn" data-role="new-tracker">+ Progress</button>
                <button class="gj-btn" data-role="new-tracker-bars">+ Multi-Bar</button>
                <button class="gj-btn" data-role="new-counter">+ Counter</button>
                <button class="gj-btn" data-role="new-multi-counter">+ Multi-Counter</button>
            </div>
        </div>
        <div class="gj-full-list" data-role="tracker-list">
            ${pages.map(p => {
                const meta     = _TRACKER_META[p.type] ?? _TRACKER_META['progress']
                const segs     = globalSegments(p)
                const segsHtml = segs.length
                    ? segs.map(s => `<div class="gj-prog-seg" style="background:${s.color}" title="${escapeHtml(s.label ?? '')}"></div>`).join('')
                    : `<div class="gj-prog-seg" style="background:rgba(255,255,255,0.07);flex:1"></div>`
                return `
                <a class="gj-full-item" href="/${p.id}" data-page-id="${escapeHtml(p.id)}" data-page-title="${escapeHtml(p.title)}">
                    <span class="gj-full-item-icon">${meta.icon()}</span>
                    <div class="gj-full-item-body">
                        <div class="gj-full-item-title">${escapeHtml(p.title)}</div>
                        <div class="gj-full-item-meta">${meta.label} · Updated ${_fmt(p.updatedAt)}</div>
                        <div class="gj-prog-segs gj-prog-segs--full">${segsHtml}</div>
                    </div>
                    <button class="gj-full-item-del" data-role="tracker-delete" title="Delete tracker">&times;</button>
                </a>`
            }).join('')}
            ${!pages.length ? `<p class="gj-no-data">No trackers yet. Create one to start tracking progress.</p>` : ''}
        </div>`

    container.querySelector('[data-role="tracker-list"]')?.addEventListener('click', async e => {
        const btn = e.target.closest('[data-role="tracker-delete"]')
        if (!btn) return
        e.preventDefault()
        e.stopPropagation()
        const item      = btn.closest('.gj-full-item[data-page-id]')
        const pageId    = item?.dataset.pageId
        const pageTitle = item?.dataset.pageTitle
        if (!pageId) return
        const ok = await confirmDialog(
            `Delete "${pageTitle}"?`,
            'This will permanently delete the tracker and all its data.',
            'Delete'
        )
        if (!ok) return
        await api.pages.remove(pageId)
        _renderProgress(appid, container, navigate)
    })

    container.querySelector('[data-role="new-tracker"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'progress', title: 'New Tracker', appid: String(appid) })
        if (page) navigate(page.id)
    })

    container.querySelector('[data-role="new-tracker-bars"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'progress-bars', title: 'New Multi-Bar', appid: String(appid) })
        if (page) navigate(page.id)
    })

    container.querySelector('[data-role="new-counter"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'counter', title: 'New Counter', appid: String(appid), current: 0, target: 10 })
        if (page) navigate(page.id)
    })

    container.querySelector('[data-role="new-multi-counter"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'multi-counter', title: 'New Multi-Counter', appid: String(appid), counters: [] })
        if (page) navigate(page.id)
    })
}

// ── Sub-view: Pages ────────────────────────────────────────────────────────────

async function _renderPages(appid, container, navigate) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    const pagesRes = await api.pages.listByGame(appid).catch(() => [])
    const pages    = (pagesRes ?? []).filter(p => p.type === 'page' || p.type === 'notes')

    container.innerHTML = `
        <div class="gj-sub-header">
            <a href="/journal/${appid}" class="gj-sub-back">&#8592; Journal</a>
            <span class="gj-sub-title">Journal Pages</span>
            <div class="gj-sub-actions">
                <button class="gj-btn" data-role="new-page">+ New Page</button>
            </div>
        </div>
        <div class="gj-full-list">
            ${pages.map(p => `
            <a class="gj-full-item" href="/${p.id}">
                <span class="gj-full-item-icon">${p.type === 'notes' ? IC.notes : IC.file}</span>
                <div class="gj-full-item-body">
                    <div class="gj-full-item-title">${escapeHtml(p.title)}</div>
                    <div class="gj-full-item-meta">${p.type === 'notes' ? 'Notes page' : 'Rich page'} · Updated ${_fmt(p.updatedAt)}</div>
                </div>
            </a>`).join('')}
            ${!pages.length ? `<p class="gj-no-data">No pages yet. Create one to start writing.</p>` : ''}
        </div>`

    container.querySelector('[data-role="new-page"]')?.addEventListener('click', async () => {
        const page = await api.pages.create({ type: 'notes', title: 'New Page', appid: String(appid) })
        if (page) navigate(page.id)
    })
}
