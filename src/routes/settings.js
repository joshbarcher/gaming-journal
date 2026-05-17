import { Router } from 'express'
import { getSettings, patchSettings } from '../services/settingsService.js'

const router = Router()

router.get('/', async (req, res) => {
    try {
        res.json(await getSettings())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.patch('/', async (req, res) => {
    try {
        res.json(await patchSettings(req.body ?? {}))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
