import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'

// The detail (notes/fixes) now lives in PcgwDetail; the section is a badge strip.
import PcgwDetail from '../lib/svelte/game/PcgwDetail.svelte'
import type { PcgwData } from '../lib/types.js'

// Shaped after the live relay payload for Assassin's Creed: Black Flag Resynced,
// the page that exposed the notes/fixes gaps: its rating cells alone say nothing
// about 30 FPS cutscenes or the broken DLSS implementation.

const pcgwData: PcgwData = {
    found:   true,
    pageUrl: 'https://www.pcgamingwiki.com/wiki/x',
    video: {
        widescreen: 'true',
        fps60:      'limited',
        aa:         'always on',
        upscaling:  'true',
        notes: {
            fps60:     'Cutscenes are 30 FPS. Use <a href="https://www.nexusmods.com/mods/7">this mod</a> to fix.',
            aa:        'TAA, DLAA, FSRAA, XeSSAA and SSAA up to 200% through <b>Resolution Scale</b> slider.',
            upscaling: 'TAAU, DLSS 4.5, FSR 4, XeSS 2',
        },
    },
    fixes: [
        { title: 'Skip intro videos', group: 'Essential improvements', html: '<p>Delete the videos.</p>' },
        { title: "DLSS upscaling doesn't work properly", group: 'Issues unresolved', html: '<p>Set Resolution Scale to 100%.</p>' },
    ],
}

const renderSection = (data: PcgwData = pcgwData) => render(PcgwDetail, { props: { pcgwData: data } })

describe('PCGW section — notes cells', () => {
    it('renders the 60 FPS cutscene caveat', () => {
        const { container } = renderSection()
        expect(container.textContent).toContain('Cutscenes are 30 FPS')
    })

    it('keeps the mod link inside the note clickable and off-site', () => {
        const { container } = renderSection()
        const link = container.querySelector('.pcgw-frow-note a') as HTMLAnchorElement | null
        expect(link?.getAttribute('href')).toBe('https://www.nexusmods.com/mods/7')
    })

    it('lists the anti-aliasing modes', () => {
        const { container } = renderSection()
        expect(container.textContent).toContain('TAA, DLAA, FSRAA, XeSSAA and SSAA')
    })

    it('shows a tile for rows with no note', () => {
        const { container } = renderSection()
        expect(container.textContent).toContain('Widescreen')
    })
})

describe('PCGW section — non-boolean ratings', () => {
    it('renders "limited" as a Limited badge instead of hiding the row', () => {
        const { container } = renderSection()
        expect(container.textContent).toContain('60 FPS')
        expect(container.querySelector('.pcgw-badge--limited')?.textContent).toBe('Limited')
    })

    it('renders free text such as "always on" verbatim', () => {
        const { container } = renderSection()
        expect(container.textContent).toContain('Anti-Aliasing')
        expect(container.querySelector('.pcgw-badge--info')?.textContent).toBe('Always on')
    })

    it('still renders booleans as Yes', () => {
        const { container } = renderSection()
        expect(container.querySelector('.pcgw-badge--yes')?.textContent).toBe('Yes')
    })
})

describe('PCGW section — fix grouping', () => {
    it('renders each PCGW heading as its own block', () => {
        const { container } = renderSection()
        const titles = [...container.querySelectorAll('.pcgw-block-title')].map(n => n.textContent?.trim())
        expect(titles).toContain('Issues unresolved')
        expect(titles).toContain('Essential improvements')
    })

    it('orders unresolved issues ahead of optional improvements', () => {
        const { container } = renderSection()
        const html = container.innerHTML
        expect(html.indexOf('Issues unresolved')).toBeLessThan(html.indexOf('Essential improvements'))
    })

    it('expands unresolved issues by default and flags them', () => {
        const { container } = renderSection()
        const warn = container.querySelector('details.pcgw-fix--warn') as HTMLDetailsElement | null
        expect(warn?.open).toBe(true)
        expect(warn?.textContent).toContain('Set Resolution Scale to 100%')
    })

    it('leaves ordinary tweaks collapsed', () => {
        const { container } = renderSection()
        const plain = [...container.querySelectorAll('details.pcgw-fix')]
            .find(d => !d.classList.contains('pcgw-fix--warn')) as HTMLDetailsElement | undefined
        expect(plain?.open).toBe(false)
    })

    it('falls back to a single block when the relay sends no group', () => {
        const { container } = renderSection({
            ...pcgwData,
            fixes: [{ title: 'Skip intro videos', html: '<p>x</p>' }],
        })
        const titles = [...container.querySelectorAll('.pcgw-block-title')].map(n => n.textContent?.trim())
        expect(titles).toContain('Fixes & Tweaks')
    })
})

describe('PCGW section — legacy payloads', () => {
    it('renders without notes or groups (entry written by the old parser)', () => {
        const { container } = renderSection({
            found: true,
            video: { widescreen: 'true', hdr: 'false' },
            fixes: [],
        })
        expect(container.querySelector('.pcgw-frow-note')).toBeNull()
        expect(container.textContent).toContain('Widescreen')
        expect(container.querySelector('.pcgw-badge--no')?.textContent).toBe('No')
    })
})
