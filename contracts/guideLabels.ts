// Shared label-display helpers for guide navigation.
//
// Not a Zod schema, unlike the rest of this package — it lives here because this is the
// only module both the SvelteKit app and react-native/ import from, and web/native must
// trim labels identically or the two TOCs visibly disagree. Small formatters that don't
// need to stay in lockstep (fmtBytes, fmtDate) are still duplicated per platform.

/**
 * Strip a redundant leading game-name prefix from a guide nav label.
 *
 *   "The Adventures of Elliot: The Millennium Tales Recommended Guides"
 *     → "Recommended Guides"
 *
 * Game8 (and to a lesser degree GamerGuides) prefixes most nav groups with the full game
 * name, so a sidebar of 14 groups renders as 14 identical truncated rows.
 *
 * LEADING ONLY, deliberately. Measured over 11,422 cached nav labels: 98 carry the name
 * as a redundant prefix, but 81 carry it as a trailing grammatical object and 93 mid-
 * sentence — "Things to Do First in Persona 5", "How to Unlock Every Ending in Elden
 * Ring". Stripping those would produce "Things to Do First in". Only a prefix is safely
 * removable, so this never touches an occurrence anywhere else in the string.
 *
 * Matching ignores case and punctuation, so a name with a colon still matches a label
 * that flattened it ("Elliot: The Millennium Tales" vs "Elliot The Millennium Tales"),
 * and a slug-derived name ("the-adventures-of-elliot") matches too.
 *
 * @param label    The nav/heading text as parsed.
 * @param gameName The game (or guide) name to strip. Ignored when under two words.
 * @returns The trimmed label, or the original when trimming would leave nothing useful.
 */
export function trimGameNamePrefix(label: string, gameName: string | null | undefined): string {
    if (!label || !gameName) return label

    const tokens = gameName.split(/[^A-Za-z0-9]+/).filter(Boolean)
    // One-word names ("Hades") match far too eagerly — a label legitimately starting with
    // that word would be gutted. The redundancy is also barely visible when it's one word.
    if (tokens.length < 2) return label

    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    // Trailing [^A-Za-z0-9]+ forces a real boundary, so "Elden Ringing …" can't match "Elden Ring".
    const re = new RegExp(`^[^A-Za-z0-9]*${escaped.join('[^A-Za-z0-9]+')}[^A-Za-z0-9]+`, 'i')

    const trimmed = label.replace(re, '').trim()
    // Label was the game name and nothing else, or collapsed to a fragment — keep the original.
    return trimmed.length >= 2 ? trimmed : label
}
