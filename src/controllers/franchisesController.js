import { getFranchiseService } from '../services/franchiseService.js'

export async function handleListFranchises(req, res) {
    try {
        res.json(getFranchiseService().getAll())
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleGetFranchise(req, res) {
    try {
        const f = getFranchiseService().getById(req.params.id)
        if (!f) return res.status(404).json({ error: 'Franchise not found' })
        res.json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleCreateFranchise(req, res) {
    try {
        const { name } = req.body
        if (!name || typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'name is required' })
        }
        const f = await getFranchiseService().create({ name: name.trim() })
        res.status(201).json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleUpdateFranchise(req, res) {
    try {
        const { name } = req.body
        if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
            return res.status(400).json({ error: 'name must be a non-empty string' })
        }
        const updates = {}
        if (name) updates.name = name.trim()

        const f = await getFranchiseService().update(req.params.id, updates)
        if (!f) return res.status(404).json({ error: 'Franchise not found' })
        res.json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleDeleteFranchise(req, res) {
    try {
        const ok = await getFranchiseService().remove(req.params.id)
        if (!ok) return res.status(404).json({ error: 'Franchise not found' })
        res.status(204).end()
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleAddEntry(req, res) {
    try {
        const { appid, name } = req.body
        if (!appid || typeof appid !== 'number') {
            return res.status(400).json({ error: 'appid (number) is required' })
        }
        const f = await getFranchiseService().addEntry(req.params.id, { appid, name })
        if (!f) return res.status(404).json({ error: 'Franchise not found' })
        res.json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleRemoveEntry(req, res) {
    try {
        const appid = Number(req.params.appid)
        if (!appid) return res.status(400).json({ error: 'Invalid appid' })
        const f = await getFranchiseService().removeEntry(req.params.id, appid)
        if (!f) return res.status(404).json({ error: 'Franchise not found' })
        res.json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}

export async function handleReorderEntries(req, res) {
    try {
        const { appids } = req.body
        if (!Array.isArray(appids)) return res.status(400).json({ error: 'appids array is required' })
        const f = await getFranchiseService().reorderEntries(req.params.id, appids)
        if (!f) return res.status(404).json({ error: 'Franchise not found' })
        res.json(f)
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
}
