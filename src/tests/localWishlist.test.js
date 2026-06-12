import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

// Static import — makeFile() reads DATA_DIR at call time, so no cache-busting needed
import { getAll, add, remove, cleanupOwned } from '../lib/server/services/localWishlistService.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
    return path.join(os.tmpdir(), `wl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

let tmpDir

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('localWishlistService', () => {
    beforeEach(async () => {
        tmpDir = makeTmpDir()
        await fsp.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
        process.env.DATA_DIR = tmpDir
    })

    afterEach(async () => {
        await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
        delete process.env.DATA_DIR
    })

    describe('getAll', () => {
        it('returns empty items on a fresh file', async () => {
            const result = await getAll()
            assert.deepEqual(result.items, {})
        })
    })

    describe('add', () => {
        it('persists a new item with a dateAdded timestamp', async () => {
            const before = Math.floor(Date.now() / 1000)
            await add(12345)
            const after = Math.floor(Date.now() / 1000)

            const data = await getAll()
            assert.ok(data.items['12345'], 'item should exist')
            assert.ok(data.items['12345'].dateAdded >= before)
            assert.ok(data.items['12345'].dateAdded <= after)
        })

        it('returns the item that was added', async () => {
            const item = await add(99999)
            assert.ok(typeof item.dateAdded === 'number')
        })

        it('is idempotent — adding the same appid twice does not duplicate', async () => {
            await add(12345)
            const firstDate = (await getAll()).items['12345'].dateAdded
            await add(12345)
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 1)
            assert.equal(data.items['12345'].dateAdded, firstDate)
        })

        it('can add multiple distinct games', async () => {
            await add(111)
            await add(222)
            await add(333)
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 3)
            assert.ok(data.items['111'])
            assert.ok(data.items['222'])
            assert.ok(data.items['333'])
        })
    })

    describe('remove', () => {
        it('removes an existing item', async () => {
            await add(12345)
            await remove(12345)
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 0)
        })

        it('is a no-op when removing a non-existent item', async () => {
            await remove(99999)
            const data = await getAll()
            assert.deepEqual(data.items, {})
        })

        it('only removes the targeted item', async () => {
            await add(111)
            await add(222)
            await remove(111)
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 1)
            assert.ok(data.items['222'])
            assert.equal(data.items['111'], undefined)
        })
    })

    describe('cleanupOwned', () => {
        it('removes items that are in the owned set', async () => {
            await add(111)
            await add(222)
            await add(333)
            await cleanupOwned([111, 333])
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 1)
            assert.ok(data.items['222'])
        })

        it('returns true when items were removed', async () => {
            await add(111)
            const changed = await cleanupOwned([111])
            assert.equal(changed, true)
        })

        it('returns false when nothing was removed', async () => {
            await add(111)
            const changed = await cleanupOwned([999])
            assert.equal(changed, false)
        })

        it('handles an empty owned list gracefully', async () => {
            await add(111)
            await cleanupOwned([])
            const data = await getAll()
            assert.equal(Object.keys(data.items).length, 1)
        })
    })
})
