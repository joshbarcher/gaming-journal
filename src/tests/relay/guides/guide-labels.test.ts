// Guards the leading-only rule in trimGameNamePrefix. The "must NOT trim" cases below are
// real labels from the cached corpus — a naive "remove the game name" would mangle them.
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import { trimGameNamePrefix } from '../../../../contracts/guideLabels'

const ELLIOT = 'The Adventures of Elliot: The Millennium Tales'

describe('trimGameNamePrefix — strips a redundant leading name', () => {
    it('strips the prefix from a Game8 nav group', () => {
        assert.equal(
            trimGameNamePrefix(`${ELLIOT} Recommended Guides`, ELLIOT),
            'Recommended Guides',
        )
    })

    it('strips it from an in-page heading too', () => {
        assert.equal(trimGameNamePrefix(`${ELLIOT} Related Guides`, ELLIOT), 'Related Guides')
    })

    it('matches even when the label flattened the punctuation', () => {
        // Label lost the colon the game name carries
        assert.equal(
            trimGameNamePrefix('The Adventures of Elliot The Millennium Tales Bosses', ELLIOT),
            'Bosses',
        )
    })

    it('matches a slug-derived name against a punctuated label', () => {
        assert.equal(
            trimGameNamePrefix(`${ELLIOT} Items`, 'the-adventures-of-elliot-the-millennium-tales'),
            'Items',
        )
    })

    it('is case-insensitive', () => {
        assert.equal(trimGameNamePrefix('ELDEN RING Patch 1.03 Notes', 'Elden Ring'), 'Patch 1.03 Notes')
    })

    it('removes a separator left behind by the prefix', () => {
        assert.equal(trimGameNamePrefix('Elden Ring - Boss List', 'Elden Ring'), 'Boss List')
        assert.equal(trimGameNamePrefix('Elden Ring: Boss List', 'Elden Ring'), 'Boss List')
    })
})

describe('trimGameNamePrefix — leaves everything else alone', () => {
    it('does NOT strip a trailing name (grammatical object)', () => {
        // Real IGN label — trimming would leave "Things to Do First in"
        assert.equal(
            trimGameNamePrefix('Things to Do First in Persona 5', 'Persona 5'),
            'Things to Do First in Persona 5',
        )
    })

    it('does NOT strip a mid-sentence name', () => {
        assert.equal(
            trimGameNamePrefix('How to Unlock Every Ending in Elden Ring', 'Elden Ring'),
            'How to Unlock Every Ending in Elden Ring',
        )
    })

    it('keeps the original when the label IS just the game name', () => {
        assert.equal(trimGameNamePrefix(ELLIOT, ELLIOT), ELLIOT)
        assert.equal(trimGameNamePrefix('Elden Ring', 'Elden Ring'), 'Elden Ring')
    })

    it('does not match a longer word that merely starts with the name', () => {
        assert.equal(trimGameNamePrefix('Elden Ringing Bells', 'Elden Ring'), 'Elden Ringing Bells')
    })

    it('ignores one-word game names as too eager', () => {
        assert.equal(trimGameNamePrefix('Hades Boss Guide', 'Hades'), 'Hades Boss Guide')
    })

    it('leaves unrelated labels untouched', () => {
        assert.equal(trimGameNamePrefix('Rankings', ELLIOT), 'Rankings')
        assert.equal(trimGameNamePrefix('All rights reserved', ELLIOT), 'All rights reserved')
    })

    it('is a no-op with no game name', () => {
        assert.equal(trimGameNamePrefix('Bosses', ''), 'Bosses')
        assert.equal(trimGameNamePrefix('Bosses', null), 'Bosses')
        assert.equal(trimGameNamePrefix('Bosses', undefined), 'Bosses')
    })

    it('does not crash on regex metacharacters in the name', () => {
        assert.equal(trimGameNamePrefix('S.T.A.L.K.E.R. 2 Weapons', 'S.T.A.L.K.E.R. 2'), 'Weapons')
    })
})
