export type NoteColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple' | 'red'
export type NoteSize  = 'sm' | 'md' | 'lg'

export interface StickyNote {
    id:       string
    label:    string
    message:  string
    from:     string
    size:     NoteSize
    color:    NoteColor
    rotation: number
}

export interface StickyWallOptions {
    title?:    string
    notes?:    Partial<StickyNote>[]
    editable?: boolean
    tape?:     boolean
    draggable?: boolean
    addForm?:  'inline' | 'modal'
    colors?:   null | string | string[]
}

export type StickyWallEvent = 'sw:add' | 'sw:update' | 'sw:remove' | 'sw:reset' | 'sw:reorder'

export class StickyWall {
    constructor(el: HTMLElement, options?: StickyWallOptions)
    add(note: Partial<StickyNote>): StickyNote
    update(id: string, changes: Partial<Omit<StickyNote, 'id'>>): void
    remove(id: string): void
    reset(notes: Partial<StickyNote>[]): void
    get(id: string): StickyNote | null
    serialize(): StickyNote[]
    toJSON(): StickyNote[]
    on(event: StickyWallEvent, fn: (payload: any) => void): this
    off(event: StickyWallEvent, fn: (payload: any) => void): this
    destroy(): void
}
