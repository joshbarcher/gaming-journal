import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { isValidOrderName, getOrder, setOrder } from '../lib/server/services/orderService.js'

function tmpDataDir() {
    return path.join(os.tmpdir(), `order-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

const orderPath = (dataDir: string, name: string) =>
    path.join(dataDir, 'gaming-journal', `${name}-order.json`)

describe('orderService', () => {
    let dataDir: string
    let savedDataDir: string | undefined

    beforeEach(() => {
        savedDataDir = process.env.DATA_DIR
        dataDir = tmpDataDir()
        process.env.DATA_DIR = dataDir
    })

    afterEach(async () => {
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('isValidOrderName', () => {
        it('accepts exactly the three known lists', () => {
            expect(isValidOrderName('in-progress')).toBe(true)
            expect(isValidOrderName('backlog')).toBe(true)
            expect(isValidOrderName('playlist')).toBe(true)
        })

        it('rejects case variants, padding, empty, and lookalike keys', () => {
            expect(isValidOrderName('In-Progress')).toBe(false)
            expect(isValidOrderName('BACKLOG')).toBe(false)
            expect(isValidOrderName(' backlog')).toBe(false)
            expect(isValidOrderName('backlog ')).toBe(false)
            expect(isValidOrderName('')).toBe(false)
            expect(isValidOrderName('wishlist')).toBe(false)
        })

        it('rejects prototype-ish names (Set lookup, no object-key hazard)', () => {
            expect(isValidOrderName('__proto__')).toBe(false)
            expect(isValidOrderName('constructor')).toBe(false)
            expect(isValidOrderName('hasOwnProperty')).toBe(false)
        })
    })

    describe('environment', () => {
        it('rejects when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            await expect(getOrder('backlog')).rejects.toThrow(/DATA_DIR/)
            await expect(setOrder('backlog', [1])).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('empty / missing store', () => {
        it('returns [] when no order file exists', async () => {
            expect(await getOrder('backlog')).toEqual([])
            expect(await getOrder('in-progress')).toEqual([])
        })
    })

    describe('set / get round trips', () => {
        it('persists an order exactly, preserving order and duplicates', async () => {
            await setOrder('backlog', [3, 1, 2, 1])
            expect(await getOrder('backlog')).toEqual([3, 1, 2, 1])
        })

        it('order is stable across repeated reads', async () => {
            await setOrder('backlog', [5, 4, 3, 2, 1])
            expect(await getOrder('backlog')).toEqual([5, 4, 3, 2, 1])
            expect(await getOrder('backlog')).toEqual([5, 4, 3, 2, 1])
        })

        it('last write wins — a second set fully replaces the first', async () => {
            await setOrder('backlog', [1, 2, 3])
            await setOrder('backlog', [9])
            expect(await getOrder('backlog')).toEqual([9])
        })

        it('setting [] clears the order', async () => {
            await setOrder('backlog', [1, 2])
            await setOrder('backlog', [])
            expect(await getOrder('backlog')).toEqual([])
        })

        it('the two lists are independent files', async () => {
            await setOrder('backlog', [1])
            await setOrder('in-progress', [2])
            expect(await getOrder('backlog')).toEqual([1])
            expect(await getOrder('in-progress')).toEqual([2])
        })

        it('round-trips boundary numbers: 0, -1, floats, MAX_SAFE_INTEGER', async () => {
            const ids = [0, -1, 3.5, Number.MAX_SAFE_INTEGER]
            await setOrder('backlog', ids)
            expect(await getOrder('backlog')).toEqual(ids)
        })

        it('silently degrades NaN and Infinity to null on the JSON round trip (lossy, documented)', async () => {
            await setOrder('backlog', [NaN, Infinity, -Infinity, 1])
            expect(await getOrder('backlog')).toEqual([null, null, null, 1])
        })

        it('round-trips a large order (10k entries) without reordering', async () => {
            const ids = Array.from({ length: 10_000 }, (_, i) => 10_000 - i)
            await setOrder('backlog', ids)
            expect(await getOrder('backlog')).toEqual(ids)
        })
    })

    describe('name validation is NOT enforced by getOrder/setOrder (caller contract)', () => {
        // isValidOrderName exists for route-level validation; the service itself will
        // happily create `<anything>-order.json`. Documented so a future refactor that
        // adds enforcement knows it is changing behavior.
        it('accepts an arbitrary unvalidated name and creates its own file', async () => {
            await setOrder('totally-unvalidated', [7])
            expect(await getOrder('totally-unvalidated')).toEqual([7])
            const stat = await fsp.stat(orderPath(dataDir, 'totally-unvalidated'))
            expect(stat.isFile()).toBe(true)
        })
    })

    describe('corrupted / wrong-shape store on disk', () => {
        async function writeStore(name: string, content: string) {
            const p = orderPath(dataDir, name)
            await fsp.mkdir(path.dirname(p), { recursive: true })
            await fsp.writeFile(p, content)
        }

        it('returns [] when the file is corrupt JSON and no checkpoint exists', async () => {
            await writeStore('backlog', '[1, 2, oops')
            expect(await getOrder('backlog')).toEqual([])
        })

        it('returns [] when the file parses but is not an array (object)', async () => {
            await writeStore('backlog', '{"1": true}')
            expect(await getOrder('backlog')).toEqual([])
        })

        it('returns [] when the file parses but is not an array (string, number, null)', async () => {
            await writeStore('backlog', '"a string"')
            expect(await getOrder('backlog')).toEqual([])
            await writeStore('in-progress', '42')
            expect(await getOrder('in-progress')).toEqual([])
            await writeStore('in-progress', 'null')
            expect(await getOrder('in-progress')).toEqual([])
        })

        it('prefers the checkpoint over a corrupt main file', async () => {
            await writeStore('backlog', 'CORRUPT')
            await fsp.writeFile(orderPath(dataDir, 'backlog') + '.checkpoint.json', JSON.stringify([4, 5, 6]))
            expect(await getOrder('backlog')).toEqual([4, 5, 6])
        })

        it('can write again after corruption and the new data persists', async () => {
            await writeStore('backlog', 'CORRUPT')
            await setOrder('backlog', [1, 2, 3])
            expect(await getOrder('backlog')).toEqual([1, 2, 3])
        })
    })

    describe('concurrency', () => {
        it('concurrent setOrder calls to DIFFERENT lists both persist (separate files)', async () => {
            await Promise.all([
                setOrder('backlog', [1, 2, 3]),
                setOrder('in-progress', [4, 5, 6]),
            ])
            expect(await getOrder('backlog')).toEqual([1, 2, 3])
            expect(await getOrder('in-progress')).toEqual([4, 5, 6])
        })

        it('concurrent setOrder calls to the SAME list settle and leave the store readable', async () => {
            // Whole-array replacement means last-write-wins is acceptable here; what must
            // hold is that the file never ends up unreadable/garbled from the tmp-file race.
            const a = [1, 2, 3]
            const b = [9, 8, 7]
            await Promise.allSettled([setOrder('backlog', a), setOrder('backlog', b)])
            const final = await getOrder('backlog')
            expect(Array.isArray(final)).toBe(true)
            expect([a, b]).toContainEqual(final)
        })
    })
})
