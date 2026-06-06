import { Router } from 'express'
import { getPrefs, togglePref } from '../services/communityPrefsService.js'

const router = Router()

router.get('/', async (_req, res) => {
    try {
        res.json(await getPrefs())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.post('/toggle', async (req, res) => {
    try {
        const { type, username, appid } = req.body ?? {}
        if (!type || !username)
            return res.status(400).json({ error: 'type and username are required' })
        if (!['filter', 'mute', 'favorite', 'highlight'].includes(type))
            return res.status(400).json({ error: 'invalid type' })
        if (type === 'highlight' && !appid)
            return res.status(400).json({ error: 'appid is required for highlight' })
        const active = await togglePref(type, String(username), appid ? String(appid) : null)
        res.json({ active })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
