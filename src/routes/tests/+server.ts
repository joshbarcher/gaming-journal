import fsp  from 'node:fs/promises'
import path from 'node:path'

export async function GET() {
    const html = await fsp.readFile(
        path.join(process.cwd(), 'public', 'tests.html'),
        'utf8'
    )
    return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
}
