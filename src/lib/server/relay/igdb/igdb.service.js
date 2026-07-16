import path from 'node:path';
import fs   from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

const IGDB_BASE = 'https://api.igdb.com/v4';
const AUTH_URL  = 'https://id.twitch.tv/oauth2/token';

// Cache TTL: 30 days — subreddit names rarely change
const ENTRY_TTL_MS = 30 * 24 * 3_600_000;

// In-memory token cache
let _token    = null;
let _tokenExp = 0;

function igdbDir()        { return featureDir('igdb'); }
function entryPath(appid) { return path.join(igdbDir(), `${appid}.json`); }

function clientId()     { return process.env.IGDB_CLIENT_ID; }
function clientSecret() { return process.env.IGDB_CLIENT_SECRET; }

function isConfigured() { return !!(clientId() && clientSecret()); }

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getToken(fetchFn = fetch) {
    if (_token && Date.now() < _tokenExp) return _token;

    const url = `${AUTH_URL}?client_id=${clientId()}&client_secret=${clientSecret()}&grant_type=client_credentials`;
    const res = await fetchFn(url, { method: 'POST' });
    if (!res.ok) throw new Error(`IGDB auth failed: ${res.status}`);

    const { access_token, expires_in } = await res.json();
    _token    = access_token;
    _tokenExp = Date.now() + (expires_in - 60) * 1_000;
    logger.debug('[igdb] Token refreshed');
    return _token;
}

async function igdbQuery(endpoint, body, fetchFn = fetch) {
    const token = await getToken(fetchFn);
    const res   = await fetchFn(`${IGDB_BASE}/${endpoint}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-ID':     clientId(),
            'Accept':        'application/json',
            'Content-Type':  'text/plain',
        },
        body,
    });
    if (!res.ok) throw new Error(`IGDB ${endpoint} HTTP ${res.status}`);
    return res.json();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

export async function getEntry(appid) {
    try { return JSON.parse((await fs.readFile(entryPath(appid), 'utf8')).replace(/\0+$/, '')); }
    catch { return null; }
}

// ── Subreddit lookup ──────────────────────────────────────────────────────────

// Normalise a game name for comparison (lowercase, strip punctuation/articles)
function _normName(s) {
    return s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(the|a|an)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function getSubreddit(appid, gameName, { force = false, fetchFn = fetch } = {}) {
    if (!isConfigured() || !gameName) return null;

    await fs.mkdir(igdbDir(), { recursive: true });

    if (!force) {
        const cached = await getEntry(appid);
        if (cached) {
            const age = Date.now() - new Date(cached.fetchedAt).getTime();
            if (age < ENTRY_TTL_MS) return cached.subreddit ?? null;
        }
    }

    let subreddit = null;
    let igdbId    = null;

    try {
        // Search IGDB by game name — more reliable than external_games Steam uid lookup
        const games = await igdbQuery(
            'games',
            `fields id, name, websites; search "${gameName.replace(/"/g, '')}"; limit 5;`,
            fetchFn
        );

        // Pick the result whose name most closely matches (exact first, then normalised)
        const normTarget = _normName(gameName);
        const match = games?.find(g => _normName(g.name) === normTarget)
            ?? games?.find(g => _normName(g.name).includes(normTarget) || normTarget.includes(_normName(g.name)))
            ?? games?.[0]
            ?? null;

        igdbId = match?.id ?? null;

        if (igdbId) {
            // Fetch all websites for this game and find the Reddit one (category 14)
            const websites = await igdbQuery(
                'websites',
                `fields url, category; where game = ${igdbId}; limit 25;`,
                fetchFn
            );
            const redditSite = websites?.find(w => w.url?.includes('reddit.com/r/'));
            if (redditSite?.url) {
                const m = redditSite.url.match(/reddit\.com\/r\/([^/?\s]+)/i);
                subreddit = m?.[1] ?? null;
            }
        }
    } catch (err) {
        logger.warn('[igdb] Subreddit lookup failed', { appid, err: err.message });
    }

    await fs.writeFile(entryPath(appid), JSON.stringify({
        appid: Number(appid), igdbId, subreddit, fetchedAt: new Date().toISOString(),
    }, null, 2));

    logger.debug('[igdb] Subreddit resolved', { appid, subreddit });
    return subreddit;
}
