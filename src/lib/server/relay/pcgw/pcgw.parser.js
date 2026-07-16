/**
 * Make wiki-relative links absolute and open them off-site.
 * PCGW note/fix bodies are injected with {@html}; a bare href="/wiki/TAA" would
 * otherwise resolve against our own origin and 404.
 */
export function absolutizeLinks(html) {
    return html
        .replace(/href="\/(?!\/)/gi, 'href="https://www.pcgamingwiki.com/')
        .replace(/<a\s(?![^>]*\btarget=)/gi, '<a target="_blank" ')
        .replace(/<a\s(?![^>]*\brel=)/gi, '<a rel="noopener noreferrer" ');
}

/** Strip HTML tags, decode common entities, normalize whitespace. */
export function htmlToText(html) {
    return html
        .replace(/<sup[\s\S]*?<\/sup>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&#91;/g, '[').replace(/&#93;/g, ']')
        .replace(/\s+/g, ' ')
        .trim();
}

// ── Path table parser ─────────────────────────────────────────────────────────

/**
 * Parse System→Location rows from a table HTML chunk.
 * Splits on every <tr opening so all row variants are captured regardless of
 * outer class (normal rows, Steam Play/compat rows with extra indentation, etc.).
 * Filters by inner cell classes table-gamedata-body-system / table-gamedata-body-location.
 * Empty location cells are skipped. Multiple paths separated by <br> → array.
 */
export function parseGameDataTable(chunkHtml) {
    const result = {};
    const segments = chunkHtml.split(/(?=<tr[\s>])/i);

    for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];

        const systemMatch   = seg.match(/<th[^>]*table-gamedata-body-system[^>]*>([\s\S]*?)<\/th>/i);
        const locationMatch = seg.match(/<td[^>]*table-gamedata-body-location[^>]*>([\s\S]*?)<\/td>/i);
        if (!systemMatch || !locationMatch) continue;

        const system = htmlToText(systemMatch[1]);
        if (!system) continue;

        const paths = locationMatch[1]
            .split(/<br\s*\/?>/i)
            .map(p => htmlToText(p))
            .filter(p => p.length > 0);

        if (paths.length === 0) continue;
        result[system] = paths.length === 1 ? paths[0] : paths;
    }
    return result;
}

/**
 * Extract config / saveGame / gameData paths from HTML.
 * Works with both full browser-page HTML (finds the "Game data" h2 section first)
 * and with MediaWiki API section-fragment HTML (no h2 present, processes directly).
 */
export function parsePathsFromHtml(html) {
    const clean = html.replace(/<!--[\s\S]*?-->/g, '');

    const h2chunks = clean.split(/(?=<h2[\s>])/i);
    const gameDataSection = h2chunks.length > 1
        ? h2chunks.find(c => /id="Game_data"/i.test(c))
        : clean;

    if (!gameDataSection) return { config: {}, saveGame: {}, gameData: {} };

    const paths = { config: {}, saveGame: {}, gameData: {} };
    const h3chunks = gameDataSection.split(/(?=<h3[\s>])/i);
    for (const chunk of h3chunks) {
        if (/configuration\s+file/i.test(chunk))
            Object.assign(paths.config, parseGameDataTable(chunk));
        else if (/save\s+game\s+data\s+location/i.test(chunk))
            Object.assign(paths.saveGame, parseGameDataTable(chunk));
        else if (/installation|game\s+data\s+loc/i.test(chunk))
            Object.assign(paths.gameData, parseGameDataTable(chunk));
    }
    return paths;
}

// ── Settings / infotable parsers ──────────────────────────────────────────────

const RATING_MAP = {
    'Native support':               'true',
    'No native support':            'false',
    'Limited native support':       'limited',
    'Hackable':                     'hackable',
    'Always on (no native option)': 'always on',
    'Unknown':                      null,
};

function parseRating(title) {
    return Object.prototype.hasOwnProperty.call(RATING_MAP, title) ? RATING_MAP[title] : null;
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generic parser for settings infotables (video, input, cloud sync).
 * Splits on <tr>, identifies rows by bodyRowClass, extracts
 * (name from <th class="...paramClass...">, rating title from <td class="...ratingClass...">,
 * free-text notes from <td class="...notesClass...">).
 * Returns { rowName: { rating, notes }, ... } where notes is link-safe HTML or null.
 *
 * The notes cell carries the detail the rating alone can't express — which
 * upscalers ship, that cutscenes are locked to 30 FPS, which RT presets exist.
 */
function parseSettingsTable(html, bodyRowClass, paramClass, ratingClass, notesClass) {
    const result = {};
    for (const seg of html.split(/(?=<tr[\s>])/i)) {
        if (!seg.includes(bodyRowClass)) continue;
        const nameMatch   = seg.match(new RegExp(`<th[^>]*${escapeRegex(paramClass)}[^>]*>([\\s\\S]*?)<\\/th>`, 'i'));
        const ratingMatch = seg.match(new RegExp(`<td[^>]*${escapeRegex(ratingClass)}[^>]*>[\\s\\S]*?<div\\s+title="([^"]*)"`, 'i'));
        if (!nameMatch || !ratingMatch) continue;
        const name = htmlToText(nameMatch[1]);
        if (!name) continue;

        let notes = null;
        if (notesClass) {
            const notesMatch = seg.match(new RegExp(`<td[^>]*${escapeRegex(notesClass)}[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
            const raw = notesMatch?.[1]
                ?.replace(/<sup[\s\S]*?<\/sup>/gi, '')  // citation markers: [2][3]
                .trim();
            if (raw && htmlToText(raw)) notes = absolutizeLinks(raw);
        }

        result[name] = { rating: ratingMatch[1], notes };
    }
    return result;
}

/**
 * Build `get` (rating) and `getNotes` (notes HTML) accessors over a row map,
 * each resolving the first alias that is present.
 */
function accessors(rows) {
    const find = (keys) => keys.find(k => k in rows);
    return {
        get:      (...keys) => { const k = find(keys); return k ? parseRating(rows[k].rating) : null; },
        getNotes: (...keys) => { const k = find(keys); return k ? rows[k].notes : null; },
    };
}

/** Map a shape of alias-lists to { values, notes } sharing the same keys. */
function splitRatingsAndNotes(rows, shape) {
    const { get, getNotes } = accessors(rows);
    const values = {}, notes = {};
    for (const [key, aliases] of Object.entries(shape)) {
        values[key] = get(...aliases);
        const n = getNotes(...aliases);
        if (n) notes[key] = n;
    }
    return { values, notes };
}

const VIDEO_SHAPE = {
    widescreen: ['Widescreen resolution'],
    ultrawide:  ['Ultra-widescreen', 'Ultrawidescreen'],
    hdr:        ['HDR', 'High dynamic range display (HDR)'],
    fps60:      ['60 FPS', '60 FPS and 120+ FPS'],
    fps120:     ['120 FPS', '120+ FPS', '60 FPS and 120+ FPS'],
    rayTracing: ['Ray tracing', 'Ray tracing (RT)'],
    frameGen:   ['Frame generation', 'Frame gen'],
    upscaling:  ['High-fidelity upscaling', 'Upscaling'],
    fov:        ['Field of view (FOV)'],
    vsync:      ['Vertical sync (Vsync)', 'Vertical sync'],
    aa:         ['Anti-aliasing (AA)', 'Anti-aliasing'],
    af:         ['Anisotropic filtering (AF)', 'Anisotropic filtering'],
    uhd4k:      ['4K Ultra HD'],
    colorBlind: ['Color blind mode'],
}

/**
 * Parse the graphics feature table from full-page or section HTML.
 * Returns { ...ratings, notes } — `notes` holds per-key HTML for rows that have it.
 */
export function parseVideoFromHtml(html) {
    const rows = parseSettingsTable(html,
        'table-settings-video-body-row',
        'table-settings-video-body-parameter',
        'table-settings-video-body-rating',
        'table-settings-video-body-notes');
    const { values, notes } = splitRatingsAndNotes(rows, VIDEO_SHAPE);
    return { ...values, notes };
}

const INPUT_SHAPE = {
    mouse: {
        sensitivity:  ['Mouse sensitivity'],
        acceleration: ['Mouse acceleration'],
        inMenus:      ['Mouse input in menus'],
        yInversion:   ['Mouse Y-axis inversion'],
        kbmPrompts:   ['Keyboard and mouse prompts'],
    },
    keyboard: {
        remapping:  ['Remapping'],
        steamInput: ['Steam Input API support'],
    },
    controller: {
        support:           ['Controller support'],
        fullSupport:       ['Full controller support'],
        remapping:         ['Controller remapping'],
        sensitivity:       ['Controller sensitivity'],
        yInversion:        ['Controller Y-axis inversion'],
        hotplugging:       ['Controller hotplugging'],
        simultaneousInput: ['Simultaneous controller+KB/M'],
        hapticFeedback:    ['Haptic feedback'],
        promptOverride:    ['Input prompt override'],
        xinput:            ['XInput-compatible controllers'],
        dinput:            ['DirectInput-compatible controllers'],
        playstation:       ['PlayStation controllers'],
        nintendo:          ['Nintendo controllers'],
        other:             ['Other controller(s)'],
    },
    platform: {
        xboxPrompts:        ['Xbox button prompts'],
        impulseTriggers:    ['Impulse Trigger support'],
        playstationPrompts: ['PlayStation button prompts'],
        lightBar:           ['Light bar support'],
        adaptiveTriggers:   ['Adaptive trigger support'],
        dualSenseHaptics:   ['DualSense haptic feedback support'],
        motionSensors:      ['Motion sensors support'],
        steamDeckPrompts:   ['Steam Deck button prompts'],
        steamInputModes:    ['Steam Input prompt modes'],
        officialPresets:    ['Official controller preset(s)'],
        touchscreen:        ['Touchscreen support'],
        trackedMotion:      ['Tracked motion controllers'],
    },
}

/**
 * Parse the input (keyboard & controller) feature table.
 * Returns { mouse, keyboard, controller, platform, notes } where `notes`
 * mirrors the same group/key nesting for rows that carry free text.
 */
export function parseInputFromHtml(html) {
    const rows = parseSettingsTable(html,
        'table-settings-input-body-row',
        'table-settings-input-body-parameter',
        'table-settings-input-body-rating',
        'table-settings-input-body-notes');

    const result = { notes: {} };
    for (const [group, shape] of Object.entries(INPUT_SHAPE)) {
        const { values, notes } = splitRatingsAndNotes(rows, shape);
        result[group] = values;
        if (Object.keys(notes).length) result.notes[group] = notes;
    }
    return result;
}

const CLOUD_SHAPE = {
    steam:          ['Steam Cloud', 'Steam'],
    gogGalaxy:      ['GOG Galaxy'],
    epicGames:      ['Epic Games Launcher'],
    eaApp:          ['EA app'],
    xbox:           ['Xbox'],
    ubisoftConnect: ['Ubisoft Connect'],
    xboxCloud:      ['Xbox Cloud'],
    oneDrive:       ['OneDrive'],
}

/** Parse the save-game cloud syncing table. */
export function parseCloudFromHtml(html) {
    const rows = parseSettingsTable(html,
        'table-cloudsync-body-row',
        'table-cloudsync-body-system',
        'table-cloudsync-body-rating',
        'table-cloudsync-body-notes');
    const { values, notes } = splitRatingsAndNotes(rows, CLOUD_SHAPE);
    return { ...values, notes };
}

// ── Unknown-row collection ────────────────────────────────────────────────────

const KNOWN_VIDEO_ROWS = new Set([
    'Widescreen resolution', 'Ultra-widescreen', 'Ultrawidescreen',
    'HDR', 'High dynamic range display (HDR)',
    '60 FPS', '60 FPS and 120+ FPS', '120 FPS', '120+ FPS',
    'Ray tracing', 'Ray tracing (RT)',
    'Frame generation', 'Frame gen',
    'High-fidelity upscaling', 'Upscaling',
    'Field of view (FOV)',
    'Vertical sync (Vsync)', 'Vertical sync',
    'Anti-aliasing (AA)', 'Anti-aliasing',
    'Anisotropic filtering (AF)', 'Anisotropic filtering',
    '4K Ultra HD',
    'Color blind mode',
    // display modes — present but not parsed
    'Windowed', 'Borderless fullscreen windowed', 'Multi-monitor',
]);

const KNOWN_INPUT_ROWS = new Set([
    // mouse
    'Mouse sensitivity', 'Mouse acceleration',
    'Mouse input in menus', 'Mouse Y-axis inversion',
    'Keyboard and mouse prompts',
    // keyboard
    'Remapping', 'Steam Input API support',
    // controller
    'Controller support', 'Full controller support',
    'Controller remapping', 'Controller sensitivity',
    'Controller Y-axis inversion', 'Controller hotplugging',
    'Simultaneous controller+KB/M', 'Haptic feedback',
    'Input prompt override',
    'XInput-compatible controllers', 'DirectInput-compatible controllers',
    'PlayStation controllers', 'Nintendo controllers', 'Other controller(s)',
    // platform-specific
    'Xbox button prompts', 'Impulse Trigger support',
    'PlayStation button prompts', 'Light bar support',
    'Adaptive trigger support', 'DualSense haptic feedback support',
    'Motion sensors support', 'Steam Deck button prompts',
    'Steam Input prompt modes', 'Official controller preset(s)',
    'Touchscreen support', 'Tracked motion controllers',
]);

const KNOWN_CLOUD_ROWS = new Set([
    'Steam Cloud', 'Steam', 'GOG Galaxy',
    'Epic Games Launcher', 'EA app', 'Xbox', 'Ubisoft Connect',
    'Xbox Cloud', 'OneDrive',
    // present but not parsed
    'Discord',
]);

/**
 * Returns row names found in the video/input/cloud tables that the parser
 * does not currently recognise. Used to discover aliases to add over time.
 * Each game contributes at most one mention per row — counts stay normalized
 * across re-syncs when the aggregate is rebuilt from per-entry data.
 */
export function collectUnknownRows(html) {
    const filter = (rows, known) => Object.keys(rows).filter(k => !known.has(k));
    return {
        video: filter(
            parseSettingsTable(html,
                'table-settings-video-body-row',
                'table-settings-video-body-parameter',
                'table-settings-video-body-rating'),
            KNOWN_VIDEO_ROWS,
        ),
        input: filter(
            parseSettingsTable(html,
                'table-settings-input-body-row',
                'table-settings-input-body-parameter',
                'table-settings-input-body-rating'),
            KNOWN_INPUT_ROWS,
        ),
        cloud: filter(
            parseSettingsTable(html,
                'table-cloudsync-body-row',
                'table-cloudsync-body-system',
                'table-cloudsync-body-rating'),
            KNOWN_CLOUD_ROWS,
        ),
    };
}

// ── Structural drift detection ────────────────────────────────────────────────

const DRIFT_MARKERS = [
    { section: 'video',        heading: /id="Video"/i,       rowClass: 'table-settings-video-body-row' },
    { section: 'input',        heading: /id="Input"/i,        rowClass: 'table-settings-input-body-row' },
    { section: 'availability', heading: /id="Availability"/i, rowClass: 'table-availability-body-row' },
    { section: 'cloud',        heading: /table-cloudsync/i,   rowClass: 'table-cloudsync-body-row' },
];

const DRIFT_THRESHOLD = 3;

/**
 * Detects structural drift in a PCGW page.
 * A section is drifted when its heading marker is present but its expected
 * row CSS class is absent — meaning the class was likely renamed.
 * If DRIFT_THRESHOLD or more sections drift simultaneously it is flagged as
 * global drift (not just a missing section for one game).
 */
export function detectDrift(html) {
    const sections = DRIFT_MARKERS
        .filter(({ heading, rowClass }) => heading.test(html) && !html.includes(rowClass))
        .map(({ section }) => section);
    return { drifted: sections.length >= DRIFT_THRESHOLD, sections };
}

// ── Availability / DRM parser ─────────────────────────────────────────────────

const STORE_DRM_NAMES = {
    'store-steam':   'Steam',
    'store-gfwl':    'Games for Windows - LIVE',
    'store-gogcom':  'GOG.com',
    'store-mas':     'Mac App Store',
    'store-uplay':   'Uplay',
    'store-ea':      'EA app',
    'store-epic':    'Epic Games Launcher',
    'store-xboxgp':  'Xbox Game Pass',
};

function extractDrmNames(cellHtml) {
    const names = [];
    for (const match of cellHtml.matchAll(/<div\b([^>]*)>/gi)) {
        const attrs = match[1];
        if (!attrs.includes('svg-icon')) continue;
        const titleAttr = attrs.match(/title="([^"]+)"/i);
        if (titleAttr) { names.push(titleAttr[1]); continue; }
        for (const [cls, name] of Object.entries(STORE_DRM_NAMES)) {
            if (attrs.includes(cls)) { names.push(name); break; }
        }
    }
    return names;
}

/** Parse the availability/DRM table. Returns { drm[], steamDrm, gogDrm }. */
export function parseAvailabilityFromHtml(html) {
    const allDrm = new Set();
    let steamDrm = null;
    let gogDrm   = null;

    for (const seg of html.split(/(?=<tr[\s>])/i)) {
        if (!seg.includes('table-availability-body-row')) continue;
        const sourceMatch = seg.match(/<th[^>]*table-availability-body-source[^>]*>([\s\S]*?)<\/th>/i);
        const drmMatch    = seg.match(/<td[^>]*table-availability-body-DRM[^>]*>([\s\S]*?)<\/td>/i);
        if (!sourceMatch || !drmMatch) continue;

        const source   = htmlToText(sourceMatch[1]);
        const drmNames = extractDrmNames(drmMatch[1]);
        drmNames.forEach(n => allDrm.add(n));

        if (/^steam$/i.test(source))    steamDrm = drmNames.join(', ') || null;
        if (/^gog\.com$/i.test(source)) gogDrm   = drmNames.join(', ') || null;
    }

    return { drm: [...allDrm], steamDrm, gogDrm };
}

// ── Fix-box parser ────────────────────────────────────────────────────────────

/**
 * Read a heading's text, dropping the trailing " • Link" self-anchor that PCGW
 * nests inside .mw-headline. The nested <span> means a non-greedy match to the
 * first </span> would truncate the title, so match the outer span by depth-1
 * scan instead.
 */
function headingText(chunk) {
    const open = chunk.match(/<span class="mw-headline"[^>]*>/i);
    if (!open) return null;
    const start = open.index + open[0].length;
    let depth = 1, i = start;
    const tag = /<(\/?)span\b[^>]*>/gi;
    tag.lastIndex = start;
    for (let m; (m = tag.exec(chunk)); ) {
        depth += m[1] ? -1 : 1;
        if (depth === 0) { i = m.index; break; }
    }
    return chunk.slice(start, i)
        .replace(/<span class="mw-linkhere"[\s\S]*$/i, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s*•\s*Link\s*$/i, '')
        .trim();
}

/**
 * Extract fix-guide sections from HTML.
 * Splits at every h2/h3/h4 boundary; keeps chunks that contain a fixbox element.
 * Tracks the enclosing <h2> so callers can tell "Essential improvements" apart
 * from "Issues unresolved" / "Issues fixed".
 * Returns [{ title, group, html }] — html is the section content after the heading.
 */
export function parseFixesFromHtml(html) {
    const clean = html.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!clean.includes('fixbox')) return [];

    const chunks = clean.split(/(?=<h[2-4][\s>])/i);
    const fixes  = [];
    let group    = null;

    for (const chunk of chunks) {
        const isH2 = /^<h2[\s>]/i.test(chunk);
        const title = headingText(chunk);
        // An h2 without a usable headline (e.g. the ToC) clears the group rather than
        // leaving the previous one to bleed into the sections below it.
        if (isH2) group = title || null;
        if (!chunk.includes('fixbox') || !title) continue;

        const afterHeading = chunk.replace(/^[\s\S]*?<\/h[2-4]>/i, '').trim();
        if (afterHeading) {
            fixes.push({
                title,
                group: isH2 ? null : group,
                html:  absolutizeLinks(afterHeading),
            });
        }
    }

    return fixes;
}
