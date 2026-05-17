import { Router } from 'express'
import { getAlerts } from '../services/alertsService.js'

const router = Router()

router.get('/', async (req, res) => {
    try {
        res.json(await getAlerts())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
