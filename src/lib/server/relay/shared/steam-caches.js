// Read-only accessors for the Steam cache files other features consume.
//
// Until Wave 3, the RELAY still owns steam/games.json + steam/wishlist.json —
// its ManagedFile instances are the single writer. Ported features that only
// need to READ those caches use these plain-fs readers so the journal never
// holds a write-capable handle on files it doesn't own yet. At Wave 3 the
// steam service moves in with its ManagedFiles and these readers keep working
// unchanged (same files, same shapes).

import fs from 'node:fs/promises'
import path from 'node:path'
import { featureDir } from './data-root.js'

/** { games: [{ appid, name, playtime_forever, ... }] } — empty shape on any error. */
export async function readGamesCache() {
    try { return JSON.parse(await fs.readFile(path.join(featureDir('steam'), 'games.json'), 'utf8')) }
    catch { return { games: [] } }
}

/** { items: { [appid]: { priority, date_added, ... } } } — empty shape on any error. */
export async function readWishlistCache() {
    try { return JSON.parse(await fs.readFile(path.join(featureDir('steam'), 'wishlist.json'), 'utf8')) }
    catch { return { items: {} } }
}
