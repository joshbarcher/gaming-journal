// Ported verbatim from relay-server src/services/steam/featured-poller.js
// (docs/relay-fold-in.md §6). Import rewrites only. poster-pool lives in the
// games feature (Wave 3), ported alongside this batch.
import logger from '../../logger.js';
import { load, accumulate, markSaleEnded, markSaleActive, getAllItems } from './featured-history.service.js';
import { ensureDiscoveryImages } from './images.service.js';
import { markSynced as markPostersSynced } from '../games/poster-pool.service.js';
import { tracked } from '../metrics/tracked.js';

const STORE_API = 'https://store.steampowered.com';
const POLL_MS   = 60 * 60 * 1_000; // 1 hour

let _lastSpecialIds = new Set();

function _normalize(item) {
    const appid    = item.id ?? item.appid;
    const price    = item.final_price ?? null;
    const original = item.original_price ?? null;
    const discount = item.discount_percent ?? 0;
    return {
        appid,
        name:          item.name,
        headerImage:   item.header_image
                           ?? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
        posterImage:   `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900_2x.jpg`,
        price:         price !== null ? price / 100 : null,
        originalPrice: original !== null && discount > 0 ? original / 100 : null,
        discount,
        isFree:        item.is_free_game ?? false,
    };
}

// Returns true (still on sale), false (sale ended), or null (unknown — leave as-is)
async function _checkDiscount(appid) {
    try {
        const res  = await fetch(
            `${STORE_API}/api/appdetails?appids=${appid}&filters=price_overview&cc=us`
        );
        if (!res.ok) return null;
        const body = await res.json();
        const d    = body[String(appid)];
        if (!d?.success || !d.data) return false; // unavailable — treat as ended
        return (d.data.price_overview?.discount_percent ?? 0) > 0;
    } catch {
        return null;
    }
}

async function _poll() {
    try {
        const res = await fetch(`${STORE_API}/api/featuredcategories?cc=us&l=english`);
        if (!res.ok) {
            logger.warn('[featured-poller] featuredcategories failed', { status: res.status });
            return { fetched: 0, failed: 0, total: 0, error: `featuredcategories HTTP ${res.status}` };
        }
        const body = await res.json();

        const KEYS = ['new_releases', 'top_sellers', 'coming_soon', 'specials'];
        const sections = KEYS
            .filter(k => body[k]?.items?.length)
            .map(k => ({ id: k, items: body[k].items.map(_normalize) }));

        const { created } = await accumulate(sections);

        // Download + index poster/header for all items in this poll before finishing.
        // The poll runs in the background so awaiting here is fine — this guarantees
        // the poster index is fully up to date before any subsequent request arrives.
        const pollItems = [...new Map(
            sections.flatMap(s => s.items.map(i => [i.appid, {
                appid:     i.appid,
                headerUrl: i.headerImage,
                posterUrl: i.posterImage,
            }]))
        ).values()];
        const withPosters = await ensureDiscoveryImages(pollItems);
        if (withPosters.length) await markPostersSynced(withPosters).catch(() => {});

        // Detect specials that rotated off the featured list and verify their sale status
        const currentIds = new Set(
            sections.find(s => s.id === 'specials')?.items.map(i => i.appid) ?? []
        );
        const dropped = [..._lastSpecialIds].filter(id => !currentIds.has(id));
        _lastSpecialIds = currentIds;

        for (const appid of dropped) {
            const onSale = await _checkDiscount(appid);
            if (onSale === true)  await markSaleActive(appid);
            if (onSale === false) await markSaleEnded(appid);
            await new Promise(r => setTimeout(r, 250)); // be nice to Steam
        }

        logger.info('[featured-poller] Poll complete', {
            sections: sections.length,
            dropped:  dropped.length,
            created,
        });
        // `fetched` is every item this poll saw; `created` is the subset never
        // featured before. Only the latter is new information.
        return { fetched: pollItems.length, created, failed: 0, total: pollItems.length };
    } catch (err) {
        logger.error('[featured-poller] Poll failed', { err: err.message });
        return { fetched: 0, failed: 0, total: 0, error: err.message };
    }
}

// _poll() resolves rather than rejects on failure, reporting the problem via the
// `error` field on its counts, so tracked() records it as a failed run.
const _trackedPoll = () => tracked('steam:featured', () => _poll());

/** Run one poll now. Used by the admin trigger; the scheduler uses _trackedPoll. */
export function pollOnce() {
    return _poll();
}

export function startPoller() {
    logger.info('[featured-poller] Started', { intervalMs: POLL_MS });
    load()
        .then(() => {
            // Background: warm images for all items across full history so the
            // discover page has local relay paths ready before anyone visits.
            getAllItems().then(items => {
                if (!items.length) return;
                logger.info('[featured-poller] Warming discovery images from history', { count: items.length });
                ensureDiscoveryImages(items)
                    .then(withPosters => { if (withPosters.length) markPostersSynced(withPosters).catch(() => {}); })
                    .catch(err => logger.error('[featured-poller] Startup image warm failed', { err: err.message }));
            }).catch(err => logger.error('[featured-poller] getAllItems failed', { err: err.message }));

            return _trackedPoll();
        })
        .catch(err => {
            logger.error('[featured-poller] History load failed', { err: err.message });
            _trackedPoll();
        });
    setInterval(_trackedPoll, POLL_MS);
}
