import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getPrefs, togglePref } from '../lib/server/services/communityPrefsService.js'

function makeTmpDir() {
    return path.join(os.tmpdir(), `prefs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('communityPrefsService', () => {
    let tmpDir: string
    let filePath: string
    let prevDataDir: string | undefined

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        filePath = path.join(tmpDir, 'gaming-journal', 'community-prefs.json')
        prevDataDir = process.env.DATA_DIR
        process.env.DATA_DIR = tmpDir
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        if (prevDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = prevDataDir
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('environment', () => {
        it('rejects when DATA_DIR is not set', async () => {
            delete process.env.DATA_DIR
            await expect(getPrefs()).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('defaults — missing / partial / corrupt file', () => {
        it('getPrefs returns empty defaults when the file does not exist', async () => {
            expect(await getPrefs()).toEqual({ filtered: [], muted: [], favorited: [], highlighted: {} })
        })

        it('getPrefs fills missing keys when the file is partial', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ muted: ['a'] }))
            const prefs = await getPrefs()
            expect(prefs.muted).toEqual(['a'])
            expect(prefs.filtered).toEqual([])
            expect(prefs.favorited).toEqual([])
            expect(prefs.highlighted).toEqual({})
        })

        it('togglePref on a partial file initializes the missing list before mutating', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ muted: ['a'] }))
            const active = await togglePref('favorite', 'bob')
            expect(active).toBe(true)
            const prefs = await getPrefs()
            expect(prefs.favorited).toEqual(['bob'])
            expect(prefs.muted).toEqual(['a'])
        })

        it('falls back to defaults when the file is corrupt and no checkpoint exists', async () => {
            await fsp.writeFile(filePath, '<<< not json >>>')
            expect(await getPrefs()).toEqual({ filtered: [], muted: [], favorited: [], highlighted: {} })
        })

        it('recovers from a checkpoint when the main file is corrupt', async () => {
            await fsp.writeFile(filePath, '<<< not json >>>')
            await fsp.writeFile(filePath + '.checkpoint.json',
                JSON.stringify({ filtered: [], muted: ['cp'], favorited: [], highlighted: {} }))
            expect((await getPrefs()).muted).toEqual(['cp'])
        })
    })

    describe('togglePref — filter / mute / favorite', () => {
        it('toggle on returns true and persists across a fresh reload', async () => {
            const active = await togglePref('mute', 'griefer')
            expect(active).toBe(true)
            expect((await getPrefs()).muted).toEqual(['griefer'])
        })

        it('toggle off returns false and removes the entry from disk', async () => {
            await togglePref('mute', 'griefer')
            const active = await togglePref('mute', 'griefer')
            expect(active).toBe(false)
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(raw.muted).toEqual([])
        })

        it('the three lists are independent — same username in each', async () => {
            await togglePref('filter', 'sam')
            await togglePref('mute', 'sam')
            await togglePref('favorite', 'sam')
            await togglePref('mute', 'sam') // un-mute only
            const prefs = await getPrefs()
            expect(prefs.filtered).toEqual(['sam'])
            expect(prefs.muted).toEqual([])
            expect(prefs.favorited).toEqual(['sam'])
        })

        it('usernames are case-sensitive (contract — "Sam" and "sam" coexist)', async () => {
            await togglePref('mute', 'Sam')
            await togglePref('mute', 'sam')
            expect((await getPrefs()).muted).toEqual(['Sam', 'sam'])
        })

        it('unicode usernames round-trip through disk', async () => {
            await togglePref('favorite', '🦊フォックス')
            expect((await getPrefs()).favorited).toEqual(['🦊フォックス'])
            const active = await togglePref('favorite', '🦊フォックス')
            expect(active).toBe(false)
        })

        it('throws for an unknown pref type', async () => {
            await expect(togglePref('block' as never, 'x')).rejects.toThrow(/Unknown pref type: block/)
        })
    })

    describe('togglePref — highlight', () => {
        it('requires an appid — null throws', async () => {
            await expect(togglePref('highlight', 'x')).rejects.toThrow(/appid required/)
        })

        it('contract: appid 0 is rejected by the falsy check', async () => {
            // `if (!appid)` treats 0 as missing. Steam appids start at 10, so this
            // boundary is defensible — documented as a contract.
            await expect(togglePref('highlight', 'x', 0)).rejects.toThrow(/appid required/)
        })

        it('adds and removes a highlight for an appid', async () => {
            expect(await togglePref('highlight', 'ann', 440)).toBe(true)
            expect((await getPrefs()).highlighted).toEqual({ '440': ['ann'] })
            expect(await togglePref('highlight', 'ann', 440)).toBe(false)
        })

        it('numeric and string appids address the same bucket', async () => {
            await togglePref('highlight', 'ann', 440)
            const active = await togglePref('highlight', 'ann', '440')
            expect(active).toBe(false)
            expect((await getPrefs()).highlighted).toEqual({})
        })

        it('removing the last user deletes the appid key from the raw file', async () => {
            await togglePref('highlight', 'ann', 440)
            await togglePref('highlight', 'bob', 440)
            await togglePref('highlight', 'ann', 440)
            let raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(raw.highlighted).toEqual({ '440': ['bob'] })
            await togglePref('highlight', 'bob', 440)
            raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(raw.highlighted).toEqual({})
        })

        it('highlights for different appids are independent', async () => {
            await togglePref('highlight', 'ann', 1)
            await togglePref('highlight', 'ann', 2)
            await togglePref('highlight', 'ann', 1)
            expect((await getPrefs()).highlighted).toEqual({ '2': ['ann'] })
        })
    })

    describe('duplicate entries', () => {
        // REGRESSION: toggle-off once used splice, removing only the FIRST occurrence,
        // so a file containing duplicates left the user still muted after an "unmute"
        // that returned false; it now filter()s out every matching entry.
        it('toggling off a duplicated entry fully removes it', async () => {
            await fsp.writeFile(filePath,
                JSON.stringify({ filtered: [], muted: ['dup', 'dup'], favorited: [], highlighted: {} }))
            const active = await togglePref('mute', 'dup')
            expect(active).toBe(false)
            expect((await getPrefs()).muted).not.toContain('dup')
        })
    })

    describe('type confusion from disk', () => {
        // REGRESSION: _ensure once repaired only nullish fields, so a string where an
        // array was expected reached `.push` and threw TypeError; _ensure now coerces
        // any wrong-typed field back to its empty array/object.
        it('togglePref tolerates a non-array muted field on disk', async () => {
            await fsp.writeFile(filePath,
                JSON.stringify({ filtered: [], muted: 'oops', favorited: [], highlighted: {} }))
            const active = await togglePref('mute', 'x')
            expect(active).toBe(true)
        })
    })

    describe('prototype-pollution keys', () => {
        // REGRESSION: highlight toggle once used `data.highlighted[k] ??= []`, which for
        // k="__proto__" read Object.prototype (not nullish), skipped the init, then hit
        // an undefined `.indexOf` → TypeError; it now uses own-property access (getOwn/setOwn).
        it('highlight toggle works for appid "__proto__"', async () => {
            const active = await togglePref('highlight', 'user', '__proto__')
            expect(active).toBe(true)
        })

        it('"__proto__" usernames are fine inside the arrays', async () => {
            expect(await togglePref('mute', '__proto__')).toBe(true)
            expect((await getPrefs()).muted).toEqual(['__proto__'])
            expect(await togglePref('mute', '__proto__')).toBe(false)
        })

        it('a "__proto__" key in highlighted on disk does not pollute Object.prototype', async () => {
            // Raw string: an object literal { __proto__: ... } would set the prototype
            // instead of producing the JSON key.
            await fsp.writeFile(filePath,
                '{"filtered":[],"muted":[],"favorited":[],"highlighted":{"__proto__":["u"]}}')
            const prefs = await getPrefs()
            expect(Object.keys(prefs.highlighted)).toContain('__proto__')
            expect(Array.isArray(Object.getPrototypeOf({}))).toBe(false)
        })
    })

    describe('concurrency', () => {
        // REGRESSION: togglePref once opened its own ManagedFile per call, so concurrent
        // toggles all read the initial state and the last flush dropped the others;
        // a shared per-path ManagedFile now serializes them.
        it('concurrent toggles must all persist', async () => {
            await Promise.all([
                togglePref('mute', 'u1'),
                togglePref('mute', 'u2'),
                togglePref('mute', 'u3'),
                togglePref('mute', 'u4'),
                togglePref('mute', 'u5'),
            ])
            const prefs = await getPrefs()
            expect([...prefs.muted].sort()).toEqual(['u1', 'u2', 'u3', 'u4', 'u5'])
        })

        it('sequentially awaited toggles all persist', async () => {
            await togglePref('mute', 'u1')
            await togglePref('filter', 'u2')
            await togglePref('favorite', 'u3')
            const prefs = await getPrefs()
            expect(prefs.muted).toEqual(['u1'])
            expect(prefs.filtered).toEqual(['u2'])
            expect(prefs.favorited).toEqual(['u3'])
        })
    })
})
