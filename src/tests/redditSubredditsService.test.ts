import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getSubreddits, addSubreddit, removeSubreddit } from '../lib/server/services/redditSubredditsService.js'

function makeTmpDir() {
    return path.join(os.tmpdir(), `reddit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('redditSubredditsService', () => {
    let tmpDir: string
    let filePath: string
    let prevDataDir: string | undefined

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        filePath = path.join(tmpDir, 'gaming-journal', 'reddit-subreddits.json')
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
            await expect(getSubreddits(440)).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('defaults — missing / empty / corrupt file', () => {
        it('getSubreddits returns [] when the file does not exist', async () => {
            expect(await getSubreddits(440)).toEqual([])
        })

        it('getSubreddits returns [] for an unknown appid on an existing store', async () => {
            await addSubreddit(1, 'skyrim')
            expect(await getSubreddits(999)).toEqual([])
        })

        it('falls back to default {} when the file is corrupt and no checkpoint exists', async () => {
            await fsp.writeFile(filePath, '}{ NOT JSON')
            expect(await getSubreddits(440)).toEqual([])
        })

        it('recovers from a checkpoint when the main file is corrupt', async () => {
            await fsp.writeFile(filePath, '}{ NOT JSON')
            await fsp.writeFile(filePath + '.checkpoint.json', JSON.stringify({ '440': ['tf2'] }))
            expect(await getSubreddits(440)).toEqual(['tf2'])
        })
    })

    describe('addSubreddit', () => {
        it('adds a name, persists it, and a fresh reload sees it', async () => {
            const result = await addSubreddit(440, 'tf2')
            expect(result).toEqual(['tf2'])
            expect(await getSubreddits(440)).toEqual(['tf2'])
        })

        it('appends preserving insertion order', async () => {
            await addSubreddit(440, 'tf2')
            await addSubreddit(440, 'truetf2')
            expect(await getSubreddits(440)).toEqual(['tf2', 'truetf2'])
        })

        it('exact duplicate add is a no-op returning the current list', async () => {
            await addSubreddit(440, 'tf2')
            const result = await addSubreddit(440, 'tf2')
            expect(result).toEqual(['tf2'])
            expect(await getSubreddits(440)).toEqual(['tf2'])
        })

        it('case-insensitive duplicate add is a no-op (original casing kept)', async () => {
            await addSubreddit(440, 'GamingLeaksAndRumours')
            const result = await addSubreddit(440, 'gamingleaksandrumours')
            expect(result).toEqual(['GamingLeaksAndRumours'])
        })

        it('numeric and string appids address the same list', async () => {
            await addSubreddit(440, 'tf2')
            expect(await getSubreddits('440')).toEqual(['tf2'])
        })

        it('same name can live under different appids independently', async () => {
            await addSubreddit(1, 'patientgamers')
            await addSubreddit(2, 'patientgamers')
            await removeSubreddit(1, 'patientgamers')
            expect(await getSubreddits(1)).toEqual([])
            expect(await getSubreddits(2)).toEqual(['patientgamers'])
        })

        it('unicode names round-trip through disk', async () => {
            await addSubreddit(440, 'ゲーム部屋🎮')
            expect(await getSubreddits(440)).toEqual(['ゲーム部屋🎮'])
        })

        it('contract: empty-string name is accepted (no validation)', async () => {
            const result = await addSubreddit(440, '')
            expect(result).toEqual([''])
        })

        it('appid 0 is a valid key', async () => {
            await addSubreddit(0, 'zero')
            expect(await getSubreddits(0)).toEqual(['zero'])
        })
    })

    describe('removeSubreddit', () => {
        it('removes with different casing', async () => {
            await addSubreddit(440, 'TrueTF2')
            const result = await removeSubreddit(440, 'truetf2')
            expect(result).toEqual([])
        })

        it('removing the last name deletes the appid key from the raw file', async () => {
            await addSubreddit(440, 'tf2')
            await addSubreddit(570, 'dota2')
            await removeSubreddit(440, 'tf2')
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(Object.keys(raw)).toEqual(['570'])
        })

        it('removing a nonexistent name leaves the list unchanged', async () => {
            await addSubreddit(440, 'tf2')
            const result = await removeSubreddit(440, 'nope')
            expect(result).toEqual(['tf2'])
            expect(await getSubreddits(440)).toEqual(['tf2'])
        })

        it('removing from an unknown appid returns [] and creates no entry', async () => {
            const result = await removeSubreddit(12345, 'anything')
            expect(result).toEqual([])
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8').catch(() => '{}'))
            expect(raw).toEqual({})
        })

        it('contract: removal is case-insensitive, so hand-edited case variants are all removed', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ '440': ['tf2', 'TF2', 'Tf2'] }))
            const result = await removeSubreddit(440, 'tf2')
            expect(result).toEqual([])
        })
    })

    describe('type confusion from disk', () => {
        // REGRESSION: getSubreddits once used `data[String(appid)] ?? []`, which only
        // guards nullish, so a non-array value on disk was returned as-is and violated
        // the string[] contract; an entryFor() helper now coerces non-arrays to [].
        it('getSubreddits returns [] when the stored value is not an array', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ '440': 'not-an-array' }))
            const result = await getSubreddits(440)
            expect(Array.isArray(result)).toBe(true)
            expect(result).toEqual([])
        })

        // REGRESSION: a non-array stored value once flowed into `current.some(...)` and
        // threw TypeError; addSubreddit now reads through entryFor(), which recovers a
        // corrupt entry to [].
        it('addSubreddit tolerates a non-array stored value', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ '440': 42 }))
            const result = await addSubreddit(440, 'tf2')
            expect(result).toContain('tf2')
        })
    })

    describe('prototype-pollution keys', () => {
        // REGRESSION: for appid "__proto__", `data[key] ?? []` once resolved to
        // Object.prototype through the prototype chain and returned it (an object, not
        // a string[]); own-property access via entryFor() now returns [].
        it('getSubreddits("__proto__") returns an array', async () => {
            const result = await getSubreddits('__proto__')
            expect(Array.isArray(result)).toBe(true)
        })

        // REGRESSION: for appid "__proto__", `current` once became Object.prototype and
        // `current.some` was undefined → TypeError; entryFor() + setOwn now treat the
        // key as inert data so addSubreddit works like any other key.
        it('addSubreddit under appid "__proto__" works like any other key', async () => {
            const result = await addSubreddit('__proto__', 'tf2')
            expect(result).toEqual(['tf2'])
        })

        it('a "__proto__" key already in the JSON file does not pollute Object.prototype', async () => {
            // Raw string: an object literal { __proto__: ... } would set the prototype
            // instead of producing the JSON key.
            await fsp.writeFile(filePath, '{"__proto__":["polluted"]}')
            await getSubreddits(440)
            expect(({} as Record<string, unknown>)[0]).toBeUndefined()
            expect(Array.isArray(Object.getPrototypeOf({}))).toBe(false)
        })
    })

    describe('concurrency', () => {
        // REGRESSION: each call once opened its own ManagedFile over the same path, so
        // concurrent adds all read the initial state and the last flush dropped the
        // others; a shared per-path ManagedFile now serializes them.
        it('concurrent addSubreddit calls must all persist', async () => {
            await Promise.all([
                addSubreddit(440, 'a'),
                addSubreddit(440, 'b'),
                addSubreddit(440, 'c'),
                addSubreddit(440, 'd'),
                addSubreddit(440, 'e'),
            ])
            const list = await getSubreddits(440)
            expect([...list].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
        })

        it('sequentially awaited adds all persist', async () => {
            await addSubreddit(440, 'a')
            await addSubreddit(440, 'b')
            await addSubreddit(440, 'c')
            expect(await getSubreddits(440)).toEqual(['a', 'b', 'c'])
        })
    })
})
