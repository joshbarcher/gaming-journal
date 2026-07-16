/**
 * flags.js — Helpers for reading per-game flags stored by the gaming-journal UI.
 *
 * Flags file: DATA_DIR/gaming-journal/flags.json
 * Shape:      { [appid: string]: { software?: boolean, alert?: boolean, ... } }
 */

import path from 'node:path';
import fs   from 'node:fs/promises';

function flagsPath() {
    return path.join(process.env.DATA_DIR, 'gaming-journal', 'flags.json');
}

/**
 * Reads flags.json and returns the parsed object, or {} on any error.
 * Never throws.
 */
export async function readFlags() {
    try {
        return JSON.parse(await fs.readFile(flagsPath(), 'utf8'));
    } catch {
        return {};
    }
}

/**
 * Returns true if the given appid is flagged as software (non-game).
 * Accepts appid as either a number or string.
 */
export function isSoftware(flags, appid) {
    return !!(flags[String(appid)]?.software);
}
