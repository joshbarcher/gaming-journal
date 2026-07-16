// Content filter for Reddit posts.
// Applied before caching — the relay only stores clean posts.

// ── Keyword blocklists ────────────────────────────────────────────────────────

const BLOCKED_TITLE_WORDS = [
    // Electoral politics
    'trump', 'biden', 'obama', 'clinton', 'harris', 'pelosi', 'desantis',
    'maga', 'election', 'democrat', 'republican', 'gop', 'dnc', 'rnc',
    'senate', 'congress', 'parliament', 'politician', 'political party',
    'vote', 'voting', 'ballot', 'caucus', 'gerrymandering',
    // Ideology / propaganda
    'propaganda', 'regime change', 'fascist', 'fascism', 'nazi', 'nazism',
    'communist manifesto', 'marxist', 'alt-right', 'alt right',
    'antifa', 'proud boys', 'qanon', 'deep state', 'new world order',
    'false flag', 'plandemic', 'great reset',
    // Culture war bait
    'sjw', 'feminazis', 'gender war', 'woke agenda', 'virtue signal',
    'snowflake', 'cuck', 'libtard', 'conservatard',
    // Crypto / NFT
    'nft', ' nfts', 'blockchain game', 'play to earn', 'web3 game',
    'crypto gaming', 'bitcoin gaming',
    // Proselytizing
    'repent', 'god is punishing', 'jesus saves', 'this is prophecy',
    // Spam / low-effort political rage
    'mainstream media lied', 'fake news', 'msm',
];

const BLOCKED_FLAIR_WORDS = [
    'politics', 'political', 'controversy', 'drama', 'culture war',
];

// Build fast case-insensitive regex from word lists
function buildRe(words) {
    const escaped = words.map(w =>
        w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
    );
    return new RegExp(`(?:^|\\b)(?:${escaped.join('|')})(?:\\b|$)`, 'i');
}

const _titleRe = buildRe(BLOCKED_TITLE_WORDS);
const _flairRe = buildRe(BLOCKED_FLAIR_WORDS);

// ── Filter ────────────────────────────────────────────────────────────────────

export function shouldInclude(raw) {
    // Reddit-side flags
    if (raw.over_18)                               return false;
    if (raw.removed_by_category)                   return false;
    const body = raw.selftext ?? '';
    if (body === '[removed]' || body === '[deleted]') return false;
    const title = raw.title ?? '';
    if (title === '[deleted]' || title === '[removed]') return false;

    // Hide zero/negative score posts (buried by community)
    if ((raw.score ?? 0) < 1)                      return false;

    // Keyword check
    if (_titleRe.test(title))                      return false;
    const flair = raw.link_flair_text ?? '';
    if (flair && _flairRe.test(flair))             return false;

    return true;
}

// ── Shape ─────────────────────────────────────────────────────────────────────

export function shapePost(raw) {
    const directUrl = raw.url_overridden_by_dest ?? raw.url ?? null;

    // Video detection: native Reddit video or GIF-as-video (reddit_video_preview).
    // Video takes priority over image so GIFs are served as efficient MP4s.
    const gifVideoUrl    = raw.preview?.reddit_video_preview?.fallback_url?.replace(/&amp;/g, '&') ?? null;
    const nativeVideoUrl = raw.media?.reddit_video?.fallback_url?.replace(/&amp;/g, '&') ?? null;
    const isVideo = raw.is_video === true || raw.domain === 'v.redd.it' || !!gifVideoUrl;
    const videoUrl = isVideo ? (nativeVideoUrl ?? gifVideoUrl) : null;

    // Image detection: i.redd.it posts are native uploads. The comments endpoint
    // sometimes omits post_hint, so also check domain. Video takes priority.
    const isImage   = !isVideo && (raw.post_hint === 'image' || !!raw.is_gallery || raw.domain === 'i.redd.it');
    const isGallery = raw.is_gallery === true;

    // Gallery posts store multiple images in media_metadata keyed by media ID;
    // gallery_data.items provides the correct display order.
    const galleryImages = [];
    if (isGallery && raw.gallery_data?.items && raw.media_metadata) {
        for (const item of raw.gallery_data.items) {
            const meta = raw.media_metadata[item.media_id];
            if (!meta || meta.e !== 'Image' || meta.status !== 'valid') continue;
            const url = meta.s?.u?.replace(/&amp;/g, '&') ?? null;
            if (!url) continue;
            const thumbArr   = meta.p ?? [];
            const thumbEntry = thumbArr.find(r => r.x >= 320 && r.x <= 960)
                ?? thumbArr[thumbArr.length - 1]
                ?? null;
            const thumbnail  = thumbEntry?.u?.replace(/&amp;/g, '&') ?? url;
            galleryImages.push({ url, thumbnail });
        }
    }

    const images = raw.preview?.images?.[0];

    // Full-resolution preview — Reddit hosts this for almost any post with a visual.
    const previewSource = images?.source ?? null;
    let previewUrl = previewSource?.url
        ? previewSource.url.replace(/&amp;/g, '&')
        : null;

    // Thumbnail: mid-res preview for listing cards (~320–960px wide)
    const thumbRes  = images?.resolutions?.find(r => r.width >= 320 && r.width <= 960)
        ?? previewSource ?? null;
    let thumbnail = thumbRes?.url
        ? thumbRes.url.replace(/&amp;/g, '&')
        : (raw.thumbnail?.startsWith('http') ? raw.thumbnail : null);

    // For gallery posts, use the first image as a thumbnail fallback so listing
    // cards can show something even before full media caching runs.
    if (isGallery && galleryImages.length > 0) {
        if (!previewUrl) previewUrl = galleryImages[0].url;
        if (!thumbnail)  thumbnail  = galleryImages[0].thumbnail;
    }

    // Text posts with inline images store them in media_metadata rather than
    // preview.images. Extract the first valid image as a fallback so listing
    // cards and thread view can still show a preview.
    if (!previewUrl && !thumbnail && !isImage && !isVideo && raw.media_metadata) {
        const firstMeta = Object.values(raw.media_metadata)
            .find(m => m.e === 'Image' && m.status === 'valid');
        if (firstMeta) {
            previewUrl = firstMeta.s?.u?.replace(/&amp;/g, '&') ?? null;
            thumbnail  = firstMeta.p?.find(r => r.x >= 320 && r.x <= 960)?.u?.replace(/&amp;/g, '&')
                ?? previewUrl;
        }
    }

    return {
        id:          raw.id,
        title:       raw.title ?? '',
        selftext:    body(raw),
        score:       raw.score        ?? 0,
        numComments: raw.num_comments ?? 0,
        author:      raw.author       ?? '[deleted]',
        subreddit:   raw.subreddit    ?? '',
        permalink:   `https://www.reddit.com${raw.permalink ?? ''}`,
        stickied:    raw.stickied     ?? false,
        isVideo,
        videoUrl,    // fallback_url MP4 (no audio for native video; full for GIF-as-video)
        isImage,
        isGallery,
        imageUrl:    isImage && !isGallery ? directUrl : null,
        galleryImages,
        previewUrl,  // full-res Reddit-hosted preview (non-image/video posts)
        thumbnail,   // mid-res poster for listing cards
        url:         directUrl,  // preserved for backfill when preview data is absent
        flair:       raw.link_flair_text ?? null,
        createdUtc:  raw.created_utc     ?? 0,
        domain:      raw.domain          ?? '',
    };
}

const MAX_SELFTEXT = 600;

function body(raw) {
    const t = raw.selftext ?? '';
    if (!t || t === '[removed]' || t === '[deleted]') return null;
    return t.slice(0, MAX_SELFTEXT).trim() || null;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export function shapeComment(raw, depth = 0) {
    if (raw.kind !== 't1') return null;
    const d = raw.data;
    const replies = (d.replies?.data?.children ?? [])
        .map(c => shapeComment(c, depth + 1))
        .filter(Boolean);
    const b = d.body;

    // Extract inline images: prefer structured media_metadata, fall back to bare URLs in body.
    const images = [];
    if (d.media_metadata) {
        for (const meta of Object.values(d.media_metadata)) {
            if (meta.e !== 'Image' || meta.status !== 'valid') continue;
            const url = meta.s?.u?.replace(/&amp;/g, '&') ?? null;
            if (url) images.push({ url });
        }
    }
    // Bare preview.redd.it / i.redd.it URLs pasted or auto-embedded in body text
    const bodyText = (b && b !== '[removed]' && b !== '[deleted]') ? b : '';
    const bareRe = /https?:\/\/(?:preview|i)\.redd\.it\/\S+\.(?:png|jpe?g|gif|webp)\S*/gi;
    for (const m of bodyText.matchAll(bareRe)) {
        const url = m[0].replace(/[)\s>]+$/, '').replace(/&amp;/g, '&');
        if (!images.some(img => img.url === url)) images.push({ url });
    }

    // Extract Giphy GIF embeds: ![gif](giphy|ID) — cached as MP4 for efficiency
    const gifs = [];
    const gifRe = /!\[gif\]\(giphy\|([a-zA-Z0-9]+)[^)]*\)/g;
    for (const m of bodyText.matchAll(gifRe)) {
        gifs.push({ id: m[1] });
    }

    // Extract Imgur links (bare URLs and markdown links) for server-side resolution
    const imgur = [];
    const imgurRe = /https?:\/\/(?:i\.)?imgur\.com\/[^\s)"'\]>]+/g;
    for (const m of bodyText.matchAll(imgurRe)) {
        const url = m[0].replace(/[.,;:!?]+$/, '');
        if (!imgur.some(e => e.originalUrl === url)) imgur.push({ originalUrl: url });
    }

    return {
        id:           d.id,
        author:       d.author       ?? '[deleted]',
        body:         (b && b !== '[removed]' && b !== '[deleted]') ? b : null,
        score:        d.score        ?? 0,
        createdUtc:   d.created_utc  ?? 0,
        depth,
        stickied:     d.stickied     ?? false,
        distinguished: d.distinguished ?? null,
        isSubmitter:  d.is_submitter ?? false,
        images,
        gifs,
        imgur,
        replies,
    };
}
