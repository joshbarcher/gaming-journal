import { Router } from 'express'
import logger from '../../logger.js'
import { getAll, add, remove } from '../services/localWishlistService.js'

const router = Router()

router.get('/', async (_req, res) => {
    try {
        res.json(await getAll())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

function _relayUrl() {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function _relayPost(path) {
    const url = `${_relayUrl()}${path}`
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

router.post('/:appid', async (req, res) => {
    try {
        const appid = Number(req.params.appid)
        logger.info('[local-wishlist] POST add', { appid })
        if (!appid) return res.status(400).json({ error: 'invalid appid' })
        const item = await add(appid)
        logger.info('[local-wishlist] add persisted', { appid, item })
        // Relay handles the full pipeline: verify what data exists, fetch what's
        // missing, then patch caches once everything is ready.
        _relayPost(`/api/admin/provision/${appid}`)
        res.json({ ok: true, item })
    } catch (err) {
        logger.error('[local-wishlist] POST error', { err: err.message })
        res.status(500).json({ error: err.message })
    }
})

router.delete('/:appid', async (req, res) => {
    try {
        const appid = Number(req.params.appid)
        logger.info('[local-wishlist] DELETE remove', { appid })
        if (!appid) return res.status(400).json({ error: 'invalid appid' })
        await remove(appid)
        logger.info('[local-wishlist] remove persisted', { appid })
        // No provisioning needed — just update the cache entries for this game.
        _relayPost(`/api/admin/patch/${appid}`)
        res.json({ ok: true })
    } catch (err) {
        logger.error('[local-wishlist] DELETE error', { err: err.message })
        res.status(500).json({ error: err.message })
    }
})

export default router
