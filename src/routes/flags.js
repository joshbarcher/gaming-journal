import { Router } from 'express'
import { getFlags, setFlag, getAllFlags } from '../services/flagsService.js'

const router = Router()

router.get('/', async (req, res) => {
    try {
        res.json(await getAllFlags())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.get('/:appid', async (req, res) => {
    try {
        res.json(await getFlags(Number(req.params.appid)))
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

router.patch('/:appid', async (req, res) => {
    try {
        const { flag, value } = req.body
        if (typeof flag !== 'string' || typeof value !== 'boolean') {
            return res.status(400).json({ error: 'Body must be { flag: string, value: boolean }' })
        }
        const flags = await setFlag(Number(req.params.appid), flag, value)
        res.json(flags)
    } catch (err) {
        if (err.message.startsWith('Unknown flag')) return res.status(400).json({ error: err.message })
        res.status(500).json({ error: err.message })
    }
})

export default router
