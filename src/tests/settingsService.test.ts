import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getSettings, patchSettings } from '../lib/server/services/settingsService.js'
import type { Settings } from '../lib/types.js'

const DEFAULTS: Settings = {
    showChildLocked: false, showFiltered: false, showSoftware: false,
    hideUnavailable: false, titleBlocklist: [], discoverFiltersEnabled: true,
    hideAdultContent: true,
}

function makeTmpDir() {
    return path.join(os.tmpdir(), `settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('settingsService', () => {
    let tmpDir: string
    let filePath: string
    let prevDataDir: string | undefined

    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        filePath = path.join(tmpDir, 'gaming-journal', 'settings.json')
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
            await expect(getSettings()).rejects.toThrow(/DATA_DIR/)
            await expect(patchSettings({})).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('defaults — missing / partial / corrupt file', () => {
        it('getSettings returns full defaults when the file does not exist', async () => {
            expect(await getSettings()).toEqual(DEFAULTS)
        })

        it('getSettings fills defaults for keys missing from a partial file', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ showFiltered: true }))
            const s = await getSettings()
            expect(s.showFiltered).toBe(true)
            expect(s.hideAdultContent).toBe(true)       // default true survives
            expect(s.discoverFiltersEnabled).toBe(true) // default true survives
            expect(s.titleBlocklist).toEqual([])
        })

        it('stored false overrides a default-true value', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ hideAdultContent: false }))
            expect((await getSettings()).hideAdultContent).toBe(false)
        })

        it('falls back to defaults when the file is corrupt and no checkpoint exists', async () => {
            await fsp.writeFile(filePath, 'corrupt!!!')
            expect(await getSettings()).toEqual(DEFAULTS)
        })

        it('recovers from a checkpoint when the main file is corrupt', async () => {
            await fsp.writeFile(filePath, 'corrupt!!!')
            await fsp.writeFile(filePath + '.checkpoint.json', JSON.stringify({ showSoftware: true }))
            expect((await getSettings()).showSoftware).toBe(true)
        })

        it('contract: unknown keys already on disk pass through getSettings', async () => {
            await fsp.writeFile(filePath, JSON.stringify({ legacySetting: 123 }))
            const s = await getSettings() as Settings & { legacySetting?: number }
            expect(s.legacySetting).toBe(123)
        })
    })

    describe('patchSettings — valid patches', () => {
        it('sets a boolean and persists it across a fresh reload', async () => {
            const result = await patchSettings({ showChildLocked: true })
            expect(result.showChildLocked).toBe(true)
            expect((await getSettings()).showChildLocked).toBe(true)
        })

        it('empty patch returns and materializes full defaults on disk', async () => {
            const result = await patchSettings({})
            expect(result).toEqual(DEFAULTS)
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect(raw).toEqual(DEFAULTS)
        })

        it('patches accumulate across sequential calls', async () => {
            await patchSettings({ showFiltered: true })
            await patchSettings({ showSoftware: true })
            const s = await getSettings()
            expect(s.showFiltered).toBe(true)
            expect(s.showSoftware).toBe(true)
        })

        it('titleBlocklist accepts a string array and round-trips unicode', async () => {
            const list = ['Hentai — 何か', 'ASCII title', '']
            const result = await patchSettings({ titleBlocklist: list })
            expect(result.titleBlocklist).toEqual(list)
            expect((await getSettings()).titleBlocklist).toEqual(list)
        })

        it('titleBlocklist can be cleared with an empty array', async () => {
            await patchSettings({ titleBlocklist: ['x'] })
            const result = await patchSettings({ titleBlocklist: [] })
            expect(result.titleBlocklist).toEqual([])
        })

        it('setting a default-true key to false persists', async () => {
            await patchSettings({ hideAdultContent: false })
            expect((await getSettings()).hideAdultContent).toBe(false)
        })
    })

    describe('patchSettings — type confusion / invalid values', () => {
        it('string "true" for a boolean key is ignored', async () => {
            const result = await patchSettings({ showFiltered: 'true' as unknown as boolean })
            expect(result.showFiltered).toBe(false)
        })

        it('numeric 1 / 0 for a boolean key is ignored', async () => {
            await patchSettings({ showFiltered: 1 as unknown as boolean, hideAdultContent: 0 as unknown as boolean })
            const s = await getSettings()
            expect(s.showFiltered).toBe(false)
            expect(s.hideAdultContent).toBe(true)
        })

        it('null / undefined for a boolean key is ignored and does not clobber a stored value', async () => {
            await patchSettings({ showSoftware: true })
            const result = await patchSettings({ showSoftware: null as unknown as boolean })
            expect(result.showSoftware).toBe(true)
        })

        it('titleBlocklist rejects a non-array without clobbering the stored list', async () => {
            await patchSettings({ titleBlocklist: ['keep'] })
            const result = await patchSettings({ titleBlocklist: 'nope' as unknown as string[] })
            expect(result.titleBlocklist).toEqual(['keep'])
        })

        it('titleBlocklist rejects a mixed-type array entirely', async () => {
            await patchSettings({ titleBlocklist: ['keep'] })
            const result = await patchSettings({ titleBlocklist: ['a', 42] as unknown as string[] })
            expect(result.titleBlocklist).toEqual(['keep'])
        })

        it('unknown keys are ignored and never written to disk', async () => {
            const result = await patchSettings({ evilKey: true } as unknown as Partial<Settings>)
            expect('evilKey' in result).toBe(false)
            const raw = JSON.parse(await fsp.readFile(filePath, 'utf8'))
            expect('evilKey' in raw).toBe(false)
        })
    })

    describe('prototype-pollution keys', () => {
        // REGRESSION: patchSettings once used `key in DEFAULTS`, which matches INHERITED
        // properties ("constructor", "toString", ...), so patchSettings({ constructor: true })
        // wrote a junk own-property that got persisted and returned; the guard is now
        // Object.hasOwn(DEFAULTS, key) so inherited-only keys are rejected.
        it('inherited-only keys like "constructor" are rejected', async () => {
            const result = await patchSettings({ constructor: true } as unknown as Partial<Settings>)
            expect(Object.hasOwn(result, 'constructor')).toBe(false)
        })

        it('a computed "__proto__" patch key does not pollute or create an own key', async () => {
            const patch = { ['__proto__']: true } as unknown as Partial<Settings>
            const result = await patchSettings(patch)
            // bracket-assignment to __proto__ with a primitive is a silent no-op
            expect(Object.hasOwn(result, '__proto__')).toBe(false)
            expect(result.showFiltered).toBe(false)
            expect(({} as Record<string, unknown>).showFiltered).toBeUndefined()
        })

        it('a "__proto__" key in the JSON file does not pollute Object.prototype', async () => {
            // Raw string: an object literal { __proto__: ... } would set the prototype
            // instead of producing the JSON key.
            await fsp.writeFile(filePath, '{"__proto__":{"polluted":true}}')
            await getSettings()
            expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        })
    })

    describe('concurrency', () => {
        // REGRESSION: patchSettings once opened its own ManagedFile per call, so
        // concurrent patches all read the initial state and the last flush dropped the
        // others; a shared per-path ManagedFile now serializes them.
        it('concurrent patches to different keys must all persist', async () => {
            await Promise.all([
                patchSettings({ showChildLocked: true }),
                patchSettings({ showFiltered: true }),
                patchSettings({ showSoftware: true }),
                patchSettings({ hideUnavailable: true }),
            ])
            const s = await getSettings()
            expect(s.showChildLocked).toBe(true)
            expect(s.showFiltered).toBe(true)
            expect(s.showSoftware).toBe(true)
            expect(s.hideUnavailable).toBe(true)
        })
    })
})
