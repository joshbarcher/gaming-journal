import { Router } from 'express'
import pagesRouter from './pages.js'
import flagsRouter from './flags.js'
import settingsRouter from './settings.js'
import alertsRouter from './alerts.js'
import franchisesRouter from './franchises.js'
import localReviewsRouter from './localReviews.js'
import localWishlistRouter from './localWishlist.js'
import orderRouter from './order.js'
import communityPrefsRouter from './communityPrefs.js'

const router = Router()

router.get('/config', (_req, res) => {
    res.json({ relayUrl: (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '') })
})

router.use('/pages',            pagesRouter)
router.use('/flags',            flagsRouter)
router.use('/settings',         settingsRouter)
router.use('/alerts',           alertsRouter)
router.use('/franchises',       franchisesRouter)
router.use('/local-reviews',    localReviewsRouter)
router.use('/local-wishlist',   localWishlistRouter)
router.use('/order',            orderRouter)
router.use('/community-prefs',  communityPrefsRouter)

export default router
