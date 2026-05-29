import { Router } from 'express'
import { isValidOrderName, getOrder, setOrder } from '../services/orderService.js'

const router = Router()

router.get('/:name', async (req, res) => {
    const { name } = req.params
    if (!isValidOrderName(name)) return res.status(404).json({ error: 'Unknown order' })
    try {
        res.json(await getOrder(name))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.put('/:name', async (req, res) => {
    const { name } = req.params
    if (!isValidOrderName(name)) return res.status(404).json({ error: 'Unknown order' })
    const appids = req.body
    if (!Array.isArray(appids) || !appids.every(id => typeof id === 'number')) {
        return res.status(400).json({ error: 'Body must be an array of numbers' })
    }
    try {
        await setOrder(name, appids)
        res.json({ ok: true })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
