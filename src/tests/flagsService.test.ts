import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getFlags, setFlag, getAllFlags } from '../lib/server/services/flagsService.js'

function makeTmpDir() {
    return path.join(os.tmpdir(), `flags-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('flagsService', () => {
    let tmpDir: string
    let filePath: string
    let prevDataDir: string | undefined

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        filePath = path.join(tmpDir, 'gaming-journal', 'flags.json')
        prevDataDir = process.env.DATA_DIR
        process.env.DATA_DIR = tmpDir
        // Silence ManagedFile's default console logger
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
            await expect(getFlags(1)).rejects.toThrow(/DATA_DIR/)
        })

        it('setFlag also rejects when DATA_DIR is not set', async () => {
            delete process.env.DATA_DIR
            await expect(setFlag(1, 'alert', true)).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('defaults — missing / empty / corrupt file', () => {
        it('getFlags returns {} when the file does not exist', async () => {
            expect(await getFlags(440)).toEqual({})
        })

        it('getAllFlags returns {} when the file does not exist', async () => {
            expect(await getAllFlags()).toEqual({})
        })

        it('getFlags returns {} for an unknown appid on an existing store', async () => {
            await setFlag(1, 'alert', true)
            expect(await getFlags(999999)).toEqual({})
        })

        it('falls back to default {} when the file is corrupt and no checkpoint exists', async () => {
            await fsp.writeFile(filePath, 'NOT JSON {{{')
            expect(await getAllFlags()).toEqual({})
        })

        it('recovers from a checkpoint when the main file is corrupt', async () => {
            await fsp.writeFile(filePath, 'NOT JSON {{{')
            await fsp.writeFile(filePath + '.checkpoint.json', JSON.stringify({ '77': { alert: true } }))
            expect(await getFlags(77)).toEqual({ alert: true })
        })

        it('entry that is null on disk is treated as no flags', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ '10': null }))
            expect(await getFlags(10)).toEqual({})
        })
    })

    describe('setFlag validation', () => {
        it('throws for an unknown flag key', async () => {
            await expect(setFlag(1, 'bogus', true)).rejects.toThrow(/Unknown flag: bogus/)
        })

        it('flag keys are case-sensitive — "Alert" is rejected', async () => {
            await expect(setFlag(1, 'Alert', true)).rejects.toThrow(/Unknown flag/)
        })

        it('empty-string flag is rejected', async () => {
            await expect(setFlag(1, '', true)).rejects.toThrow(/Unknown flag/)
        })

        it('rejecting an unknown flag does not create the file entry', async () => {
            await setFlag(1, 'alert', true)
            await expect(setFlag(2, 'nope', true)).rejects.toThrow()
            expect(await getAllFlags()).toEqual({ '1': { alert: true } })
        })
    })

    describe('setFlag behavior + persistence round-trips', () => {
        it('set true persists and survives a fresh reload from disk', async () => {
            const result = await setFlag(440, 'favorite', true)
            expect(result).toEqual({ favorite: true })
            // Fresh service call = fresh ManagedFile = read from disk
            expect(await getFlags(440)).toEqual({ favorite: true })
        })

        it('numeric and string appids address the same entry', async () => {
            await setFlag(440, 'alert', true)
            expect(await getFlags('440')).toEqual({ alert: true })
            await setFlag('440', 'alert', false)
            expect(await getFlags(440)).toEqual({})
        })

        it('multiple flags accumulate on the same appid', async () => {
            await setFlag(1, 'alert', true)
            await setFlag(1, 'favorite', true)
            await setFlag(1, 'backlog', true)
            expect(await getFlags(1)).toEqual({ alert: true, favorite: true, backlog: true })
        })

        it('set false removes the flag; the appid entry is deleted from disk when empty', async () => {
            await setFlag(1, 'alert', true)
            await setFlag(1, 'alert', false)
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(raw).toEqual({})
        })

        it('set false keeps the appid entry when other flags remain', async () => {
            await setFlag(1, 'alert', true)
            await setFlag(1, 'favorite', true)
            const result = await setFlag(1, 'alert', false)
            expect(result).toEqual({ favorite: true })
            expect(await getFlags(1)).toEqual({ favorite: true })
        })

        it('set false on a never-set appid returns {} and creates no entry', async () => {
            const result = await setFlag(555, 'alert', false)
            expect(result).toEqual({})
            expect(await getAllFlags()).toEqual({})
        })

        it('contract: truthy non-boolean value is coerced to literal true', async () => {
            // setFlag stores `true`, never the raw value
            await setFlag(1, 'alert', 'yes' as unknown as boolean)
            expect(await getFlags(1)).toEqual({ alert: true })
        })

        it('contract: falsy non-boolean value (0) acts as delete', async () => {
            await setFlag(1, 'alert', true)
            await setFlag(1, 'alert', 0 as unknown as boolean)
            expect(await getFlags(1)).toEqual({})
        })

        it('boundary appids 0, -1 and NaN are stringified into distinct keys', async () => {
            await setFlag(0, 'alert', true)
            await setFlag(-1, 'favorite', true)
            await setFlag(NaN, 'backlog', true)
            expect(await getFlags(0)).toEqual({ alert: true })
            expect(await getFlags(-1)).toEqual({ favorite: true })
            expect(await getFlags(NaN)).toEqual({ backlog: true })
            expect(Object.keys(await getAllFlags()).sort()).toEqual(['-1', '0', 'NaN'])
        })

        it('contract: non-boolean flag values already on disk pass through getFlags unvalidated', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ '10': { alert: 'yes' } }))
            expect(await getFlags(10)).toEqual({ alert: 'yes' })
        })
    })

    describe('prototype-pollution keys', () => {
        // REGRESSION: setFlag on appid "__proto__" once let data[key] resolve to
        // Object.prototype and wrote the flag onto it, polluting every object; now
        // uses own-property access (getOwn/setOwn) so the key stays inert data.
        it('setFlag on appid "__proto__" must not pollute Object.prototype', async () => {
            try {
                await setFlag('__proto__', 'alert', true).catch(() => {})
                expect(({} as Record<string, unknown>).alert).toBeUndefined()
            } finally {
                delete (Object.prototype as Record<string, unknown>).alert
            }
        })

        // REGRESSION: getFlags("__proto__") once read through the prototype chain and
        // returned Object.prototype instead of {}; now uses own-property access.
        it('getFlags("__proto__") returns a plain empty object, not Object.prototype', async () => {
            const flags = await getFlags('__proto__')
            expect(flags).not.toBe(Object.prototype)
        })
    })

    describe('concurrency', () => {
        // REGRESSION: setFlag once opened its own ManagedFile per call, so concurrent
        // writes all read the initial state and the last flush dropped the others;
        // a shared per-path ManagedFile now serializes them.
        it('concurrent setFlag calls on different appids must all persist', async () => {
            await Promise.all([
                setFlag(1, 'alert', true),
                setFlag(2, 'alert', true),
                setFlag(3, 'alert', true),
                setFlag(4, 'alert', true),
                setFlag(5, 'alert', true),
            ])
            const all = await getAllFlags()
            expect(Object.keys(all).sort()).toEqual(['1', '2', '3', '4', '5'])
        })

        it('sequentially awaited setFlag calls all persist', async () => {
            await setFlag(1, 'alert', true)
            await setFlag(2, 'alert', true)
            await setFlag(3, 'alert', true)
            expect(Object.keys(await getAllFlags()).sort()).toEqual(['1', '2', '3'])
        })
    })
})
