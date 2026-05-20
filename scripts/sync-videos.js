/**
 * sync-videos.mjs — Download Steam store trailers to local NAS storage.
 *
 * Usage:
 *   node --env-file .env scripts/sync-videos.js
 *   node --env-file .env scripts/sync-videos.js --force    # re-download existing files
 *   node --env-file .env scripts/sync-videos.js --dry-run  # show what would be downloaded
 *
 * Steam now serves trailers as HLS/DASH streams (not direct files).
 * This script downloads via ffmpeg, which selects the highest-quality
 * variant from the HLS master playlist automatically.
 *
 * Output layout:
 *   $DATA_DIR/relay/steam/videos/{appid}/0.mp4   ← highlight trailer
 *   $DATA_DIR/relay/steam/videos/{appid}/1.mp4   ← additional trailers
 *   $DATA_DIR/relay/steam/movies/{appid}.json    ← metadata cache (avoids re-fetching)
 *   $DATA_DIR/relay/steam/video-sync-errors.json ← written on completion if any errors
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { join }                                from 'node:path'
import { spawn }                               from 'node:child_process'

// ── Config ────────────────────────────────────────────────────────────────────

const DATA_DIR      = process.env.DATA_DIR ?? String.raw`\\192.168.86.74\app-data`
const GAMES_FILE          = join(DATA_DIR, 'relay', 'steam', 'games.json')
const STEAM_WISHLIST_FILE = join(DATA_DIR, 'relay', 'steam', 'wishlist.json')
const LOCAL_WISHLIST_FILE = join(DATA_DIR, 'gaming-journal', 'local-wishlist.json')
const MOVIES_DIR          = join(DATA_DIR, 'relay', 'steam', 'movies')
const VIDEOS_DIR          = join(DATA_DIR, 'relay', 'steam', 'videos')

const FORCE   = process.argv.includes('--force')
const DRY_RUN = process.argv.includes('--dry-run')

// Steam rate-limit headroom: ~200 req / 5 min → safe at 1.5s between uncached calls
const API_DELAY_MS        = 1_500
const RATE_LIMIT_BACKOFF  = 90_000   // wait 90s if we hit a 429
const MAX_TRAILERS_PER_GAME = 5      // cap per game (most have 1-3)

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fileExists(p) {
    try { await access(p); return true } catch { return false }
}

function pad(n, total) { return String(n).padStart(String(total).length) }

// ── Steam API ─────────────────────────────────────────────────────────────────

async function fetchMovies(appid) {
    const cache = join(MOVIES_DIR, `${appid}.json`)

    if (!FORCE && await fileExists(cache)) {
        const { movies } = JSON.parse(await readFile(cache, 'utf8'))
        return { movies: movies ?? [], cached: true }
    }

    const url  = `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=movies`
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })

    if (resp.status === 429) throw Object.assign(new Error('rate-limited'), { rateLimited: true })
    if (!resp.ok)            throw new Error(`HTTP ${resp.status}`)

    const json   = await resp.json()
    const entry  = json?.[String(appid)]
    const movies = (entry?.success && Array.isArray(entry.data?.movies))
        ? entry.data.movies
        : []

    await mkdir(MOVIES_DIR, { recursive: true })
    await writeFile(cache, JSON.stringify({ fetchedAt: new Date().toISOString(), movies }), 'utf8')

    return { movies, cached: false }
}

// ── ffmpeg download ───────────────────────────────────────────────────────────

// ffmpeg's HLS demuxer selects the highest-bandwidth variant from the master
// playlist by default, giving maximum quality without needing extra flags.
function ffmpegDownload(url, outPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', [
            '-loglevel', 'warning',
            '-stats',
            '-i',         url,
            '-c',         'copy',
            '-movflags',  '+faststart',
            '-y',
            outPath,
        ])

        let errBuf = ''
        proc.stderr.on('data', chunk => { errBuf += chunk })

        proc.on('close', code => {
            if (code === 0) resolve()
            else            reject(new Error(`ffmpeg exit ${code}: ${errBuf.slice(-400).trim()}`))
        })

        proc.on('error', reject)
    })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const { games = [] } = JSON.parse(await readFile(GAMES_FILE, 'utf8'))

    const libraryIds = new Set(games.map(g => g.appid))

    // Steam wishlist: { items: { "appid": { priority, date_added } } }
    let steamWishlistIds = []
    try {
        const { items = {} } = JSON.parse(await readFile(STEAM_WISHLIST_FILE, 'utf8'))
        steamWishlistIds = Object.keys(items).map(Number).filter(id => !libraryIds.has(id))
    } catch { /* absent — skip */ }

    // Local wishlist: { items: { "appid": { dateAdded } } }
    // Exclude anything already covered by library or Steam wishlist
    const steamWishlistSet = new Set(steamWishlistIds)
    let localWishlistIds = []
    try {
        const { items = {} } = JSON.parse(await readFile(LOCAL_WISHLIST_FILE, 'utf8'))
        localWishlistIds = Object.keys(items)
            .map(Number)
            .filter(id => !libraryIds.has(id) && !steamWishlistSet.has(id))
    } catch { /* absent — skip */ }

    const wishlistOnly = [...steamWishlistIds, ...localWishlistIds]
        .map(id => ({ appid: id, name: String(id) }))

    const targets = [...games, ...wishlistOnly]
    const total   = targets.length

    console.log(`Steam trailer sync`)
    console.log(`  Library:         ${games.length}`)
    console.log(`  Steam wishlist:  ${steamWishlistIds.length}`)
    console.log(`  Local wishlist:  ${localWishlistIds.length}`)
    console.log(`  Total:           ${total}`)
    console.log(`  Videos → ${VIDEOS_DIR}`)
    console.log(`  Flags:    ${[FORCE && '--force', DRY_RUN && '--dry-run'].filter(Boolean).join(' ') || 'none'}`)
    console.log()

    let apiFetched  = 0
    let downloaded  = 0
    let skipped     = 0
    let noTrailer   = 0
    let errorCount  = 0
    const errorLog  = []

    for (let i = 0; i < total; i++) {
        const { appid } = targets[i]
        const name      = targets[i].name ?? String(appid)
        const prefix    = `[${pad(i + 1, total)}/${total}]`

        // ── Fetch movie metadata ──────────────────────────────────────────────
        let movies
        try {
            const result = await fetchMovies(appid)
            movies = result.movies
            if (!result.cached) {
                apiFetched++
                await sleep(API_DELAY_MS)
            }
        } catch (err) {
            if (err.rateLimited) {
                console.error(`\n${prefix} Rate limited — waiting ${RATE_LIMIT_BACKOFF / 1000}s`)
                await sleep(RATE_LIMIT_BACKOFF)
                i--  // retry this game
                continue
            }
            console.error(`${prefix} API error [${appid}] ${name}: ${err.message}`)
            errorCount++
            errorLog.push({ appid, name, stage: 'api', reason: err.message })
            await sleep(API_DELAY_MS)
            continue
        }

        if (!movies.length) {
            noTrailer++
            continue
        }

        // ── Sort: highlight trailers first ────────────────────────────────────
        const sorted = [
            ...movies.filter(m => m.highlight),
            ...movies.filter(m => !m.highlight),
        ].slice(0, MAX_TRAILERS_PER_GAME)

        // ── Download each trailer ─────────────────────────────────────────────
        const gameDir = join(VIDEOS_DIR, String(appid))
        if (!DRY_RUN) await mkdir(gameDir, { recursive: true })

        for (let j = 0; j < sorted.length; j++) {
            const movie   = sorted[j]
            const outPath = join(gameDir, `${j}.mp4`)
            const label   = `${prefix} ${name} — trailer ${j + 1}/${sorted.length}`

            if (!FORCE && await fileExists(outPath)) {
                skipped++
                continue
            }

            // Prefer HLS h264 (widely compatible; ffmpeg auto-selects max quality variant)
            // Fall back to DASH h264 if HLS is absent
            const videoUrl = movie.hls_h264 ?? movie.dash_h264
            if (!videoUrl) {
                console.log(`${label} — no downloadable URL, skipping`)
                skipped++
                continue
            }

            if (DRY_RUN) {
                console.log(`${label}`)
                console.log(`  → ${outPath}`)
                downloaded++
                continue
            }

            process.stdout.write(`${label} ... `)

            try {
                await ffmpegDownload(videoUrl, outPath)
                console.log('✓')
                downloaded++
            } catch (err) {
                console.log(`✗`)
                console.error(`  ${err.message.slice(0, 120)}`)
                errorCount++
                errorLog.push({ appid, name, trailer: j, stage: 'ffmpeg', reason: err.message })
            }
        }

        // Periodic summary
        if ((i + 1) % 100 === 0) {
            console.log()
            console.log(`  ── ${i + 1}/${total} titles processed ──`)
            console.log(`     Downloaded: ${downloaded}  Skipped: ${skipped}  No trailer: ${noTrailer}  Errors: ${errorCount}`)
            console.log()
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log()
    console.log('═══════════════════════════════════')
    console.log(`  Titles processed: ${total} (${games.length} library + ${steamWishlistIds.length} Steam wishlist + ${localWishlistIds.length} local wishlist)`)
    console.log(`  API calls made:   ${apiFetched}`)
    console.log(`  Downloaded:       ${downloaded}`)
    console.log(`  Already present:  ${skipped}`)
    console.log(`  No trailer:       ${noTrailer}`)
    console.log(`  Errors:           ${errorCount}`)
    console.log('═══════════════════════════════════')

    if (errorLog.length) {
        const logPath = join(DATA_DIR, 'relay', 'steam', 'video-sync-errors.json')
        await writeFile(logPath, JSON.stringify(errorLog, null, 2), 'utf8')
        console.log(`\n  Error log → ${logPath}`)
    }
}

main().catch(err => { console.error(err); process.exit(1) })
