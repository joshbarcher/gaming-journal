import { Router } from 'express'
import logger from '../logger.js'
import { getAll, add, remove } from '../services/localWishlistService.js'

const router = Router()

router.get('/', async (_req, res) => {
    try {
        res.json(await getAll())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.post('/:appid', async (req, res) => {
    try {
        const appid = Number(req.params.appid)
        if (!appid) return res.status(400).json({ error: 'invalid appid' })
        const item = await add(appid)

        // Trigger full provision on relay so store data, images, etc. arrive promptly.
        // Fire-and-forget — don't block the response.
        const relayUrl = (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
        fetch(`${relayUrl}/api/admin/provision/${appid}`, { method: 'POST' })
            .catch(err => logger.warn('[local-wishlist] Provision trigger failed', { appid, err: err.message }))

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
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
