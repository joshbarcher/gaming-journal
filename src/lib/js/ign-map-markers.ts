// Canvas marker layer for downloaded IGN interactive maps.
//
// A Palworld map carries 11,138 markers and 43 layers are on by default, so one
// Leaflet Marker per point is not viable — that many DOM nodes stall panning.
// Instead every visible marker is drawn onto a single canvas in the overlay pane,
// which keeps the exact sprite artwork IGN uses (no substituted dots or clusters)
// while staying smooth at any zoom.
//
// Hit-testing walks the drawn set back-to-front so the marker visually on top is
// the one a click selects.

import L from 'leaflet'

export interface MapIcon {
    width: number
    height: number
    offsetX: number
    offsetY: number
    anchorX?: number
    anchorY?: number
    pixelRatio: number
}

export interface MapMarker {
    id: string
    lat: number
    lng: number
    name: string
    typeSlug: string
}

export interface MarkerLayerOptions {
    sprite: HTMLImageElement
    /**
     * Sprite pixels per icon-coordinate unit.
     *
     * IGN reports `pixelRatio: 1` on every icon while shipping an @2x sheet — the
     * Palworld sprite is 660x792 for a 330x396 icon coordinate space. Trusting the
     * reported ratio slices the wrong rectangle out of the sheet and every marker
     * renders as a quarter of itself plus its neighbours. Measure it instead:
     * see spriteScaleFor().
     */
    spriteScale: number
    iconFor: (typeSlug: string) => MapIcon | null
    /** Markers already dimmed as "found" draw at reduced opacity. */
    isFound: (id: string) => boolean
    onSelect: (marker: MapMarker | null) => void
}

/**
 * Derive the sprite sheet's true scale by comparing its pixel size against the
 * furthest icon rectangle the map declares. Falls back to 1 when the numbers
 * don't divide cleanly, which is safer than assuming 2 for a map that really is @1x.
 */
export function spriteScaleFor(sprite: HTMLImageElement, icons: MapIcon[]): number {
    let maxX = 0
    let maxY = 0
    for (const ic of icons) {
        maxX = Math.max(maxX, ic.offsetX + ic.width)
        maxY = Math.max(maxY, ic.offsetY + ic.height)
    }
    if (!maxX || !maxY) return 1
    const sx = sprite.naturalWidth / maxX
    const sy = sprite.naturalHeight / maxY
    // Both axes must agree and land on a whole number for the sheet to be a
    // clean multiple; anything else means the extent isn't the sheet bounds.
    const rounded = Math.round(sx)
    if (rounded >= 1 && Math.abs(sx - sy) < 0.01 && Math.abs(sx - rounded) < 0.01) return rounded
    return 1
}

// Extra pixels drawn beyond the viewport so markers slide in already-painted
// rather than popping at the edge during a pan.
const CULL_PAD = 96

export const MarkerCanvasLayer = L.Layer.extend({
    initialize(this: any, markers: MapMarker[], options: MarkerLayerOptions) {
        this._markers = markers
        this._opts = options
        this._visible = markers
        this._drawn = [] as Array<{ m: MapMarker, x: number, y: number, w: number, h: number }>
        this._selectedId = null as string | null
    },

    onAdd(this: any, map: L.Map) {
        this._map = map
        const canvas = L.DomUtil.create('canvas', 'ign-map-markers') as HTMLCanvasElement
        this._canvas = canvas
        canvas.style.position = 'absolute'
        // Clicks are handled off the map's own container so Leaflet's drag
        // handling keeps working; the canvas must not swallow pointer events.
        canvas.style.pointerEvents = 'none'
        map.getPanes().overlayPane!.appendChild(canvas)

        map.on('moveend zoomend resize viewreset', this._reset, this)
        map.on('zoomanim', this._onZoomAnim, this)
        map.on('click', this._onClick, this)
        map.on('mousemove', this._onMouseMove, this)
        this._reset()
        return this
    },

    onRemove(this: any, map: L.Map) {
        map.off('moveend zoomend resize viewreset', this._reset, this)
        map.off('zoomanim', this._onZoomAnim, this)
        map.off('click', this._onClick, this)
        map.off('mousemove', this._onMouseMove, this)
        this._canvas?.remove()
        return this
    },

    /** Swap the marker set (filter change / search) and repaint. */
    setMarkers(this: any, markers: MapMarker[]) {
        this._markers = markers
        this._reset()
    },

    setSelected(this: any, id: string | null) {
        this._selectedId = id
        this._draw()
    },

    /** Keep the canvas glued to the pane while Leaflet animates a zoom. */
    _onZoomAnim(this: any, e: any) {
        const scale = this._map.getZoomScale(e.zoom, this._map.getZoom())
        const offset = this._map._latLngToNewLayerPoint(
            this._map.getBounds().getNorthWest(), e.zoom, e.center,
        )
        L.DomUtil.setTransform(this._canvas, offset, scale)
    },

    _reset(this: any) {
        const map = this._map
        if (!map) return
        const size = map.getSize()
        const topLeft = map.containerPointToLayerPoint([0, 0])

        L.DomUtil.setTransform(this._canvas, topLeft, 1)

        // Back the canvas at device resolution so sprite art stays crisp on HiDPI.
        const dpr = window.devicePixelRatio || 1
        this._canvas.width = Math.round(size.x * dpr)
        this._canvas.height = Math.round(size.y * dpr)
        this._canvas.style.width = `${size.x}px`
        this._canvas.style.height = `${size.y}px`
        this._dpr = dpr

        this._draw()
    },

    _draw(this: any) {
        const map = this._map
        const canvas = this._canvas
        if (!map || !canvas) return

        const ctx: CanvasRenderingContext2D = canvas.getContext('2d')
        const { sprite, spriteScale, iconFor, isFound } = this._opts as MarkerLayerOptions

        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0)
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        const size = map.getSize()
        const drawn: Array<{ m: MapMarker, x: number, y: number, w: number, h: number }> = []

        for (const m of this._markers) {
            const p = map.latLngToContainerPoint([m.lat, m.lng])
            if (p.x < -CULL_PAD || p.y < -CULL_PAD || p.x > size.x + CULL_PAD || p.y > size.y + CULL_PAD) continue

            const icon = iconFor(m.typeSlug)
            if (!icon) continue

            const w = icon.width
            const h = icon.height
            const ax = icon.anchorX ?? w / 2
            const ay = icon.anchorY ?? h            // default: point sits on the pin's tip
            const x = p.x - ax
            const y = p.y - ay

            const found = isFound(m.id)
            const selected = m.id === this._selectedId

            ctx.globalAlpha = found ? 0.35 : 1
            if (selected) {
                // A soft halo rather than a scale bump — scaling the sprite would
                // resample the artwork and look mushy against its neighbours.
                ctx.save()
                ctx.globalAlpha = 1
                ctx.beginPath()
                ctx.arc(p.x, p.y - h / 2 + (h - ay), Math.max(w, h) * 0.62, 0, Math.PI * 2)
                ctx.fillStyle = 'rgba(120, 190, 255, 0.32)'
                ctx.fill()
                ctx.restore()
                ctx.globalAlpha = found ? 0.5 : 1
            }

            ctx.drawImage(
                sprite,
                icon.offsetX * spriteScale, icon.offsetY * spriteScale,
                w * spriteScale, h * spriteScale,
                x, y, w, h,
            )
            drawn.push({ m, x, y, w, h })
        }

        ctx.globalAlpha = 1
        this._drawn = drawn
    },

    /** Topmost marker under a container point, or null. */
    _hit(this: any, cp: L.Point) {
        const drawn = this._drawn
        for (let i = drawn.length - 1; i >= 0; i--) {
            const d = drawn[i]
            if (cp.x >= d.x && cp.x <= d.x + d.w && cp.y >= d.y && cp.y <= d.y + d.h) return d.m
        }
        return null
    },

    _onClick(this: any, e: L.LeafletMouseEvent) {
        const hit = this._hit(e.containerPoint)
        this._opts.onSelect(hit)
    },

    _onMouseMove(this: any, e: L.LeafletMouseEvent) {
        const hit = this._hit(e.containerPoint)
        const el = this._map.getContainer() as HTMLElement
        el.style.cursor = hit ? 'pointer' : ''
    },
})

export function createMarkerLayer(markers: MapMarker[], options: MarkerLayerOptions): any {
    // @ts-expect-error — L.Layer.extend has no typed constructor signature
    return new MarkerCanvasLayer(markers, options)
}

/** Load an <img> and resolve once decoded, so first paint never draws a blank sheet. */
export function loadSprite(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error(`Failed to load marker sprite: ${url}`))
        img.src = url
    })
}
