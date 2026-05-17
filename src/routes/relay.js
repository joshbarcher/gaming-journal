import http from 'node:http'
import https from 'node:https'
import { Router } from 'express'

const router = Router()

function relay() {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

router.use((req, res) => {
    const base   = relay()
    const target = new URL(base)
    const secure = target.protocol === 'https:'
    const mod    = secure ? https : http

    const options = {
        hostname: target.hostname,
        port:     target.port || (secure ? 443 : 80),
        path:     req.url,
        method:   req.method,
        headers:  {
            accept: req.headers.accept || '*/*',
            ...(req.headers['content-type']   && { 'content-type':   req.headers['content-type'] }),
            ...(req.headers['content-length'] && { 'content-length': req.headers['content-length'] }),
        },
    }

    const proxyReq = mod.request(options, proxyRes => {
        res.status(proxyRes.statusCode)
        const ct = proxyRes.headers['content-type']
        const cl = proxyRes.headers['content-length']
        const cc = proxyRes.headers['cache-control']
        if (ct) res.setHeader('Content-Type', ct)
        if (cl) res.setHeader('Content-Length', cl)
        if (cc) res.setHeader('Cache-Control', cc)
        proxyRes.pipe(res, { end: true })
    })

    proxyReq.on('error', () => {
        if (!res.headersSent) res.status(502).json({ error: 'Relay server unreachable' })
    })

    req.pipe(proxyReq, { end: true })
})

export default router
