import { Router } from 'express'
import pagesRouter from './pages.js'

const router = Router()

router.get('/config', (_req, res) => {
    res.json({ relayUrl: (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '') })
})

router.use('/pages', pagesRouter)

export default router
