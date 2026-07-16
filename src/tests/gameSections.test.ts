import { describe, it, expect } from 'vitest'
import { GAME_SECTIONS } from '../lib/js/game-sections.js'

// GAME_SECTIONS drives in-page anchors on the game page — ids must be valid,
// unique DOM ids and labels must be human-readable.

describe('GAME_SECTIONS', () => {
    it('has unique ids (duplicate DOM ids would break anchor navigation)', () => {
        const ids = GAME_SECTIONS.map(s => s.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('has unique labels', () => {
        const labels = GAME_SECTIONS.map(s => s.label)
        expect(new Set(labels).size).toBe(labels.length)
    })

    it('every id is a valid CSS-selector-safe token with the game-sec- prefix', () => {
        for (const s of GAME_SECTIONS) {
            expect(s.id).toMatch(/^game-sec-[a-z0-9-]+$/)
        }
    })

    it('every label is non-empty and trimmed', () => {
        for (const s of GAME_SECTIONS) {
            expect(s.label.length).toBeGreaterThan(0)
            expect(s.label).toBe(s.label.trim())
        }
    })

    it('starts with the hero section (Top) so jump navigation anchors at the page head', () => {
        expect(GAME_SECTIONS[0]).toEqual({ id: 'game-sec-hero', label: 'Top' })
    })

    it('covers the sections the game page renders', () => {
        const ids = GAME_SECTIONS.map(s => s.id)
        for (const required of ['game-sec-local-review', 'game-sec-screenshots', 'game-sec-prices', 'game-sec-nexus']) {
            expect(ids).toContain(required)
        }
        expect(GAME_SECTIONS.length).toBe(14)
    })
})
