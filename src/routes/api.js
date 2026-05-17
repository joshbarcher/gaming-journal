import { Router } from 'express'
import pagesRouter from './pages.js'
import flagsRouter from './flags.js'
import settingsRouter from './settings.js'

const router = Router()

router.get('/config', (_req, res) => {
    res.json({ relayUrl: (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '') })
})

router.use('/pages',    pagesRouter)
router.use('/flags',    flagsRouter)
router.use('/settings', settingsRouter)

export default router
