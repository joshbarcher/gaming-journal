import { json } from '@sveltejs/kit'
import logger from '$lib/server/logger.js'
import { getAll, add, remove } from '$lib/server/services/localWishlistService.js'

function relayUrl() {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function relayPost(path) {
    const url = `${relayUrl()}${path}`
    logger.info('[local-wishlist] relay call start', { url })
    try {
        const res = await fetch(url, { method: 'POST' })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            logger.warn('[local-wishlist] relay call non-2xx', { url, status: res.status, body })
        } else {
            logger.info('[local-wishlist] relay call ok', { url, status: res.status })
        }
    } catch (err) {
        logger.warn('[local-wishlist] relay call network error', { url, err: err.message })
    }
}

export async function GET({ params }) {
    try {
        const appid = Number(params.appid)
        if (!appid) return json({ error: 'invalid appid' }, { status: 400 })
        const data = await getAll()
        const wishlisted = !!data.items[String(appid)]
        logger.info('[local-wishlist] GET status', { appid, wishlisted })
        return json({ wishlisted })
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}

export async function POST({ params }) {
    try {
        const appid = Number(params.appid)
        logger.info('[local-wishlist] POST add', { appid })
        if (!appid) return json({ error: 'invalid appid' }, { status: 400 })
        const item = await add(appid)
        logger.info('[local-wishlist] add persisted', { appid, item })
        relayPost(`/api/admin/provision/${appid}`)
        return json({ ok: true, item })
    } catch (err) {
        logger.error('[local-wishlist] POST error', { err: err.message })
        return json({ error: err.message }, { status: 500 })
    }
}

export async function DELETE({ params }) {
    try {
        const appid = Number(params.appid)
        logger.info('[local-wishlist] DELETE remove', { appid })
        if (!appid) return json({ error: 'invalid appid' }, { status: 400 })
        await remove(appid)
        logger.info('[local-wishlist] remove persisted', { appid })
        relayPost(`/api/admin/patch/${appid}`)
        return json({ ok: true })
    } catch (err) {
        logger.error('[local-wishlist] DELETE error', { err: err.message })
        return json({ error: err.message }, { status: 500 })
    }
}
