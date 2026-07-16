// Single source of truth for where relay-era data lives on disk.
//
// Every ported service builds its paths through relayDataRoot() — never
// path.join(DATA_DIR, 'relay', ...) directly. During the migration this points
// at the relay's historical tree ($DATA_DIR/relay); the Phase-6 relocation to
// $DATA_DIR/gaming-journal/relay is then a single RELAY_DATA_ROOT env flip.
// See docs/relay-fold-in.md § Phase 6.
//
// Read at call time (not import time) so tests can point DATA_DIR at a temp dir
// after modules are loaded — same convention as the relay's per-feature dir fns.

import path from 'node:path'

export function relayDataRoot() {
    if (process.env.RELAY_DATA_ROOT) return process.env.RELAY_DATA_ROOT
    if (!process.env.DATA_DIR) throw new Error('relayDataRoot: DATA_DIR (or RELAY_DATA_ROOT) must be set')
    return path.join(process.env.DATA_DIR, 'relay')
}

/** Convenience: relayDataRoot()/<feature> — the per-feature storage dir. */
export function featureDir(feature) {
    return path.join(relayDataRoot(), feature)
}
