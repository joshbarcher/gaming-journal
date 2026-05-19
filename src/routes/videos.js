import { Router } from 'express'
import { join }   from 'node:path'
import { readFile, access } from 'node:fs/promises'

const router = Router()

const videosBase = () => join(process.env.DATA_DIR, 'relay', 'steam', 'videos')
const moviesBase = () => join(process.env.DATA_DIR, 'relay', 'steam', 'movies')

async function fileExists(p) {
    try { await access(p); return true } catch { return false }
}

// GET /videos/meta/:appid — [{index, name, thumbnail}] for downloaded trailers only
router.get('/meta/:appid', async (req, res) => {
    const { appid } = req.params
    if (!/^\d+$/.test(appid)) return res.status(400).json([])

    const cachePath = join(moviesBase(), `${appid}.json`)
    let movies = []
    try {
        const { movies: m = [] } = JSON.parse(await readFile(cachePath, 'utf8'))
        movies = m
    } catch {
        return res.json([])
    }

    const sorted = [...movies.filter(m => m.highlight), ...movies.filter(m => !m.highlight)]

    const result = []
    for (let i = 0; i < sorted.length; i++) {
        if (await fileExists(join(videosBase(), appid, `${i}.mp4`))) {
            result.push({ index: i, name: sorted[i].name ?? `Trailer ${i + 1}`, thumbnail: sorted[i].thumbnail ?? null })
        }
    }

    res.json(result)
})

// GET /videos/:appid/:index.mp4 — streams the video file with Range support
router.get('/:appid/:filename', (req, res) => {
    const { appid, filename } = req.params
    if (!/^\d+$/.test(appid) || !/^\d+\.mp4$/.test(filename)) return res.status(400).end()

    const filePath = join(videosBase(), appid, filename)
    res.sendFile(filePath, err => {
        if (err && !res.headersSent) res.status(404).end()
    })
})

export default router
