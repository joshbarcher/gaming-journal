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

function _relayPost(path) {
    fetch(`${_relayUrl()}${path}`, { method: 'POST' })
        .catch(err => logger.warn('[local-wishlist] Relay call failed', { path, err: err.message }))
}

router.post('/:appid', async (req, res) => {
    try {
        const appid = Number(req.params.appid)
        if (!appid) return res.status(400).json({ error: 'invalid appid' })
        const item = await add(appid)
        // Relay handles the full pipeline: verify what data exists, fetch what's
        // missing, then patch caches once everything is ready.
        _relayPost(`/api/admin/provision/${appid}`)
        res.json({ ok: true, item })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.delete('/:appid', async (req, res) => {
    try {
        const appid = Number(req.params.appid)
        if (!appid) return res.status(400).json({ error: 'invalid appid' })
        await remove(appid)
        // No provisioning needed — just update the cache entries for this game.
        _relayPost(`/api/admin/patch/${appid}`)
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
