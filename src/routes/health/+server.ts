import { json } from '@sveltejs/kit'

export function _formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400)
    const h = Math.floor((seconds % 86400) / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
    return `${m}m`
}

export function GET() {
    return json({ status: 'ok', uptime: _formatUptime(process.uptime()) })
}
